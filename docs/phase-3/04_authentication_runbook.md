# Authentication runbook Phase 3

Runbook này chỉ dành cho local development/local acceptance. Không dùng các lệnh dưới đây với production.

## 1. Cấu hình local

Các biến bắt buộc được đặt trong `.env` local và không commit:

```dotenv
DATABASE_URL=<local-runtime-postgresql-url>
MIGRATION_DATABASE_URL=<local-owner-postgresql-url>
BETTER_AUTH_URL=<local-http-origin>
BETTER_AUTH_SECRET=<local-secret-at-least-32-characters>
AUTH_TRUSTED_ORIGINS=<comma-separated-local-origins>
AUDIT_HMAC_SECRET=<local-secret-at-least-32-characters>
```

Bootstrap một lần cần thêm `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` và `BOOTSTRAP_ADMIN_NAME`. Không ghi giá trị thật vào tài liệu, log, shell script hoặc Git. Xóa bootstrap password khỏi `.env` sau khi hoàn tất.

## 2. Đồng bộ runtime role và permissions

Nếu PostgreSQL báo authentication `P1000`, đồng bộ local runtime role bằng cấu hình hiện tại, sau đó áp lại policy Phase 3:

```bash
pnpm db:bootstrap-runtime-role
pnpm exec tsx scripts/phase-3/grant-auth-runtime-permissions.ts
```

Không dùng migration owner làm `DATABASE_URL` của ứng dụng.

## 3. Seed units

```bash
pnpm auth:seed-units
```

Script dùng owner URL cho thao tác seed local, kiểm tra owner/runtime cùng database, giữ nguyên `approval_unit`, idempotent và không gán leader.

## 4. Bootstrap ADMIN

Chỉ chạy sau khi danh tính local được phê duyệt và database chưa có auth user:

```bash
pnpm auth:bootstrap-admin -- --confirm-local-bootstrap
```

Bootstrap tạo một credential user, active access profile và `ADMIN` role; không tạo lecturer mapping hoặc unit scope giả. Script từ chối email không hợp lệ, password ngắn hơn 12 ký tự, placeholder và database không local.

## 5. Login và logout

- Trang login: `/sign-in`.
- Thành công chuyển tới `/dashboard`.
- Sai email và sai password trả cùng thông báo generic.
- Disabled profile không tạo session.
- Logout xóa database session và ghi `AUTH_LOGOUT`.
- Không có `/sign-up` và không có public account creation API riêng.

Session timeout là 8 giờ; update age 1 giờ; fresh age 10 phút. Cookie cache bị tắt.

## 6. Quản trị account

`ADMIN` dùng `/admin/users` để tạo/vô hiệu hóa/kích hoạt user, quản lý role, lecturer mapping, unit scope và revoke session. Server Action luôn gọi lại `requireAdmin()`.

Không hỗ trợ hard delete, impersonation, password display, token display hoặc sửa legacy data.

## 7. Kiểm tra an toàn

```bash
git check-ignore -v .env
pnpm exec prisma migrate status
pnpm data:verify -- --file <approved-local-source-file> --sheet <approved-sheet>
```

Sau khi RLS được bật, verifier Phase 2 cần owner URL trong transaction read-only; không đổi runtime app sang owner để làm verifier PASS.
