import React, { useState } from 'react';
import CameraView from './components/CameraView';
import VideoManager from './components/VideoManager';
import SearchByQR from './components/SearchByQR';
import Settings from './components/Settings';
import { VideoMetadata } from '../main/preload';

type Tab = 'record' | 'videos' | 'search' | 'settings';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('record');

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <div className="bg-blue-600 text-white px-6 py-4 shadow-lg">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">📦 Phần mềm Đóng Gửi Hàng</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('record')}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                activeTab === 'record' ? 'bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              📹 Quay Video
            </button>
            <button
              onClick={() => setActiveTab('videos')}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                activeTab === 'videos' ? 'bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              📁 Danh sách Video
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                activeTab === 'search' ? 'bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              🔍 Tìm theo QR
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                activeTab === 'settings' ? 'bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              ⚙️ Cài đặt
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'record' && <CameraView />}
        {activeTab === 'videos' && <VideoManager />}
        {activeTab === 'search' && <SearchByQR />}
        {activeTab === 'settings' && <Settings />}
      </div>
    </div>
  );
};

export default App;

