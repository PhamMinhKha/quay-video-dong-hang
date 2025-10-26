import React, { useState } from 'react';

declare global {
  interface Window {
    electronAPI: {
      searchByQR: (qrText: string) => Promise<any[]>;
      getVideoPath: (filename: string) => Promise<string>;
    };
  }
}

const SearchByQR: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchText.trim()) return;

    setLoading(true);
    try {
      const videos = await window.electronAPI.searchByQR(searchText);
      setResults(videos);
    } catch (err) {
      console.error('Error searching:', err);
      alert('Lỗi khi tìm kiếm video!');
    } finally {
      setLoading(false);
    }
  };

  const handlePlayVideo = async (filename: string) => {
    const videoPath = await window.electronAPI.getVideoPath(filename);
    setSelectedVideo(videoPath);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDate = (date: Date): string => {
    return new Date(date).toLocaleString('vi-VN');
  };

  return (
    <div className="h-full flex flex-col p-4 bg-gray-50">
      {/* Search Header */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h2 className="text-2xl font-bold mb-4">🔍 Tìm kiếm Video theo QR Code</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Nhập mã QR code để tìm..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            onClick={handleSearch}
            disabled={loading || !searchText.trim()}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold"
          >
            {loading ? '⏳ Đang tìm...' : '🔍 Tìm kiếm'}
          </button>
        </div>
      </div>

      {/* Selected Video Player */}
      {selectedVideo && (
        <div className="bg-white rounded-lg shadow p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-lg">📹 Video đang phát</h3>
            <button
              onClick={() => setSelectedVideo(null)}
              className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
            >
              ✕ Đóng
            </button>
          </div>
          <video
            src={`file://${selectedVideo}`}
            controls
            className="w-full rounded-lg"
            autoPlay
          />
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 && searchText && !loading && (
          <div className="text-center text-gray-500 py-12">
            <div className="text-6xl mb-4">📭</div>
            <div className="text-xl">Không tìm thấy video nào</div>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-4">
            <div className="font-semibold text-lg mb-4">
              Tìm thấy {results.length} video:
            </div>
            {results.map((video, idx) => (
              <div
                key={idx}
                className="bg-white rounded-lg shadow p-4 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-semibold text-lg mb-2">{video.filename}</div>
                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 mb-3">
                      <div>📅 {formatDate(video.created)}</div>
                      💾 {formatFileSize(video.size)}
                    </div>
                    {video.metadata?.notes && (
                      <div className="bg-blue-50 p-2 rounded mb-2">
                        <span className="font-semibold">Ghi chú:</span> {video.metadata.notes}
                      </div>
                    )}
                    {video.metadata?.detections && video.metadata.detections.length > 0 && (
                      <div className="bg-green-50 p-2 rounded mb-2">
                        <span className="font-semibold">QR phát hiện ({video.metadata.detections.length}):</span>
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
                  <button
                    onClick={() => handlePlayVideo(video.filename)}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold"
                  >
                    ▶️ Phát Video
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchByQR;

