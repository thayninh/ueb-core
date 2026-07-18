# Phase 6 guarded staging tooling runbook

## 1. Scope and hard gate

Runbook này mô tả exact order cho guarded database/operator tooling. Nó không tự
authorize SSH, Compose, Caddy hoặc deployment. Tất cả database URLs/passwords và
monitoring email phải được inject từ restricted external configuration; không
dùng `.env` trong repository, `set -x`, command-line secret hoặc UAT credential.

```text
TARGET_HOST=103.200.25.54
TARGET_DATABASE=ueb_core_staging
OWNER_ROLE=ueb_core_staging_owner
RUNTIME_ROLE=ueb_core_staging_app
PROVISIONING_ROLE=ueb_core_staging_provisioner
DATABASE_MUTATIONS=NOT_AUTHORIZED_BY_THIS_DOCUMENT
STAGING_DEPLOYMENT=NOT_PERFORMED
```

## 2. Secure environment contract

Approved Node 24 operator job phải nhận các biến sau từ secret store hoặc file
mode `0600` ngoài repository. Không print value:

```text
STAGING_TARGET_HOST=103.200.25.54
STAGING_DATABASE_HOST=db
STAGING_DATABASE_PORT=5432
STAGING_EXPECTED_DATABASE=ueb_core_staging
STAGING_MIGRATION_OWNER_ROLE=ueb_core_staging_owner
APP_DATABASE_USER=ueb_core_staging_app
PHASE6_PROVISIONING_USER=ueb_core_staging_provisioner
STAGING_AUTHORIZED_BOOTSTRAP_ROLE=<APPROVED_NON_SUPERUSER_CREATEDB_CREATEROLE_ADMIN>
STAGING_BOOTSTRAP_DATABASE_URL=<RESTRICTED_BOOTSTRAP_URL>
MIGRATION_DATABASE_URL=<RESTRICTED_OWNER_URL>
STAGING_ROLE_ADMIN_DATABASE_URL=<RESTRICTED_ROLE_ADMIN_URL>
DATABASE_URL=<RESTRICTED_RUNTIME_URL>
PHASE6_PROVISIONING_DATABASE_URL=<RESTRICTED_PROVISIONER_URL>
STAGING_MIGRATION_OWNER_PASSWORD=<RESTRICTED_VALUE>
STAGING_RUNTIME_PASSWORD=<RESTRICTED_VALUE>
STAGING_PROVISIONING_PASSWORD=<RESTRICTED_VALUE>
STAGING_MONITORING_EMAIL=<RESTRICTED_APPROVED_ADDRESS>
STAGING_CHANGE_WINDOW_START=<FUTURE_ISO_TIMESTAMP_WITH_OFFSET>
STAGING_CHANGE_WINDOW_END=<FUTURE_ISO_TIMESTAMP_WITH_OFFSET>
STAGING_TIMEZONE=Asia/Ho_Chi_Minh
```

Production staging URLs must use the declared private database host and port
`5432`. Các file được sinh bởi `phase6:generate-staging-secrets` được tách thành
`postgres-bootstrap.env`, `database-owner.env`, `app-runtime.env`,
`provisioner.env` và `monitoring.env`. Cluster-admin credential chỉ ở file
bootstrap; app chỉ nhận `app-runtime.env`. Unit và integration test chỉ dùng
`ueb_core_staging_test_<safe_suffix>` trên endpoint local được explicit test gate
cho phép.

## 3. Local immutable artifact and rollback preflight

Run from clean branch `feat/phase-6-staging-rollout-validation`. Paths below must
be absolute and outside the repository.

```bash
pnpm phase6:verify-rollback-image -- \
  --previous-image-metadata="$ROLLBACK_METADATA_PATH" \
  --expected-architecture="$TARGET_ARCHITECTURE"

pnpm phase6:staging-deployment-preflight -- \
  --expected-git-commit="$GIT_SHA" \
  --expected-image-archive-sha256="$IMAGE_ARCHIVE_SHA256" \
  --expected-image-id="$IMAGE_ID" \
  --image-tag="ueb-core:${GIT_SHA}" \
  --image-archive="$IMAGE_ARCHIVE_PATH" \
  --expected-operator-image-archive-sha256="$OPERATOR_IMAGE_ARCHIVE_SHA256" \
  --expected-operator-image-id="$OPERATOR_IMAGE_ID" \
  --operator-image-tag="ueb-core-operator:${GIT_SHA}" \
  --operator-image-archive="$OPERATOR_IMAGE_ARCHIVE_PATH" \
  --target-host=103.200.25.54 \
  --target-database=ueb_core_staging \
  --deployment-directory=/opt/ueb-core \
  --proxy-network=ueb-core-proxy \
  --caddy-container=khtc-ueb-prod-caddy-1 \
  --ssh-alias=ueb-core-staging \
  --secret-file="$RESTRICTED_STAGING_ENV_PATH" \
  --rollback-evidence="$ROLLBACK_EVIDENCE_PATH" \
  --confirm-authorized-staging-deployment
```

Nếu đây là first deployment, thay command rollback đầu tiên bằng command dưới
đây, sau khi external change record phê duyệt giữ nguyên database/backup khi
remove new stack:

```bash
export STAGING_FIRST_DEPLOYMENT_ROLLBACK_APPROVED=YES
pnpm phase6:verify-rollback-image -- \
  --first-deployment \
  --confirm-remove-new-staging-stack
```

Không tiếp tục nếu preflight không xuất `PASS`.

## 4. Existing-database branch: backup first

Chỉ dùng branch này khi guarded discovery xác nhận exact staging database đã tồn
tại. Tên file là operator-generated UTC timestamp, path tuyệt đối:

```bash
pnpm phase6:backup-staging -- \
  --expected-database=ueb_core_staging \
  --output="$STAGING_BACKUP_PATH" \
  --confirm-staging-backup

pnpm phase6:verify-staging-backup -- \
  --backup="$STAGING_BACKUP_PATH"
```

Sau khi encrypted off-host copy và retrieval được operator xác minh độc lập, ghi
marker idempotence-controlled đúng một lần:

```bash
pnpm phase6:verify-staging-backup -- \
  --backup="$STAGING_BACKUP_PATH" \
  --record-off-host-copy \
  --confirm-record-off-host-copy
```

## 5. Absent-database branch: bootstrap once

Chỉ dùng branch này khi exact target chưa tồn tại.
`STAGING_BOOTSTRAP_DATABASE_URL` dùng approved bootstrap identity;
`MIGRATION_DATABASE_URL` luôn là dedicated owner. Bootstrap từ chối
superuser/existing target, tạo exact owner/database rồi chạy `prisma migrate
deploy` và require 7 applied migrations.

```bash
pnpm phase6:bootstrap-staging-database -- \
  --expected-database=ueb_core_staging \
  --confirm-create-staging-database
```

Sau PASS, các job tiếp theo tiếp tục dùng `MIGRATION_DATABASE_URL` owner đã được
sinh sẵn. Không ghi URL vào evidence.

## 6. Roles, ACL, security and fingerprint

Role/restore bootstrap dùng distinct `STAGING_ROLE_ADMIN_DATABASE_URL` với
`CREATEROLE`/`CREATEDB`; ACL/migrations dùng owner URL; verifier còn yêu cầu
dedicated runtime/provisioner URLs.

```bash
pnpm phase6:bootstrap-staging-runtime-role -- \
  --expected-database=ueb_core_staging \
  --confirm-bootstrap-staging-runtime-role

pnpm phase6:bootstrap-staging-provisioning-role -- \
  --expected-database=ueb_core_staging \
  --confirm-bootstrap-staging-provisioning-role

pnpm phase6:grant-staging-runtime-permissions -- \
  --expected-database=ueb_core_staging \
  --confirm-staging-runtime-grants

pnpm phase6:grant-staging-provisioning-permissions -- \
  --expected-database=ueb_core_staging \
  --confirm-staging-provisioning-grants

pnpm phase6:verify-staging-security -- \
  --expected-database=ueb_core_staging

pnpm phase6:fingerprint-staging -- \
  --expected-database=ueb_core_staging
```

Với absent-database branch, tạo và verify first backup ngay sau toàn bộ commands
trên, theo Section 4.

## 7. Restore rehearsal and explicit cleanup

Restore target phải là new `ueb_core_staging_restore_<safe_suffix>`. Failure giữ
target/lock để điều tra; tooling không tự cleanup.

```bash
pnpm phase6:restore-staging-rehearsal -- \
  --source-database=ueb_core_staging \
  --target-database="$STAGING_RESTORE_DATABASE" \
  --backup="$STAGING_BACKUP_PATH" \
  --confirm-create-staging-restore

pnpm phase6:verify-staging-restore -- \
  --target-database="$STAGING_RESTORE_DATABASE"
```

Chỉ cleanup sau evidence approval:

```bash
pnpm phase6:cleanup-staging-restore -- \
  --target-database="$STAGING_RESTORE_DATABASE" \
  --backup="$STAGING_BACKUP_PATH" \
  --confirm-drop-staging-restore
```

## 8. Retention cleanup

Cleanup giữ 14 daily + 8 weekly, không xóa artifact thiếu matching off-host
checksum marker và không xóa backup có restore lock.

```bash
pnpm phase6:cleanup-staging-backups -- \
  --backup-directory=/var/backups/ueb-core/staging \
  --confirm-cleanup-staging-backups
```

## 9. Stop conditions and evidence

Stop ngay nếu target/host/port/role khác contract, confirmation thiếu, change
window hết hạn, monitoring email không hợp lệ, image/checksum mismatch, role/ACL
excess, RLS default deny fail hoặc restore fingerprint metadata lệch. Evidence
chỉ lưu aggregate counts, immutable IDs, SHA-256 và PASS/FAIL; không lưu URL,
password, email chưa approved, PII, dump/catalog hoặc raw environment.
