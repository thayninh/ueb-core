# Migration và database guards Giai đoạn 2

## 1. Phân tách credential

Giai đoạn 2 dùng hai database role tách biệt:

| Role | Biến môi trường | Mục đích |
| --- | --- | --- |
| Migration/owner | nằm trong `MIGRATION_DATABASE_URL` | Prisma migration và bootstrap quyền |
| Application runtime | `APP_DATABASE_USER`, `APP_DATABASE_PASSWORD` và `DATABASE_URL` | Next.js đọc và chèn dữ liệu runtime |

`prisma.config.ts` chỉ đọc `MIGRATION_DATABASE_URL` cho datasource của Prisma CLI. `src/lib/server/env.ts` và Next.js tiếp tục chỉ đọc `DATABASE_URL`. Khi nghiệm thu, username trong `DATABASE_URL` phải là `APP_DATABASE_USER` và không được là migration user, database owner hoặc schema owner.

`.env.example` chỉ chứa địa chỉ loopback và mật khẩu mẫu local. `.env` cùng mọi biến thể `.env.*` tiếp tục bị Git ignore, ngoại trừ `.env.example`. Không đưa credential production vào các file này hoặc vào lệnh được lưu trong log.

## 2. Thứ tự vận hành local

Các lệnh dưới đây mô tả thứ tự sau khi migration được phê duyệt. Việc viết tài liệu và bootstrap script không tự apply migration.

1. Khởi động PostgreSQL local bằng migration/owner credential.
2. Apply migration bằng quy trình migration riêng, với `MIGRATION_DATABASE_URL`.
3. Chạy `pnpm db:bootstrap-runtime-role` để tạo hoặc siết lại runtime role.
4. Cấu hình Next.js bằng `DATABASE_URL` chứa đúng `APP_DATABASE_USER` và `APP_DATABASE_PASSWORD`.
5. Xác nhận kết nối runtime báo `current_user` là `APP_DATABASE_USER`, không phải owner.

Bootstrap phải chạy sau migration vì nó kiểm tra sự tồn tại của ba bảng Phase 2 và identity sequence. Nếu schema chưa tồn tại, toàn bộ transaction bị rollback và role không được tạo dở.

Migration `20260715135204_phase_2_initial` được tạo theo chế độ create-only để review trước, sau đó đã được apply lên PostgreSQL local ngày 2026-07-15. Migration chưa được apply lên production.

## 3. Bootstrap runtime role

Script `scripts/phase-2/bootstrap-runtime-role.ts` chỉ dùng:

- `MIGRATION_DATABASE_URL` để mở kết nối quản trị;
- `APP_DATABASE_USER` làm tên runtime role;
- `APP_DATABASE_PASSWORD` làm mật khẩu runtime role.

Script không in password hoặc connection string. Lỗi PostgreSQL bất ngờ được thay bằng thông báo an toàn, không chuyển nguyên error object ra console.

Bootstrap chạy trong một transaction và lấy advisory lock để tránh hai tiến trình cùng sửa role. Hành vi idempotent:

- role chưa tồn tại: `CREATE ROLE`;
- role đã tồn tại: `ALTER ROLE`, không drop hoặc tạo lại;
- mỗi lần chạy cập nhật password và ép lại toàn bộ thuộc tính an toàn;
- role có membership hoặc đang sở hữu database object thì script dừng, không tự ý thu hồi ownership hay membership.

Thuộc tính bắt buộc:

- `LOGIN`;
- `NOSUPERUSER`;
- `NOCREATEDB`;
- `NOCREATEROLE`;
- `NOINHERIT`;
- `NOREPLICATION`;
- `NOBYPASSRLS`.

Script từ chối cấu hình nếu runtime role trùng migration user, database owner hoặc owner của schema `public`.

## 4. Ma trận quyền runtime

Trước khi grant, script thu hồi toàn bộ quyền trực tiếp hiện có của runtime role trên database, schema `public`, mọi table và sequence trong schema. Đồng thời:

- revoke `CREATE` trên schema `public` khỏi `PUBLIC`;
- revoke `TEMPORARY` trên database khỏi `PUBLIC`.

Sau đó chỉ grant:

| Object | Được grant | Không được grant |
| --- | --- | --- |
| Database hiện tại | `CONNECT` | `CREATE`, `TEMPORARY` |
| Schema `public` | `USAGE` | `CREATE` |
| `ueb_core_data` | `SELECT`, `INSERT` | `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` |
| `import_run` | `SELECT`, `INSERT` | `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` |
| `workflow_event` | `SELECT`, `INSERT` | `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` |
| `ueb_core_data_stt_seq` | `USAGE`, `SELECT` | `UPDATE`/`setval` |

`USAGE` trên identity sequence cho phép lấy STT tự sinh từ 2570. Không grant `UPDATE` sequence nên runtime role không thể gọi `setval` để thay đổi vị trí sequence.

Sau khi grant, script tự kiểm tra lại role attributes và toàn bộ ma trận quyền. Bất kỳ quyền thiếu hoặc thừa nào cũng làm transaction rollback.

## 5. Bảo vệ append-only nhiều lớp

Quyền runtime là lớp bảo vệ thứ nhất: runtime role không có `UPDATE`, `DELETE` hoặc `TRUNCATE`.

Migration tạo lớp bảo vệ thứ hai bằng trigger trên `ueb_core_data`, `import_run` và `workflow_event`. Trigger từ chối `UPDATE`, `DELETE` và `TRUNCATE` kể cả khi một role khác được cấp nhầm các quyền đó. Thay đổi nghiệp vụ tương lai phải tạo dòng mới bằng `INSERT`.

Migration/owner credential không được đưa vào `DATABASE_URL` của Next.js, container app, health check hoặc readiness check. Owner chỉ dùng trong quy trình migration/bootstrap có kiểm soát.

## 6. Kiểm tra nghiệm thu

Trước nghiệm thu local cần chứng minh tối thiểu:

- bootstrap chạy thành công hai lần liên tiếp mà không drop role;
- runtime connection trả về đúng `current_user`;
- `SELECT` và `INSERT` hợp lệ theo schema;
- `UPDATE`, `DELETE` và `TRUNCATE` đều bị từ chối;
- runtime role không có `CREATE` database/schema, `TEMPORARY` hoặc quyền thay đổi sequence;
- migration/owner URL không xuất hiện trong biến môi trường của tiến trình Next.js;
- log không chứa password hoặc connection string.

Không chạy các kiểm tra ghi này với production. Việc apply migration, bootstrap production role và production import đều nằm ngoài bước hiện tại.

### Kết quả kiểm tra local ngày 2026-07-15

- PostgreSQL báo healthy.
- Prisma xác nhận database schema up to date với một migration.
- Bootstrap runtime role chạy thành công hai lần liên tiếp.
- `_prisma_migrations`, `ueb_core_data`, `import_run` và `workflow_event` tồn tại; owner là migration role, không phải runtime role.
- `ueb_core_data` có `0` dòng.
- Identity sequence là `public.ueb_core_data_stt_seq`, `start_value = 2570` và chưa có `last_value`; kiểm tra không gọi `nextval()`.
- Runtime role có `SELECT`, `INSERT` và không có `UPDATE`, `DELETE`, `TRUNCATE` trên ba bảng runtime.
- Runtime role có `USAGE`, `SELECT` và không có `UPDATE` trên identity sequence.
- Runtime role có `LOGIN` nhưng không có `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION` hoặc `BYPASSRLS`.
