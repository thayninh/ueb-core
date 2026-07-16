# Database và migrations Phase 3

## 1. Migration inventory

Acceptance database có bốn migration và Prisma báo up to date:

1. `20260715135204_phase_2_initial`
2. `20260715164205_align_khoi_kien_thuc_integer`
3. `20260715183059_phase_3_auth_rbac_foundation`
4. `20260716030000_phase_3_core_read_rls`

Hai migration Phase 3 đã được replay sạch trên `ueb_core_phase3_rehearsal` và `ueb_core_phase3_e2e`.

## 2. Better Auth tables

- `auth_user`
- `auth_session`
- `auth_account`
- `auth_verification`

Auth IDs dùng UUID. `auth_session`, `auth_account` và `auth_verification` không append-only vì Better Auth cần cập nhật/xóa session và token. Self-delete bị tắt ở application layer.

## 3. Business RBAC tables

- `access_profile`: trạng thái `PENDING_MAPPING`, `ACTIVE`, `DISABLED`; unique user và optional unique lecturer mapping.
- `role_assignment`: grant/revoke `LECTURER`, `FACULTY_LEADER`, `ADMIN`.
- `organization_unit`: exact source value và display name.
- `unit_scope_assignment`: quan hệ nhiều unit trên một user.
- `auth_audit_event`: audit append-only.

Partial unique indexes ngăn hai active assignment cùng user/role hoặc user/unit. Check constraints buộc `revoked_at` và `revoked_by` cùng null hoặc cùng có giá trị.

Database triggers bảo vệ invariant: active `LECTURER` phải giữ lecturer mapping.

## 4. Audit append-only

`auth_audit_event` chặn:

- `UPDATE` bằng row trigger;
- `DELETE` bằng row trigger;
- `TRUNCATE` bằng statement trigger.

Foreign keys audit không dùng cascade làm mất lịch sử. Runtime chỉ có `SELECT`, `INSERT` trên bảng audit.

## 5. RLS migration

Migration `phase_3_core_read_rls` bật RLS trên `ueb_core_data` và chỉ tạo policy `SELECT`. Không có policy `INSERT`, `UPDATE` hoặc `DELETE`.

Policy đọc active profile, active role và active unit assignment từ database. Thiếu request context hoặc không có grant phù hợp trả về 0 dòng.

## 6. Bảo toàn Phase 2

Phase 3 không:

- thêm foreign key từ dữ liệu lõi sang auth user;
- thay đổi 20 cột nghiệp vụ hoặc technical metadata Phase 2;
- sửa sequence `stt`, source checksum hoặc import run;
- sửa/xóa 2497 dòng legacy;
- tạo workflow event.

Snapshot sau nghiệm thu: core rows `2497`, import runs `1`, workflow events `0`.
