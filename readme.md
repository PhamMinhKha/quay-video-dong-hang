# Phần mềm Quay Video + Quét QR (Ứng dụng: đóng & gửi hàng, hoạt động offline - Electron)

## Mục tiêu

Ứng dụng desktop (Electron) hoạt động hoàn toàn offline, dùng để quay video từ camera, phát hiện mã QR trong khung hình theo thời gian thực, lưu vị trí QR và metadata kèm theo video. Ứng dụng phục vụ quy trình “quay video đóng gửi hàng” để làm bằng chứng.

---

## Tính năng chính

1. **Quay video**: Sử dụng camera máy tính (qua `navigator.mediaDevices.getUserMedia`) để ghi hình, lưu video định dạng `.webm` hoặc `.mp4`.
2. **Phát hiện QR realtime**: Sử dụng thư viện `jsQR` hoặc `@zxing/library` để quét QR từ từng khung hình.
3. **Lưu vị trí & thời gian QR**: Khi phát hiện QR, ghi nhận:

   * Nội dung mã QR (`text`)
   * Tọa độ `x,y,width,height`
   * Thời gian trong video (`timestamp`)
4. **Overlay hiển thị QR**: Hiển thị khung chữ nhật quanh QR code trên preview realtime.
5. **Lưu video + metadata**: Khi dừng quay, lưu video cùng file JSON metadata (cùng tên). Ví dụ:

   ```
   videos/
   ├─ 2025-10-26_15-30-22.mp4
   └─ 2025-10-26_15-30-22.json
   ```
6. **Ghi chú đóng hàng**: Cho phép người dùng nhập ghi chú, mã đơn hàng, nhân viên phụ trách, ...
7. **Chỉ hoạt động offline**: Không có chức năng upload, API hoặc network request. Mọi dữ liệu chỉ lưu trên máy.
8. **Xuất dữ liệu**: Cho phép export video + metadata ra USB hoặc thư mục khác.
9. **Quản lý lưu trữ**: Hiển thị dung lượng, cho phép xóa video cũ.

---

## Công nghệ

* **Electron + React + TypeScript**
* **QR Detection**: `jsQR` (JS-based) hoặc `@zxing/library` (WASM)
* **Video Recording**: `MediaRecorder` API
* **Lưu trữ**: filesystem (qua Node.js `fs`) + SQLite (optional) hoặc JSON index
* **UI**: React + TailwindCSS (gọn nhẹ, responsive)

---

## Cấu trúc thư mục

```
project/
├─ main/                  # Process chính của Electron
│  ├─ main.ts             # Entry point
│  └─ fileManager.ts      # Lưu, export, quản lý video
├─ renderer/              # Giao diện React
│  ├─ App.tsx
│  ├─ components/
│  │  ├─ CameraView.tsx   # Preview camera + overlay
│  │  ├─ Recorder.tsx     # Điều khiển quay video
│  │  └─ QRDetector.tsx   # Quét QR code từ canvas
│  ├─ hooks/
│  │  └─ useQRScanner.ts  # Hook quét QR
│  ├─ utils/
│  │  └─ time.ts          # Format timestamp
│  └─ styles.css
├─ package.json
└─ electron-builder.yml   # Cấu hình build app
```

---

## Ví dụ mã nguồn

### `renderer/components/CameraView.tsx`

```tsx
import React, { useRef, useEffect, useState } from 'react';
import jsQR from 'jsqr';

export default function CameraView({ onDetect }: { onDetect: (res: any) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const startCamera = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setRunning(true);
        detectLoop();
      }
    };

    const detectLoop = () => {
      if (!canvasRef.current || !videoRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;
      const w = videoRef.current.videoWidth;
      const h = videoRef.current.videoHeight;
      canvasRef.current.width = w;
      canvasRef.current.height = h;
      ctx.drawImage(videoRef.current, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const result = jsQR(imgData.data, w, h);
      if (result) {
        onDetect({
          text: result.data,
          bbox: result.location,
          time: videoRef.current.currentTime,
        });
      }
      if (running) requestAnimationFrame(detectLoop);
    };

    startCamera();
    return () => setRunning(false);
  }, []);

  return (
    <div className="relative">
      <video ref={videoRef} className="w-full rounded-xl" />
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
    </div>
  );
}
```

---

### `renderer/components/Recorder.tsx`

```tsx
import React, { useRef, useState } from 'react';

export default function Recorder({ onStop }: { onStop: (blob: Blob) => void }) {
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [chunks, setChunks] = useState<Blob[]>([]);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => setChunks((prev) => [...prev, e.data]);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      onStop(blob);
      setChunks([]);
    };
    rec.start();
    setRecorder(rec);
  };

  const stopRecording = () => recorder?.stop();

  return (
    <div className="flex gap-2 mt-2">
      <button onClick={startRecording}>Bắt đầu quay</button>
      <button onClick={stopRecording}>Dừng quay</button>
    </div>
  );
}
```

---

## Metadata JSON (mẫu)

```json
{
  "video": "2025-10-26_15-30-22.mp4",
  "createdAt": "2025-10-26T15:30:22+07:00",
  "detections": [
    {"text": "SHIP123456", "time": 1.23, "bbox": {"x":100,"y":200,"w":150,"h":150}}
  ],
  "notes": "Đóng gói đúng quy trình",
  "user": {"id": "NV001", "name": "Nguyễn Văn A"}
}
```

---

## Build & chạy

```
yarn install
yarn dev     # chạy React + Electron dev
yarn build   # build app desktop (Windows/macOS/Linux)
```

---

## Ghi chú bảo mật

* Không yêu cầu mạng hoặc quyền upload.
* Mọi dữ liệu được lưu cục bộ trong thư mục `videos/`.
* Có thể bật tùy chọn mã hóa file video/metadata bằng passphrase nếu cần.

---

## Hướng mở rộng

* Thêm watermark thời gian quay lên video.
* Cho phép người dùng nhập mã đơn hàng trước khi quay.
* Thêm bảng danh sách video đã quay + nút mở/thêm ghi chú.

---

**Chế độ:** Hoạt động hoàn toàn offline, sử dụng Electron cho gọn nhẹ và quản lý trực tiếp filesystem.
