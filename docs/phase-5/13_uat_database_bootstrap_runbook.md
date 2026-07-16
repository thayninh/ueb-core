# Phase 5 guarded UAT database bootstrap

## 1. Scope and hard gates

Runbook này bootstrap dedicated local UAT database từ backup acceptance đã nghiệm
thu. Nó không thay đổi migration, không provision user, không deploy production và
không ghi hoặc restore đè canonical database `ueb_core`.

Hai contract độc lập, không thay thế lẫn nhau:

- restore rehearsal chỉ nhận `ueb_core_restore_*` và marker disposable restore;
- UAT bootstrap chỉ nhận `ueb_core_uat_*` và marker UAT riêng.

Không dùng `createdb`, `pg_restore` hoặc `dropdb` thủ công để vượt guard. Không tự
động chạy ACL reconciliation hoặc cleanup trong bootstrap.

## 2. Credentials and accepted artifact

Bootstrap source dùng:

```text
MIGRATION_DATABASE_URL=<local owner URL targeting 127.0.0.1:55432/ueb_core>
POSTGRES_DB=ueb_core
POSTGRES_USER=<owner role>
APP_DATABASE_USER=<runtime role distinct from owner>
```

Backup phải là absolute `.dump` path ngoài repository, là regular file không phải
symlink, và có sidecar `<backup-path>.sha256` cũng là regular file. Actual checksum,
sidecar và accepted checksum phải cùng bằng:

```text
db79596e75ad234ffc514ab97fed66d40ced4a7ad06aa62caf5d374ac2d5d9b8
```

Script dùng `pg_restore --list` và `pg_restore` từ Compose service `db`; nó không
in URL, password, catalog hoặc business data.

## 3. Bootstrap command

Target phải chưa tồn tại:

```bash
pnpm phase5:bootstrap-uat -- \
  --backup=<ABSOLUTE_ACCEPTED_BACKUP_PATH_OUTSIDE_REPOSITORY> \
  --target-database=ueb_core_uat_phase5 \
  --confirm-create-uat-database \
  --expected-source-database=ueb_core
```

Trước `CREATE DATABASE`, command xác minh arguments, local owner endpoint, backup,
sidecar, accepted checksum, catalog, source ownership, canonical fingerprint và
target non-existence. Failure không tự drop target; operator phải điều tra và dùng
guarded cleanup riêng khi được phê duyệt.

Backup chứa migration history nên bootstrap không chạy migration mới. Post-restore
verification yêu cầu 2,497 core rows, 0 workflow events, 1 import run, 7 applied/0
pending migrations, `MAX(stt)=2569`, next STT 2570, RLS/default-deny và exact Phase
4 runtime ACL. Canonical fingerprint được chụp lại sau restore và phải không đổi.

## 4. Migration status and runtime ACL

Sau bootstrap, inject UAT owner URL qua secure operator environment; không ghi URL
vào Git hoặc shell transcript:

```bash
MIGRATION_DATABASE_URL="<SECURE_UAT_OWNER_URL>" \
pnpm db:migrate:status
```

Bootstrap không tự thay ACL. Operator chạy riêng:

```bash
MIGRATION_DATABASE_URL="<SECURE_UAT_OWNER_URL>" \
APP_DATABASE_USER="<UAT_RUNTIME_ROLE>" \
pnpm phase4:grant-runtime-permissions -- \
  --confirm-runtime-grants \
  --expected-database=ueb_core_uat_phase5
```

Sau đó chạy read-only verification. Environment cần `POSTGRES_USER` khớp owner và
`APP_DATABASE_USER` khớp runtime role:

```bash
MIGRATION_DATABASE_URL="<SECURE_UAT_OWNER_URL>" \
POSTGRES_USER="<UAT_OWNER_ROLE>" \
APP_DATABASE_USER="<UAT_RUNTIME_ROLE>" \
pnpm phase5:verify-uat-baseline -- \
  --target-database=ueb_core_uat_phase5
```

Verifier dùng owner transaction `READ ONLY`, không gọi `nextval()`, và xác minh
runtime khác owner, non-superuser, `NOBYPASSRLS`, no-context visibility bằng 0 và
exact Phase 4 table/sequence ACL.

## 5. Revoke copied sessions

Đây là mutation UAT riêng, cần change authorization và confirmation. Nó chỉ xóa
rows trong `auth_session` của UAT, không đổi user, profile, role, mapping hoặc audit;
chạy lại là idempotent.

```bash
MIGRATION_DATABASE_URL="<SECURE_UAT_OWNER_URL>" \
POSTGRES_USER="<UAT_OWNER_ROLE>" \
APP_DATABASE_USER="<UAT_RUNTIME_ROLE>" \
pnpm phase5:revoke-uat-sessions -- \
  --target-database=ueb_core_uat_phase5 \
  --confirm-revoke-copied-sessions
```

Hard gate: `ACTIVE_SESSION_COUNT=0` và `SESSION_REVOKE_STATUS=PASS`.

## 6. Active ADMIN internal ID

Sau khi session revoke và baseline verification pass, lookup read-only chỉ trả ID
nếu đúng một user có active `ADMIN` assignment và active access profile:

```bash
MIGRATION_DATABASE_URL="<SECURE_UAT_OWNER_URL>" \
POSTGRES_USER="<UAT_OWNER_ROLE>" \
APP_DATABASE_USER="<UAT_RUNTIME_ROLE>" \
pnpm phase5:lookup-active-admin -- \
  --target-database=ueb_core_uat_phase5
```

Zero hoặc multiple candidate làm command fail. Không commit internal ID hoặc raw
output; command không in email, name hay session.

## 7. Standalone canonical fingerprint

Command sau chỉ chấp nhận canonical acceptance database và chỉ đọc metadata/counts:

```bash
pnpm phase5:fingerprint-database -- \
  --expected-database=ueb_core
```

Fingerprint gồm database name, core/workflow/import/migration counts, `MAX(stt)`,
sequence last value/is-called và SHA-256 của metadata đó; không chứa business field
hoặc PII. Bootstrap tự so sánh fingerprint trước/sau và chỉ pass khi giống nhau.

## 8. Guarded UAT cleanup

Không cleanup mặc định hoặc tự động. Chỉ dùng sau explicit approval; target phải có
prefix và exact UAT marker do bootstrap tạo:

```bash
pnpm phase5:cleanup-uat -- \
  --target-database=ueb_core_uat_phase5 \
  --confirm-drop-uat-database
```

Cleanup từ chối `ueb_core`, restore rehearsal database, unsafe name, target thiếu
marker và mọi non-UAT target. Nó không xóa backup hoặc sidecar.

## 9. Evidence hygiene

Chỉ giữ aggregate counts, checksum và PASS/FAIL qua secure operational evidence.
Không commit backup, checksum sidecar, URL, password, ADMIN ID, PII, session/token,
catalog hoặc raw log. Chưa chạy provisioning apply nếu bootstrap, ACL verification,
baseline verification và session revoke chưa cùng `PASS`.
