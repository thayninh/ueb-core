# Kế hoạch Giai đoạn 1 — Nền tảng dự án

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | COMPLETED WITH OPEN PHASE-0 CONDITIONS |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-15 |
| Ngày nghiệm thu kỹ thuật | 2026-07-15 |

## Mục tiêu

- Khởi tạo nền tảng dự án Next.js.
- Tạo môi trường phát triển local.
- Tạo PostgreSQL local riêng.
- Thiết lập công cụ chất lượng mã nguồn.
- Tạo health endpoint.
- Tạo skeleton xác thực và phân quyền.
- Chưa triển khai nghiệp vụ import hoặc phê duyệt.

## Phạm vi dự kiến

1. Khởi tạo Next.js App Router, TypeScript.
2. Chọn package manager và commit lockfile.
3. Cấu hình ESLint và formatter.
4. Thiết lập test framework.
5. Tạo Docker Compose local.
6. Tạo PostgreSQL local.
7. Tạo `.env.example`, không chứa secret thật.
8. Tạo health endpoint.
9. Tạo cấu trúc module:
   - `auth`
   - `users`
   - `lecturers`
   - `approval-units`
   - `core-data`
   - `workflow`
   - `audit`
10. Tạo CI local hoặc script kiểm tra:
    - lint
    - typecheck
    - unit test
    - build

## Không thuộc phạm vi

- Import Excel production.
- Migration schema nghiệp vụ hoàn chỉnh.
- Kết nối Caddy production.
- Deploy production.
- Tạo tài khoản thật.
- Gửi email thật.
- SSO VNU.
- Backup production.

## Điều kiện nghiệm thu Giai đoạn 1

- [x] Next.js project foundation.
- [x] Node.js 24 và pnpm 11.
- [x] PostgreSQL local bằng Docker Compose.
- [x] Health và readiness endpoints.
- [x] Unit test và Chromium E2E.
- [x] Docker image tương thích triển khai production.
- [x] Nghiệm thu native app với Docker database.
- [x] Nghiệm thu full Docker stack.
- [x] Kiểm tra loại trừ secret và file cấm.
- [x] Tài liệu Giai đoạn 1.

Các nội dung chưa hoàn thành và không thuộc technical foundation Giai đoạn 1:

- [ ] Triển khai production.
- [ ] Kết nối PostgreSQL production.
- [ ] Database nghiệp vụ.
- [ ] Import Excel.
- [ ] Authentication.
- [ ] Role-based authorization.
- [ ] Workflow phê duyệt.
- [ ] Backup/restore production.

Chi tiết bằng chứng và các điểm chặn kế thừa vẫn `OPEN` được ghi tại `05_phase_1_acceptance.md`.
