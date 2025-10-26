# 📦 Phần Mềm Đóng Gửi Hàng

Ứng dụng desktop (Electron) quay video + quét QR code hoạt động offline.

## ✨ Tính năng

✅ **Quay video từ camera** với preview realtime
✅ **Quét QR code** tự động trong khi quay
✅ **Lưu metadata** (vị trí QR, thời gian, ghi chú)
✅ **Chọn camera** khác nhau
✅ **Quản lý video**: xem danh sách, xóa, mở vị trí file
✅ **Tìm kiếm video** theo QR code
✅ **Play video** trực tiếp trong app
✅ **Cài đặt** thư mục lưu trữ tùy chỉnh
✅ **SQLite database** để lưu trữ metadata

## 🚀 Cài đặt và Chạy

```bash
# Cài đặt dependencies
npm install

# Chạy ở chế độ development
npm run dev

# Build
npm run build

# Tạo file cài đặt
npm run dist
```

## 📁 Cấu trúc

```
Phan-mem-dong-hang/
├── main/              # Electron main process
│   ├── main.ts        # Entry point
│   ├── preload.ts     # IPC bridge
│   └── database.ts    # SQLite operations
├── renderer/          # React UI
│   ├── App.tsx
│   └── components/
│       ├── CameraView.tsx
│       ├── VideoManager.tsx
│       ├── SearchByQR.tsx
│       └── Settings.tsx
├── dist/              # Compiled files
└── node_modules/      # Dependencies
```

## 💾 Lưu trữ

- **Video**: Thư mục cài đặt hoặc mặc định tại `~/Library/Application Support/phan-mem-dong-hang/videos/`
- **Database**: `database.db` (SQLite)
- **Config**: `config.json`

## 🎯 Sử dụng

1. **Quay video**: Mở tab "📹 Quay Video", chọn camera, nhấn "Bắt đầu quay"
2. **Xem video**: Tab "📁 Danh sách Video"
3. **Tìm kiếm**: Tab "🔍 Tìm theo QR" - nhập mã QR để tìm
4. **Cài đặt**: Tab "⚙️ Cài đặt" - chọn thư mục lưu trữ

## 📝 Lưu ý

- Hoạt động hoàn toàn offline
- Cần cấp quyền camera
- Video lưu định dạng .webm

## 🛠️ Tech Stack

- **Electron** 27
- **React** 18 + TypeScript
- **TailwindCSS** 3
- **Vite** 5
- **better-sqlite3** 9
- **jsQR** 1.4

