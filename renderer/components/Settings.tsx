import React, { useState, useEffect } from 'react';

const Settings: React.FC = () => {
  const [storagePath, setStoragePath] = useState('');
  const [databasePath, setDatabasePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const videoPath = await window.electronAPI.getStoragePath();
      const dbPath = await window.electronAPI.getDatabasePath();
      setStoragePath(videoPath);
      setDatabasePath(dbPath);
    } catch (err) {
      console.error('Error loading settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectVideoFolder = async () => {
    try {
      const path = await window.electronAPI.selectStorageFolder();
      if (path) {
        setStoragePath(path);
      }
    } catch (err) {
      console.error('Error selecting video folder:', err);
      alert('Không thể chọn thư mục video. Vui lòng thử lại!');
    }
  };

  const handleSelectDatabaseFolder = async () => {
    try {
      const path = await window.electronAPI.selectStorageFolder();
      if (path) {
        setDatabasePath(path);
      }
    } catch (err) {
      console.error('Error selecting database folder:', err);
      alert('Không thể chọn thư mục database. Vui lòng thử lại!');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      console.log('Saving settings:', { storagePath, databasePath });

      const videoResult = await window.electronAPI.setStoragePath(storagePath);
      console.log('Video result:', videoResult);

      const dbResult = await window.electronAPI.setDatabasePath(databasePath);
      console.log('Database result:', dbResult);

      if (videoResult.success && dbResult.success) {
        alert('✅ Đã lưu cài đặt thành công!\n\n⚠️ Vui lòng khởi động lại ứng dụng để áp dụng thay đổi.');
      } else {
        console.error('Save failed:', { videoResult, dbResult });
        alert(`Lỗi khi lưu cài đặt!\nVideo: ${videoResult.success ? 'OK' : videoResult.error}\nDatabase: ${dbResult.success ? 'OK' : dbResult.error}`);
      }
    } catch (err) {
      console.error('Error saving settings:', err);
      alert('Lỗi khi lưu cài đặt: ' + err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xl">⏳ Đang tải cài đặt...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto w-full">
          <h1 className="text-3xl font-bold mb-6">⚙️ Cài đặt Hệ thống</h1>

          <div className="bg-white rounded-lg shadow-lg p-6 space-y-8">
            {/* Video Storage Path */}
            <div>
              <label className="block text-lg font-semibold mb-3">
                📹 Thư mục lưu trữ Video
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={storagePath}
                  readOnly
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 font-mono text-sm"
                  placeholder="Chưa chọn thư mục..."
                />
                <button
                  onClick={handleSelectVideoFolder}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold transition-colors"
                >
                  📂 Chọn thư mục
                </button>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                📁 Video (.mp4) và file metadata (.json) sẽ được lưu tại thư mục này
              </p>
            </div>

            {/* Database Storage Path */}
            <div>
              <label className="block text-lg font-semibold mb-3">
                🗄️ Thư mục lưu trữ Database SQLite
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={databasePath}
                  readOnly
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 font-mono text-sm"
                  placeholder="Chưa chọn thư mục..."
                />
                <button
                  onClick={handleSelectDatabaseFolder}
                  className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold transition-colors"
                >
                  📂 Chọn thư mục
                </button>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                🗃️ File database.db chứa thông tin video và QR detections sẽ được lưu tại thư mục này
              </p>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4 border-t">
              <button
                onClick={handleSave}
                disabled={saving || !storagePath || !databasePath}
                className="px-8 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold text-lg transition-colors"
              >
                {saving ? '⏳ Đang lưu...' : '💾 Lưu cài đặt'}
              </button>
            </div>
          </div>

          {/* Info Section */}
          <div className="mt-6 space-y-4">
            {/* AWC / Điện thoại làm camera */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <div className="flex items-start">
                <div className="text-2xl mr-3">📱</div>
                <div className="text-sm text-gray-700">
                  <p className="font-semibold mb-2 text-indigo-900">Dùng điện thoại làm camera (AWC)</p>
                  <p className="mb-2">
                    App này không nhúng mã nguồn AWP — dùng{' '}
                    <a
                      href="https://github.com/soubhagyajit/Android-Webcam-Project"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-700 underline font-medium"
                    >
                      Android Webcam Project
                    </a>{' '}
                    chạy song song. AWC tạo webcam ảo trên Windows; phần mềm đóng hàng chỉ cần chọn camera đó.
                  </p>
                  <ol className="list-decimal list-inside space-y-1 mb-2">
                    <li>Cài <strong>AWA</strong> trên điện thoại Android và <strong>AWC</strong> trên PC (bản client ≥ v1.0.6 có virtual webcam).</li>
                    <li>Mở AWA → cấp quyền camera → bắt đầu stream (USB hoặc cùng WiFi).</li>
                    <li>Mở AWC trên PC → Connect tới điện thoại.</li>
                    <li>Trong tab <strong>Quay Video</strong>, chọn camera có nhãn AWC / Softcam (hoặc bấm Làm mới).</li>
                  </ol>
                  <p className="text-xs text-indigo-800">
                    USB ổn định hơn WiFi. Nếu không thấy camera: mở firewall cổng 8080/8554, đóng Zoom/Teams đang chiếm camera, rồi Làm mới.
                  </p>
                </div>
              </div>
            </div>

            {/* Warning */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start">
                <div className="text-2xl mr-3">⚠️</div>
                <div className="text-sm text-gray-700">
                  <p className="font-semibold mb-1 text-yellow-800">Lưu ý quan trọng:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Cần <strong>khởi động lại ứng dụng</strong> để áp dụng thay đổi</li>
                    <li>Dữ liệu cũ sẽ vẫn ở vị trí cũ, không tự động di chuyển</li>
                    <li>Dữ liệu mới sẽ được lưu vào thư mục mới</li>
                    <li>Vui lòng backup dữ liệu trước khi thay đổi</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start">
                <div className="text-2xl mr-3">ℹ️</div>
                <div className="text-sm text-gray-700">
                  <p className="font-semibold mb-1 text-blue-800">Thông tin:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>Video:</strong> Lưu trữ file video và metadata JSON</li>
                    <li><strong>Database:</strong> Lưu trữ thông tin tìm kiếm và QR detections</li>
                    <li><strong>Tách biệt:</strong> Có thể lưu ở 2 vị trí khác nhau để tối ưu</li>
                    <li><strong>Backup:</strong> Nên backup cả 2 thư mục định kỳ</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Tác Giả */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start">
                <div className="text-2xl mr-3">✅</div>
                <div className="text-sm text-gray-700">
                  <p className="font-semibold mb-1 text-green-800">Tác giả: Phạm Minh Kha</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong>Zalo:</strong> <a href="https://zalo.me/0981751649" target="_blank" rel="noopener noreferrer">098-175-1649</a></li>
                  </ul>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;

