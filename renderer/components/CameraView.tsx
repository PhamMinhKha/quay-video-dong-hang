import React, { useRef, useEffect, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import QRDetector from './QRDetector';
import { VideoMetadata } from '../../main/preload';

interface QRDetection {
  text: string;
  time: number;
  bbox: { x: number; y: number; w: number; h: number };
}

const CAMERA_PREF_KEY = 'preferredCameraId';

/** Nhận diện webcam ảo từ AWC / Softcam / Android Webcam Project */
const isAwcCamera = (label: string): boolean => {
  const name = (label || '').toLowerCase();
  return (
    name.includes('awc') ||
    name.includes('awa') ||
    name.includes('softcam') ||
    name.includes('android webcam') ||
    name.includes('virtual cam') ||
    name.includes('virtual webcam') ||
    name.includes('obs virtual')
  );
};

/** Stream module-level — HMR/React remount không làm sót track cũ (gây Device in use) */
let sharedCameraStream: MediaStream | null = null;

async function releaseSharedCamera(waitMs = 800): Promise<void> {
  if (sharedCameraStream) {
    sharedCameraStream.getTracks().forEach(track => {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    });
    sharedCameraStream = null;
  }
  if (waitMs > 0) {
    await new Promise(r => setTimeout(r, waitMs));
  }
}

async function acquireCamera(deviceId: string): Promise<MediaStream> {
  await releaseSharedCamera(1000);

  const attempts: MediaStreamConstraints[] = [
    // Softcam thường fail nếu ép resolution — thử tối giản trước
    { video: { deviceId: { exact: deviceId } }, audio: false },
    { video: { deviceId: { ideal: deviceId } }, audio: false },
    {
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    },
  ];

  let lastError: unknown = null;

  for (let round = 0; round < 3; round++) {
    if (round > 0) {
      await releaseSharedCamera(1200);
    }
    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        sharedCameraStream = stream;
        return stream;
      } catch (e) {
        lastError = e;
        console.warn(`[camera] attempt failed (round ${round})`, constraints, e);
      }
    }
  }

  throw lastError || new Error('getUserMedia failed');
}

const CameraView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const phoneImgRef = useRef<HTMLImageElement>(null);
  /** Ảnh riêng để quét QR (MJPEG HTTP không drawImage ổn định) */
  const phoneScanImgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimeRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceModeRef = useRef<'webcam' | 'phone'>('webcam');

  const [isRecording, setIsRecording] = useState(false);
  const [detections, setDetections] = useState<QRDetection[]>([]);
  const [notes, setNotes] = useState('');
  const [recordedDetections, setRecordedDetections] = useState<QRDetection[]>([]);
  /** QR cuối cùng đã thấy — giữ trên preview kể cả khi mã ra khỏi khung */
  const [lastSeenQr, setLastSeenQr] = useState<{ text: string; time: number } | null>(null);
  /** Flash ngắn chỉ khi đổi sang mã QR khác */
  const [qrNewFlash, setQrNewFlash] = useState(false);
  const detectionHistoryRef = useRef<Set<string>>(new Set());
  const recordedDetectionsRef = useRef<QRDetection[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [cameraError, setCameraError] = useState<string>('');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isOpeningCamera, setIsOpeningCamera] = useState(false);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentQRRef = useRef<string | null>(null); // QR hiện tại đang được detect
  const qrStartTimeRef = useRef<{ [qrText: string]: number }>({}); // Thời điểm bắt đầu của mỗi QR
  const startingCameraRef = useRef(false);
  const detectLoopActiveRef = useRef(false);
  const lastQrScanRef = useRef(0);
  const lastRecordDrawRef = useRef(0);
  const frameSizeRef = useRef({ w: 640, h: 480 });
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastDetectionTextRef = useRef<string | null>(null);
  const latestLiveDetectionRef = useRef<QRDetection | null>(null);
  /** Chờ xác nhận vài frame trước khi lưu — tránh lưu khi QR vừa biến mất / nhiễu 1 frame */
  const pendingSaveQrRef = useRef<{ text: string; hits: number; detection: QRDetection } | null>(null);
  const qrLostTimerRef = useRef<number | null>(null);
  const qrFlashTimerRef = useRef<number | null>(null);
  const lastAnnouncedQrRef = useRef<string | null>(null);
  const phoneQrTimerRef = useRef<number | null>(null);
  const phoneQrBusyRef = useRef(false);
  const phoneQrUnsubRef = useRef<(() => void) | null>(null);
  /** QR chính của clip đang quay — đổi mã khác → tách file */
  const segmentQrRef = useRef<string | null>(null);
  const rotatingRef = useRef(false);
  const webcamExtRef = useRef('webm');
  const webcamMimeRef = useRef('video/webm');
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const [activeSegmentQr, setActiveSegmentQr] = useState<string | null>(null);
  const [sessionSavedCount, setSessionSavedCount] = useState(0);

  // Nguồn ảnh: webcam máy tính HOẶC điện thoại AWA (như AWC, không cần Virtual Cam)
  const [sourceMode, setSourceMode] = useState<'webcam' | 'phone'>('phone');
  const [phoneLink, setPhoneLink] = useState<'usb' | 'wifi'>('usb');
  const [phoneIp, setPhoneIp] = useState('192.168.1.1');
  const [phonePort, setPhonePort] = useState('8080');
  const [adbDevices, setAdbDevices] = useState<Array<{ id: string; model: string; status: string }>>([]);
  const [selectedAdbDevice, setSelectedAdbDevice] = useState('');
  const [mjpegUrl, setMjpegUrl] = useState('');
  const [phoneStatus, setPhoneStatus] = useState('');
  const [phoneConnecting, setPhoneConnecting] = useState(false);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const stopCameraStream = useCallback(async (waitMs = 800) => {
    detectLoopActiveRef.current = false;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    streamRef.current = null;
    await releaseSharedCamera(waitMs);
    setIsCameraReady(false);
  }, []);

  // Âm thanh chỉ khi đổi sang mã QR khác (không beep lại cùng mã)
  const playQRDetectionSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.22, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.15);
    } catch {
      /* ignore */
    }
  }, []);

  const announceNewQr = useCallback(
    (text: string) => {
      if (lastAnnouncedQrRef.current === text) return;
      lastAnnouncedQrRef.current = text;
      // Beep lệch 1 tick — tránh giật preview lúc gắn mã lần đầu
      window.setTimeout(() => playQRDetectionSound(), 0);
      setQrNewFlash(true);
      if (qrFlashTimerRef.current != null) window.clearTimeout(qrFlashTimerRef.current);
      qrFlashTimerRef.current = window.setTimeout(() => setQrNewFlash(false), 450);
    },
    [playQRDetectionSound]
  );

  const makeVideoFilename = useCallback((ext: string, qr?: string | null) => {
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    const slug = qr
      ? `__${String(qr).replace(/[^a-zA-Z0-9\u00C0-\u024F._-]+/g, '-').replace(/-+/g, '-').slice(0, 48)}`
      : '';
    return `${ts}${slug}.${ext}`;
  }, []);

  const scalePhoneDetections = useCallback((list: QRDetection[]) => {
    const pw = frameSizeRef.current.w || 720;
    const scaleToRecord = 1920 / pw;
    return list.map((d) => ({
      ...d,
      bbox: {
        x: d.bbox.x * scaleToRecord,
        y: d.bbox.y * scaleToRecord,
        w: d.bbox.w * scaleToRecord,
        h: d.bbox.h * scaleToRecord,
      },
    }));
  }, []);

  const resetSegmentTracking = useCallback(() => {
    recordedDetectionsRef.current = [];
    setRecordedDetections([]);
    detectionHistoryRef.current.clear();
    qrStartTimeRef.current = {};
    pendingSaveQrRef.current = null;
    segmentQrRef.current = null;
    setActiveSegmentQr(null);
    currentQRRef.current = null;
  }, []);

  const assignSegmentQr = useCallback((detection: QRDetection) => {
    const at: QRDetection = {
      text: detection.text,
      time: detection.time,
      bbox: detection.bbox,
    };
    detectionHistoryRef.current.add(detection.text);
    qrStartTimeRef.current[detection.text] = at.time;
    currentQRRef.current = detection.text;
    segmentQrRef.current = detection.text;
    setActiveSegmentQr(detection.text);
    recordedDetectionsRef.current = [at];
    setRecordedDetections([at]);
    console.log('📎 Gắn QR vào clip:', detection.text);
  }, []);

  const startPhoneSegment = useCallback(
    async (qrForName?: string | null) => {
      const filename = makeVideoFilename('mp4', qrForName);
      const started = await window.electronAPI.phoneStartRecord(filename);
      if (!started.success) {
        return { ok: false as const, message: started.message || 'Không bắt đầu quay được' };
      }
      startTimeRef.current = Date.now();
      recordingTimeRef.current = 0;
      setRecordingTime(0);
      if (!recordingIntervalRef.current) {
        recordingIntervalRef.current = setInterval(() => {
          setRecordingTime((prev) => prev + 1);
        }, 1000);
      }
      return { ok: true as const, message: started.message };
    },
    [makeVideoFilename]
  );

  const stopPhoneSegment = useCallback(async () => {
    // An toàn: nếu đang thấy QR mà chưa gắn vào clip → gắn trước khi lưu
    if (
      recordedDetectionsRef.current.length === 0 &&
      latestLiveDetectionRef.current?.text &&
      !segmentQrRef.current
    ) {
      assignSegmentQr({ ...latestLiveDetectionRef.current, time: 0 });
    }
    const detectionsForSave = scalePhoneDetections(recordedDetectionsRef.current);
    const metadata: VideoMetadata = {
      video: '',
      createdAt: new Date().toISOString(),
      detections: detectionsForSave,
      notes: notesRef.current,
    };
    console.log('💾 stopPhoneSegment QR:', segmentQrRef.current, detectionsForSave);
    const result = await window.electronAPI.phoneStopRecord(metadata);
    if (result.success) {
      setSessionSavedCount((c) => c + 1);
    }
    return { ...result, qr: segmentQrRef.current, detectionCount: detectionsForSave.length };
  }, [assignSegmentQr, scalePhoneDetections]);

  const startWebcamSegment = useCallback(async () => {
    if (!videoRef.current?.srcObject) {
      return { ok: false as const, message: 'Chưa có webcam' };
    }
    const stream = videoRef.current.srcObject as MediaStream;
    const videoBitsPerSecond = 6_000_000;
    let options: MediaRecorderOptions;
    let fileExtension: string;

    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
      options = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond };
      fileExtension = 'webm';
    } else if (MediaRecorder.isTypeSupported('video/mp4')) {
      options = { mimeType: 'video/mp4', videoBitsPerSecond };
      fileExtension = 'mp4';
    } else {
      options = { mimeType: 'video/webm', videoBitsPerSecond };
      fileExtension = 'webm';
    }

    webcamExtRef.current = fileExtension;
    webcamMimeRef.current = options.mimeType || 'video/webm';
    startTimeRef.current = Date.now();
    recordingTimeRef.current = 0;
    setRecordingTime(0);
    if (!recordingIntervalRef.current) {
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    }

    const recorder = new MediaRecorder(stream, options);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mediaRecorderRef.current = recorder;
    recorder.start(250);
    return { ok: true as const };
  }, []);

  const stopWebcamSegment = useCallback(async () => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === 'inactive') return { ok: true as const };

    const mime = webcamMimeRef.current;
    const ext = webcamExtRef.current;
    const detectionsSnapshot = [...recordedDetectionsRef.current];

    await new Promise<void>((resolve) => {
      rec.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mime });
          const qr = segmentQrRef.current;
          const filename = makeVideoFilename(ext, qr);
          const arrayBuffer = await blob.arrayBuffer();
          const metadata: VideoMetadata = {
            video: filename,
            createdAt: new Date().toISOString(),
            detections: detectionsSnapshot,
            notes: notesRef.current,
          };
          await window.electronAPI.saveVideo({ filename, buffer: arrayBuffer, metadata });
          setSessionSavedCount((c) => c + 1);
        } catch (err) {
          console.error('Lỗi lưu webcam segment:', err);
        }
        resolve();
      };
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
    mediaRecorderRef.current = null;
    return { ok: true as const };
  }, [makeVideoFilename]);

  const rotateRecordingForNewQr = useCallback(
    async (detection: QRDetection) => {
      if (rotatingRef.current || startTimeRef.current <= 0) return;
      rotatingRef.current = true;
      pendingSaveQrRef.current = null;
      const prevQr = segmentQrRef.current;
      console.log('🔄 Tách clip:', prevQr, '→', detection.text);
      setPhoneStatus(`Đang tách clip${prevQr ? ` · ${prevQr}` : ''}…`);

      // Nhường 1 frame cho UI/preview trước khi stop ffmpeg (tránh đứng hình cảm nhận nặng)
      await new Promise((r) => setTimeout(r, 50));

      try {
        if (sourceModeRef.current === 'phone') {
          const stopped = await stopPhoneSegment();
          if (!stopped.success) {
            setPhoneStatus(stopped.message || 'Lỗi lưu clip khi đổi QR');
            return;
          }
          resetSegmentTracking();
          // Nghỉ ngắn trước khi mở RTSP ghi mới (tránh AWA/ffmpeg nghẽn)
          await new Promise((r) => setTimeout(r, 300));
          const started = await startPhoneSegment(detection.text);
          if (!started.ok) {
            setIsRecording(false);
            startTimeRef.current = 0;
            if (recordingIntervalRef.current) {
              clearInterval(recordingIntervalRef.current);
              recordingIntervalRef.current = null;
            }
            setPhoneStatus(started.message);
            alert(started.message);
            return;
          }
          setIsRecording(true);
          assignSegmentQr({ ...detection, time: 0 });
          setPhoneStatus(
            `Đã lưu${prevQr ? ` · ${prevQr}` : ''} → đang quay · ${detection.text}`
          );
        } else {
          await stopWebcamSegment();
          resetSegmentTracking();
          const started = await startWebcamSegment();
          if (!started.ok) {
            setIsRecording(false);
            startTimeRef.current = 0;
            if (recordingIntervalRef.current) {
              clearInterval(recordingIntervalRef.current);
              recordingIntervalRef.current = null;
            }
            alert(started.message);
            return;
          }
          setIsRecording(true);
          assignSegmentQr({ ...detection, time: 0 });
          setPhoneStatus(
            `Đã lưu${prevQr ? ` · ${prevQr}` : ''} → đang quay · ${detection.text}`
          );
        }
      } catch (err) {
        console.error('rotateRecordingForNewQr:', err);
        setPhoneStatus('Lỗi tách clip theo QR');
      } finally {
        rotatingRef.current = false;
      }
    },
    [
      assignSegmentQr,
      resetSegmentTracking,
      startPhoneSegment,
      stopPhoneSegment,
      startWebcamSegment,
      stopWebcamSegment,
    ]
  );

  const applyQrResult = useCallback((result: ReturnType<typeof jsQR>, scale: number) => {
    // QR biến mất tạm — không xóa pending gắn mã (tránh video không có QR)
    if (!result) {
      latestLiveDetectionRef.current = null;
      if (qrLostTimerRef.current != null) window.clearTimeout(qrLostTimerRef.current);
      qrLostTimerRef.current = window.setTimeout(() => {
        if (latestLiveDetectionRef.current) return;
        pendingSaveQrRef.current = null;
        if (lastDetectionTextRef.current !== null) {
          lastDetectionTextRef.current = null;
          currentQRRef.current = null;
          setDetections([]);
        }
      }, 600);
      return;
    }

    const rawText = (result.data || '').trim();
    if (!rawText) return;

    if (qrLostTimerRef.current != null) {
      window.clearTimeout(qrLostTimerRef.current);
      qrLostTimerRef.current = null;
    }

    const inv = scale > 0 ? 1 / scale : 1;
    const recording = startTimeRef.current > 0;
    const currentTime = recording
      ? Math.max(0, (Date.now() - startTimeRef.current) / 1000)
      : 0;

    const detection: QRDetection = {
      text: rawText,
      time: currentTime,
      bbox: {
        x: result.location.topLeftCorner.x * inv,
        y: result.location.topLeftCorner.y * inv,
        w: (result.location.bottomRightCorner.x - result.location.topLeftCorner.x) * inv,
        h: (result.location.bottomRightCorner.y - result.location.topLeftCorner.y) * inv,
      },
    };

    latestLiveDetectionRef.current = detection;

    const isNewText = lastAnnouncedQrRef.current !== detection.text;
    if (isNewText) {
      setLastSeenQr({ text: detection.text, time: currentTime });
      announceNewQr(detection.text);
    } else {
      setLastSeenQr((prev) => {
        if (!prev || prev.text !== detection.text) {
          return { text: detection.text, time: currentTime };
        }
        if (recording && Math.abs(prev.time - currentTime) >= 0.5) {
          return { text: prev.text, time: currentTime };
        }
        return prev;
      });
    }

    if (lastDetectionTextRef.current !== detection.text) {
      lastDetectionTextRef.current = detection.text;
      setDetections([detection]);
    } else {
      setDetections((prev) => {
        if (!prev[0]) return [detection];
        const p = prev[0].bbox;
        const b = detection.bbox;
        if (
          Math.abs(p.x - b.x) < 12 &&
          Math.abs(p.y - b.y) < 12 &&
          Math.abs(p.w - b.w) < 12 &&
          Math.abs(p.h - b.h) < 12
        ) {
          return prev;
        }
        return [detection];
      });
    }

    if (!recording || rotatingRef.current) {
      return;
    }

    // Cùng mã đã gắn clip → bỏ qua
    if (
      detectionHistoryRef.current.has(detection.text) ||
      segmentQrRef.current === detection.text
    ) {
      pendingSaveQrRef.current = null;
      return;
    }

    // Xác nhận 1 frame ổn định là đủ (trước đây 2 frame + null xen kẽ → không bao giờ gắn)
    const CONFIRM_HITS = 1;
    const pending = pendingSaveQrRef.current;
    if (!pending || pending.text !== detection.text) {
      pendingSaveQrRef.current = { text: detection.text, hits: 1, detection };
      if (CONFIRM_HITS > 1) return;
    } else {
      pending.hits += 1;
      pending.detection = detection;
      if (pending.hits < CONFIRM_HITS) return;
    }

    pendingSaveQrRef.current = null;

    // Clip chưa có QR → gắn mã ngay
    if (!segmentQrRef.current) {
      assignSegmentQr(detection);
      setPhoneStatus(`Đang quay · ${detection.text}`);
      return;
    }

    // Clip đã có mã khác → lưu clip cũ + mở clip mới
    void rotateRecordingForNewQr(detection);
  }, [announceNewQr, assignSegmentQr, rotateRecordingForNewQr]);

  const stopPhoneQrLoop = useCallback(() => {
    if (phoneQrUnsubRef.current) {
      phoneQrUnsubRef.current();
      phoneQrUnsubRef.current = null;
    }
    if (phoneQrTimerRef.current != null) {
      window.clearInterval(phoneQrTimerRef.current);
      phoneQrTimerRef.current = null;
    }
    phoneQrBusyRef.current = false;
  }, []);

  /** QR từ main process (nativeImage + jsQR trên JPEG) — ổn định hơn snapshot/fetch */
  const startPhoneQrLoop = useCallback(() => {
    stopPhoneQrLoop();
    if (!window.electronAPI?.onPhoneQr) {
      console.warn('onPhoneQr API chưa có — rebuild preload');
      return;
    }
    phoneQrUnsubRef.current = window.electronAPI.onPhoneQr((payload) => {
      if (sourceModeRef.current !== 'phone') return;
      if (!payload) {
        applyQrResult(null, 1);
        return;
      }
      frameSizeRef.current = { w: payload.width, h: payload.height };
      applyQrResult(
        {
          data: payload.data,
          location: {
            topLeftCorner: payload.location.topLeftCorner,
            topRightCorner: {
              x: payload.location.bottomRightCorner.x,
              y: payload.location.topLeftCorner.y,
            },
            bottomLeftCorner: {
              x: payload.location.topLeftCorner.x,
              y: payload.location.bottomRightCorner.y,
            },
            bottomRightCorner: payload.location.bottomRightCorner,
          },
        } as ReturnType<typeof jsQR>,
        1
      );
    });
  }, [stopPhoneQrLoop, applyQrResult]);

  const detectQR = useCallback(() => {
    if (!detectLoopActiveRef.current) return;
    // Phone dùng startPhoneQrLoop (snapshot) — không dùng rAF path
    if (sourceModeRef.current === 'phone') return;

    const now = performance.now();
    const QR_INTERVAL_MS = 200;
    const RECORD_INTERVAL_MS = 1000 / 24;

    const getSource = (): { draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; w: number; h: number } | null => {
      const video = videoRef.current;
      if (!video || video.readyState < video.HAVE_CURRENT_DATA || video.videoWidth <= 0) return null;
      return {
        w: video.videoWidth,
        h: video.videoHeight,
        draw: (ctx, w, h) => ctx.drawImage(video, 0, 0, w, h),
      };
    };

    const source = getSource();
    if (source) {
      frameSizeRef.current = { w: source.w, h: source.h };

      const isRec = startTimeRef.current > 0;
      if (isRec && canvasRef.current && now - lastRecordDrawRef.current >= RECORD_INTERVAL_MS) {
        lastRecordDrawRef.current = now;
        const canvas = canvasRef.current;
        if (canvas.width !== source.w || canvas.height !== source.h) {
          canvas.width = source.w;
          canvas.height = source.h;
        }
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) source.draw(ctx, source.w, source.h);
      }

      if (now - lastQrScanRef.current >= QR_INTERVAL_MS) {
        lastQrScanRef.current = now;

        if (!scanCanvasRef.current) {
          scanCanvasRef.current = document.createElement('canvas');
        }
        const scan = scanCanvasRef.current;
        const maxW = 480;
        const scale = Math.min(1, maxW / source.w);
        const dw = Math.max(1, Math.floor(source.w * scale));
        const dh = Math.max(1, Math.floor(source.h * scale));
        if (scan.width !== dw || scan.height !== dh) {
          scan.width = dw;
          scan.height = dh;
        }
        const sctx = scan.getContext('2d', { willReadFrequently: true, alpha: false });
        if (sctx) {
          source.draw(sctx, dw, dh);
          const imageData = sctx.getImageData(0, 0, dw, dh);
          const result = jsQR(imageData.data, dw, dh, { inversionAttempts: 'attemptBoth' });
          applyQrResult(result, scale);
        }
      }
    }

    if (detectLoopActiveRef.current && sourceModeRef.current !== 'phone') {
      requestAnimationFrame(detectQR);
    }
  }, [applyQrResult]);

  const refreshAdbDevices = useCallback(async () => {
    setPhoneStatus('Đang quét thiết bị USB...');
    try {
      if (!window.electronAPI?.adbGetDevices) {
        setPhoneStatus('Thiếu API ADB — hãy khởi động lại ứng dụng (npm run dev).');
        return;
      }
      const res = await window.electronAPI.adbGetDevices();
      if (!res.success) {
        setAdbDevices([]);
        setPhoneStatus(res.error || 'Không quét được ADB');
        return;
      }
      setAdbDevices(res.devices);
      if (res.devices.length === 0) {
        setPhoneStatus('Không thấy điện thoại. Bật USB debugging + mở app AWA, rồi bấm Làm mới.');
        return;
      }
      setSelectedAdbDevice(prev => {
        if (prev && res.devices.some(d => d.id === prev)) return prev;
        return res.devices[0].id;
      });
      setPhoneStatus(`Tìm thấy ${res.devices.length} thiết bị — chọn rồi bấm Kết nối.`);
    } catch (e: any) {
      setPhoneStatus(e?.message || String(e));
    }
  }, []);

  const disconnectPhone = useCallback(async () => {
    detectLoopActiveRef.current = false;
    stopPhoneQrLoop();
    setMjpegUrl('');
    setIsCameraReady(false);
    setDetections([]);
    setPhoneStatus('Đã ngắt kết nối điện thoại.');
    if (phoneImgRef.current) {
      phoneImgRef.current.removeAttribute('src');
    }
    try {
      await window.electronAPI.phoneStopRtsp?.();
    } catch {
      /* ignore */
    }
  }, [stopPhoneQrLoop]);

  const connectPhone = useCallback(async () => {
    if (isRecording || phoneConnecting) return;
    setPhoneConnecting(true);
    setCameraError('');
    setPhoneStatus('Đang kết nối...');

    try {
      await stopCameraStream(200);
      stopPhoneQrLoop();
      try {
        await window.electronAPI.phoneStopRtsp?.();
      } catch {
        /* ignore */
      }

      let host = phoneIp.trim();
      let httpPort = phonePort.trim() || '8080';

      if (phoneLink === 'usb') {
        if (!selectedAdbDevice) {
          throw new Error('Hãy chọn điện thoại trong danh sách USB (vd: Pixel 7 Pro).');
        }
        if (selectedAdbDevice !== '__localhost__') {
          const fwd = await window.electronAPI.adbForwardDevice(selectedAdbDevice);
          if (!fwd.success) throw new Error(fwd.message);
          setPhoneStatus(fwd.message);
        }
        host = '127.0.0.1';
        httpPort = '8080';
      }

      const base = `http://${host}:${httpPort}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      let features: any = null;
      try {
        const res = await fetch(`${base}/features`, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        features = await res.json();
      } catch (e: any) {
        clearTimeout(timer);
        throw new Error(
          `Không gọi được ${base}/features. Mở app AWA trên điện thoại và kiểm tra ${phoneLink === 'usb' ? 'USB debugging + ADB' : 'cùng WiFi / IP đúng'}. (${e?.message || e})`
        );
      }

      try {
        await fetch(`${base}/control?resolution_str=${encodeURIComponent('1920x1080')}`, {
          signal: AbortSignal.timeout(2000),
        });
      } catch {
        /* optional */
      }

      const protocol = String(features?.stream_protocol || '').toUpperCase();
      const rtspPort = String(features?.rtsp_port || features?.stream_port || '8554');
      let previewUrl = `${base}/video`;

      if (protocol.includes('RTSP') || protocol.includes('H264')) {
        setPhoneStatus(`Phát hiện ${protocol || 'RTSP'} — đang mở preview qua ffmpeg...`);
        const rtspUrl = `rtsp://${host}:${rtspPort}`;
        const started = await window.electronAPI.phoneStartRtsp(rtspUrl);
        if (!started.success || !started.previewUrl) {
          throw new Error(started.message || 'Không mở được RTSP preview');
        }
        previewUrl = `${started.previewUrl}?t=${Date.now()}`;
        setPhoneStatus(started.message);
      } else {
        previewUrl = `${base}/video?t=${Date.now()}`;
        setPhoneStatus(`Đã kết nối MJPEG ${base}/video`);
      }

      sourceModeRef.current = 'phone';
      setSourceMode('phone');
      setMjpegUrl(previewUrl);
      setIsCameraReady(true);
      detectLoopActiveRef.current = true;
      // Đợi ffmpeg có frame rồi mới quét QR
      setTimeout(() => startPhoneQrLoop(), 800);
    } catch (err: any) {
      setIsCameraReady(false);
      setMjpegUrl('');
      stopPhoneQrLoop();
      setPhoneStatus(err?.message || String(err));
      setCameraError(err?.message || String(err));
    } finally {
      setPhoneConnecting(false);
    }
  }, [isRecording, phoneConnecting, phoneIp, phonePort, phoneLink, selectedAdbDevice, stopCameraStream, stopPhoneQrLoop, startPhoneQrLoop]);

  // Chỉ liệt kê camera — KHÔNG tự mở stream (tránh Device in use với AWC)
  const refreshCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setCameras(videoDevices);

      if (videoDevices.length === 0) {
        setCameraError(
          'Không tìm thấy camera. Hãy mở AWC (desktop) + AWA (điện thoại), kết nối xong rồi bấm Làm mới.'
        );
        return;
      }

      setCameraError('');

      // Chỉ gợi ý lựa chọn trong dropdown — chưa mở camera
      setSelectedCamera(prev => {
        if (prev && videoDevices.some(d => d.deviceId === prev)) return prev;
        const savedId = localStorage.getItem(CAMERA_PREF_KEY) || '';
        if (savedId && videoDevices.some(d => d.deviceId === savedId)) return savedId;
        const awcDevice = videoDevices.find(d => isAwcCamera(d.label));
        return awcDevice?.deviceId || videoDevices[0].deviceId;
      });
    } catch (err) {
      console.error('Error enumerating cameras:', err);
      setCameraError('Không đọc được danh sách camera.');
    }
  }, []);

  // Mở camera CHỈ khi người dùng chọn xong và bấm nút
  const openSelectedCamera = useCallback(async () => {
    if (!selectedCamera) {
      setCameraError('Hãy chọn camera trước khi mở.');
      return;
    }
    if (isRecording || startingCameraRef.current) return;

    startingCameraRef.current = true;
    setIsOpeningCamera(true);
    setCameraError('');
    setIsCameraReady(false);

    try {
      const stream = await acquireCamera(selectedCamera);
      streamRef.current = stream;
      localStorage.setItem(CAMERA_PREF_KEY, selectedCamera);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        sourceModeRef.current = 'webcam';
        setSourceMode('webcam');
        setMjpegUrl('');
        setIsCameraReady(true);
        detectLoopActiveRef.current = true;
        detectQR();
        await refreshCameras();
      }
    } catch (err: any) {
      console.error('Error accessing camera:', err);
      const name = err?.name || 'Error';
      let message = `Không thể truy cập camera (${name}).`;
      if (name === 'NotReadableError' || name === 'TrackStartError' || /in use|Device in use/i.test(err?.message || '')) {
        message =
          'Camera Softcam/AWC đang bị khóa (Device in use).\n' +
          '1) Giữ AWC đang Connect (đang stream) nhưng đóng app Camera Windows / Zoom / Teams.\n' +
          '2) Thử chọn camera khác trong danh sách (không phải laptop cam).\n' +
          '3) Bấm "Thử từng camera" bên dưới để tìm thiết bị mở được.\n' +
          '4) Nếu Softcam luôn lỗi: trong AWC dùng OBS Virtual Camera làm trung gian, hoặc dùng webcam USB.';
      } else if (name === 'OverconstrainedError') {
        message = 'Không mở được đúng camera đã chọn. Hãy Làm mới danh sách và chọn lại.';
      } else if (name === 'NotAllowedError') {
        message = 'Bị từ chối quyền camera. Cho phép trong Windows Settings → Privacy → Camera.';
      } else if (name === 'NotFoundError') {
        message = 'Không tìm thấy camera đã chọn. Bấm Làm mới rồi chọn lại.';
      } else if (err?.message) {
        message += ` ${err.message}`;
      }
      setCameraError(message);
      setIsCameraReady(false);
    } finally {
      startingCameraRef.current = false;
      setIsOpeningCamera(false);
    }
  }, [selectedCamera, isRecording, detectQR, refreshCameras]);

  const probeAllCameras = useCallback(async () => {
    if (isRecording || startingCameraRef.current) return;
    setIsOpeningCamera(true);
    setCameraError('');
    const results: string[] = [];

    try {
      await stopCameraStream(500);
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setCameras(videoDevices);

      for (let i = 0; i < videoDevices.length; i++) {
        const cam = videoDevices[i];
        const label = cam.label || `Camera ${i + 1}`;
        try {
          const stream = await acquireCamera(cam.deviceId);
          const settings = stream.getVideoTracks()[0]?.getSettings?.();
          results.push(
            `OK: ${label}${isAwcCamera(label) ? ' (AWC)' : ''} — ${settings?.width || '?'}x${settings?.height || '?'}`
          );
          // Nhả ngay để thử cam tiếp theo
          await releaseSharedCamera(800);
        } catch (e: any) {
          results.push(`FAIL: ${label}${isAwcCamera(label) ? ' (AWC)' : ''} — ${e?.name || e?.message || e}`);
          await releaseSharedCamera(500);
        }
      }

      setCameraError(
        results.length
          ? 'Kết quả thử camera:\n' + results.join('\n') + '\n\nChọn dòng OK rồi bấm Mở camera.'
          : 'Không có camera để thử.'
      );
    } finally {
      setIsOpeningCamera(false);
    }
  }, [isRecording, stopCameraStream]);

  // Mount: chỉ lấy danh sách — không getUserMedia (tránh khóa AWC)
  useEffect(() => {
    // Dọn stream sót từ HMR lần trước
    releaseSharedCamera(0);
    refreshCameras();
    refreshAdbDevices();

    const onDeviceChange = () => {
      console.log('📷 devicechange — làm mới danh sách camera');
      refreshCameras();
    };
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      detectLoopActiveRef.current = false;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      streamRef.current = null;
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, [refreshCameras, refreshAdbDevices]);

  // ffmpeg ghi hình chết sớm → reset UI (tránh beep QR rồi Dừng báo "không có phiên")
  useEffect(() => {
    if (!window.electronAPI?.onPhoneRecordDied) return;
    return window.electronAPI.onPhoneRecordDied((info) => {
      console.warn('phone-record-died', info);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      startTimeRef.current = 0;
      setIsRecording(false);
      rotatingRef.current = false;
      resetSegmentTracking();
      setPhoneStatus(info.message || 'Phiên quay bị dừng sớm — bấm Quay lại');
    });
  }, [resetSegmentTracking]);

  const startRecording = async () => {
    if (!isCameraReady || rotatingRef.current) return;

    resetSegmentTracking();
    setSessionSavedCount(0);
    recordingTimeRef.current = 0;
    setRecordingTime(0);
    setPhoneStatus('Đang quay — QR mới sẽ tự tách clip');

    if (sourceModeRef.current === 'phone') {
      try {
        const started = await startPhoneSegment(null);
        if (!started.ok) {
          alert(started.message);
          return;
        }
        setIsRecording(true);
        setPhoneStatus(started.message || 'Đang quay · chờ QR đầu tiên');
      } catch (err) {
        console.error(err);
        alert('Lỗi bắt đầu quay từ điện thoại');
      }
      return;
    }

    try {
      const started = await startWebcamSegment();
      if (!started.ok) {
        alert(started.message);
        return;
      }
      setIsRecording(true);
    } catch (err) {
      console.error('Error starting recording:', err);
      setIsRecording(false);
      startTimeRef.current = 0;
    }
  };

  const stopRecording = async () => {
    if (rotatingRef.current) return;

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (sourceModeRef.current === 'phone') {
      try {
        const result = await stopPhoneSegment();
        setIsRecording(false);
        startTimeRef.current = 0;
        resetSegmentTracking();
        if (result.success) {
          setNotes('');
          setPhoneStatus(
            result.qr
              ? `Đã dừng · lưu clip ${result.qr}`
              : result.message || 'Đã lưu video 1080p'
          );
        } else if ((result.message || '').includes('Không có phiên')) {
          // ffmpeg đã chết sớm — không alert gây hiểu nhầm
          setPhoneStatus('Phiên quay đã kết thúc sớm — bấm Quay lại (kiểm tra kết nối điện thoại)');
        } else {
          alert(result.message || 'Lỗi lưu video');
        }
      } catch (err) {
        console.error(err);
        setIsRecording(false);
        startTimeRef.current = 0;
        alert('Lỗi dừng quay');
      }
      return;
    }

    try {
      await stopWebcamSegment();
      setIsRecording(false);
      startTimeRef.current = 0;
      resetSegmentTracking();
      setNotes('');
      setPhoneStatus('Đã lưu video');
    } catch (err) {
      console.error(err);
      setIsRecording(false);
      startTimeRef.current = 0;
      alert('Lỗi dừng quay');
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="h-full relative bg-slate-100 overflow-hidden p-2.5">
      <div className="h-full grid grid-cols-[minmax(0,1fr)_280px] gap-2.5 min-h-0">
        {/* LEFT: preview + controls */}
        <div className="flex flex-col gap-2 min-h-0 min-w-0">
          {/* Video fills remaining height */}
          <div className="relative flex-1 min-h-[220px] bg-black rounded-xl overflow-hidden shadow-md ring-1 ring-black/10">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 w-full h-full object-contain ${sourceMode === 'phone' ? 'hidden' : ''}`}
            />
            <img
              ref={phoneImgRef}
              src={mjpegUrl || undefined}
              alt="AWA phone stream"
              decoding="async"
              className={`absolute inset-0 w-full h-full object-contain bg-black ${sourceMode === 'phone' && mjpegUrl ? '' : 'hidden'}`}
            />

            {isRecording && (
              <div className="absolute top-2 right-2 z-[70] flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-mono text-white shadow">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                REC {formatTime(recordingTime)}
              </div>
            )}

            {lastSeenQr && (
              <div
                className={`absolute top-2 left-2 z-[80] max-w-[min(70%,22rem)] rounded-lg px-2.5 py-1.5 shadow-md ${
                  qrNewFlash ? 'bg-emerald-500 ring-2 ring-white/80' : 'bg-slate-900/90'
                }`}
              >
                <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70">
                  QR gần nhất
                  {isRecording ? ` · ${lastSeenQr.time.toFixed(1)}s` : ''}
                </div>
                <div className="break-all text-sm font-bold leading-snug text-white sm:text-base">
                  {lastSeenQr.text}
                </div>
              </div>
            )}

            {!isCameraReady && (
              <div className="absolute inset-0 z-[40] flex items-center justify-center bg-black/40 px-6 text-center text-sm text-slate-300">
                {sourceMode === 'phone'
                  ? 'Chọn điện thoại rồi bấm Kết nối'
                  : 'Chọn webcam rồi bấm Mở camera'}
              </div>
            )}

            {isCameraReady && sourceMode === 'phone' && (
              <div className="absolute bottom-2 left-2 z-[70] rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/75">
                Preview · Quay 1080p
              </div>
            )}

            <canvas
              ref={canvasRef}
              className="pointer-events-none absolute inset-0 z-[45] h-full w-full opacity-0"
            />
            {detections.map((det) => {
              const canvasWidth = frameSizeRef.current.w || 640;
              const canvasHeight = frameSizeRef.current.h || 480;
              return (
                <div
                  key={det.text}
                  className="pointer-events-none absolute z-[60] rounded border-2 border-emerald-400/90"
                  style={{
                    left: `${(det.bbox.x / canvasWidth) * 100}%`,
                    top: `${(det.bbox.y / canvasHeight) * 100}%`,
                    width: `${(det.bbox.w / canvasWidth) * 100}%`,
                    height: `${(det.bbox.h / canvasHeight) * 100}%`,
                  }}
                />
              );
            })}
          </div>

          {/* Bottom dock: connect + record + notes */}
          <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
            {/* Row 1: source + device + connect */}
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                <button
                  type="button"
                  disabled={isRecording}
                  onClick={() => {
                    setSourceMode('phone');
                    sourceModeRef.current = 'phone';
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    sourceMode === 'phone' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  Điện thoại
                </button>
                <button
                  type="button"
                  disabled={isRecording}
                  onClick={async () => {
                    await disconnectPhone();
                    setSourceMode('webcam');
                    sourceModeRef.current = 'webcam';
                    refreshCameras();
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    sourceMode === 'webcam' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  Webcam
                </button>
              </div>

              {sourceMode === 'phone' ? (
                <>
                  <select
                    value={phoneLink}
                    disabled={isRecording || phoneConnecting}
                    onChange={(e) => setPhoneLink(e.target.value as 'usb' | 'wifi')}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="usb">USB</option>
                    <option value="wifi">WiFi</option>
                  </select>

                  {phoneLink === 'usb' ? (
                    <select
                      value={selectedAdbDevice}
                      disabled={isRecording || phoneConnecting}
                      onChange={(e) => setSelectedAdbDevice(e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                    >
                      {adbDevices.length === 0 ? (
                        <option value="">Chưa có thiết bị</option>
                      ) : (
                        adbDevices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.model} ({d.id.slice(0, 8)})
                          </option>
                        ))
                      )}
                    </select>
                  ) : (
                    <>
                      <input
                        value={phoneIp}
                        onChange={(e) => setPhoneIp(e.target.value)}
                        placeholder="IP"
                        disabled={isRecording || phoneConnecting}
                        className="min-w-[8rem] flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                      />
                      <input
                        value={phonePort}
                        onChange={(e) => setPhonePort(e.target.value)}
                        placeholder="8080"
                        disabled={isRecording || phoneConnecting}
                        className="w-16 rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                      />
                    </>
                  )}

                  {phoneLink === 'usb' && (
                    <button
                      type="button"
                      disabled={isRecording || phoneConnecting}
                      onClick={refreshAdbDevices}
                      className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
                      title="Làm mới thiết bị"
                    >
                      Làm mới
                    </button>
                  )}

                  {mjpegUrl ? (
                    <button
                      type="button"
                      onClick={disconnectPhone}
                      disabled={isRecording}
                      className="rounded-md bg-rose-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
                    >
                      Ngắt
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={connectPhone}
                      disabled={phoneConnecting || isRecording || (phoneLink === 'usb' && !selectedAdbDevice)}
                      className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
                    >
                      {phoneConnecting ? 'Đang kết nối...' : 'Kết nối'}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <select
                    value={selectedCamera}
                    onChange={async (e) => {
                      const id = e.target.value;
                      if (isCameraReady || streamRef.current) {
                        await stopCameraStream(300);
                      }
                      setSelectedCamera(id);
                      localStorage.setItem(CAMERA_PREF_KEY, id);
                      setCameraError('');
                    }}
                    disabled={isRecording || isOpeningCamera || cameras.length === 0}
                    className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs disabled:bg-slate-50"
                  >
                    {cameras.length === 0 ? (
                      <option value="">Chưa có camera</option>
                    ) : (
                      cameras.map((camera, index) => (
                        <option key={camera.deviceId} value={camera.deviceId}>
                          {camera.label || `Camera ${index + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    disabled={isRecording || isOpeningCamera}
                    onClick={() => {
                      setCameraError('');
                      refreshCameras();
                    }}
                    className="rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    Làm mới
                  </button>
                  <button
                    type="button"
                    onClick={openSelectedCamera}
                    disabled={!selectedCamera || isRecording || isOpeningCamera}
                    className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
                  >
                    {isOpeningCamera ? 'Đang mở...' : isCameraReady ? 'Mở lại' : 'Mở camera'}
                  </button>
                </>
              )}

              {isCameraReady && (
                <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  Sẵn sàng
                </span>
              )}
            </div>

            {(phoneStatus || cameraError) && (
              <p className={`mt-1.5 line-clamp-2 text-[11px] leading-snug ${cameraError ? 'text-rose-600' : 'text-slate-500'}`}>
                {cameraError || phoneStatus}
              </p>
            )}

            {/* Row 2: record + notes */}
            <div className="mt-2 flex items-stretch gap-2">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={!isRecording && !isCameraReady}
                className={`w-40 shrink-0 rounded-xl text-sm font-bold transition-all ${
                  isRecording
                    ? 'bg-rose-500 text-white hover:bg-rose-600'
                    : 'bg-emerald-500 text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300'
                }`}
              >
                {isRecording ? 'Dừng quay' : 'Bắt đầu quay'}
              </button>
              <div className="min-w-0 flex-1">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ghi chú đóng hàng..."
                  rows={3}
                  className="h-full w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: QR panel */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Mã QR</h2>
              <p className="text-[11px] text-slate-500">
                {isRecording ? 'QR mới → tự tách clip' : 'Theo dõi trong lúc quay'}
              </p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              isRecording ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
            }`}>
              {sessionSavedCount > 0 ? `${sessionSavedCount} clip` : recordedDetections.length}
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
            {isRecording && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/80 px-2.5 py-2">
                <div className="text-[11px] font-semibold text-blue-700">Clip đang quay</div>
                <div className="mt-0.5 break-all text-sm font-bold text-blue-950">
                  {activeSegmentQr || 'Chưa gắn QR — đưa mã vào khung'}
                </div>
                {sessionSavedCount > 0 && (
                  <div className="mt-1 text-[11px] text-blue-600">
                    Đã tách lưu {sessionSavedCount} clip trước đó
                  </div>
                )}
              </div>
            )}

            {(detections[0] || lastSeenQr) ? (
              <div className={`rounded-lg border p-2.5 ${
                qrNewFlash
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 bg-slate-50'
              }`}>
                <div className={`mb-1 text-[11px] font-semibold ${
                  qrNewFlash ? 'text-emerald-700' : 'text-slate-500'
                }`}>
                  QR gần nhất
                </div>
                <div className="break-all text-sm font-bold text-slate-900">
                  {(detections[0] || lastSeenQr)?.text}
                </div>
              </div>
            ) : (
              !isRecording && (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-400">
                  Chưa thấy QR
                </div>
              )
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between px-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  QR trên clip này
                </span>
                {!isRecording && recordedDetections.length === 0 && (
                  <span className="text-[10px] text-slate-400">Bắt đầu quay để lưu</span>
                )}
              </div>

              {isRecording && recordedDetections.length === 0 && (
                <div className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">
                  Đưa QR vào khung để gắn vào clip hiện tại
                </div>
              )}

              {recordedDetections.length > 0 && (
                <div className="space-y-1">
                  {[...recordedDetections].reverse().map((d, i) => (
                    <div
                      key={`${d.text}-${i}`}
                      className="flex items-start justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50/80 px-2.5 py-1.5"
                    >
                      <span className="min-w-0 break-all text-xs font-semibold text-blue-950">{d.text}</span>
                      <span className="shrink-0 font-mono text-[11px] text-blue-600">{d.time.toFixed(1)}s</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* không toast QR — chỉ flash banner khi đổi mã */}
    </div>
  );
};

export default CameraView;
