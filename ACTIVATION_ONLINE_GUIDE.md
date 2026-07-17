# Kích hoạt online — Hướng dẫn

Cho phép phát license **từ xa**: mày không cần ngồi máy khách hay biết trước mã máy. Mày tạo sẵn các "mã kích hoạt" trong Google Sheet, gửi mã cho đối tác; họ nhập mã vào app → app tự nhận bản quyền qua mạng.

Dùng chung hạ tầng Google Apps Script đã dựng (xem [TRACKING_GUIDE.md](TRACKING_GUIDE.md)). Chỉ cần thêm 2 thứ: **nạp private key vào script** và **cập nhật code Apps Script**.

## Cách hoạt động (tóm tắt)

1. App gửi `{ mã kích hoạt + mã máy }` lên Apps Script của mày.
2. Script tra mã trong sheet **"Cấp phép"** → nếu hợp lệ & chưa dùng, nó **tự ký license** khóa đúng máy đó bằng private key, trả token về.
3. App verify token bằng public key có sẵn (như key thủ công) rồi kích hoạt. Mã bị đánh dấu "đã dùng" + ghi mã máy → không dùng lại cho máy khác được.

## Setup 1 lần

### A. Nạp private key vào script (BƯỚC BẢO MẬT QUAN TRỌNG)

Đây là **cùng private key** mày dùng để phát key thủ công (cặp với `config/license-public.pem`).

1. Mở tab Apps Script (gắn với Google Sheet theo dõi).
2. Bên trái: **⚙️ Cài đặt dự án** (Project Settings) → kéo xuống **Thuộc tính tập lệnh** (Script Properties) → **Thêm thuộc tính**:
   - Tên: `PRIVATE_KEY`
   - Giá trị: dán **toàn bộ** nội dung file private key (cả dòng `-----BEGIN PRIVATE KEY-----` ... `-----END PRIVATE KEY-----`)
   - **Lưu**
3. Private key này chỉ tài khoản Google của mày xem được, không hiện trong code, không hiện trong Sheet.

> ⚠️ Vì private key giờ nằm trên Google, **bắt buộc bật xác minh 2 bước** cho Gmail (dung.mdmedia@gmail.com). Ai chiếm được Gmail = phát được license.

### B. Cập nhật code Apps Script

1. Mở [tools/activation-sheet/Code.gs](tools/activation-sheet/Code.gs) bằng Notepad → **Ctrl+A → Ctrl+C**.
2. Sang tab Apps Script → bấm vào khung code → **Ctrl+A → Delete** (xóa sạch) → **Ctrl+V** (dán) → **Ctrl+S** (lưu).
3. **Triển khai → Quản lý các tùy chọn triển khai → ✏️ → Phiên bản: Phiên bản mới → Triển khai.** (URL giữ nguyên, app không phải sửa gì.)

### C. Tạo sheet "Cấp phép"

Lần đầu có ai kích hoạt, script tự tạo sheet **"Cấp phép"** với các cột sẵn. Hoặc mày tự tạo tab tên `Cấp phép` với hàng tiêu đề:

| Mã kích hoạt | Số ngày (hoặc lifetime) | Tên khách | Email | Trạng thái | Machine ID đã dùng | Ngày cấp | Ghi chú |
|---|---|---|---|---|---|---|---|

## Cách phát license cho một khách (làm mọi lúc, cả trên điện thoại)

1. Mở Google Sheet → tab **"Cấp phép"** → thêm 1 dòng:
   - **Mã kích hoạt**: tự đặt, nên khó đoán, ví dụ `KH-BINH-7F3K`
   - **Số ngày**: `365` (hoặc `30`, `lifetime` cho vĩnh viễn)
   - **Tên khách / Email**: tùy chọn, sẽ nhúng vào license
   - 4 cột còn lại để trống — script tự điền khi khách kích hoạt
2. Gửi mã `KH-BINH-7F3K` cho khách.
3. Khách mở app → **Bản quyền → ô "Kích hoạt online"** → nhập mã → bấm **Kích hoạt**. Xong.

## Quản lý

- **Xem ai đã kích hoạt**: cột "Trạng thái" = "đã dùng", cột "Machine ID đã dùng" cho biết máy nào, tab "Thiết bị" cho biết lần cuối họ mở app.
- **Thu hồi / chặn mã**: đổi cột "Trạng thái" của dòng đó thành `khóa`. Mã đó sẽ không kích hoạt được nữa (máy đã kích hoạt rồi thì vẫn chạy tới khi hết hạn license).
- **Cho khách đổi máy**: xóa nội dung cột "Machine ID đã dùng" của mã đó → mã dùng lại được cho máy mới.
- **Kích hoạt thủ công vẫn còn**: nếu mạng lỗi, mày vẫn phát key tay bằng tool license-admin như cũ, dán vào mục "dán khóa thủ công" trong app.

## Kiểm tra

Sau khi setup, tự thử: tạo 1 mã test số ngày `1`, mở app nhập mã đó → app phải kích hoạt, dòng mã chuyển "đã dùng", tab "Thiết bị" hiện máy mày.
