# UEB Core

## Mục tiêu dự án

UEB Core là nền tảng quản lý dữ liệu giảng viên của Trường Đại học Kinh tế, Đại học Quốc gia Hà Nội (UEB). Phase 3 cung cấp Better Auth, RBAC và PostgreSQL RLS. Phase 4 bổ sung workflow bất biến theo từng dòng cho giảng viên gửi, lãnh đạo từ chối/phê duyệt và tạo phiên bản core mới theo mô hình append-only.

## Yêu cầu môi trường

- Node.js 24
- pnpm 11 (qua Corepack)

## Cài đặt dependency

```bash
corepack enable pnpm
pnpm install
```

## Chạy môi trường phát triển

```bash
pnpm dev
```

Ứng dụng chạy tại [http://localhost:3000](http://localhost:3000).

## Kiểm tra chất lượng

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:phase4
pnpm build
```

`pnpm test:phase4` chạy tuần tự unit/static, integration/security trên database cô lập và bốn luồng E2E Phase 4. Các database test được guard theo tên và cleanup sau khi chạy; không trỏ các lệnh test vào local acceptance hoặc production.

## Triển khai database và quyền runtime

Sau khi backup và xác nhận đúng môi trường, thứ tự vận hành là:

```bash
pnpm exec prisma migrate deploy
pnpm phase4:grant-runtime-permissions -- \
  --confirm-runtime-grants \
  --expected-database=<database>
```

Script quyền dùng `MIGRATION_DATABASE_URL`, lấy target role từ `APP_DATABASE_USER` và phải chạy sau migration deploy ở từng môi trường. Không cấp quyền bằng SQL thủ công. `DATABASE_URL` của ứng dụng phải là runtime role non-owner, non-superuser, `NOBYPASSRLS`; tuyệt đối không dùng owner credential cho application runtime.

Verifier toàn bảng như `pnpm data:verify` phải chạy read-only bằng owner connection vì runtime RLS default-deny theo request context. Việc này không cho phép đổi ứng dụng sang owner role. Xem runbook đầy đủ tại [docs/phase-4/06_database_and_migrations.md](docs/phase-4/06_database_and_migrations.md).

Phase 4 chỉ được nghiệm thu kỹ thuật local. Production deployment, production SSO và real-user provisioning chưa được thực hiện hoặc cho phép.

## An toàn dữ liệu

Không commit file `.env`, file Excel hoặc output kiểm kê/audit vào repository. Dữ liệu đầu vào cá nhân và kết quả trong `infra/audit` phải luôn được giữ ngoài lịch sử Git, ngoại trừ các file giữ chỗ đã được phê duyệt.

Chỉ lưu placeholder trong `.env.example`; không ghi credential hoặc secret thực vào README, source code, Compose hay tài liệu.
