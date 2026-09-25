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
      showInFolder: (filePath: string) => Promise<{ success: boolean; error?: any }>;
      getStoragePath: () => Promise<string>;
      setStoragePath: (path: string) => Promise<{ success: boolean }>;
      selectStorageFolder: () => Promise<string | null>;
      getDatabasePath: () => Promise<string>;
      setDatabasePath: (path: string) => Promise<{ success: boolean }>;
      exportQRSegments: (data: { filename: string; detections: any[]; outputDir: string }) => Promise<{
        success: boolean;
        exportedSegments?: Array<{
          qrText: string;
          time: number;
          outputPath: string;
          filename: string;
        }>;
        outputDir?: string;
        error?: string;
      }>;
      exportVideoSegment: (data: { 
        inputPath: string; 
        outputDir: string; 
        outputFilename: string; 
        startTime: number; 
        endTime: number 
      }) => Promise<{
        success: boolean;
        error?: string;
      }>;
      adbGetDevices: () => Promise<{
        success: boolean;
        devices: Array<{ id: string; model: string; status: string }>;
        error?: string;
      }>;
      adbForwardDevice: (deviceId: string) => Promise<{ success: boolean; message: string }>;
      phoneStartRtsp: (rtspUrl: string) => Promise<{
        success: boolean;
        previewUrl: string;
        message: string;
      }>;
      phoneStopRtsp: () => Promise<{ success: boolean; message?: string }>;
      phoneStartRecord: (filename: string) => Promise<{ success: boolean; message: string }>;
      phoneStopRecord: (metadata: any) => Promise<{ success: boolean; path?: string; message: string }>;
      onPhoneFrame: (callback: (base64: string) => void) => () => void;
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
      ) => () => void;
      onPhoneRecordDied: (callback: (info: { message: string }) => void) => () => void;
    };
  }
}

export {};

