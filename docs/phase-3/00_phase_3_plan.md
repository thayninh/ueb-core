# Kế hoạch Giai đoạn 3 — Authentication, Identity Mapping và RBAC Foundation

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | PLANNED — IMPLEMENTATION HARD GATES OPEN |
| Nhánh thực hiện | `feat/phase-3-auth-rbac` |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-16 |
| Phạm vi môi trường | Local development và local acceptance; không kết nối production |
| Quyết định kiến trúc | `docs/phase-3/01_auth_architecture_decision.md` |
| Policy RBAC | `config/phase-3/rbac-policy.ts` |

## 1. Mục tiêu và ranh giới

Giai đoạn 3 xây dựng nền tảng xác thực, ánh xạ danh tính và phân quyền cho dữ liệu đã được import trong Giai đoạn 2. Authentication, session management và authorization là ba lớp riêng: Better Auth xử lý đăng nhập/session, Data Access Layer (DAL) xác thực quyền gần nguồn dữ liệu, DTO giới hạn dữ liệu trả ra và PostgreSQL Row-Level Security (RLS) tạo lớp bảo vệ cuối tại database.

Giai đoạn này chỉ đọc dữ liệu lõi `ueb_core_data`. Không thêm, sửa, xóa hoặc tạo phiên bản nghiệp vụ. Workflow submit/phê duyệt/từ chối được chuyển sang Giai đoạn 4.

Nguyên tắc bắt buộc:

- Dùng Better Auth với Prisma adapter; phiên bản cụ thể chỉ được chọn khi triển khai và phải được khóa trong `pnpm-lock.yaml`.
- Không nâng cấp Next.js hoặc Prisma ngoài thay đổi tối thiểu có căn cứ và review riêng.
- Email/password chỉ là cơ chế local và nền tảng ban đầu; production SSO chưa kích hoạt.
- Public sign-up bị tắt hoàn toàn; tài khoản chỉ do `ADMIN` hoặc bootstrap script có kiểm soát tạo.
- Session được lưu trong database. Cookie chỉ mang thông tin cần thiết để định vị/xác minh session và không phải nguồn thẩm quyền cho authorization nhạy cảm.
- `proxy.ts` chỉ làm redirect hoặc kiểm tra lạc quan; không truy vấn database và không thay thế secure authorization.
- DAL phải chạy server-only, kiểm tra session/role/scope từ database và trả DTO tối thiểu.
- PostgreSQL RLS mặc định từ chối khi thiếu request context hợp lệ và giới hạn truy vấn theo mapping trong database.
- Không tin `user_id`, role, `lecturer_uid` hoặc `approval_unit` do client gửi lên.
- Không sửa schema hoặc dữ liệu của `ueb_core_data` trong bước lập kế hoạch này.
- Không commit secret, `.env`, file Excel hoặc audit output.
- Các điều kiện Phase 0 và formal sign-off Phase 2 tiếp tục `OPEN`.

## 2. Quyết định kiến trúc đã chốt

| Hạng mục | Quyết định Phase 3 |
| --- | --- |
| Thư viện xác thực | Better Auth với Prisma adapter |
| Phương thức local | Email và mật khẩu |
| Public sign-up | Tắt hoàn toàn |
| Khởi tạo tài khoản | `ADMIN` hoặc bootstrap script có kiểm soát |
| Session | Database session |
| Production SSO | Chưa kích hoạt; Google Workspace/VNU OAuth để giai đoạn sau |
| Vai trò | `LECTURER`, `FACULTY_LEADER`, `ADMIN` |
| Nhiều vai trò | Một user có thể có nhiều role |
| Phạm vi lãnh đạo | Một `FACULTY_LEADER` có thể quản lý nhiều đơn vị |
| Mapping giảng viên | Một auth user ánh xạ tối đa một `lecturer_uid` |
| Admin | Có thể không có `lecturer_uid` |
| Email đăng nhập | Một email chính; trim và lowercase trước đối chiếu |
| Email alias | Không hỗ trợ trong Phase 3 |
| Dữ liệu lõi | Chỉ đọc |
| Bảo vệ dữ liệu | DAL + DTO + PostgreSQL RLS |
| Proxy | Chỉ redirect/kiểm tra lạc quan |
| Workflow | Ngoài phạm vi, chuyển Phase 4 |

Phase 3 dùng tên canonical `ADMIN`. Tên `SYSTEM_ADMIN` trong tài liệu Phase 0 không bị sửa; khác biệt tên gọi được ghi nhận như một quyết định kỹ thuật Phase 3 trong khi formal sign-off cũ tiếp tục `OPEN`.

## 3. Phạm vi triển khai dự kiến

### 3.1 Better Auth và đăng nhập local

- Cài Better Auth ở checkpoint triển khai sau khi review phiên bản tương thích với Next.js 16.2.10 và Prisma 7.8.0.
- Dùng Prisma adapter và database sessions.
- Bật email/password cho local; không cấu hình OAuth provider production.
- Tắt endpoint/flow public sign-up. UI không hiển thị sign-up và server phải từ chối gọi trực tiếp.
- Không tự viết password hashing, session token lifecycle hoặc credential verification thay cho thư viện.
- Chuẩn hóa email bằng trim và lowercase trước đối chiếu; database phải bảo vệ uniqueness của email canonical.
- Không hỗ trợ alias hoặc nhiều email trên một user trong Phase 3.
- Reset password qua email và MFA nằm ngoài phạm vi.

### 3.2 Tài khoản và ánh xạ danh tính

- `user_id` của auth là định danh kỹ thuật; không dùng email làm khóa bất biến.
- Một auth user có tối đa một `lecturer_uid`; `ADMIN` và lãnh đạo không phải giảng viên có thể để mapping này trống.
- Một `lecturer_uid` không được liên kết với nhiều tài khoản hoạt động.
- Không tự mapping chỉ vì email/tên/mã cán bộ có vẻ giống nhau. Identity source audit và mapping report phải đạt trước khi bootstrap hàng loạt.
- Tài khoản có thể giữ nhiều role trên cùng một `user_id`.
- Việc tạo/vô hiệu hóa tài khoản, gán/thu hồi role, mapping giảng viên và mapping đơn vị phải có audit.
- Không xóa vật lý tài khoản đã có lịch sử; trạng thái tài khoản và hành vi session phải được chốt trong thiết kế schema.

### 3.3 Đơn vị và mapping lãnh đạo

- Sáu đơn vị trong `docs/phase-0/05_approval_units.csv` là inventory đầu vào; không tự thêm hoặc đổi tên đơn vị.
- Cả sáu đơn vị tiếp tục ở trạng thái `UNASSIGNED`/`PENDING_ASSIGNMENT` cho tới khi có lãnh đạo và email được xác nhận.
- Không tạo lãnh đạo giả và không suy đoán email lãnh đạo.
- Một `FACULTY_LEADER` có thể được gán nhiều đơn vị; một đơn vị chưa có mapping hợp lệ không tạo ra quyền đọc cho bất kỳ lãnh đạo nào.
- Unit scope được đọc từ database trên secure authorization path, không lấy từ cookie hoặc payload.

### 3.4 Session management

- Session là record trong database và có thể bị thu hồi từng session hoặc toàn bộ session của user.
- Thay đổi trạng thái tài khoản hoặc quyền nhạy cảm phải có quy tắc thu hồi/kiểm tra lại session.
- Cookie phải dùng thuộc tính an toàn phù hợp (`HttpOnly`, `Secure` ở môi trường HTTPS, `SameSite`, expiry và path).
- Không đưa role, unit scope hoặc `lecturer_uid` trong cookie thành nguồn thẩm quyền cho thao tác nhạy cảm.
- Secure check phải đọc session đang hiệu lực và trạng thái/mapping hiện tại từ database.
- Session secret/token/password không được ghi vào Git, log hoặc audit payload.

### 3.5 DAL, DTO và route protection

- DAL nằm trong module server-only và là lối vào chuẩn cho truy vấn dữ liệu nhạy cảm.
- DAL xác minh database session, trạng thái user, role và scope trước khi truy vấn.
- DTO chỉ trả đúng trường giao diện cần; không trả raw auth record, password hash, session token hoặc toàn bộ Prisma model.
- Server Components, Route Handlers và Server Actions phải gọi secure DAL tại từng entry point.
- Page/layout/client-side hiding không được coi là authorization.
- `proxy.ts` chỉ đọc dấu hiệu session tối thiểu để redirect lạc quan; không gọi database hoặc cấp quyền.
- Request thiếu session, role, mapping hoặc scope hợp lệ bị từ chối mặc định.

### 3.6 PostgreSQL RLS

- RLS bảo vệ đường đọc `ueb_core_data` ngoài lớp DAL; application runtime role không được có `BYPASSRLS` hoặc ownership.
- DAL thiết lập request context bằng giá trị `user_id` đã xác minh trong cùng transaction chứa truy vấn dữ liệu.
- Request context phải transaction-local; không dùng session variable tồn tại ngoài transaction trên pooled connection.
- RLS lấy role, `lecturer_uid` và unit assignments từ bảng mapping đã được review, không tin danh sách scope do client truyền.
- Thiếu hoặc sai request context phải trả về không dòng/deny, không fallback sang truy cập rộng.
- `ADMIN` được đọc toàn bộ qua policy rõ ràng nhưng vẫn không được `UPDATE`, `DELETE` hoặc ghi dữ liệu legacy.
- Mọi thay đổi grant, RLS policy hoặc quyền runtime phải nằm trong migration được review; không dùng `db push`.
- Clean migration replay và negative SQL tests phải chứng minh DAL bị bỏ qua cũng không làm rò rỉ dữ liệu.

## 4. Ma trận quyền Phase 3

| Vai trò | Đọc `ueb_core_data` | Ghi dữ liệu lõi | Quản trị tài khoản/quyền |
| --- | --- | --- | --- |
| `LECTURER` | Chỉ dòng có `lecturer_uid` bằng mapping của chính user | Không | Không |
| `FACULTY_LEADER` | Chỉ dòng có `approval_unit` trong tập đơn vị được giao | Không | Không |
| `ADMIN` | Toàn bộ dữ liệu | Không | Tạo/vô hiệu hóa account; gán/thu hồi role và đơn vị; thu hồi session |

Quy tắc hợp thành role:

- Grant đọc là hợp của các role đang có hiệu lực.
- User có cả `LECTURER` và `FACULTY_LEADER` được đọc dữ liệu cá nhân và dữ liệu thuộc các đơn vị được giao.
- `FACULTY_LEADER` không có unit assignment chỉ còn các grant từ role khác; riêng role lãnh đạo không cấp quyền đọc nào.
- Không role nào được tạo, sửa hoặc xóa dữ liệu lõi trong Phase 3.
- Mọi action không xuất hiện trong policy được từ chối mặc định.

## 5. Hard gates trước triển khai và nghiệm thu

| Gate | Điều kiện đạt | Trạng thái hiện tại |
| --- | --- | --- |
| HG3-01 Identity source audit | Nguồn identity, owner, checksum/đối chiếu và quy tắc xử lý sai khác được review | OPEN |
| HG3-02 Email uniqueness | Audit email canonical không trùng; constraint/index strategy được review | OPEN |
| HG3-03 Lecturer mapping | Mapping email–`lecturer_uid` đầy đủ, xung đột được xử lý có bằng chứng | OPEN |
| HG3-04 Unit inventory | Sáu unit code/canonical name được xác nhận; unassigned được giữ an toàn | OPEN |
| HG3-05 Bootstrap admin | Danh tính admin đầu tiên, người phê duyệt, kênh credential và recovery được chốt | OPEN |
| HG3-06 Migration review | Schema Better Auth + RBAC + session + audit + RLS được review trước apply | OPEN |
| HG3-07 Negative authorization | Test chéo user/role/unit, cookie giả, session revoked và bypass DAL đều bị từ chối | OPEN |
| HG3-08 Clean migration replay | Toàn bộ migration replay từ database sạch, Prisma status/diff đạt | OPEN |

Không cài Better Auth, sinh schema hoặc tạo migration trong bước lập kế hoạch hiện tại. Checkpoint tiếp theo chỉ được bắt đầu khi artifact đầu vào tương ứng đã được review; không đánh dấu gate `PASS` chỉ dựa trên tài liệu kế hoạch.

## 6. Checkpoint thực hiện

### CP3-0 — Kế hoạch và ADR

- [x] Đọc hồ sơ Phase 0–2, schema, migrations và database access hiện tại.
- [x] Ghi quyết định Better Auth, session database, role model và security boundary.
- [x] Ghi policy RBAC máy đọc được.
- [x] Không cài dependency, tạo schema/migration hoặc sửa bảng nghiệp vụ.
- [x] Prisma migration status local up to date trước khi sửa.

### CP3-1 — Audit identity và inventory

- [ ] Hoàn thành HG3-01 đến HG3-05.
- [ ] Không đưa dữ liệu cá nhân hoặc audit output vào Git.
- [ ] Không tự tạo account/mapping để làm audit đạt.

### CP3-2 — Dependency và schema review

- [ ] Chọn và khóa phiên bản Better Auth tương thích trong lockfile.
- [ ] Sinh schema tham chiếu bằng Better Auth CLI nếu cần, sau đó review thủ công.
- [ ] Thiết kế auth user/account/session, multi-role, lecturer mapping, leader-unit mapping và audit.
- [ ] Thiết kế RLS và quyền runtime không làm thay đổi cột/dữ liệu nghiệp vụ của `ueb_core_data`.
- [ ] HG3-06 đạt trước khi apply migration.

### CP3-3 — Migration local

- [ ] Tạo migration Prisma có tên rõ ràng; không sửa hai migration Phase 2.
- [ ] Review SQL, grants, RLS, indexes, constraints và rollback/recovery.
- [ ] Apply chỉ trên PostgreSQL local.
- [ ] Clean migration replay và schema diff đạt HG3-08.
- [ ] Dữ liệu 2.497 dòng và checksum Phase 2 không đổi.

### CP3-4 — Authentication và session

- [ ] Public sign-up bị từ chối ở server.
- [ ] Account bootstrap/admin-only creation có kiểm soát.
- [ ] Login/logout và database session hoạt động.
- [ ] Disable user và revoke session có hiệu lực.
- [ ] Không kích hoạt SSO production, reset email hoặc MFA.

### CP3-5 — DAL, DTO và RLS

- [ ] Secure DAL kiểm tra database session và policy ở từng entry point.
- [ ] DTO không làm lộ trường nội bộ.
- [ ] RLS giới hạn đúng lecturer/unit/admin và deny khi thiếu context.
- [ ] Proxy chỉ redirect lạc quan.
- [ ] Core data vẫn read-only.

### CP3-6 — Negative tests và nghiệm thu

- [ ] HG3-07 đạt cho cả DAL và SQL/RLS.
- [ ] Lint, typecheck, test và build đạt.
- [ ] `data:verify` vẫn `PASS` với 2.497 dòng và anomalies bằng 0.
- [ ] Không có `.env`, secret, Excel hoặc audit output bị track.
- [ ] Không kết nối hoặc thay đổi production.
- [ ] Phase 0 conditions và formal sign-off Phase 2 vẫn được ghi `OPEN`.

## 7. Ngoài phạm vi

- Public sign-up.
- Reset password qua email.
- MFA.
- Production SSO/Google Workspace/VNU OAuth.
- Nhiều email alias.
- Giảng viên thêm, sửa, xác nhận hoặc xóa dòng.
- Submit.
- Lãnh đạo approve/reject.
- Versioning nghiệp vụ mới.
- Production deployment, migration hoặc account bootstrap.
- Thay đổi Caddy, network hoặc backup production.

## 8. Điều kiện kế thừa tiếp tục `OPEN`

- R-05: quyết định nghiệp vụ chưa có formal sign-off đầy đủ.
- R-12: cả sáu đơn vị chưa có lãnh đạo/email được xác nhận; Phase 3 giữ `UNASSIGNED`, không đóng rủi ro này.
- R-35, R-36, R-39 và R-40: restore, off-host backup, backup UEB Core và chữ ký hạ tầng chưa hoàn tất.
- Formal business sign-off của Phase 2 tiếp tục `PENDING` dù technical acceptance đã `PASS`.
- Các mục Draft khác trong Phase 0 không bị tài liệu Phase 3 tự động phê duyệt hoặc thay đổi.

## 9. Thứ tự thực hiện dự kiến

1. Review kế hoạch, ADR và RBAC policy.
2. Hoàn thành identity source audit, email uniqueness, lecturer mapping, unit inventory và bootstrap admin decision.
3. Chọn/khóa Better Auth version mà không nâng Next.js hoặc Prisma không cần thiết.
4. Sinh schema tham chiếu, thiết kế model/RLS và review migration SQL.
5. Apply migration trên local, clean replay và xác nhận dữ liệu Phase 2 không đổi.
6. Triển khai Better Auth email/password, database session và đóng public sign-up.
7. Triển khai DAL, DTO, optimistic proxy và transaction-local RLS context.
8. Triển khai account/role/unit/session administration cùng audit.
9. Chạy negative authorization tests, quality gates và `data:verify`.
10. Lập nghiệm thu Phase 3; workflow và production vẫn ngoài phạm vi.
