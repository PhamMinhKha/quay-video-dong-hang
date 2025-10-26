import React, { useEffect, useState } from 'react';
import QRTimeline from './QRTimeline';

interface VideoItem {
  filename: string;
  path: string;
  size: number;
  created: Date;
  metadata: any;
}

const VideoManager: React.FC = () => {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [timelineVideo, setTimelineVideo] = useState<{path: string, detections: any[]} | null>(null);

  useEffect(() => {
    console.log('🔄 VideoManager useEffect - loading videos...');
    loadVideos();
  }, []);

  const loadVideos = async () => {
    try {
      const videoList = await window.electronAPI.listVideos();
      setVideos(videoList);
    } catch (err) {
      console.error('Error loading videos:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(`Bạn có chắc muốn xóa video: ${filename}?`)) return;

    try {
      await window.electronAPI.deleteVideo(filename);
      loadVideos(); // Reload list
    } catch (err) {
      console.error('Error deleting video:', err);
      alert('Lỗi khi xóa video!');
    }
  };

  const handleShowLocation = async (filePath: string) => {
    try {
      await window.electronAPI.showInFolder(filePath);
    } catch (err) {
      console.error('Error showing file location:', err);
      // Fallback: copy path to clipboard
      await navigator.clipboard.writeText(filePath);
      alert(`Đã copy đường dẫn vào clipboard:\n${filePath}`);
    }
  };

  const handleShowTimeline = (video: VideoItem) => {
    console.log('🎬 Showing timeline for:', video);
    if (video.metadata?.detections && video.metadata.detections.length > 0) {
      console.log('📊 QR detections:', video.metadata.detections);
      setTimelineVideo({
        path: video.path,
        detections: video.metadata.detections
      });
    } else {
      console.log('❌ No QR detections found - showing empty timeline');
      // Hiển thị timeline trống để test
      setTimelineVideo({
        path: video.path,
        detections: []
      });
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDate = (date: Date): string => {
    return new Date(date).toLocaleString('vi-VN');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xl">Đang tải...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">Danh sách Video</h2>
        <div className="flex gap-2">
          <button
            onClick={() => console.log('Videos:', videos)}
            className="px-3 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 text-sm"
          >
            🐛 Debug Data
          </button>
          <button
            onClick={() => console.log('ElectronAPI:', window.electronAPI)}
            className="px-3 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 text-sm"
          >
            🐛 Debug API
          </button>
          <button
            onClick={loadVideos}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            🔄 Làm mới
          </button>
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <div className="text-6xl mb-4">📁</div>
            <div className="text-xl">Chưa có video nào</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 gap-4">
            {videos.map((video) => (
              <div
                key={video.filename}
                className="bg-white rounded-lg shadow p-4 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-semibold text-lg mb-2">{video.filename}</div>
                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                      <div>📅 {formatDate(video.created)}</div>
                      <div>💾 {formatFileSize(video.size)}</div>
                    </div>
                    {video.metadata && (
                      <div className="mt-3 space-y-2">
                        {video.metadata.notes && (
                          <div className="bg-blue-50 p-2 rounded">
                            <span className="font-semibold">Ghi chú:</span> {video.metadata.notes}
                          </div>
                        )}
                        {video.metadata.detections && video.metadata.detections.length > 0 && (
                          <div className="bg-green-50 p-2 rounded">
                            <span className="font-semibold">QR phát hiện:</span> {video.metadata.detections.length} mã
                            <div className="mt-2 space-y-1">
                              {video.metadata.detections.slice(0, 3).map((det: any, idx: number) => (
                                <div key={idx} className="text-sm">
                                  • {det.text} tại {det.time.toFixed(2)}s
                                </div>
                              ))}
                              {video.metadata.detections.length > 3 && (
                                <div className="text-sm text-gray-500">
                                  ... và {video.metadata.detections.length - 3} mã khác
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => {
                        console.log('🎬 Video clicked:', video);
                        console.log('📊 Metadata:', video.metadata);
                        console.log('🔍 Detections:', video.metadata?.detections);
                        console.log('📝 Notes:', video.metadata?.notes);
                      }}
                      className="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600 text-xs"
                    >
                      🐛 Debug Video
                    </button>
                    <button
                      onClick={() => handleShowTimeline(video)}
                      className={`px-4 py-2 rounded-lg text-sm ${
                        video.metadata?.detections && video.metadata.detections.length > 0
                          ? 'bg-green-500 hover:bg-green-600 text-white'
                          : 'bg-gray-400 hover:bg-gray-500 text-white'
                      }`}
                      disabled={!video.metadata?.detections || video.metadata.detections.length === 0}
                    >
                      📊 Timeline QR ({video.metadata?.detections?.length || 0})
                    </button>
                    <button
                      onClick={() => handleShowLocation(video.path)}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm"
                    >
                      📁 Mở vị trí
                    </button>
                    <button
                      onClick={() => handleDelete(video.filename)}
                      className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm"
                    >
                      🗑️ Xóa
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QR Timeline Modal */}
      {timelineVideo && (
        <QRTimeline
          videoPath={timelineVideo.path}
          detections={timelineVideo.detections}
          onClose={() => setTimelineVideo(null)}
        />
      )}
    </div>
  );
};

export default VideoManager;

