# Hướng dẫn phát hành & Auto-Update

App dùng `electron-updater` + **GitHub Releases**. Bản đã cài trên máy người dùng sẽ tự check bản mới khi khởi động (và mỗi 4 giờ), tải ngầm, rồi hỏi khởi động lại để cài.

> ⚠️ Chỉ bản **Setup (NSIS)** tự update được. Bản **Portable** không hỗ trợ auto-update — người dùng portable phải tải tay.

## Cài đặt một lần (lần đầu tiên)

1. **Tạo repo trên GitHub** (ví dụ `vicdigi-downloader`). Repo **phải để Public** — electron-updater tải update từ release công khai, repo private sẽ không update được cho khách hàng.
   - Nếu không muốn lộ source: tạo repo public **chỉ để chứa Releases** (không push code), còn code để repo private khác. Auto-update chỉ cần Releases.
2. **Sửa 2 chỗ placeholder** thành username GitHub của bạn:
   - `electron-builder.yml` → `publish.owner`
   - `package.json` → `repository.url`
3. Push code lên GitHub (git đã được khởi tạo sẵn):
   ```bash
   git remote add origin https://github.com/<username>/vicdigi-downloader.git
   git push -u origin main
   ```

## Quy trình phát hành mỗi bản mới

1. **Tăng version** trong `package.json` (ví dụ `8.0.0` → `8.0.1`). Auto-update so sánh version này — không tăng là không update.
2. Chạy test + build:
   ```bash
   npm run smoke
   npm run build-win
   ```
3. Trên GitHub → **Releases → Draft a new release**:
   - Tag: `v8.0.1` (phải trùng version, có tiền tố `v`)
   - Upload **đủ 3 file** từ thư mục `dist/`:
     - `VICdigi Downloader-v8.0.1-Setup.exe`
     - `VICdigi Downloader-v8.0.1-Setup.exe.blockmap` (để tải update dạng delta, nhẹ hơn)
     - `latest.yml` ← **quan trọng nhất**, electron-updater đọc file này để biết có bản mới
   - (Tuỳ chọn) upload thêm bản Portable cho người tải tay.
4. Bấm **Publish release**. Xong — app đã cài trên máy khách sẽ tự thấy bản mới.

### Cách nhanh hơn: publish thẳng từ máy build
Tạo Personal Access Token (GitHub → Settings → Developer settings → Tokens, quyền `repo`), rồi:
```powershell
$env:GH_TOKEN = "ghp_xxx"
npx electron-builder --win --config electron-builder.yml --publish always
```
electron-builder sẽ tự build + tạo draft release + upload đủ file. Vào GitHub bấm Publish là xong.

## Kiểm tra auto-update hoạt động

1. Build và cài bản `8.0.0` vào máy.
2. Tăng version lên `8.0.1`, build, publish release.
3. Mở app bản `8.0.0` → sau ~5 giây app check GitHub → tải ngầm → hiện hộp thoại "Khởi động lại ngay / Để sau".
4. Nếu không thấy gì, xem log tại `%APPDATA%\vicdigi-downloader\logs\` hoặc chạy app từ terminal để xem console (`[app-updater] ...`).

## Lưu ý

- `yt-dlp.exe` / `ffmpeg.exe` không nằm trong git (file quá lớn) nhưng **bắt buộc phải có trong thư mục project khi build** — electron-builder đóng chúng vào `resources/`.
- Auto-update là của **app**; nút update yt-dlp trong app là cơ chế riêng, không liên quan.
- Đừng bao giờ commit private key license (`.gitignore` đã chặn `*private*.pem`).
- Bản Setup phải được cài (không phải chạy file Setup rồi xoá) thì cơ chế update mới có quyền ghi vào thư mục cài đặt.
