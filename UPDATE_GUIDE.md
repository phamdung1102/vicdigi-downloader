# Hướng dẫn phát hành & Auto-Update

App dùng `electron-updater` + **GitHub Releases**. Bản Setup đã cài trên máy người dùng tự check bản mới khi khởi động (và mỗi 4 giờ), tải ngầm, rồi hỏi khởi động lại để cài.

## Setup hiện tại (đã cấu hình xong)

- Releases đăng tại repo **public**: https://github.com/phamdung1102/vicdigi-downloader
- Repo này **chỉ chứa file cài đặt** — source code KHÔNG đưa lên GitHub (giữ ở máy, quản lý bằng git local).
- Token GitHub lấy tự động từ `gh` CLI (đã đăng nhập tài khoản phamdung1102 trên máy này).
- `releaseType: release` trong `electron-builder.yml` → đăng lên là khách nhận được ngay, không cần vào GitHub bấm gì thêm.
- Bộ cài hiện chưa ký số, vì vậy không cấu hình `win.publisherName`; nếu khai báo
  publisher mà không ký installer, `electron-updater` sẽ từ chối bản cập nhật.

## Phát hành bản mới — chỉ 2 bước

1. **Tăng version** trong `package.json` (ví dụ `8.0.0` → `8.0.1`). Không tăng version là khách không nhận update.
2. Chạy:
   ```bash
   npm run smoke     # kiểm tra nhanh app không hỏng
   npm run release   # build + tự upload lên GitHub Releases
   ```

Xong. `npm run release` tự làm hết: build Setup + Portable, tạo tag `v8.0.1`, upload `Setup.exe` + `.blockmap` + `latest.yml` (file mà electron-updater đọc để biết có bản mới).

> ⚠️ Chỉ bản **Setup (NSIS)** tự update được. Bản **Portable** không hỗ trợ auto-update.

## Kiểm tra auto-update hoạt động

1. Cài bản Setup hiện tại vào máy.
2. Tăng version, chạy `npm run release`.
3. Mở app bản cũ → sau ~5 giây app check GitHub → tải ngầm → hiện hộp thoại "Khởi động lại ngay / Để sau".
4. Nếu không thấy gì: xem log `%APPDATA%\vicdigi-downloader\logs\` hoặc chạy app từ terminal xem dòng `[app-updater] ...`.

## Lưu ý

- `yt-dlp.exe` / `ffmpeg.exe` không nằm trong git (quá lớn) nhưng **bắt buộc có trong thư mục project khi build** — electron-builder đóng chúng vào `resources/`.
- Auto-update là của **app**; nút update yt-dlp trong app là cơ chế riêng.
- Đừng bao giờ commit hay upload private key license (`.gitignore` đã chặn `*private*.pem`).
- Nếu đổi máy build: cài `gh` CLI và chạy `gh auth login` (hoặc set biến môi trường `GH_TOKEN`).
