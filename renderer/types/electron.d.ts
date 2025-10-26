import { VideoMetadata } from '../../main/preload';

declare global {
  interface Window {
    electronAPI: {
      getVideosDir: () => Promise<string>;
      saveVideo: (data: { filename: string; buffer: ArrayBuffer; metadata: VideoMetadata }) => Promise<any>;
      listVideos: () => Promise<Array<{
        filename: string;
        path: string;
        size: number;
        created: Date;
        metadata: any;
      }>>;
      deleteVideo: (filename: string) => Promise<{ success: boolean }>;
      getVideoPath: (filename: string) => Promise<string>;
      searchByQR: (qrText: string) => Promise<any>;
      showInFolder: (filePath: string) => Promise<{ success: boolean }>;
      getStoragePath: () => Promise<string>;
      setStoragePath: (path: string) => Promise<{ success: boolean }>;
      selectStorageFolder: () => Promise<string | null>;
    };
  }
}

export {};

