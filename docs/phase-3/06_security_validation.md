# Security validation Phase 3

## 1. Audit taxonomy

Các event được hỗ trợ:

- `AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILED`, `AUTH_LOGOUT`;
- `USER_CREATED`, `USER_ENABLED`, `USER_DISABLED`;
- `PASSWORD_SET_BY_ADMIN`;
- `ROLE_GRANTED`, `ROLE_REVOKED`;
- `UNIT_SCOPE_GRANTED`, `UNIT_SCOPE_REVOKED`;
- `LECTURER_MAPPING_ASSIGNED`, `LECTURER_MAPPING_REMOVED`;
- `SESSION_REVOKED`.

Login failure chỉ lưu email HMAC bằng `AUDIT_HMAC_SECRET`. Audit không lưu password, session token, cookie, OAuth access/refresh token hoặc secret. Metadata được shape theo allowlist.

Audit insert thuộc cùng transaction với thay đổi quyền; audit failure làm transaction nghiệp vụ thất bại. Database trigger chặn audit `UPDATE`, `DELETE` và `TRUNCATE`, kể cả owner.

## 2. Unit tests

Kết quả cuối: 136 PASS, 13 integration tests được skip trong lệnh unit mặc định và chạy riêng trên rehearsal database.

Coverage bắt buộc gồm signup-off, password length, email normalization, ambiguous mapping, role prerequisites, multiple roles/units, revoked role, disabled session, audit metadata và DTO 20 cột.

## 3. Isolated integration tests

Kết quả: 13/13 PASS trên `ueb_core_phase3_rehearsal`.

- Clean migration replay và bootstrap idempotent.
- Valid login tạo database session; wrong password không tạo session.
- Logout và disable/revoke session có hiệu lực.
- RLS không context trả 0 dòng.
- Lecturer A không đọc Lecturer B.
- Leader một/nhiều unit chỉ thấy union được giao; leader không scope thấy 0.
- Admin thấy đúng 2497 dòng.
- Revoked role mất quyền ngay.
- Runtime `UPDATE`/`DELETE` core bị từ chối.
- Audit `UPDATE`/`DELETE`/`TRUNCATE` bị từ chối.

## 4. E2E và IDOR

Kết quả: 6/6 PASS trên `ueb_core_phase3_e2e` với fixture email giả từ environment.

- Unauthenticated redirect và không có sign-up page.
- Lecturer login, dashboard và đủ 20 column headers.
- Lecturer/leader không mở admin route.
- Leader chỉ thấy assigned unit; multi-unit leader thấy đúng union.
- Admin tạo user, gán/thu hồi role/unit, revoke session và disable account.
- Disabled account không đăng nhập.
- Tamper `lecturer_uid`, `unit_id`, `user_id`, page/filter trả 403/404 hoặc không tiết lộ dữ liệu.

Sau E2E, read-only audit check xác nhận role grant/revoke, unit grant, session revoke và user disable đều có event thành công.

## 5. Infrastructure/security checks

- `pnpm install --frozen-lockfile`, format, lint, typecheck, test, E2E và build: PASS.
- Prisma format/validate/generate/status: PASS.
- Phase 2 data verify: PASS, 0 anomaly.
- Docker Compose config và image `ueb-core:phase-3` build: PASS.
- Docker build không cần database credential; protected/sign-in routes được render request-time.
- OpenSSL có trong builder/runner cho Prisma.
- `.env`, audit output và Playwright failure artifacts bị Git ignore.
- Tất cả database URL được kiểm tra là local; không có production connection.

## 6. Acceptance observation

Một lần E2E ban đầu dùng nhầm config mặc định đã tạo ba `AUTH_LOGIN_FAILED` HMAC-only trên local acceptance. Không có email rõ, secret hoặc thay đổi core data. Vì audit append-only, các event được giữ nguyên. `pnpm test:e2e` đã được sửa để luôn reset đúng hai database test có guard tên và chạy config Phase 3.
