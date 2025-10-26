import React, { useRef, useEffect, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import QRDetector from './QRDetector';
import { VideoMetadata } from '../../main/preload';

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
  const recordedDetectionsRef = useRef<QRDetection[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSoundTimeRef = useRef<number>(0); // Để debounce âm thanh
  const currentQRRef = useRef<string | null>(null); // QR hiện tại đang được detect
  const qrStartTimeRef = useRef<{ [qrText: string]: number }>({}); // Thời điểm bắt đầu của mỗi QR

  // Tạo âm thanh thông báo QR detection với debounce
  const playQRDetectionSound = useCallback(() => {
    const now = Date.now();
    const timeSinceLastSound = now - lastSoundTimeRef.current;
    
    // Chỉ phát âm thanh nếu đã qua 10 giây kể từ lần cuối
    if (timeSinceLastSound < 10000) {
      console.log('🔇 Skipping sound - debounce active:', timeSinceLastSound + 'ms ago');
      return;
    }
    
    lastSoundTimeRef.current = now;
    console.log('🔊 Playing QR detection sound');
    
    try {
      // Tạo âm thanh beep đơn giản
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // Tần số 800Hz
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (error) {
      console.log('Could not play sound:', error);
    }
  }, []);

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
        // Tính thời gian dựa trên startTimeRef - không phụ thuộc vào isRecording state
        const currentTime = startTimeRef.current > 0
          ? (Date.now() - startTimeRef.current) / 1000 
          : 0;
        
        console.log('🕐 Detection timing:', {
          isRecording,
          startTime: startTimeRef.current,
          currentTimestamp: Date.now(),
          calculatedTime: currentTime,
          qrText: result.data,
          startTimeExists: startTimeRef.current > 0,
          timeDiff: startTimeRef.current > 0 ? Date.now() - startTimeRef.current : 'N/A'
        });
          
        const detection: QRDetection = {
          text: result.data,
          time: currentTime,
          bbox: {
            x: result.location.topLeftCorner.x,
            y: result.location.topLeftCorner.y,
            w: result.location.bottomRightCorner.x - result.location.topLeftCorner.x,
            h: result.location.bottomRightCorner.y - result.location.topLeftCorner.y,
          },
        };

        // Lưu tất cả detections, không chỉ detection cuối cùng
        setDetections(prev => {
          const key = `${detection.text}_${detection.time.toFixed(2)}`;
          const exists = prev.some(d => `${d.text}_${d.time.toFixed(2)}` === key);
          if (!exists) {
            console.log('🔍 New QR detected:', detection);
            return [...prev, detection];
          }
          return prev;
        });
        
        // Lưu detection khi đang quay (chỉ cần startTimeRef > 0 và currentTime > 0)
        if (startTimeRef.current > 0 && currentTime > 0) {
          // Kiểm tra nếu đây là QR mới khác với QR hiện tại
          if (currentQRRef.current && currentQRRef.current !== result.data) {
            console.log('🔄 QR changed from', currentQRRef.current, 'to', result.data);
            // Kết thúc detection của QR cũ bằng cách không làm gì thêm
          }
          
          // Cập nhật QR hiện tại
          currentQRRef.current = result.data;
          
          // Lưu thời điểm bắt đầu của QR này nếu chưa có
          if (!qrStartTimeRef.current[result.data]) {
            qrStartTimeRef.current[result.data] = currentTime;
            console.log('🆕 First time seeing QR:', result.data, 'at time:', currentTime);
          }
          
          // Chỉ lưu detection đầu tiên của mỗi QR (dựa trên text)
          const qrKey = result.data; // Chỉ dùng text, không dùng time
          
          if (!detectionHistoryRef.current.has(qrKey)) {
            // Tạo detection với thời gian đầu tiên xuất hiện
            const firstTimeDetection: QRDetection = {
              text: result.data,
              time: qrStartTimeRef.current[result.data], // Dùng thời gian đầu tiên
              bbox: {
                x: result.location.topLeftCorner.x,
                y: result.location.topLeftCorner.y,
                w: result.location.bottomRightCorner.x - result.location.topLeftCorner.x,
                h: result.location.bottomRightCorner.y - result.location.topLeftCorner.y,
              },
            };
            
            detectionHistoryRef.current.add(qrKey);
            setRecordedDetections(prev => {
              console.log('📊 Adding FIRST detection for QR:', firstTimeDetection);
              console.log('📊 Previous recordedDetections length:', prev.length);
              const newRecorded = [...prev, firstTimeDetection];
              console.log('📊 New recordedDetections length:', newRecorded.length);
              
              // Cập nhật ref để tránh stale closure
              recordedDetectionsRef.current = newRecorded;
              
              // Phát âm thanh thông báo khi detect QR lần đầu
              playQRDetectionSound();
              
              return newRecorded;
            });
          } else {
            console.log('⚠️ QR already recorded:', result.data, '- skipping duplicate');
          }
        } else {
          console.log('❌ Not adding to recorded because:', {
            startTimeExists: startTimeRef.current > 0,
            currentTime,
            reason: startTimeRef.current <= 0 ? 'recording not started' : 'currentTime is 0'
          });
        }
      } else {
        setDetections([]);
        // Reset QR hiện tại khi không detect được gì
        if (currentQRRef.current) {
          console.log('❌ Lost QR detection:', currentQRRef.current);
          currentQRRef.current = null;
        }
      }
    }

    requestAnimationFrame(detectQR);
  }, []); // Bỏ dependency để tránh stale closure

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
      // Cleanup timer nếu component unmount
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCamera]);

  const startRecording = async () => {
    if (!videoRef.current) return;

    const stream = videoRef.current.srcObject as MediaStream;
    
    // Thử các format MP4 trước, fallback về WebM nếu không support
    let options: MediaRecorderOptions;
    let fileExtension: string;
    
    if (MediaRecorder.isTypeSupported('video/mp4')) {
      options = { mimeType: 'video/mp4' };
      fileExtension = 'mp4';
      console.log('🎬 Using MP4 format');
    } else if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) {
      options = { mimeType: 'video/mp4;codecs=avc1' };
      fileExtension = 'mp4';
      console.log('🎬 Using MP4 with AVC1 codec');
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
      options = { mimeType: 'video/webm;codecs=h264' };
      fileExtension = 'webm';
      console.log('🎬 Using WebM with H264 codec');
    } else {
      options = { mimeType: 'video/webm;codecs=vp9' };
      fileExtension = 'webm';
      console.log('🎬 Fallback to WebM with VP9 codec');
    }

    try {
      // Đặt startTime và isRecording trước khi tạo recorder
      startTimeRef.current = Date.now();
      setIsRecording(true);
      
      console.log('🎬 Starting recording at:', startTimeRef.current);
      console.log('🎬 isRecording will be set to:', true);
      
      const recorder = new MediaRecorder(stream, options);
      chunksRef.current = [];
      setRecordedDetections([]);
      recordedDetectionsRef.current = []; // Reset ref cũng
      detectionHistoryRef.current.clear();
      currentQRRef.current = null; // Reset QR hiện tại
      qrStartTimeRef.current = {}; // Reset thời gian bắt đầu của các QR
      recordingTimeRef.current = 0;
      
      console.log('🔄 Reset recordedDetections and detectionHistory');
      console.log('🔄 recordedDetections after reset:', []);
      console.log('🔄 detectionHistory size after clear:', detectionHistoryRef.current.size);
      
      // Bắt đầu timer cho recording
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: options.mimeType });
        await saveVideo(blob, fileExtension);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // Collect data every second

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
    console.log('🛑 Stopping recording...');
    console.log('🛑 Current recordedDetections before stop:', recordedDetections);
    console.log('🛑 recordedDetections length:', recordedDetections.length);
    
    // Dừng timer
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      // Lưu recordedDetections vào ref để tránh stale closure
      recordedDetectionsRef.current = recordedDetections;
      console.log('🔄 Saved to ref - recordedDetectionsRef.current:', recordedDetectionsRef.current);
      
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Không cần useEffect này nữa vì đã xử lý trong detectQR
  // useEffect(() => {
  //   if (isRecording && detections.length > 0) {
  //     console.log('🎬 Recording with detections:', detections);
  //     // Lưu các detections mới khi đang quay với timestamp chính xác
  //     detections.forEach(detection => {
  //       // Sử dụng thời gian đã được tính trong detectQR
  //       const key = `${detection.text}_${detection.time.toFixed(2)}`;
  //       if (!detectionHistoryRef.current.has(key)) {
  //         detectionHistoryRef.current.add(key);
  //         setRecordedDetections(prev => {
  //           console.log('📊 Adding detection to recorded:', detection);
  //           return [...prev, detection];
  //         });
  //       }
  //     });
  //   }
  // }, [isRecording, detections]);

  const saveVideo = async (blob: Blob, extension: string = 'webm') => {
    try {
      const now = new Date();
      const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}.${extension}`;

      const arrayBuffer = await blob.arrayBuffer();
      
      // Sử dụng recordedDetectionsRef để tránh stale closure
      const detectionsToSave = recordedDetectionsRef.current;
      console.log('💾 Using detections from ref:', detectionsToSave);
      console.log('💾 Detections count:', detectionsToSave.length);
      
      const metadata: VideoMetadata = {
        video: filename,
        createdAt: now.toISOString(),
        detections: detectionsToSave,
        notes: notes,
      };

      console.log('💾 Saving video with metadata:', metadata);
      console.log('📊 Final recorded detections:', detectionsToSave);

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
          <div className="relative bg-black rounded-lg overflow-hidden shadow-lg" style={{ height: '400px' }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
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
              {isRecording && (
                <div className="text-center bg-red-50 p-2 rounded-lg">
                  <div className="text-red-700 font-mono text-lg">
                    ⏱️ {formatTime(recordingTime)}
                  </div>
                  <div className="text-xs text-red-500">
                    Thời gian quay
                  </div>
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
              
              {/* Hiển thị số lượng QR đã ghi lại khi đang quay */}
              {isRecording && recordedDetections.length > 0 && (
                <div className="bg-blue-50 p-2 rounded border-l-4 border-blue-400">
                  <div className="font-semibold text-blue-800">
                    📊 Đã ghi lại: {recordedDetections.length} QR code
                  </div>
                  <div className="text-xs text-blue-600 mt-1">
                    Mới nhất: {recordedDetections[recordedDetections.length - 1]?.text}
                  </div>
                </div>
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

