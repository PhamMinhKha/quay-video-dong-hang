import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

let db: Database.Database | null = null;

function getDatabasePath(): string {
  try {
    // Đọc từ config nếu có
    const configFile = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configFile)) {
      const configContent = fs.readFileSync(configFile, 'utf-8');
      const config = JSON.parse(configContent);
      if (config.databasePath) {
        return path.join(config.databasePath, 'database.db');
      }
    }
  } catch (err) {
    console.error('Error reading database config:', err);
  }
  
  // Mặc định
  return path.join(app.getPath('userData'), 'database.db');
}

export function initDatabase() {
  const dbPath = getDatabasePath();
  
  // Tạo thư mục nếu chưa có
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
  db = new Database(dbPath);

  // Tạo bảng videos
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      notes TEXT
    )
  `);

  // Tạo bảng qr_detections
  db.exec(`
    CREATE TABLE IF NOT EXISTS qr_detections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      qr_text TEXT NOT NULL,
      timestamp REAL NOT NULL,
      bbox_x INTEGER NOT NULL,
      bbox_y INTEGER NOT NULL,
      bbox_w INTEGER NOT NULL,
      bbox_h INTEGER NOT NULL,
      FOREIGN KEY (video_id) REFERENCES videos(id)
    )
  `);

  // Tạo index
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_video_id ON qr_detections(video_id)
  `);

  console.log('✅ Database initialized at:', dbPath);
  return db;
}

export function getDatabase() {
  if (!db) {
    db = initDatabase();
  }
  return db;
}

export interface VideoRecord {
  id?: number;
  filename: string;
  path: string;
  size: number;
  created_at: string;
  notes?: string;
}

export interface QRDetectionRecord {
  id?: number;
  video_id: number;
  qr_text: string;
  timestamp: number;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
}

export function insertVideo(video: VideoRecord): number {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO videos (filename, path, size, created_at, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    video.filename,
    video.path,
    video.size,
    video.created_at,
    video.notes || null
  );
  return result.lastInsertRowid as number;
}

export function insertQRDetections(detections: QRDetectionRecord[]): void {
  if (detections.length === 0) return;

  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO qr_detections 
    (video_id, qr_text, timestamp, bbox_x, bbox_y, bbox_w, bbox_h)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((dets: QRDetectionRecord[]) => {
    for (const det of dets) {
      stmt.run(
        det.video_id,
        det.qr_text,
        det.timestamp,
        det.bbox_x,
        det.bbox_y,
        det.bbox_w,
        det.bbox_h
      );
    }
  });

  insertMany(detections);
}

export function getAllVideos(): any[] {
  const db = getDatabase();
  const videos = db.prepare(`
    SELECT v.*, 
           COUNT(d.id) as detection_count
    FROM videos v
    LEFT JOIN qr_detections d ON v.id = d.video_id
    GROUP BY v.id
    ORDER BY v.created_at DESC
  `).all();

  // Lấy detections cho từng video
  return videos.map((video: any) => {
    const detections = db!.prepare(`
      SELECT qr_text, timestamp, bbox_x, bbox_y, bbox_w, bbox_h
      FROM qr_detections
      WHERE video_id = ?
      ORDER BY timestamp
    `).all(video.id);

    return {
      ...video,
      detections: detections.map((d: any) => ({
        text: d.qr_text,
        time: d.timestamp,
        bbox: {
          x: d.bbox_x,
          y: d.bbox_y,
          w: d.bbox_w,
          h: d.bbox_h,
        }
      }))
    };
  });
}

export function deleteVideo(filename: string): void {
  const db = getDatabase();
  
  // Xóa detections trước
  db.prepare('DELETE FROM qr_detections WHERE video_id IN (SELECT id FROM videos WHERE filename = ?)').run(filename);
  
  // Xóa video
  db.prepare('DELETE FROM videos WHERE filename = ?').run(filename);
}

export function getVideoByFilename(filename: string): any {
  const db = getDatabase();
  const video = db.prepare('SELECT * FROM videos WHERE filename = ?').get(filename) as any;
  
  if (!video) return null;

  const detections = db.prepare(`
    SELECT qr_text, timestamp, bbox_x, bbox_y, bbox_w, bbox_h
    FROM qr_detections
    WHERE video_id = ?
    ORDER BY timestamp
  `).all(video.id);

  return {
    ...video,
    detections: detections.map((d: any) => ({
      text: d.qr_text,
      time: d.timestamp,
      bbox: { x: d.bbox_x, y: d.bbox_y, w: d.bbox_w, h: d.bbox_h }
    }))
  };
}

export function searchVideosByQR(qrText: string): any[] {
  const db = getDatabase();
  
  // Tìm videos có chứa QR code này
  const videos = db.prepare(`
    SELECT DISTINCT v.*
    FROM videos v
    INNER JOIN qr_detections qr ON v.id = qr.video_id
    WHERE qr.qr_text LIKE ?
    ORDER BY v.created_at DESC
  `).all(`%${qrText}%`) as any[];

  // Lấy detections cho từng video
  return videos.map((video: any) => {
    const detections = db!.prepare(`
      SELECT qr_text, timestamp, bbox_x, bbox_y, bbox_w, bbox_h
      FROM qr_detections
      WHERE video_id = ? AND qr_text LIKE ?
      ORDER BY timestamp
    `).all(video.id, `%${qrText}%`);

    return {
      ...video,
      detections: detections.map((d: any) => ({
        text: d.qr_text,
        time: d.timestamp,
        bbox: { x: d.bbox_x, y: d.bbox_y, w: d.bbox_w, h: d.bbox_h }
      }))
    };
  });
}

