import React, { useRef, useEffect, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import QRDetector from './QRDetector';
import { VideoMetadata } from '../../main/preload';

declare global {
  interface Window {
    electronAPI: {
      saveVideo: (data: { filename: string; buffer: ArrayBuffer; metadata: VideoMetadata }) => Promise<any>;
    };
  }
}

interface QRDetection {
  text: string;
  time: number;
  bbox: { x: number; y: number; w: number; h: number };
}

const CameraView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimeRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [detections, setDetections] = useState<QRDetection[]>([]);
  const [notes, setNotes] = useState('');
  const [recordedDetections, setRecordedDetections] = useState<QRDetection[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const detectionHistoryRef = useRef<Set<string>>(new Set());
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');

  const detectQR = useCallback(() => {
    if (!canvasRef.current || !videoRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imageData.data, canvas.width, canvas.height);

      if (result) {
        const detection: QRDetection = {
          text: result.data,
          time: video.currentTime,
          bbox: {
            x: result.location.topLeftCorner.x,
            y: result.location.topLeftCorner.y,
            w: result.location.bottomRightCorner.x - result.location.topLeftCorner.x,
            h: result.location.bottomRightCorner.y - result.location.topLeftCorner.y,
          },
        };

        setDetections([detection]);
      } else {
        setDetections([]);
      }
    }

    requestAnimationFrame(detectQR);
  }, []);

  // Tải danh sách camera
  useEffect(() => {
    const loadCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setCameras(videoDevices);
        if (videoDevices.length > 0 && !selectedCamera) {
          setSelectedCamera(videoDevices[0].deviceId);
        }
      } catch (err) {
        console.error('Error enumerating cameras:', err);
      }
    };

    loadCameras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Khởi động camera
  useEffect(() => {
    const startCamera = async () => {
      if (!selectedCamera) return;

      try {
        // Dừng stream cũ nếu có
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: selectedCamera },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          detectQR();
        }
      } catch (err) {
        console.error('Error accessing camera:', err);
        alert('Không thể truy cập camera. Vui lòng kiểm tra quyền truy cập.');
      }
    };

    if (selectedCamera) {
      startCamera();
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCamera]);

  const startRecording = async () => {
    if (!videoRef.current) return;

    const stream = videoRef.current.srcObject as MediaStream;
    const options = { mimeType: 'video/webm;codecs=vp9' };

    try {
      const recorder = new MediaRecorder(stream, options);
      chunksRef.current = [];
      setRecordedDetections([]);
      detectionHistoryRef.current.clear();
      recordingTimeRef.current = 0;
      startTimeRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        await saveVideo(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // Collect data every second
      setIsRecording(true);

      // Log detections during recording - track detected QR codes
      const intervalId = setInterval(() => {
        // During recording, capture detections
        // This will be used to save metadata
      }, 1000);

      setTimeout(() => {
        clearInterval(intervalId);
      }, 600000); // Clear after 10 minutes max
    } catch (err) {
      console.error('Error starting recording:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  useEffect(() => {
    if (isRecording && detections.length > 0) {
      // Lưu các detections mới khi đang quay
      detections.forEach(detection => {
        const key = `${detection.text}_${detection.time}`;
        if (!detectionHistoryRef.current.has(key)) {
          detectionHistoryRef.current.add(key);
          setRecordedDetections(prev => [...prev, detection]);
        }
      });
    }
  }, [isRecording, detections]);

  const saveVideo = async (blob: Blob) => {
    try {
      const now = new Date();
      const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}.webm`;

      const arrayBuffer = await blob.arrayBuffer();
      const metadata: VideoMetadata = {
        video: filename,
        createdAt: now.toISOString(),
        detections: recordedDetections,
        notes: notes,
      };

      await window.electronAPI.saveVideo({
        filename,
        buffer: arrayBuffer,
        metadata,
      });

      setShowSuccess(true);
      setNotes('');
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      console.error('Error saving video:', err);
      alert('Lỗi khi lưu video!');
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Video Preview Section */}
      <div className="flex-1 flex gap-4 p-4">
        <div className="flex-1 flex flex-col">
          <div className="relative bg-black rounded-lg overflow-hidden shadow-lg">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-auto"
            />
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0 w-full h-full pointer-events-none"
            />
            {/* Overlay QR detections */}
            {detections.map((det, idx) => (
              <div
                key={idx}
                className="absolute border-2 border-green-400"
                style={{
                  left: `${det.bbox.x}px`,
                  top: `${det.bbox.y}px`,
                  width: `${det.bbox.w}px`,
                  height: `${det.bbox.h}px`,
                }}
              >
                <div className="bg-green-400 text-white text-xs px-1 py-0.5">
                  {det.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Control Panel */}
        <div className="w-80 flex flex-col gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="font-bold text-lg mb-3">Chọn Camera</h2>
            <select
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              disabled={isRecording}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {cameras.map((camera) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label || `Camera ${camera.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="font-bold text-lg mb-3">Điều khiển</h2>
            <div className="space-y-3">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`w-full py-3 rounded-lg font-semibold transition-all ${
                  isRecording
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-green-500 hover:bg-green-600 text-white'
                }`}
              >
                {isRecording ? '⏹️ Dừng quay' : '▶️ Bắt đầu quay'}
              </button>
              {isRecording && (
                <div className="text-center text-red-600 font-bold">
                  ⏺️ ĐANG QUAY...
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="font-bold text-lg mb-3">Ghi chú</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Nhập ghi chú đóng hàng..."
              className="w-full border rounded-lg p-2 h-32 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="font-bold text-lg mb-3">QR được phát hiện</h2>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {detections.length > 0 ? (
                <div className="bg-green-50 p-2 rounded">
                  <div className="font-semibold text-green-800">{detections[0].text}</div>
                  <div className="text-xs text-gray-600">
                    Thời gian: {detections[0].time.toFixed(2)}s
                  </div>
                </div>
              ) : (
                <div className="text-gray-400 text-center">Chưa phát hiện QR</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Success Message */}
      {showSuccess && (
        <div className="absolute top-20 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg">
          ✅ Đã lưu video thành công!
        </div>
      )}
    </div>
  );
};

export default CameraView;

