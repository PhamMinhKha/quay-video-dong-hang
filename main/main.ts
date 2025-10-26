import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { initDatabase, insertVideo, insertQRDetections, getAllVideos, deleteVideo as dbDeleteVideo, getVideoByFilename, searchVideosByQR } from './database';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Cho phép file:// protocol
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Kiểm tra xem có phải dev mode không
  const isDev = !app.isPackaged || process.argv.includes('--dev');
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Uncomment để mở DevTools khi debug
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', async () => {
  // Tạo thư mục videos nếu chưa có
  const videosDir = path.join(app.getPath('userData'), 'videos');
  try {
    await fs.mkdir(videosDir, { recursive: true });
  } catch (err) {
    console.error('Error creating videos directory:', err);
  }
  
  // Khởi tạo database
  try {
    initDatabase();
  } catch (err) {
    console.error('Error initializing database:', err);
  }
  
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('get-videos-dir', () => {
  return path.join(app.getPath('userData'), 'videos');
});

ipcMain.handle('save-video', async (_, { filename, buffer, metadata }) => {
  const videosDir = path.join(app.getPath('userData'), 'videos');
  const videoPath = path.join(videosDir, filename);
  const metadataPath = videoPath.replace(/\.[^.]+$/, '.json');
  
  await fs.writeFile(videoPath, Buffer.from(buffer));
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  
  // Lưu vào SQLite
  const stats = await fs.stat(videoPath);
  const videoId = insertVideo({
    filename,
    path: videoPath,
    size: stats.size,
    created_at: metadata.createdAt || new Date().toISOString(),
    notes: metadata.notes || null,
  });
  
  // Lưu QR detections
  if (metadata.detections && metadata.detections.length > 0) {
    const detections = metadata.detections.map((d: any) => ({
      video_id: videoId,
      qr_text: d.text,
      timestamp: d.time,
      bbox_x: d.bbox.x,
      bbox_y: d.bbox.y,
      bbox_w: d.bbox.w,
      bbox_h: d.bbox.h,
    }));
    insertQRDetections(detections);
  }
  
  return { success: true, path: videoPath };
});

ipcMain.handle('list-videos', async () => {
  try {
    // Lấy từ SQLite
    const videos = getAllVideos();
    
    // Mapping dữ liệu để tương thích với UI
    return videos.map(v => ({
      filename: v.filename,
      path: v.path,
      size: v.size,
      created: new Date(v.created_at),
      metadata: {
        notes: v.notes,
        detections: v.detections || [],
      },
    }));
  } catch (err) {
    console.error('Error listing videos:', err);
    return [];
  }
});

ipcMain.handle('delete-video', async (_, filename) => {
  const videosDir = path.join(app.getPath('userData'), 'videos');
  const videoPath = path.join(videosDir, filename);
  const metadataPath = videoPath.replace(/\.[^.]+$/, '.json');
  
  try {
    // Xóa file video và metadata
    await fs.unlink(videoPath);
    try {
      await fs.unlink(metadataPath);
    } catch {
      // Metadata file có thể không tồn tại
    }
    
    // Xóa từ database
    dbDeleteVideo(filename);
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err };
  }
});

ipcMain.handle('get-video-path', async (_, filename) => {
  try {
    const videoPath = path.join(app.getPath('userData'), 'videos', filename);
    console.log('🎬 Getting video path for:', filename);
    console.log('📁 Full path:', videoPath);
    
    // Kiểm tra file có tồn tại không
    try {
      await fs.access(videoPath);
      console.log('✅ Video file exists');
      return videoPath;
    } catch (error) {
      console.error('❌ Video file does not exist:', videoPath);
      throw new Error(`Video file not found: ${filename}`);
    }
  } catch (error) {
    console.error('❌ Error in get-video-path:', error);
    throw error;
  }
});

ipcMain.handle('search-by-qr', async (_, qrText) => {
  try {
    const videos = searchVideosByQR(qrText);
    return videos.map(v => ({
      filename: v.filename,
      path: v.path,
      size: v.size,
      created: new Date(v.created_at),
      metadata: {
        notes: v.notes,
        detections: v.detections || [],
      },
    }));
  } catch (err) {
    console.error('Error searching by QR:', err);
    return [];
  }
});

ipcMain.handle('show-in-folder', async (_, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (err) {
    console.error('Error showing in folder:', err);
    return { success: false, error: err };
  }
});

ipcMain.handle('get-storage-path', async () => {
  try {
    // Đọc từ config nếu có
    const configFile = path.join(app.getPath('userData'), 'config.json');
    try {
      const configContent = await fs.readFile(configFile, 'utf-8');
      const config = JSON.parse(configContent);
      if (config.storagePath) {
        return config.storagePath;
      }
    } catch {
      // Chưa có config, dùng mặc định
    }
    
    // Mặc định
    const defaultPath = path.join(app.getPath('userData'), 'videos');
    return defaultPath;
  } catch (err) {
    console.error('Error getting storage path:', err);
    return path.join(app.getPath('userData'), 'videos');
  }
});

ipcMain.handle('set-storage-path', async (_, newPath) => {
  // Lưu cấu hình vào file
  const configFile = path.join(app.getPath('userData'), 'config.json');
  const config = { storagePath: newPath };
  await fs.writeFile(configFile, JSON.stringify(config, null, 2));
  return { success: true };
});

ipcMain.handle('select-storage-folder', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Chọn thư mục lưu trữ video',
    });

    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  } catch (err) {
    console.error('Error selecting folder:', err);
    return null;
  }
});

// Export QR code segments using ffmpeg
ipcMain.handle('export-qr-segments', async (_, { filename, detections, outputDir }) => {
  try {
    const videosDir = path.join(app.getPath('userData'), 'videos');
    const inputVideoPath = path.join(videosDir, filename);
    
    // Check if input video exists
    try {
      await fs.access(inputVideoPath);
    } catch {
      throw new Error(`Video file not found: ${filename}`);
    }

    // Create output directory if it doesn't exist
    await fs.mkdir(outputDir, { recursive: true });

    const exportedSegments = [];
    
    for (let i = 0; i < detections.length; i++) {
      const detection = detections[i];
      const startTime = Math.max(0, detection.time - 2); // 2 seconds before QR detection
      const duration = 5; // 5 seconds total (2 before + 3 after)
      
      const outputFilename = `${path.parse(filename).name}_QR_${i + 1}_${detection.text.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`;
      const outputPath = path.join(outputDir, outputFilename);
      
      await new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-i', inputVideoPath,
          '-ss', startTime.toString(),
          '-t', duration.toString(),
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-y', // Overwrite output file
          outputPath
        ]);

        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
          if (code === 0) {
            resolve(outputPath);
          } else {
            reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
          }
        });

        ffmpeg.on('error', (err) => {
          reject(new Error(`FFmpeg spawn error: ${err.message}`));
        });
      });

      exportedSegments.push({
        qrText: detection.text,
        time: detection.time,
        outputPath,
        filename: outputFilename
      });
    }

    return {
      success: true,
      exportedSegments,
      outputDir
    };
  } catch (err) {
    console.error('Error exporting QR segments:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    };
  }
});

// Export video segment using ffmpeg
ipcMain.handle('export-video-segment', async (_, { inputPath, outputDir, outputFilename, startTime, endTime }) => {
  try {
    // Check if input video exists
    try {
      await fs.access(inputPath);
    } catch {
      throw new Error(`Video file not found: ${inputPath}`);
    }

    // Create output directory if it doesn't exist
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, outputFilename);
    const duration = endTime - startTime;
    
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputPath,
        '-ss', startTime.toString(),
        '-t', duration.toString(),
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-y', // Overwrite output file
        outputPath
      ]);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(new Error(`FFmpeg spawn error: ${err.message}`));
      });
    });

    return {
      success: true,
      outputPath
    };
  } catch (err) {
    console.error('Error exporting video segment:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    };
  }
});

