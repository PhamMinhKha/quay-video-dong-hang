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
  const [actualVideoPath, setActualVideoPath] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);

  // Thêm state cho selection
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

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

  // Lấy đường dẫn video chính xác
  useEffect(() => {
    const getCorrectVideoPath = async () => {
      try {
        console.log('🎬 Original videoPath:', videoPath);
        // Lấy filename từ path
        const filename = videoPath.split('/').pop() || videoPath.split('\\').pop() || '';
        console.log('📁 Extracted filename:', filename);

        if (filename) {
          const correctPath = await window.electronAPI.getVideoPath(filename);
          console.log('✅ Correct video path:', correctPath);
          setActualVideoPath(correctPath);

          // Force video reload sau khi có path mới
          setTimeout(() => {
            const video = videoRef.current;
            if (video) {
              console.log('🔄 Force reload video with new path');
              video.load(); // Force reload video
            }
          }, 100);
        }
      } catch (error) {
        console.error('❌ Error getting video path:', error);
        // Fallback to original path
        setActualVideoPath(videoPath);

        // Force video reload với fallback path
        setTimeout(() => {
          const video = videoRef.current;
          if (video) {
            console.log('🔄 Force reload video with fallback path');
            video.load();
          }
        }, 100);
      }
    };

    if (videoPath) {
      getCorrectVideoPath();
    }
  }, [videoPath]);

  // Fix cho WebM files không có duration metadata - seek to end để lấy duration
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !actualVideoPath) return;

    console.log('🎯 WebM duration fix - seeking to end to get duration...');

    const getDurationBySeek = async () => {
      return new Promise<number>((resolve) => {
        const originalTime = video.currentTime;

        const onSeeked = () => {
          const totalDuration = video.currentTime;
          console.log('✅ Got duration by seeking:', totalDuration);

          // Quay lại thời gian ban đầu
          video.currentTime = originalTime;
          video.removeEventListener('seeked', onSeeked);
          resolve(totalDuration);
        };

        video.addEventListener('seeked', onSeeked);

        // Seek đến một thời gian rất lớn (video sẽ tự động dừng ở cuối)
        video.currentTime = 999999;
      });
    };

    const checkAndFixDuration = async () => {
      // Đợi video load
      if (video.readyState < 2) {
        setTimeout(checkAndFixDuration, 100);
        return;
      }

      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        console.log('✅ Duration already available:', video.duration);
        setDuration(video.duration);
      } else {
        console.log('⚠️ No duration metadata, using seek method...');
        try {
          const seekDuration = await getDurationBySeek();
          if (seekDuration > 0) {
            setDuration(seekDuration);
          }
        } catch (error) {
          console.error('❌ Failed to get duration by seek:', error);
        }
      }
    };

    // Bắt đầu check sau khi video load
    setTimeout(checkAndFixDuration, 500);
  }, [actualVideoPath]);

  // Thêm state cho drag detection
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState<number | null>(null);

  // Thêm functions cho selection và seeking
  const handleProgressBarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickTime = (clickX / rect.width) * duration;

    // Lưu vị trí bắt đầu drag
    setDragStartX(clickX);
    setIsDragging(false);

    setSelectionStart(clickTime);
    setSelectionEnd(clickTime);
    setIsSelecting(true);
  };

  const handleProgressBarMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isSelecting || !duration || selectionStart === null || dragStartX === null) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const moveX = e.clientX - rect.left;
    const moveTime = (moveX / rect.width) * duration;

    // Kiểm tra nếu đã drag đủ xa (threshold 5px)
    if (Math.abs(moveX - dragStartX) > 5) {
      setIsDragging(true);
    }

    setSelectionEnd(moveTime);
  };

  const handleProgressBarMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickTime = (clickX / rect.width) * duration;

    // Nếu không drag (chỉ click), thực hiện seek
    if (!isDragging && dragStartX !== null && Math.abs(clickX - dragStartX) <= 5) {
      console.log(`🎯 Seeking to time: ${formatTime(clickTime)}`);
      jumpToTime(clickTime);
      // Clear selection khi seek
      clearSelection();
    }

    setIsSelecting(false);
    setIsDragging(false);
    setDragStartX(null);
  };

  const clearSelection = () => {
    setSelectionStart(null);
    setSelectionEnd(null);
    setIsSelecting(false);
  };

  // Export selected segment
  const handleExportSelectedSegment = async () => {
    if (selectionStart === null || selectionEnd === null) {
      alert('Vui lòng chọn đoạn video trước khi export!');
      return;
    }

    const startTime = Math.min(selectionStart, selectionEnd);
    const endTime = Math.max(selectionStart, selectionEnd);

    if (endTime - startTime < 0.1) {
      alert('Đoạn video được chọn quá ngắn!');
      return;
    }

    try {
      setIsExporting(true);

      console.log('🎬 Starting export process...');
      console.log('📁 Video path:', actualVideoPath);
      console.log('⏱️ Start time:', startTime, 'End time:', endTime);

      // Chọn thư mục output
      const outputDir = await window.electronAPI.selectStorageFolder();
      if (!outputDir) {
        console.log('❌ User cancelled folder selection');
        setIsExporting(false);
        return;
      }

      console.log('📂 Output directory:', outputDir);

      // Lấy tên file gốc
      const originalFilename = actualVideoPath.split('/').pop()?.split('.')[0] || 'segment';
      const outputFilename = `${originalFilename}_${formatTime(startTime)}-${formatTime(endTime)}.mp4`.replace(/:/g, '-');

      console.log('📄 Output filename:', outputFilename);

      // Export segment
      console.log('🚀 Calling exportVideoSegment API...');
      const result = await window.electronAPI.exportVideoSegment({
        inputPath: actualVideoPath,
        outputDir,
        outputFilename,
        startTime,
        endTime
      });

      console.log('📊 Export result:', result);

      if (result.success) {
        console.log('✅ Export successful!');
        alert(`✅ Export thành công!\nFile: ${outputFilename}`);

        // Mở thư mục chứa file
        try {
          const showResult = await window.electronAPI.showInFolder(`${outputDir}/${outputFilename}`);
          if (!showResult.success && showResult.error) {
            console.error('Error opening folder:', showResult.error);
          }
        } catch (error) {
          console.error('Error opening output folder:', error);
        }

        clearSelection();
      } else {
        console.error('❌ Export failed:', result.error);
        alert(`❌ Export thất bại: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Export error details:', error);
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      alert(`❌ Có lỗi xảy ra khi export video!\nChi tiết: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const jumpToTime = (time: number) => {
    const video = videoRef.current;
    if (video) {
      console.log(`🎯 Jumping to time: ${formatTime(time)}`);
      video.currentTime = time;
      // Ensure video plays after jumping
      if (video.paused) {
        video.play().catch(err => {
          console.error('Error playing video after jump:', err);
        });
      }
    } else {
      console.error('❌ Video ref not available for jumping to time');
    }
  };

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) {
      return '0:00';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimelinePosition = (time: number): number => {
    if (!isFinite(time) || isNaN(time) || !isFinite(duration) || isNaN(duration) || duration <= 0) {
      return 0;
    }
    return (time / duration) * 100;
  };

  const getCurrentTimelinePosition = (): number => {
    if (!isFinite(currentTime) || isNaN(currentTime) || !isFinite(duration) || isNaN(duration) || duration <= 0) {
      return 0;
    }
    return (currentTime / duration) * 100;
  };

  const handleExportSegments = async () => {
    if (detections.length === 0) {
      alert('Không có QR code nào để export!');
      return;
    }

    try {
      setIsExporting(true);

      // Chọn thư mục output
      const outputDir = await window.electronAPI.selectStorageFolder();
      if (!outputDir) {
        setIsExporting(false);
        return;
      }

      // Lấy filename từ videoPath
      const filename = videoPath.split('/').pop() || videoPath.split('\\').pop() || 'unknown.webm';

      console.log('🎬 Starting export with:', { filename, detections: detections.length, outputDir });

      const result = await window.electronAPI.exportQRSegments({
        filename,
        detections,
        outputDir
      });

      if (result.success) {
        alert(`✅ Export thành công!\n\nĐã tạo ${result.exportedSegments?.length} video segments tại:\n${result.outputDir}\n\nCác file:\n${result.exportedSegments?.map(s => s.filename).join('\n')}`);

        // Mở thư mục output
        if (result.outputDir) {
          try {
            const showResult = await window.electronAPI.showInFolder(result.outputDir);
            if (!showResult.success) {
              console.warn('Could not open folder:', showResult.error);
            }
          } catch (error) {
            console.warn('Error opening folder:', error);
          }
        }
      } else {
        alert(`❌ Export thất bại:\n${result.error}`);
      }
    } catch (error) {
      console.error('Export error:', error);
      alert(`❌ Lỗi khi export: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-xl font-bold">📹 Timeline QR Code</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportSegments}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={detections.length === 0 || isExporting}
            >
              {isExporting ? '⏳ Đang export...' : '📤 Export QR Segments'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
            >
              ✕ Đóng
            </button>
          </div>
        </div>

        {/* Main Content - Split Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Video Player - Left Side */}
          <div className="w-2/3 p-4">
            {/* Debug Info */}
            <div className="mb-2 p-2 bg-gray-100 rounded text-sm hidden">
              <div>Duration: {duration} (isFinite: {isFinite(duration).toString()})</div>
              <div>Current Time: {currentTime}</div>
              <div>Video Path: {actualVideoPath}</div>
              <button
                onClick={() => {
                  const video = videoRef.current;
                  if (video) {
                    console.log('🔍 Manual video check:', {
                      src: video.src,
                      duration: video.duration,
                      readyState: video.readyState,
                      networkState: video.networkState,
                      videoWidth: video.videoWidth,
                      videoHeight: video.videoHeight,
                      paused: video.paused,
                      ended: video.ended,
                      currentTime: video.currentTime
                    });

                    // Force get duration từ video element
                    const videoDuration = video.duration;
                    console.log('🎯 Raw video duration:', videoDuration, 'isFinite:', isFinite(videoDuration));

                    if (videoDuration && isFinite(videoDuration) && videoDuration > 0) {
                      console.log('✅ Manually setting duration:', videoDuration);
                      setDuration(videoDuration);
                    } else {
                      console.log('🔄 Duration not available, checking video state...');

                      // Nếu video đang play và có currentTime > 0, thử seek để trigger metadata
                      if (video.currentTime > 0) {
                        console.log('🔄 Video has currentTime, trying to get duration...');
                        video.currentTime = video.currentTime; // Force refresh

                        setTimeout(() => {
                          const newDuration = video.duration;
                          console.log('🎯 Duration after seek:', newDuration);
                          if (newDuration && isFinite(newDuration) && newDuration > 0) {
                            console.log('✅ Got duration after seek:', newDuration);
                            setDuration(newDuration);
                          }
                        }, 100);
                      } else {
                        console.log('🔄 Manually loading video...');
                        video.load();
                      }
                    }
                  }
                }}
                className="ml-2 px-2 py-1 bg-blue-500 text-white rounded text-xs"
              >
                Debug Video
              </button>
            </div>

            <video
              ref={videoRef}
              src={actualVideoPath ? `file://${actualVideoPath}` : ''}
              controls
              className="w-full h-auto max-h-[60vh] rounded-lg"
              preload="auto"
              onLoadStart={(e) => {
                console.log('🔄 Video onLoadStart inline:', {
                  src: (e.target as HTMLVideoElement).src,
                  readyState: (e.target as HTMLVideoElement).readyState,
                  networkState: (e.target as HTMLVideoElement).networkState
                });
                setDuration(0); // Reset duration
              }}
              onLoadedMetadata={(e) => {
                const video = e.target as HTMLVideoElement;
                console.log('🎯 Video onLoadedMetadata inline:', {
                  duration: video.duration,
                  readyState: video.readyState,
                  src: video.src,
                  videoWidth: video.videoWidth,
                  videoHeight: video.videoHeight
                });
                if (video && isFinite(video.duration) && video.duration > 0) {
                  console.log('✅ Setting duration from onLoadedMetadata:', video.duration);
                  setDuration(video.duration);
                } else {
                  console.warn('⚠️ Duration not available in onLoadedMetadata, trying to get it manually...');
                  // Thử lấy duration sau một khoảng thời gian ngắn
                  setTimeout(() => {
                    if (video.duration && isFinite(video.duration) && video.duration > 0) {
                      console.log('✅ Got duration after timeout:', video.duration);
                      setDuration(video.duration);
                    }
                  }, 100);
                }
              }}
              onLoadedData={(e) => {
                const video = e.target as HTMLVideoElement;
                console.log('🎯 Video onLoadedData inline:', {
                  duration: video.duration,
                  readyState: video.readyState,
                  buffered: video.buffered.length > 0 ? video.buffered.end(0) : 0
                });
                if (video && isFinite(video.duration) && video.duration > 0) {
                  console.log('✅ Setting duration from onLoadedData:', video.duration);
                  setDuration(video.duration);
                } else {
                  console.warn('⚠️ Duration not available in onLoadedData');
                }
              }}
              onCanPlay={(e) => {
                const video = e.target as HTMLVideoElement;
                console.log('🎯 Video onCanPlay inline:', {
                  duration: video.duration,
                  readyState: video.readyState,
                  paused: video.paused
                });
                if (video && isFinite(video.duration) && video.duration > 0) {
                  console.log('✅ Setting duration from onCanPlay:', video.duration);
                  setDuration(video.duration);
                } else {
                  console.warn('⚠️ Duration not available in onCanPlay');
                }
              }}
              onDurationChange={(e) => {
                const video = e.target as HTMLVideoElement;
                console.log('⏱️ Video onDurationChange inline:', {
                  duration: video.duration,
                  readyState: video.readyState
                });
                if (video && isFinite(video.duration) && video.duration > 0) {
                  console.log('✅ Setting duration from onDurationChange:', video.duration);
                  setDuration(video.duration);
                } else {
                  console.warn('⚠️ Duration not available in onDurationChange');
                }
              }}
              onTimeUpdate={(e) => {
                const video = e.target as HTMLVideoElement;
                setCurrentTime(video.currentTime);

                // Nếu duration vẫn là 0 nhưng video đang play, thử lấy duration
                if (duration === 0 && video.duration && isFinite(video.duration) && video.duration > 0) {
                  console.log('🎯 Got duration from timeupdate:', video.duration);
                  setDuration(video.duration);
                }
              }}
              onError={(e) => {
                console.error('❌ Video onError inline:', e);
                const video = e.target as HTMLVideoElement;
                if (video?.error) {
                  console.error('Video error details:', {
                    code: video.error.code,
                    message: video.error.message,
                    src: video.src
                  });
                }
              }}
              onProgress={(e) => {
                const video = e.target as HTMLVideoElement;
                console.log('📈 Video progress inline:', {
                  buffered: video.buffered.length > 0 ? video.buffered.end(0) : 0,
                  duration: video.duration,
                  readyState: video.readyState
                });
              }}
            />

            {/* Timeline với tính năng seek */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Timeline</span>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
                  {selectionStart !== null && selectionEnd !== null && (
                    <span className="text-blue-600">
                      Đã chọn: {formatTime(Math.min(selectionStart, selectionEnd))} - {formatTime(Math.max(selectionStart, selectionEnd))}
                    </span>
                  )}
                </div>
              </div>
              
              {/* Progress Bar với seek và selection */}
              <div 
                className="relative h-8 bg-gray-200 rounded-lg cursor-pointer select-none"
                onMouseDown={handleProgressBarMouseDown}
                onMouseMove={handleProgressBarMouseMove}
                onMouseUp={handleProgressBarMouseUp}
                onMouseLeave={() => {
                  setIsSelecting(false);
                  setIsDragging(false);
                  setDragStartX(null);
                }}
              >
                {/* Background track */}
                <div className="absolute inset-0 bg-gray-300 rounded-lg"></div>
                
                {/* Current time indicator */}
                <div 
                  className="absolute top-0 h-full bg-blue-500 rounded-lg transition-all duration-100"
                  style={{ width: `${getCurrentTimelinePosition()}%` }}
                ></div>
                
                {/* Selection area */}
                {selectionStart !== null && selectionEnd !== null && (
                  <div 
                    className="absolute top-0 h-full bg-yellow-400 bg-opacity-50 border-2 border-yellow-500"
                    style={{
                      left: `${Math.min(getTimelinePosition(selectionStart), getTimelinePosition(selectionEnd))}%`,
                      width: `${Math.abs(getTimelinePosition(selectionEnd) - getTimelinePosition(selectionStart))}%`
                    }}
                  ></div>
                )}
                
                {/* QR Detection markers */}
                {detections.map((detection, index) => (
                  <div
                    key={index}
                    className="absolute top-0 w-1 h-full bg-red-500 cursor-pointer hover:bg-red-600 transition-colors"
                    style={{ left: `${getTimelinePosition(detection.time)}%` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      jumpToTime(detection.time);
                    }}
                    title={`QR: ${detection.text} tại ${formatTime(detection.time)}`}
                  ></div>
                ))}
                
                {/* Current time cursor */}
                <div 
                  className="absolute top-0 w-0.5 h-full bg-white shadow-lg pointer-events-none"
                  style={{ left: `${getCurrentTimelinePosition()}%` }}
                ></div>
              </div>
              
              {/* Timeline controls */}
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={clearSelection}
                    className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                    disabled={selectionStart === null && selectionEnd === null}
                  >
                    Xóa vùng chọn
                  </button>
                  <button
                    onClick={handleExportSelectedSegment}
                    className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                    disabled={selectionStart === null || selectionEnd === null || isExporting}
                  >
                    {isExporting ? 'Đang export...' : 'Export đoạn đã chọn'}
                  </button>
                </div>
                <div className="text-xs text-gray-500">
                  💡 Click để seek, kéo để chọn đoạn video
                </div>
              </div>
            </div>
          </div>

          {/* QR List - Right Side */}
          <div className="w-1/3 p-4 border-l bg-gray-50 overflow-y-auto">
            <h4 className="font-semibold mb-4">QR Codes ({detections.length})</h4>
            <div className="space-y-2">
              {detections.map((detection, index) => (
                <div
                  key={index}
                  className="bg-white p-3 rounded-lg shadow-sm border cursor-pointer hover:bg-blue-50 transition-colors"
                  onClick={() => jumpToTime(detection.time)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-sm">{detection.text}</div>
                      <div className="text-xs text-gray-600">
                        {formatTime(detection.time)}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        jumpToTime(detection.time);
                      }}
                      className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                    >
                      ▶️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRTimeline;
