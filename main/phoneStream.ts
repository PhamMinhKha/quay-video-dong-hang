import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { nativeImage } from 'electron';
import jsQR from 'jsqr';

const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_PORT = 18080;

export type PhoneQrPayload = {
  data: string;
  width: number;
  height: number;
  location: {
    topLeftCorner: { x: number; y: number };
    bottomRightCorner: { x: number; y: number };
  };
} | null;

let previewProc: ChildProcess | null = null;
let recordProc: ChildProcess | null = null;
let previewServer: http.Server | null = null;
const clients = new Set<http.ServerResponse>();
let jpegBuffer = Buffer.alloc(0);
let latestJpeg: Buffer | null = null;
let currentRtspUrl = '';
let frameEmitter: ((b64: string) => void) | null = null;
let qrEmitter: ((payload: PhoneQrPayload) => void) | null = null;
let lastEmitAt = 0;
let lastQrScanAt = 0;
let lastQrIpcAt = 0;
let qrBusy = false;
let lastEmittedQrText: string | null = null;
let qrMissStreak = 0;
let recordOutputPath = '';
let recordDeathEmitter: ((info: { message: string }) => void) | null = null;
let recordStopExpected = false;

export function setPhoneFrameEmitter(fn: ((b64: string) => void) | null) {
  frameEmitter = fn;
}

export function setPhoneQrEmitter(fn: ((payload: PhoneQrPayload) => void) | null) {
  qrEmitter = fn;
}

export function setPhoneRecordDeathEmitter(fn: ((info: { message: string }) => void) | null) {
  recordDeathEmitter = fn;
}

/** Quét QR — thu nhỏ frame + chạy setImmediate để không chặn MJPEG/preview */
function scanQrFromJpeg(jpeg: Buffer): void {
  if (!qrEmitter || qrBusy) return;
  const now = Date.now();
  // Cùng mã đã có: quét thưa hơn; mã mới / chưa có: nhanh hơn một chút
  const minGap = lastEmittedQrText ? 450 : 300;
  if (now - lastQrScanAt < minGap) return;
  lastQrScanAt = now;
  qrBusy = true;

  // Tách khỏi vòng broadcast JPEG — tránh đứng hình preview khi jsQR nặng
  setImmediate(() => {
    const emit = qrEmitter;
    if (!emit) {
      qrBusy = false;
      return;
    }
    try {
      let img = nativeImage.createFromBuffer(jpeg);
      if (img.isEmpty()) return;

      const full = img.getSize();
      if (full.width < 40 || full.height < 40) return;

      // Thu nhỏ trước khi jsQR (720p full-frame rất nặng trên main)
      const maxW = 360;
      const scale = Math.min(1, maxW / full.width);
      const width = Math.max(1, Math.round(full.width * scale));
      const height = Math.max(1, Math.round(full.height * scale));
      if (scale < 1) {
        img = img.resize({ width, height, quality: 'good' });
      }

      const bgra = img.toBitmap();
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const o = i * 4;
        rgba[o] = bgra[o + 2];
        rgba[o + 1] = bgra[o + 1];
        rgba[o + 2] = bgra[o];
        rgba[o + 3] = 255;
      }

      const result = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
      const text = (result?.data || '').trim();
      if (text) {
        qrMissStreak = 0;
        const isNew = lastEmittedQrText !== text;
        if (isNew) {
          console.log('✅ [main] QR:', text);
          lastEmittedQrText = text;
        }
        // Cùng mã: chỉ gửi IPC thưa (đủ để UI biết còn thấy)
        if (isNew || now - lastQrIpcAt >= 700) {
          lastQrIpcAt = Date.now();
          const inv = scale > 0 ? 1 / scale : 1;
          emit({
            data: text,
            width: full.width,
            height: full.height,
            location: {
              topLeftCorner: {
                x: result!.location.topLeftCorner.x * inv,
                y: result!.location.topLeftCorner.y * inv,
              },
              bottomRightCorner: {
                x: result!.location.bottomRightCorner.x * inv,
                y: result!.location.bottomRightCorner.y * inv,
              },
            },
          });
        }
      } else if (lastEmittedQrText !== null) {
        qrMissStreak += 1;
        if (qrMissStreak >= 3) {
          lastEmittedQrText = null;
          qrMissStreak = 0;
          emit(null);
        }
      }
    } catch (err) {
      console.warn('[main] QR scan error:', err);
    } finally {
      qrBusy = false;
    }
  });
}

function resolveFfmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string | null;
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }

  const candidates = [
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg.exe'),
    path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error('Không tìm thấy ffmpeg. Cần ffmpeg-static để xem/ghi stream RTSP từ AWA.');
}

function broadcastJpeg(jpeg: Buffer) {
  latestJpeg = jpeg;

  // Quét QR (async, không chặn gửi frame preview)
  scanQrFromJpeg(jpeg);

  // Frame base64 tùy chọn (debug) — không dùng cho QR nữa
  if (frameEmitter) {
    const now = Date.now();
    if (now - lastEmitAt >= 1000) {
      lastEmitAt = now;
      try {
        frameEmitter(jpeg.toString('base64'));
      } catch {
        /* ignore */
      }
    }
  }

  if (clients.size === 0) return;

  const header = Buffer.from(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`
  );
  const part = Buffer.concat([header, jpeg, Buffer.from('\r\n')]);
  for (const res of [...clients]) {
    try {
      res.write(part);
    } catch {
      clients.delete(res);
    }
  }
}

function ensurePreviewServer(): Promise<void> {
  if (previewServer) return Promise.resolve();
  return new Promise((resolve, reject) => {
    previewServer = http.createServer((req, res) => {
      const url = req.url || '';

      // Snapshot 1 frame JPEG — dùng để quét QR ổn định
      if (url.startsWith('/snapshot')) {
        if (!latestJpeg || latestJpeg.length < 100) {
          res.writeHead(503, {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          });
          res.end('no frame');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': latestJpeg.length,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        });
        res.end(latestJpeg);
        return;
      }

      if (!url.startsWith('/preview')) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      clients.add(res);
      if (latestJpeg) {
        try {
          const header = Buffer.from(
            `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${latestJpeg.length}\r\n\r\n`
          );
          res.write(Buffer.concat([header, latestJpeg, Buffer.from('\r\n')]));
        } catch {
          /* ignore */
        }
      }
      req.on('close', () => clients.delete(res));
    });
    previewServer.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn('Preview port in use — reuse');
        previewServer = null;
        resolve();
        return;
      }
      reject(err);
    });
    previewServer.listen(PREVIEW_PORT, PREVIEW_HOST, () => {
      console.log(`✅ Phone preview at http://${PREVIEW_HOST}:${PREVIEW_PORT}/preview (+ /snapshot)`);
      resolve();
    });
  });
}

export function getPhonePreviewUrl(): string {
  return `http://${PREVIEW_HOST}:${PREVIEW_PORT}/preview`;
}

export function getCurrentRtspUrl(): string {
  return currentRtspUrl;
}

function attachMjpegReader(proc: ChildProcess) {
  proc.stdout?.on('data', (chunk: Buffer) => {
    jpegBuffer = Buffer.concat([jpegBuffer, chunk]);
    if (jpegBuffer.length > 6 * 1024 * 1024) {
      jpegBuffer = jpegBuffer.subarray(jpegBuffer.length - 1.5 * 1024 * 1024);
    }

    while (true) {
      const start = jpegBuffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) {
        jpegBuffer = Buffer.alloc(0);
        break;
      }
      if (start > 0) jpegBuffer = jpegBuffer.subarray(start);
      const end = jpegBuffer.indexOf(Buffer.from([0xff, 0xd9]), 2);
      if (end < 0) break;
      const jpeg = jpegBuffer.subarray(0, end + 2);
      jpegBuffer = jpegBuffer.subarray(end + 2);
      broadcastJpeg(jpeg);
    }
  });
}

export async function startPhoneRtspPreview(
  rtspUrl: string
): Promise<{ success: boolean; previewUrl: string; message: string }> {
  await stopPhoneRtspPreview();
  await ensurePreviewServer();

  currentRtspUrl = rtspUrl;
  const ffmpeg = resolveFfmpegPath();
  jpegBuffer = Buffer.alloc(0);
  latestJpeg = null;

  // Preview: 720px, 15fps, JPEG chất lượng cao hơn để jsQR đọc được
  const args = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-rtsp_transport',
    'tcp',
    '-fflags',
    'nobuffer',
    '-flags',
    'low_delay',
    '-i',
    rtspUrl,
    '-an',
    '-map',
    '0:v:0',
    '-vf',
    'scale=720:-2',
    '-r',
    '15',
    '-f',
    'mjpeg',
    '-q:v',
    '3',
    'pipe:1',
  ];

  console.log('🎬 Preview 720p/15fps q3:', ffmpeg, args.join(' '));
  const proc = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  previewProc = proc;

  proc.stderr?.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.log('[ffmpeg-preview]', msg);
  });

  attachMjpegReader(proc);

  proc.on('exit', (code, signal) => {
    console.log('ffmpeg preview exited', code, signal);
    if (previewProc === proc) previewProc = null;
  });

  await new Promise((r) => setTimeout(r, 1000));
  if (!previewProc) {
    return {
      success: false,
      previewUrl: '',
      message: `Không mở được RTSP preview ${rtspUrl}. Kiểm tra AWA đang stream + ADB forward 8554.`,
    };
  }

  return {
    success: true,
    previewUrl: getPhonePreviewUrl(),
    message: `Preview 720px/15fps · Quay lưu 1080p · QR quét trong main`,
  };
}

export async function stopPhoneRtspPreview(): Promise<void> {
  if (recordProc) {
    await stopPhoneRecording();
  }
  if (previewProc) {
    try {
      previewProc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    previewProc = null;
  }
  jpegBuffer = Buffer.alloc(0);
  // Không đóng HTTP clients cứng — để img reconnect khi start lại
}

export async function startPhoneRecording(
  outputPath: string
): Promise<{ success: boolean; message: string }> {
  if (!currentRtspUrl) {
    return { success: false, message: 'Chưa có RTSP URL — hãy kết nối điện thoại trước.' };
  }
  if (recordProc) {
    return { success: false, message: 'Đang quay rồi.' };
  }

  const ffmpeg = resolveFfmpegPath();
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const tryOnce = async (): Promise<boolean> => {
    recordOutputPath = outputPath;
    // RTSP ổn định hơn khi mở song song với preview (analyzeduration/probesize)
    const args = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-rtsp_transport',
      'tcp',
      '-analyzeduration',
      '10000000',
      '-probesize',
      '10000000',
      '-fflags',
      '+genpts',
      '-i',
      currentRtspUrl,
      '-an',
      '-map',
      '0:v:0',
      '-vf',
      'scale=1920:-2',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '24',
      '-movflags',
      '+faststart',
      '-y',
      outputPath,
    ];

    console.log('🔴 Record 1080p:', args.join(' '));
    recordStopExpected = false;
    const proc = spawn(ffmpeg, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    recordProc = proc;

    proc.stderr?.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.log('[ffmpeg-record]', msg);
    });

    proc.on('exit', (code, signal) => {
      console.log('ffmpeg record exited', code, signal);
      if (recordProc === proc) {
        recordProc = null;
        if (!recordStopExpected && recordDeathEmitter) {
          try {
            recordDeathEmitter({
              message: 'Phiên quay bị dừng sớm (ffmpeg/RTSP). Bấm Quay lại để tiếp tục.',
            });
          } catch {
            /* ignore */
          }
        }
      }
    });

    // Chờ đủ lâu để bắt lỗi "Output file does not contain any stream"
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (!recordProc) return false;
    }
    return true;
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const ok = await tryOnce();
    if (ok) {
      return { success: true, message: `Đang ghi 1080p → ${path.basename(outputPath)}` };
    }
    console.warn(`ffmpeg record thử ${attempt}/3 thất bại — retry...`);
    try {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  recordOutputPath = '';
  return {
    success: false,
    message: 'Không ghi được video từ RTSP (ffmpeg thoát sớm). Thử Kết nối lại điện thoại rồi Quay.',
  };
}

export async function stopPhoneRecording(): Promise<{
  success: boolean;
  path?: string;
  message: string;
}> {
  const proc = recordProc;
  const out = recordOutputPath;
  if (!proc) {
    return { success: false, message: 'Không có phiên quay nào.' };
  }

  recordStopExpected = true;
  recordProc = null;
  recordOutputPath = '';

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    proc.once('exit', done);
    try {
      proc.stdin?.write('q');
      proc.stdin?.end();
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      done();
    }, 4000);
  });

  // Đợi file flush
  await new Promise((r) => setTimeout(r, 300));

  if (out && fs.existsSync(out) && fs.statSync(out).size > 0) {
    return { success: true, path: out, message: 'Đã lưu video 1080p.' };
  }
  return { success: false, message: 'File quay trống hoặc không tạo được.' };
}

export async function disposePhonePreview(): Promise<void> {
  await stopPhoneRecording();
  await stopPhoneRtspPreview();
  for (const res of clients) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  clients.clear();
  if (previewServer) {
    await new Promise<void>((resolve) => {
      previewServer?.close(() => resolve());
    });
    previewServer = null;
  }
  currentRtspUrl = '';
  latestJpeg = null;
  frameEmitter = null;
}
