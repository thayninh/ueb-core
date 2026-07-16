# Kế hoạch và kết quả Giai đoạn 3

## 1. Trạng thái

| Hạng mục | Trạng thái |
| --- | --- |
| Phase 3 technical acceptance | **PASS** |
| Local auth/RBAC acceptance | **COMPLETED** |
| Production SSO | **NOT CONFIGURED** |
| Production account provisioning | **NOT PERFORMED** |
| Phase 0 open conditions | **UNCHANGED** |

Phạm vi được nghiệm thu ngày 2026-07-16 trên local development, local acceptance và hai database test cô lập. Không có kết nối hoặc thay đổi production.

## 2. Mục tiêu đã hoàn thành

- Better Auth với Prisma adapter, email/password cho local và database-backed session.
- Public signup bị tắt; không có trang hoặc liên kết đăng ký.
- Tài khoản chỉ được tạo bằng bootstrap có xác nhận hoặc thao tác `ADMIN` phía server.
- Business RBAC gồm `LECTURER`, `FACULTY_LEADER`, `ADMIN`.
- Một user có thể có nhiều role; một lãnh đạo có thể có nhiều unit scope.
- Một auth user ánh xạ tối đa một `lecturer_uid`; `ADMIN` có thể không có mapping.
- DAL, DTO và PostgreSQL RLS bảo vệ đường đọc dữ liệu lõi.
- Giao diện read-only cho dashboard, lecturer, leader, admin users và admin audit.
- Audit đăng nhập, lifecycle tài khoản, role, unit scope, lecturer mapping và session.
- Clean migration replay, unit, integration, RLS, IDOR và E2E đã đạt.

## 3. Ranh giới Phase 3

`ueb_core_data` tiếp tục read-only. Phase 3 không triển khai:

- public signup, email password reset, MFA hoặc production SSO;
- giảng viên thêm/sửa/xóa dòng;
- submit, approve/reject hoặc business versioning;
- sửa dữ liệu legacy đã import;
- mass-provision toàn bộ giảng viên;
- production deployment hoặc production account provisioning.

Các workflow nghiệp vụ được chuyển sang Phase 4.

## 4. Kết quả hard gate

| Gate | Kết quả |
| --- | --- |
| Identity source audit | PASS; transaction read-only, không đọc Excel |
| Email uniqueness | PASS; không có email ánh xạ nhiều `lecturer_uid` |
| Lecturer mapping ambiguity | PASS; không có `lecturer_uid` ánh xạ nhiều email |
| Organizational unit inventory | PASS; 6 đơn vị, giữ nguyên source value |
| Bootstrap admin local | COMPLETED; một `ADMIN` không có lecturer mapping |
| Migration review/replay | PASS; 4 migration apply sạch |
| Negative authorization | PASS |
| RLS/default deny | PASS |

Sáu đơn vị chưa có lãnh đạo/email được xác nhận tiếp tục `unassigned`. Không tạo lãnh đạo giả và không suy đoán email.

## 5. Kết quả acceptance cố định

- Core rows: `2497`.
- Import runs: `1`.
- Workflow events: `0`.
- Auth migrations: up to date.
- Phase 2 data verify: PASS, `0` anomaly.
- Runtime role khác migration owner, không có `BYPASSRLS`.
- Runtime không có `UPDATE`/`DELETE` trên `ueb_core_data`.
- Local ADMIN login/logout: PASS; không còn active session sau nghiệm thu.

Chi tiết nằm trong `docs/phase-3/07_phase_3_acceptance.md`.

## 6. Điều kiện kế thừa

Phase 3 technical acceptance không đóng hoặc thay đổi các điều kiện còn mở của Phase 0. Production SSO, production provisioning, production deployment và formal business decisions ngoài phạm vi vẫn giữ nguyên trạng thái trước Phase 3.
