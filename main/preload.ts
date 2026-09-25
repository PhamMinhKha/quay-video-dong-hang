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
  getDatabasePath: () => ipcRenderer.invoke('get-database-path'),
  setDatabasePath: (path: string) => ipcRenderer.invoke('set-database-path', path),
  selectStorageFolder: () => ipcRenderer.invoke('select-storage-folder'),
  exportQRSegments: (data: { filename: string; detections: any[]; outputDir: string }) =>
    ipcRenderer.invoke('export-qr-segments', data),
  exportVideoSegment: (data: { inputPath: string; outputDir: string; outputFilename: string; startTime: number; endTime: number }) =>
    ipcRenderer.invoke('export-video-segment', data),
  adbGetDevices: () => ipcRenderer.invoke('adb-get-devices'),
  adbForwardDevice: (deviceId: string) => ipcRenderer.invoke('adb-forward-device', deviceId),
  phoneStartRtsp: (rtspUrl: string) => ipcRenderer.invoke('phone-start-rtsp', rtspUrl),
  phoneStopRtsp: () => ipcRenderer.invoke('phone-stop-rtsp'),
  phoneStartRecord: (filename: string) => ipcRenderer.invoke('phone-start-record', filename),
  phoneStopRecord: (metadata: VideoMetadata) => ipcRenderer.invoke('phone-stop-record', metadata),
  onPhoneFrame: (callback: (base64: string) => void) => {
    const handler = (_event: unknown, base64: string) => callback(base64);
    ipcRenderer.on('phone-frame', handler);
    return () => ipcRenderer.removeListener('phone-frame', handler);
  },
  onPhoneQr: (
    callback: (
      payload: {
        data: string;
        width: number;
        height: number;
        location: {
          topLeftCorner: { x: number; y: number };
          bottomRightCorner: { x: number; y: number };
        };
      } | null
    ) => void
  ) => {
    const handler = (_event: unknown, payload: Parameters<typeof callback>[0]) => callback(payload);
    ipcRenderer.on('phone-qr', handler);
    return () => ipcRenderer.removeListener('phone-qr', handler);
  },
  onPhoneRecordDied: (callback: (info: { message: string }) => void) => {
    const handler = (_event: unknown, info: { message: string }) => callback(info);
    ipcRenderer.on('phone-record-died', handler);
    return () => ipcRenderer.removeListener('phone-record-died', handler);
  },
});

export {};

