import React, { useState, useRef, useEffect } from 'react';

interface QRDetection {
  text: string;
  time: number;
  bbox?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

interface QRTimelineProps {
  videoPath: string;
  detections: QRDetection[];
  onClose: () => void;
}

const QRTimeline: React.FC<QRTimelineProps> = ({ videoPath, detections, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Debug log để kiểm tra detections
  useEffect(() => {
    console.log('🎯 QRTimeline received detections:', detections);
    detections.forEach((detection, idx) => {
      console.log(`Detection ${idx + 1}:`, {
        text: detection.text,
        time: detection.time,
        formattedTime: formatTime(detection.time)
      });
    });
  }, [detections]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => setDuration(video.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, []);

  const jumpToTime = (time: number) => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = time;
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimelinePosition = (time: number): number => {
    return duration > 0 ? (time / duration) * 100 : 0;
  };

  const getCurrentTimelinePosition = (): number => {
    return duration > 0 ? (currentTime / duration) * 100 : 0;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-xl font-bold">📹 Timeline QR Code</h3>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            ✕ Đóng
          </button>
        </div>

        {/* Video Player */}
        <div className="p-4">
          <video
            ref={videoRef}
            src={`file://${videoPath}`}
            controls
            className="w-full rounded-lg"
            preload="metadata"
          />
        </div>

        {/* Timeline */}
        <div className="p-4 border-t bg-gray-50">
          <div className="mb-4">
            <h4 className="font-semibold mb-2">Timeline QR Code ({detections.length} mã)</h4>
            
            {/* Timeline Bar */}
            <div className="relative bg-gray-200 rounded-lg h-8 mb-4">
              {/* Current Time Indicator */}
              <div
                className="absolute top-0 h-full w-1 bg-red-500 z-10"
                style={{ left: `${getCurrentTimelinePosition()}%` }}
              />
              
              {/* QR Code Markers */}
              {detections.map((detection, idx) => (
                <button
                  key={idx}
                  onClick={() => jumpToTime(detection.time)}
                  className="absolute top-1 h-6 w-6 bg-blue-500 rounded-full hover:bg-blue-600 transition-colors z-20 flex items-center justify-center text-white text-xs font-bold"
                  style={{ left: `${getTimelinePosition(detection.time)}%`, transform: 'translateX(-50%)' }}
                  title={`${detection.text} - ${formatTime(detection.time)}`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>

            {/* QR Code List */}
            <div className="max-h-48 overflow-y-auto">
              <div className="space-y-2">
                {detections.map((detection, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                      Math.abs(currentTime - detection.time) < 0.5
                        ? 'bg-blue-100 border-2 border-blue-500'
                        : 'bg-white hover:bg-gray-50'
                    }`}
                    onClick={() => jumpToTime(detection.time)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="font-semibold">{detection.text}</div>
                        <div className="text-sm text-gray-600">
                          Thời gian: {formatTime(detection.time)}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        jumpToTime(detection.time);
                      }}
                      className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                    >
                      ▶️ Nhảy đến
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRTimeline;
