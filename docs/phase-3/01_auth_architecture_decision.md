# Quyết định kiến trúc xác thực và phân quyền Giai đoạn 3

| Thuộc tính | Giá trị |
| --- | --- |
| Mã quyết định | ADR-P3-001 |
| Trạng thái | ACCEPTED FOR PHASE 3 TECHNICAL IMPLEMENTATION |
| Ngày | 2026-07-16 |
| Phạm vi | Local development và local acceptance |
| Production activation | NOT AUTHORIZED |
| Formal business sign-off | Vẫn `OPEN`/`PENDING` theo hồ sơ Phase 0–2 |

## 1. Bối cảnh

UEB Core đang dùng Next.js 16.2.10 App Router, Prisma 7.8.0 với PostgreSQL adapter và PostgreSQL 18.4 local. Phase 2 đã tạo ba bảng append-only, import 2.497 dòng vào `ueb_core_data` và tách migration/owner credential khỏi runtime credential. Authentication, user account, session, application RBAC và RLS chưa tồn tại.

Tài liệu Next.js đi kèm phiên bản hiện tại phân biệt authentication, session management và authorization; khuyến nghị dùng auth library, thực hiện secure checks trong DAL gần nguồn dữ liệu, trả DTO tối thiểu và chỉ dùng Proxy cho optimistic checks/redirect. Thiết kế Phase 3 áp dụng ranh giới này và bổ sung PostgreSQL RLS để giảm rủi ro khi một entry point bỏ sót DAL scope.

## 2. Quyết định

### 2.1 Authentication provider

- Chọn Better Auth với Prisma adapter.
- Phiên bản Better Auth cụ thể chưa được cài trong bước quyết định này. Khi triển khai, phiên bản phải được đối chiếu tài liệu chính thức với Next.js 16.2.10 và Prisma 7.8.0, sau đó khóa trong `pnpm-lock.yaml`.
- Không nâng Next.js hoặc Prisma chỉ để dùng phiên bản mới hơn nếu chưa có căn cứ, compatibility review và yêu cầu riêng.
- Better Auth CLI có thể sinh schema tham chiếu; Prisma migration vẫn phải được tạo, review và áp dụng theo quy trình dự án. Không coi CLI output là migration đã duyệt và không dùng `prisma db push`.

### 2.2 Login và account provisioning

- Email/password là phương thức local và nền tảng ban đầu.
- Public sign-up bị tắt ở cả UI và server endpoint/handler.
- Tài khoản chỉ được tạo bởi `ADMIN` đã xác thực hoặc bootstrap script có kiểm soát.
- Bootstrap script không chứa credential hard-code, không ghi mật khẩu/token ra log và không tự chọn admin từ dữ liệu nguồn.
- Identity của bootstrap admin, người phê duyệt, kênh truyền credential và recovery procedure là hard gate riêng trước khi chạy script.
- Reset password qua email, MFA và impersonation không thuộc Phase 3.

### 2.3 SSO boundary

- Không kích hoạt production SSO, Google Workspace hoặc VNU OAuth trong Phase 3.
- Thiết kế giữ `user_id` độc lập với email và `lecturer_uid` để một provider SSO tương lai có thể liên kết vào user hiện có.
- Không tạo OAuth credential, callback production hoặc provider configuration giả trong Phase 3.

### 2.4 Session

- Dùng database sessions do Better Auth quản lý.
- Browser nhận cookie/session token theo cơ chế của thư viện; database record là nguồn xác minh session cho secure path.
- Cookie có thể được Proxy dùng cho redirect lạc quan nhưng không được coi là bằng chứng đủ để đọc dữ liệu nhạy cảm hoặc thực hiện admin action.
- DAL phải xác minh session database, user còn hiệu lực và quyền/mapping hiện tại.
- `ADMIN` có quyền thu hồi session. Disable account và thay đổi quyền nhạy cảm phải có policy thu hồi hoặc làm session mất quyền ngay ở request tiếp theo.

### 2.5 Identity model

- Auth `user_id` là định danh kỹ thuật bất biến; email không phải khóa nghiệp vụ.
- Mỗi user có đúng một email chính trong Phase 3. Email được trim và lowercase trước đối chiếu; email canonical phải unique.
- Không hỗ trợ email alias hoặc nhiều email đăng nhập.
- Một auth user ánh xạ tối đa một `lecturer_uid`.
- Một `lecturer_uid` không được ánh xạ tới nhiều user đang hiệu lực.
- `ADMIN` hoặc lãnh đạo không phải giảng viên có thể không có `lecturer_uid`.
- Không tự liên kết bằng fuzzy name, suy đoán email hoặc chỉ dựa vào một giá trị client cung cấp.

### 2.6 Role và scope model

Ba business role canonical của Phase 3 là:

- `LECTURER`;
- `FACULTY_LEADER`;
- `ADMIN`.

Một user có thể có nhiều role. Role grants được hợp theo nguyên tắc union nhưng mỗi grant vẫn phải thỏa scope tương ứng:

- `LECTURER` đọc dòng có `lecturer_uid` của chính user.
- `FACULTY_LEADER` đọc dòng có `approval_unit` thuộc tập đơn vị được gán.
- User có cả hai role được đọc hợp của hai tập dữ liệu.
- `ADMIN` đọc toàn bộ dữ liệu và quản trị account/role/unit/session.
- Không role nào ghi `ueb_core_data` trong Phase 3.

Phase 0 dùng tên `SYSTEM_ADMIN`; Phase 3 dùng canonical `ADMIN` theo quyết định hiện tại. Tài liệu Phase 0 không bị sửa và formal sign-off tiếp tục mở.

### 2.7 Organizational units

- Inventory ban đầu gồm đúng sáu unit trong `docs/phase-0/05_approval_units.csv`.
- Một `FACULTY_LEADER` có thể quản lý nhiều unit.
- Cả sáu unit chưa có lãnh đạo/email được giữ `UNASSIGNED`/`PENDING_ASSIGNMENT`.
- Không tạo leader giả, không suy đoán email leader và không cấp scope chỉ vì role `FACULTY_LEADER` tồn tại.
- Gán/thu hồi unit là admin action có audit và phải lấy unit từ inventory canonical.

### 2.8 Secure authorization boundary

Secure authorization gồm ba lớp:

1. **DAL**: xác minh database session, account state, role và scope; chỉ query sau khi authorize.
2. **DTO**: chỉ trả trường cần cho use case; không đưa raw Prisma/Auth object sang render/client boundary.
3. **PostgreSQL RLS**: từ chối hoặc giới hạn truy vấn nếu DAL/query bị gọi thiếu scope.

Server Components, Route Handlers và Server Actions là các entry point độc lập và phải gọi DAL. Layout/page/client checks chỉ phục vụ trải nghiệm giao diện.

### 2.9 Proxy boundary

- `proxy.ts` chỉ thực hiện redirect hoặc optimistic check bằng thông tin cookie tối thiểu.
- Proxy không truy vấn database, không tải role/unit mapping và không cấp quyền.
- Matcher/refactor không được làm secure authorization biến mất vì mọi entry point vẫn phải kiểm tra trong DAL/RLS.

### 2.10 PostgreSQL RLS context

- Runtime role không có `BYPASSRLS`, không sở hữu bảng và không dùng migration credential.
- DAL truyền `user_id` đã xác minh vào transaction-local database context trong cùng transaction chạy query dữ liệu.
- Không dùng connection/session-level `SET` trên pooled connection vì context có thể rò sang request khác.
- RLS policy resolve role, lecturer mapping và leader-unit assignment từ database dựa trên authenticated `user_id`.
- Client không được truyền role, `lecturer_uid` hoặc unit list làm authority.
- Thiếu context, user bị disable, mapping không hợp lệ hoặc role/scope không đủ phải deny.
- Policy `ADMIN` cho phép đọc toàn bộ nhưng không cấp mutation trên `ueb_core_data`.
- SQL cụ thể, table names, `set_config` contract, grants và RLS expressions chỉ được chốt trong migration review; ADR này không tạo schema.

## 3. Ma trận quyền chuẩn

| Capability | `LECTURER` | `FACULTY_LEADER` | `ADMIN` |
| --- | --- | --- | --- |
| Đọc dữ liệu cá nhân | Có, cần lecturer mapping | Chỉ khi đồng thời có `LECTURER` | Có |
| Đọc dữ liệu theo unit | Không | Có, cần assigned unit | Có |
| Đọc toàn bộ core data | Không | Không | Có |
| Tạo/sửa/xóa core data | Không | Không | Không |
| Tạo account | Không | Không | Có |
| Disable account | Không | Không | Có |
| Gán/thu hồi role | Không | Không | Có |
| Gán/thu hồi leader unit | Không | Không | Có |
| Thu hồi session | Không | Không | Có |
| Approve/reject | Không | Không | Không trong Phase 3 |

Policy máy đọc được tương ứng nằm tại `config/phase-3/rbac-policy.ts`. Policy đó là contract thiết kế và test input, không tự thay thế secure DAL hoặc RLS.

## 4. Dữ liệu lõi và migration boundary

- Không sửa 20 cột nghiệp vụ, cột kỹ thuật hoặc 2.497 dòng hiện có của `ueb_core_data` trong Phase 3.
- Không sửa hai migration Phase 2 đã apply.
- Auth/RBAC/session/audit tables và RLS/grants phải nằm trong migration Phase 3 mới sau review.
- Nếu RLS/grant cần tham chiếu `ueb_core_data`, thay đổi chỉ bổ sung policy/quyền/index cần thiết; mọi tác động phải được review và clean replay.
- Runtime read-only invariant cho Phase 3 phải được chứng minh bằng quyền database, RLS và negative tests; quyền `INSERT` kế thừa từ Phase 2 phải được đánh giá rõ trong migration review, không được bỏ qua.
- Sau migration, `data:verify` phải vẫn `PASS`, row count/checksum không đổi và append-only triggers còn nguyên.

## 5. Audit boundary

Audit Phase 3 phải ghi tối thiểu:

- login thành công/thất bại ở mức không lộ credential;
- logout và session revocation;
- account creation/disable;
- role assignment/revocation;
- lecturer mapping assignment/revocation;
- leader-unit assignment/revocation;
- actor, target, action, kết quả, timestamp và before/after metadata đã redaction.

Không lưu password, password hash, raw session token, secret, connection string hoặc dữ liệu Excel vào audit. Audit output cục bộ không được commit.

## 6. Hard gates

Thiết kế chỉ được triển khai theo từng checkpoint sau khi các gate tương ứng đạt:

- identity source audit;
- email canonical uniqueness audit;
- lecturer_uid/email mapping review;
- organizational unit inventory confirmation;
- bootstrap admin identity/approval/recovery decision;
- database migration review;
- negative authorization tests;
- clean migration replay.

Các quyết định về công nghệ và cardinality trong ADR đã chốt cho technical planning, nhưng các gate dữ liệu/bằng chứng trên chưa tự động `PASS`.

## 7. Hệ quả

### Tích cực

- Dùng thư viện giảm phạm vi tự triển khai credential và session security.
- Database sessions hỗ trợ revoke và kiểm tra trạng thái hiện tại.
- Multi-role và many-unit mapping đáp ứng trường hợp một người có nhiều trách nhiệm.
- DAL + DTO + RLS tạo defense in depth và giảm rủi ro IDOR/BOLA.
- Tách `user_id`, email và `lecturer_uid` giữ đường chuyển sang SSO trong tương lai.

### Chi phí và rủi ro cần quản lý

- Database session và RLS làm tăng truy vấn/context setup; cần index và test hiệu năng.
- Prisma connection pooling đòi hỏi transaction-local context đúng tuyệt đối.
- Better Auth schema sinh tự động vẫn cần reconcile với naming, Prisma 7 adapter và migration policy hiện có.
- `ADMIN` đọc toàn bộ dữ liệu là quyền rộng, cần audit, least privilege và negative tests chặt.
- Sáu unit unassigned khiến role lãnh đạo chưa có scope cho tới khi có dữ liệu được xác nhận.

## 8. Phương án không chọn

- Tự triển khai toàn bộ password/session: không chọn vì tăng rủi ro và trái khuyến nghị dùng auth library.
- Cookie-only authorization: không chọn cho secure operations vì role/mapping có thể thay đổi hoặc session bị revoke.
- Proxy làm lớp authorization chính: không chọn vì Proxy chỉ phù hợp kiểm tra lạc quan và có thể bị bỏ qua bởi entry point/refactor.
- Một role duy nhất trên user: không chọn vì một người có thể đồng thời là giảng viên/lãnh đạo/admin.
- Một leader chỉ có một unit: không chọn vì Phase 3 cho phép quản lý nhiều đơn vị.
- Email alias trong Phase 3: không chọn để giữ uniqueness và mapping đơn giản, kiểm chứng được.
- Tạo leader/email giả cho unit thiếu: không chọn vì làm sai identity và quyền truy cập.

## 9. Ngoài phạm vi và điều kiện còn mở

Public sign-up, reset password qua email, MFA, production SSO, workflow submit/approve/reject, business versioning và production deployment đều ngoài Phase 3.

R-05, R-12, R-35, R-36, R-39, R-40 và formal sign-off Phase 2 tiếp tục `OPEN`/`PENDING`. ADR kỹ thuật này không thay thế chữ ký nghiệp vụ, hạ tầng hoặc production authorization.
