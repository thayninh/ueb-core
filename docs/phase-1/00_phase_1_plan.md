# Kế hoạch Giai đoạn 1 — Nền tảng dự án

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | Draft — Bắt đầu Giai đoạn 1 |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-14 |

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

- Ứng dụng chạy local.
- PostgreSQL local healthy.
- Ứng dụng kết nối được database local.
- Lint đạt.
- Typecheck đạt.
- Test cơ bản đạt.
- Production build đạt.
- Health endpoint trả kết quả đúng.
- Không có secret trong Git.
- Có README hướng dẫn chạy local.
