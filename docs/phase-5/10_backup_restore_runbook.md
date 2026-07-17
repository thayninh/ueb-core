# Phase 5 guarded backup and restore runbook

## 1. Scope and hard gate

Runbook này tạo custom-format backup của local acceptance `ueb_core`, kiểm tra SHA-256/catalog, restore vào database disposable cô lập và xác minh baseline. Đây không phải production backup hoặc production deployment.

Không provision real user, chạy mutation UAT hoặc provisioning apply khi rehearsal chưa `PASS`. Backup exclusion trong `.gitignore` và `.dockerignore` cũng phải `PASS` trước khi tạo artifact.

## 2. Safety contract

- Chỉ dùng `MIGRATION_DATABASE_URL` và PostgreSQL owner trong service `db`; không dùng runtime URL/password.
- Source phải là local `127.0.0.1:55432/ueb_core`; migration user phải khớp `POSTGRES_USER`, khác `APP_DATABASE_USER` và sở hữu source database.
- Script không in URL, password, PII, catalog hoặc database object list.
- Target phải là database mới, tên bắt đầu bằng `ueb_core_restore_`, không được là `ueb_core`, `postgres`, `template0` hoặc `template1`.
- Restore từ chối database đã tồn tại; không tự động drop hoặc overwrite target.
- Database mới được gắn marker `ueb-core:phase-5:disposable-restore`. Cleanup yêu cầu cả prefix, marker và confirmation.
- Backup/checksum nằm dưới ignored `infra/backup/`; không add bằng `git add -f` và không đưa vào Docker build context.

## 3. PostgreSQL client toolchain

Kiểm tra host:

```bash
command -v pg_dump
command -v pg_restore
command -v psql
command -v createdb
command -v dropdb
```

Nếu host không có client binaries, các package scripts dùng binaries từ PostgreSQL service `db` qua `docker compose exec -T`. Service phải đang healthy; script không tự start hoặc thay đổi Compose configuration.

## 4. Unit/static verification

```bash
pnpm typecheck
pnpm test
```

Guard tests phải chứng minh forbidden targets bị từ chối, prefix/confirmation bắt buộc, backup path không thoát `infra/backup/`, và owner/runtime identities được tách.

## 5. Backup

Backup mặc định được tạo tại ignored path `infra/backup/ueb_core_phase5.dump`; SHA-256 sidecar dùng cùng path với suffix `.sha256`. Script từ chối overwrite artifact đã tồn tại.

```bash
pnpm phase5:backup -- \
  --confirm-backup \
  --expected-database=ueb_core
```

Pass contract:

```text
BACKUP_STATUS=PASS
BACKUP_CHECKSUM=<SHA-256>
BACKUP_CHECKSUM_STATUS=PASS
BACKUP_CATALOG_STATUS=PASS
```

Catalog được kiểm tra trong memory bằng `pg_restore --list`; raw catalog và object names không được in hoặc lưu làm committed evidence.

## 6. Mandatory negative guard

Lệnh sau phải exit non-zero trước khi đọc archive, kết nối database hoặc chạy thao tác destructive:

```bash
pnpm phase5:restore-rehearsal -- \
  --backup=infra/backup/ueb_core_phase5.dump \
  --target-database=ueb_core \
  --confirm-create-disposable-database
```

Expected sanitized output:

```text
RESTORE_TARGET_GUARD=FAIL
```

## 7. Restore rehearsal

Target phải chưa tồn tại:

```bash
pnpm phase5:restore-rehearsal -- \
  --backup=infra/backup/ueb_core_phase5.dump \
  --target-database=ueb_core_restore_phase5 \
  --confirm-create-disposable-database
```

Post-restore verifier không gọi `nextval()` và yêu cầu:

```text
RESTORE_TARGET_GUARD=PASS
BACKUP_CHECKSUM_STATUS=PASS
BACKUP_CATALOG_STATUS=PASS
RESTORE_STATUS=PASS
POST_RESTORE_VERIFY=PASS
CORE_ROW_COUNT=2497
WORKFLOW_EVENT_COUNT=0
IMPORT_RUN_COUNT=1
MIGRATIONS_APPLIED=7
MIGRATIONS_PENDING=0
MAX_STT=2569
NEXT_STT=2570
RLS_DEFAULT_DENY=PASS
```

RLS verification xác nhận hai table bật RLS, runtime role là non-superuser và `NOBYPASSRLS`, sau đó dùng owner session với `SET LOCAL ROLE` để chứng minh no-context runtime thấy 0 core/workflow rows. Runtime credential không được sử dụng.

Nếu restore hoặc verification fail, giữ nguyên database và backup để điều tra; không tự động drop acceptance hoặc target.

## 8. Guarded cleanup

Chỉ cleanup sau khi checksum và restore evidence đã được ghi nhận ngoài repository:

```bash
pnpm phase5:cleanup-restore -- \
  --target-database=ueb_core_restore_phase5 \
  --confirm-drop-disposable-database
```

Expected:

```text
CLEANUP_TARGET_GUARD=PASS
CLEANUP_STATUS=PASS
```

Cleanup từ chối mọi database không có exact prefix và disposable marker. Nó không xóa backup; backup retention/xóa cần change-control riêng.

## 9. Evidence handling

Console output chỉ gồm checksum, aggregate counts và `PASS`/`FAIL`. Không commit backup, checksum sidecar, catalog, raw log, URL, credential, PII hoặc sensitive object names. Committed summary chỉ được dùng opaque external evidence reference và kết luận đã khử nhạy cảm.
