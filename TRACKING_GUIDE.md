# Theo dõi kích hoạt qua Google Sheet

App gửi 2 loại tín hiệu về Google Sheet của bạn (qua Google Apps Script — miễn phí, không cần server):
- **`activate`** — mỗi lần khách kích hoạt license thành công
- **`heartbeat`** — mỗi ngày 1 lần khi khách mở app (license đang active)

Nhìn vào sheet **"Thiết bị"** là biết: bao nhiêu máy đã kích hoạt, tên khách, gói, ngày hết hạn, lần cuối họ còn mở app. Sheet **"Log"** ghi thô toàn bộ lịch sử.

## Setup 1 lần (~5 phút)

1. Vào https://sheets.google.com → tạo Sheet mới, đặt tên ví dụ `VICdigi Activations`.
2. Trên Sheet: menu **Tiện ích mở rộng → Apps Script**.
3. Xoá code mẫu, dán toàn bộ nội dung file [`tools/activation-sheet/Code.gs`](tools/activation-sheet/Code.gs) vào, bấm **Lưu** (Ctrl+S).
4. Bấm **Triển khai → Tùy chọn triển khai mới** (Deploy → New deployment):
   - Loại: **Ứng dụng web** (Web app)
   - Thực thi bằng: **Tôi** (Me)
   - Ai có quyền truy cập: **Bất kỳ ai** (Anyone) ← bắt buộc, để app trên máy khách gửi được
   - Bấm **Triển khai**, cấp quyền khi Google hỏi.
5. Copy **URL Web App** (dạng `https://script.google.com/macros/s/AKfy.../exec`).
6. Mở file `config/telemetry.json` trong project, dán URL vào:
   ```json
   { "endpoint": "https://script.google.com/macros/s/AKfy.../exec" }
   ```
7. Build lại app (`npm run build-win` hoặc `npm run release`). Từ bản build này trở đi, mọi máy cài sẽ tự báo về Sheet.

## Kiểm tra hoạt động

- Mở URL Web App bằng trình duyệt → thấy chữ `VICdigi activation tracker OK` là script sống.
- Kích hoạt license trên một máy → vài giây sau mở Sheet thấy dòng mới trong "Thiết bị" và "Log".

## Lưu ý

- Để `endpoint` rỗng = tắt hẳn theo dõi (app không gửi gì).
- Gửi tín hiệu là **fire-and-forget**: khách mất mạng hay Sheet lỗi thì app vẫn chạy bình thường, không chậm, không báo lỗi.
- Khi sửa file `Code.gs`, phải bấm **Triển khai → Quản lý triển khai → Chỉnh sửa → Phiên bản mới** thì thay đổi mới có hiệu lực (URL giữ nguyên).
- URL endpoint nằm trong app, người mổ app có thể thấy — nó chỉ ghi được dữ liệu vào Sheet, không đọc được gì, nhưng đừng dùng lại URL này cho việc khác.
- Cột "Lần cuối mở app" giúp phát hiện khách hết hạn mà vẫn xài (license expired thì app khoá, nhưng nhìn heartbeat dừng cũng biết khách rời đi).
