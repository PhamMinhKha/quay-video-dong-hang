import React, { useState } from 'react';
import CameraView from './components/CameraView';
import VideoManager from './components/VideoManager';
import SearchByQR from './components/SearchByQR';
import Settings from './components/Settings';
import { VideoMetadata } from '../main/preload';

type Tab = 'record' | 'videos' | 'search' | 'settings';

// Error Boundary Component
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('🚨 Component Error:', error);
    console.error('🚨 Error Info:', errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          <h3 className="font-bold">Lỗi Component:</h3>
          <p>{this.state.error?.message}</p>
          <button 
            onClick={() => this.setState({ hasError: false })}
            className="mt-2 px-4 py-2 bg-red-500 text-white rounded"
          >
            Thử lại
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('record');

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <div className="bg-blue-600 text-white px-4 py-2 shadow shrink-0">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold whitespace-nowrap">📦 Đóng Gửi Hàng</h1>
          <div className="flex gap-1.5 flex-wrap justify-end">
            <button
              onClick={() => setActiveTab('record')}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                activeTab === 'record' ? 'bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              📹 Quay Video
            </button>
            <button
              onClick={() => {
                console.log('🔄 Switching to videos tab');
                setActiveTab('videos');
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                activeTab === 'videos' ? 'bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              📁 Danh sách Video
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                activeTab === 'search' ? 'bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
              }`}
            >
              🔍 Tìm theo QR
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
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
        {activeTab === 'videos' && (
          <ErrorBoundary>
            <div>
              {console.log('📁 Rendering VideoManager, activeTab:', activeTab)}
              <VideoManager />
            </div>
          </ErrorBoundary>
        )}
        {activeTab === 'search' && <SearchByQR />}
        {activeTab === 'settings' && <Settings />}
      </div>
    </div>
  );
};

export default App;

