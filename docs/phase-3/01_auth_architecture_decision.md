# ADR-P3-001 — Authentication, identity mapping và RBAC

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | ACCEPTED AND IMPLEMENTED |
| Ngày | 2026-07-16 |
| Phạm vi | Local development và local acceptance |
| Production activation | NOT AUTHORIZED |

## 1. Quyết định

UEB Core dùng Better Auth với Prisma adapter và PostgreSQL. Provider local là email/password. Public signup bị tắt hoàn toàn; account chỉ do `ADMIN` hoặc bootstrap script có kiểm soát tạo.

Production SSO, Google Workspace và VNU OAuth chưa được cấu hình. Auth `user_id` độc lập với email và `lecturer_uid` để có thể liên kết provider tương lai mà không thay khóa nghiệp vụ.

## 2. Session

- Session được lưu trong `auth_session`, thời hạn 8 giờ.
- `updateAge` là 1 giờ và `freshAge` là 10 phút.
- Cookie cache bị tắt; không dùng stateless/cookie-only session.
- Role, lecturer mapping và unit scope không được coi là thẩm quyền nếu chỉ xuất hiện trong cookie.
- Disable account thu hồi session; server kiểm tra trạng thái profile ở request tiếp theo.
- Change email và self-delete bị tắt; account linking chưa hỗ trợ.

## 3. Authorization boundary

- Proxy chỉ redirect lạc quan và không quyết định quyền dữ liệu.
- Server Components, Server Actions và route handlers kiểm tra session/role lại phía server.
- DAL lấy principal hiện hành từ database.
- DTO chỉ trả 20 trường nghiệp vụ và metadata hiển thị đã duyệt.
- PostgreSQL RLS là lớp bảo vệ thứ hai cho `ueb_core_data`.
- Runtime role không phải migration owner, không có `BYPASSRLS` và không có quyền ghi dữ liệu lõi.

## 4. Identity và business RBAC

Business roles không dùng Better Auth role:

- `LECTURER`: bắt buộc có `lecturer_uid`.
- `FACULTY_LEADER`: bắt buộc có ít nhất một active unit scope.
- `ADMIN`: không bắt buộc `lecturer_uid` hoặc unit scope.

Một user có thể có nhiều role. Grant đọc là hợp của các role đang active. Một `FACULTY_LEADER` có thể quản lý nhiều đơn vị. Một auth user chỉ có một primary email và tối đa một `lecturer_uid`; Phase 3 không hỗ trợ email alias.

Email được trim và lowercase chỉ để validate/đối chiếu. Dữ liệu nguồn không bị sửa.

## 5. Dữ liệu đơn vị

`organization_unit.source_value` phải khớp chính xác `ueb_core_data.approval_unit`. Seed chỉ insert source value mới, không đổi chuỗi, không gộp khác biệt hoa/thường và không tự gán lãnh đạo.

Cả sáu đơn vị hiện chưa có lãnh đạo/email được xác nhận và tiếp tục ở trạng thái unassigned. Trạng thái này không cấp leader scope.

## 6. Lý do

Thiết kế tách authentication, session management và authorization. Better Auth quản lý credential/session; business RBAC nằm trong schema riêng; DAL giới hạn truy vấn gần nguồn dữ liệu; RLS giảm rủi ro khi một entry point bỏ sót scope.

Thiết kế cũng giữ dữ liệu Phase 2 nguyên vẹn và không đưa workflow phê duyệt vào Phase 3.

## 7. Hệ quả

- Mọi query lõi của ứng dụng cần transaction-local RLS context.
- Production phải cung cấp runtime env khi container chạy; secret không được nhúng lúc build.
- SSO tương lai cần ADR/migration/provisioning review riêng.
- Phase 4 phải bổ sung policy ghi và workflow; không được suy diễn từ quyền đọc Phase 3.
