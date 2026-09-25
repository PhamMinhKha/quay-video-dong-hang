# Changelog

## [1.1.1] — 2026-09-25

### UI / Windows
- Bỏ header xanh trùng tên app (Windows đã có title bar); chỉ giữ thanh tab gọn
- Tắt menu File/Edit/View mặc định của Electron
- Gỡ tuỳ chọn cửa sổ macOS không dùng trên Windows
- Xóa `resources/platform-tools` thừa (chỉ giữ `resources/adb`)

## [1.1.0] — 2026-09-25

### Kết nối điện thoại (AWA) — không cần Virtual Cam / Softcam
- Kết nối trực tiếp app Android Webcam (AWA) qua USB (ADB) hoặc Wi‑Fi
- Forward cổng ADB (8080 control + 8554 RTSP), bundle `adb.exe` trong `resources/adb`
- Preview RTSP H264 qua ffmpeg → MJPEG `http://127.0.0.1:18080/preview`
- Ghi hình 1080p riêng từ RTSP (libx264), preview nhẹ hơn để UI mượt

### Quét & gắn QR
- Quét QR trong main process (nativeImage + jsQR), ổn định hơn drawImage MJPEG
- Banner “QR gần nhất” trên preview; hiệu ứng/beep chỉ khi **đổi mã**, cùng mã không nhấp nháy
- Chỉ gắn QR khi đang quay; bỏ qua mã cũ; không lưu khi mã vừa biến mất / nhiễu
- Sửa lỗi video lưu không có mã (confirm bị reset bởi tín hiệu null xen kẽ)

### Tách clip theo QR (phù hợp đóng hàng ít, không nhanh)
- QR đầu tiên trong phiên quay → gắn vào clip hiện tại
- QR **mới khác mã** → tự lưu clip cũ + mở clip mới gắn mã mới
- Tên file kèm mã QR để dễ tìm trên ổ đĩa / trong app
- Panel hiển thị clip đang quay và số clip đã tách

### Ổn định ghi hình & hiệu năng
- Retry / probesize RTSP khi mở phiên ghi; báo khi ffmpeg chết sớm (không còn alert “không có phiên” gây hiểu nhầm)
- Tối ưu quét QR: thu nhỏ frame, chạy lệch nhịp, giảm đứng hình lúc nhận mã lần đầu
- Loại bỏ toast lưu video; giảm spam IPC

### UI / khác
- Tab quay: nguồn Điện thoại / Webcam, chọn thiết bị ADB, trạng thái kết nối
- Hướng dẫn AWC/AWA trong Settings
- Phụ thuộc: `ffmpeg-static`, giữ `jsqr`

### Ghi chú kỹ thuật
- Preview ~720p / 15fps; file lưu 1920p / 24fps
- Cần: USB debugging + app AWA đang stream; máy có quyền ghi thư mục videos
