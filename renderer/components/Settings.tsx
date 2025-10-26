import React, { useState, useEffect } from 'react';

const Settings: React.FC = () => {
  const [storagePath, setStoragePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const path = await window.electronAPI.getStoragePath();
      setStoragePath(path);
    } catch (err) {
      console.error('Error loading settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const path = await window.electronAPI.selectStorageFolder();
      if (path) {
        setStoragePath(path);
      }
    } catch (err) {
      console.error('Error selecting folder:', err);
      alert('Không thể chọn thư mục. Vui lòng thử lại!');
    }
  };

  const handleSave = async () => {
    if (!storagePath) {
      alert('Vui lòng chọn thư mục lưu trữ!');
      return;
    }

    setSaving(true);
    try {
      const result = await window.electronAPI.setStoragePath(storagePath);
      if (result.success) {
        alert('✅ Đã lưu cài đặt thành công!');
      } else {
        alert('Lỗi khi lưu cài đặt!');
      }
    } catch (err) {
      console.error('Error saving settings:', err);
      alert('Lỗi khi lưu cài đặt!');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xl">Đang tải...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6 bg-gray-50">
      <div className="max-w-2xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-6">⚙️ Cài đặt</h1>

        <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
          {/* Storage Path */}
          <div>
            <label className="block text-lg font-semibold mb-3">
              📁 Thư mục lưu trữ video
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={storagePath}
                readOnly
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50"
              />
              <button
                onClick={handleSelectFolder}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold"
              >
                📂 Chọn thư mục
              </button>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              Video và file metadata sẽ được lưu tại thư mục này
            </p>
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving || !storagePath}
              className="px-8 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold text-lg"
            >
              {saving ? '⏳ Đang lưu...' : '💾 Lưu cài đặt'}
            </button>
          </div>
        </div>

        {/* Info */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <div className="text-2xl mr-3">ℹ️</div>
            <div className="text-sm text-gray-700">
              <p className="font-semibold mb-1">Lưu ý:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Video cũ sẽ vẫn ở vị trí cũ, không tự động di chuyển</li>
                <li>Video mới sẽ được lưu vào thư mục mới</li>
                <li>Vui lòng backup dữ liệu trước khi thay đổi</li>
                <li>Cần khởi động lại ứng dụng để áp dụng thay đổi</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;

