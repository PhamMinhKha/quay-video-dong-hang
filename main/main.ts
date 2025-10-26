import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { initDatabase, insertVideo, insertQRDetections, getAllVideos, deleteVideo as dbDeleteVideo, getVideoByFilename, searchVideosByQR } from './database';

let mainWindow: BrowserWindow | null = null;

// Cải thiện khả năng tương thích với M4 và Electron 32
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Cho phép file:// protocol
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      // Cải thiện cho M4 chip
      experimentalFeatures: false,
      // Tối ưu hóa memory cho M4
      v8CacheOptions: 'code',
      // Tắt các tính năng có thể gây xung đột trên M4
      spellcheck: false,
      backgroundThrottling: false,
    },
    // Tối ưu hóa cho M4
    titleBarStyle: 'default',
    trafficLightPosition: { x: 20, y: 20 },
    show: false, // Không hiện window ngay lập tức
    // Cải thiện hiệu suất trên M4
    useContentSize: true,
    acceptFirstMouse: true,
  });

  // Hiện window khi đã ready với delay để tránh crash trên M4
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      mainWindow?.show();
    }, 100);
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

  // Xử lý lỗi để tránh crash trên M4
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details);
    // Tự động tạo lại window nếu crash
    if (mainWindow) {
      mainWindow.destroy();
      mainWindow = null;
      setTimeout(createWindow, 1000);
    }
  });

  // Xử lý unresponsive để tránh hang trên M4
  mainWindow.on('unresponsive', () => {
    console.warn('Window became unresponsive');
  });

  mainWindow.on('responsive', () => {
    console.log('Window became responsive again');
  });
}

app.on('ready', async () => {
  // Cải thiện khả năng tương thích với M4
  app.commandLine.appendSwitch('--disable-features', 'VizDisplayCompositor');
  app.commandLine.appendSwitch('--disable-gpu-sandbox');
  app.commandLine.appendSwitch('--disable-software-rasterizer');
  app.commandLine.appendSwitch('--no-sandbox');
  
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
  // Sử dụng storage path từ config
  let videosDir: string;
  try {
    // Đọc từ config nếu có
    const configFile = path.join(app.getPath('userData'), 'config.json');
    try {
      const configContent = await fs.readFile(configFile, 'utf-8');
      const config = JSON.parse(configContent);
      videosDir = config.storagePath || path.join(app.getPath('userData'), 'videos');
    } catch {
      // Chưa có config, dùng mặc định
      videosDir = path.join(app.getPath('userData'), 'videos');
    }
  } catch (err) {
    console.error('Error getting storage path:', err);
    videosDir = path.join(app.getPath('userData'), 'videos');
  }
  
  // Tạo thư mục nếu chưa có
  await fs.mkdir(videosDir, { recursive: true });
  
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
  try {
    // Đọc config hiện tại
    const configFile = path.join(app.getPath('userData'), 'config.json');
    let config: any = {};
    try {
      const configContent = await fs.readFile(configFile, 'utf-8');
      config = JSON.parse(configContent);
    } catch {
      // Chưa có config, tạo mới
    }
    
    // Cập nhật storage path
    config.storagePath = newPath;
    await fs.writeFile(configFile, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (err: any) {
    console.error('Error setting storage path:', err);
    return { success: false, error: err.message };
  }
});

// Database path handlers
ipcMain.handle('get-database-path', async () => {
  try {
    // Đọc từ config nếu có
    const configFile = path.join(app.getPath('userData'), 'config.json');
    try {
      const configContent = await fs.readFile(configFile, 'utf-8');
      const config = JSON.parse(configContent);
      if (config.databasePath) {
        return config.databasePath;
      }
    } catch {
      // Chưa có config, dùng mặc định
    }
    
    // Mặc định
    const defaultPath = app.getPath('userData');
    return defaultPath;
  } catch (err: any) {
    console.error('Error getting database path:', err);
    return app.getPath('userData');
  }
});

ipcMain.handle('set-database-path', async (_, newPath) => {
  try {
    // Đọc config hiện tại
    const configFile = path.join(app.getPath('userData'), 'config.json');
    let config: any = {};
    try {
      const configContent = await fs.readFile(configFile, 'utf-8');
      config = JSON.parse(configContent);
    } catch {
      // Chưa có config, tạo mới
    }
    
    // Cập nhật database path
    config.databasePath = newPath;
    await fs.writeFile(configFile, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (err: any) {
    console.error('Error setting database path:', err);
    return { success: false, error: err.message };
  }
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

