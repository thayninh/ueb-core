# RBAC, DAL và PostgreSQL RLS

## 1. Principal

Principal server-only chỉ chứa:

- `userId`;
- active `roles`;
- nullable `lecturerUid`;
- active `unitIds`;
- access profile `status`.

Principal không chứa password hash, session token, provider token hoặc audit secret.

## 2. Ma trận quyền

| Role | Quyền đọc core | Điều kiện | Ghi legacy data | Admin actions |
| --- | --- | --- | --- | --- |
| `LECTURER` | Chỉ dòng cùng `lecturer_uid` | Active profile + active role + mapping | Không | Không |
| `FACULTY_LEADER` | Chỉ `approval_unit` thuộc active unit scope | Active profile + active role + scope | Không | Không |
| `ADMIN` | Toàn bộ 2497 dòng | Active profile + active role | Không | Account/RBAC/session administration |

Multiple roles hợp lệ; kết quả đọc là hợp của các grant. Multiple unit scopes hợp lệ. Leader không có scope nhìn thấy 0 dòng từ role leader.

## 3. DAL và DTO

- Lecturer DAL không nhận `lecturer_uid` từ client để quyết định quyền.
- Leader DAL resolve `source_value` từ active database assignment.
- Admin vẫn đọc qua DAL và `requireAdmin()`.
- Search/pagination được validate server-side.
- DTO có đủ 20 cột nghiệp vụ cùng metadata hiển thị đã duyệt; không trả source checksum, auth account, password hoặc session token.

## 4. RLS request context

Mọi query core chạy trong cùng transaction với:

```sql
SELECT set_config('app.current_user_id', '<verified-user-uuid>', true);
```

Tham số `true` làm context transaction-local. Không dùng session-global `SET` trên connection pool.

## 5. RLS policy

Policy `ueb_core_data_phase_3_select` cho phép nếu active user có ít nhất một grant:

1. active `ADMIN`; hoặc
2. active `LECTURER` và profile `lecturer_uid` khớp dòng; hoặc
3. active `FACULTY_LEADER` và `approval_unit` khớp exact active unit `source_value`.

Thiếu context, disabled profile, revoked role, leader không scope hoặc unit inactive đều trả 0 dòng. RLS không áp dụng cho auth tables.

## 6. Runtime permissions

| Table | Runtime permissions |
| --- | --- |
| `ueb_core_data` | `SELECT` |
| `import_run` | `SELECT` |
| `workflow_event` | `SELECT`, `INSERT` theo policy kế thừa Phase 2; chưa dùng trong Phase 3 |
| `auth_user` | `SELECT`, `INSERT`, `UPDATE` |
| `auth_session` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `auth_account` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| `auth_verification` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |
| RBAC/unit tables | `SELECT`, `INSERT`, `UPDATE` |
| `auth_audit_event` | `SELECT`, `INSERT` |

Runtime không có `ALTER`, `DROP`, `TRUNCATE`, schema create, sequence mutation hoặc `UPDATE`/`DELETE` core. Runtime role khác database/schema owner và có `NOBYPASSRLS`.
