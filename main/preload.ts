import { contextBridge, ipcRenderer } from 'electron';

export interface VideoMetadata {
  video: string;
  createdAt: string;
  detections: Array<{
    text: string;
    time: number;
    bbox: { x: number; y: number; w: number; h: number };
  }>;
  notes: string;
  user?: { id: string; name: string };
}

contextBridge.exposeInMainWorld('electronAPI', {
  getVideosDir: () => ipcRenderer.invoke('get-videos-dir'),
  saveVideo: (data: { filename: string; buffer: ArrayBuffer; metadata: VideoMetadata }) =>
    ipcRenderer.invoke('save-video', data),
  listVideos: () => ipcRenderer.invoke('list-videos'),
  deleteVideo: (filename: string) => ipcRenderer.invoke('delete-video', filename),
  getVideoPath: (filename: string) => ipcRenderer.invoke('get-video-path', filename),
  searchByQR: (qrText: string) => ipcRenderer.invoke('search-by-qr', qrText),
  showInFolder: (filePath: string) => ipcRenderer.invoke('show-in-folder', filePath),
  getStoragePath: () => ipcRenderer.invoke('get-storage-path'),
  setStoragePath: (path: string) => ipcRenderer.invoke('set-storage-path', path),
  selectStorageFolder: () => ipcRenderer.invoke('select-storage-folder'),
});

export {};

