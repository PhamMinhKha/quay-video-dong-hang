# Hướng dẫn cài đặt và chạy

## Yêu cầu hệ thống
- Node.js (version 18 trở lên)
- npm hoặc yarn

## Cài đặt

```bash
# Cài đặt dependencies
npm install
```

## Chạy ứng dụng

### Chế độ development
```bash
npm run dev
```

Lệnh này sẽ:
1. Khởi động Vite dev server cho React
2. Chờ server sẵn sàng
3. Khởi động Electron

### Build production
```bash
# Build code
npm run build

# Tạo file cài đặt
npm run dist
```

## Cấu trúc thư mục

```
Phan-mem-dong-hang/
├── main/                    # Electron main process
│   ├── main.ts             # Entry point
│   ├── preload.ts          # Preload script cho IPC
│   └── tsconfig.json
├── renderer/                # React UI
│   ├── components/
│   │   ├── CameraView.tsx  # Component quay video
│   │   ├── QRDetector.tsx  # Component quét QR
│   │   └── VideoManager.tsx # Quản lý video
│   ├── App.tsx             # App chính
│   ├── index.tsx           # Entry point
│   ├── styles.css          # Tailwind CSS
│   └── types/
│       └── electron.d.ts   # Type definitions
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── electron-builder.yml
```

## Tính năng

### 1. Quay Video
- Mở camera và hiển thị preview
- Phát hiện QR code realtime
- Ghi video kèm metadata
- Lưu offline vào thư mục `videos/`

### 2. Quản lý Video
- Xem danh sách video đã quay
- Xem thông tin metadata
- Xóa video cũ

## Lưu ý

- Ứng dụng hoạt động hoàn toàn offline
- Video được lưu tại thư mục userData của Electron
- Windows: `%APPDATA%\phan-mem-dong-hang\videos`
- macOS: `~/Library/Application Support/phan-mem-dong-hang/videos`
- Linux: `~/.config/phan-mem-dong-hang/videos`

