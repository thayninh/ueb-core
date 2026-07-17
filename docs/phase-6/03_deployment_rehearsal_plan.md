# Phase 6 deployment and rollback rehearsal plan

## 1. Purpose

Rehearsal chứng minh ordered staging rollout có thể chạy và rollback an toàn
trước staging acceptance. Staging decisions/resource limits đã được operator
phê duyệt, nhưng rehearsal/deployment chưa chạy và vẫn bị chặn bởi missing
staging-safe guarded tooling cùng execution-only gates.

## 2. Preconditions

- Approved target; change/observation windows và rollback execution reference.
- Approved source commit, immutable application image và compatible rollback
  image.
- Dedicated staging database/volume/network; target không phải UAT/canonical.
- Owner/runtime/provisioning roles tách biệt và secrets từ external store.
- Staging-safe guarded backup, restore, fingerprint, security verifier và session
  procedures có negative tests; không bypass Phase 5 UAT-only guards.
- Off-host backup destination, RPO/RTO, monitoring và support routing được duyệt.
- Working tree sạch; migration history không modified; full quality gates pass.

Approved target contract:

```text
STAGING_HOST=103.200.25.54
STAGING_DATABASE=ueb_core_staging
STAGING_DEPLOYMENT_DIRECTORY=/opt/ueb-core
STAGING_PROXY_NETWORK=ueb-core-proxy
STAGING_APP_UPSTREAM=ueb-core-staging-app:3000
APP_MEMORY_LIMIT=512M
APP_CPU_LIMIT=0.75
DATABASE_MEMORY_LIMIT=768M
DATABASE_CPU_LIMIT=0.75
COMBINED_MEMORY_LIMIT_MIB=1280
IMAGE_DELIVERY=DOCKER_SAVE_SHA256_SCP_DOCKER_LOAD
STAGING_GUARDED_TOOLING_READY=NO
```

Exact command order, Caddy backup/validate/reload steps, image transfer,
monitoring and rollback commands are in
`docs/phase-6/07_staging_change_and_rollback_plan.md`.

## 3. Baseline capture

Ghi redacted baseline trước mutation:

- source commit và immutable image digest;
- staging/canonical fingerprints bằng guarded read-only commands;
- migration status và schema checksum;
- aggregate core/workflow/import counts, maximum/next sequence metadata không
  gọi `nextval()`;
- role properties và exact ACL;
- container/network/volume state;
- health/readiness/TLS status nếu app hiện hữu;
- backup freshness và last verified restore evidence.

Mismatch hoặc missing baseline là stop condition.

## 4. Ordered rehearsal

### R-01 — Artifact and configuration preflight

Xác minh image digest, source commit, app user, read-only filesystem, private
ports/networks, resource limits, log rotation và exact app environment key
allowlist. Không print environment values.

Expected: `ARTIFACT_CONFIG_PREFLIGHT=PASS`, database/app public ports bằng 0.

### R-02 — Pre-deploy backup

Chạy staging-safe owner job tạo custom-format backup. Artifact/sidecar nằm ngoài
Git/build context, encryption và restrictive access được áp dụng.

Current Phase 5 backup command is local/UAT-only. R-02 remains blocked until a
staging-safe exact-host/database wrapper with negative tests exists.

Expected: `BACKUP_STATUS=PASS`, `DATABASE_WRITES=0`.

### R-03 — Checksum, catalog and off-host copy

So khớp SHA-256, chạy `pg_restore --list` không persist/print catalog, xác minh
encrypted off-host copy có thể retrieve.

Expected: checksum/catalog/off-host retrieval đều `PASS`.

### R-04 — Guarded restore rehearsal

Restore backup vào **new isolated staging-rehearsal target** có approved prefix
và marker. Từ chối active staging, canonical, UAT, existing/ambiguous target.
Verify migrations, counts, sequence metadata, latest rows, auth/session, ACL và
RLS default deny; cleanup chỉ bằng guarded command sau evidence approval.

### R-05 — Migration owner job

Chạy migration deploy riêng bằng owner credential. Require zero failed/pending
migrations và unchanged applied migration files. Không start app hoặc provision
trong job này.

The approved runner image does not contain the Node/Prisma operator workspace.
R-05 therefore requires a separate approved Node 24 operator image/job attached
only to the private database network.

### R-06 — Runtime role and ACL reconciliation

Bootstrap/reconcile runtime role riêng, rồi verify non-owner/non-superuser/
`NOBYPASSRLS`, exact table/helper/sequence privileges và no-context visibility 0.

Runtime primitives are reusable only behind a new staging target guard.
Provisioning role tools currently require local/UAT database/role patterns and
must not run against `ueb_core_staging`.

### R-07 — Application start

Start/update app bằng immutable image và runtime credential only, `--no-build`.
Không truyền owner/provisioning variables và không chạy migration lúc startup.

### R-08 — Technical probes

Qua public TLS path, require:

- `/api/health` HTTP 200;
- `/api/ready` HTTP 200 và no-cache;
- valid TLS/hostname/security headers;
- migration status up to date;
- runtime RLS default deny core/workflow visibility 0.

### R-09 — Read-only smoke tests

- Anonymous protected routes safe-deny/redirect.
- Staging admin đọc latest-data/users/audit, không có mutation controls.
- Staging lecturer/leader thấy đúng row/unit scope; cross-user/unit IDOR safe-deny.
- Pure admin không submit thay lecturer.
- No unexplained core/workflow delta.

Chỉ dùng small approved staging-only identities; không mass-provision real users.

### R-10 — Fingerprint reconciliation

So sánh staging before/after fingerprint và canonical reference. Chỉ expected
migration/bootstrap delta được chấp nhận; canonical không đổi.

## 5. Application rollback rehearsal

1. Contain traffic và preserve evidence.
2. Xác minh rollback image tương thích schema đã apply.
3. Switch tới previous immutable image; không reverse/delete migration.
4. Lặp health, readiness, TLS, migration status, RLS, admin/latest và role/scope
   smoke tests.
5. So khớp fingerprint, logs và unexplained deltas.

Không cycle images khi failure lặp lại; quay về containment và incident review.

## 6. Restore decision rehearsal

Restore không phải default rollback. Rehearse decision tree cho partial migration,
data integrity, credential exposure và DB loss. New-target restore yêu cầu incident
owner + data owner, verified backup/catalog, approved RPO/RTO, marker/prefix và
controlled cutover plan. Không restore đè active DB và không destructive cleanup.

## 7. Failure injection phạm vi an toàn

Cho phép trên rehearsal target: app stop, invalid non-secret configuration key,
temporary private-network interruption và read-only verifier failure simulation.
Không inject failure bằng thay đổi core/workflow, broad ACL, corrupt backup,
production credential hoặc UAT database.

## 8. Planning readiness and stop conditions

```text
STAGING_AUTHORIZATION=APPROVED
RESOURCE_PROFILE_ACCEPTED=YES_CONDITIONAL_WITH_RESOURCE_LIMITS
PROXY_ARCHITECTURE=REUSE_EXISTING_CADDY_CONTAINER
EXTERNAL_PROXY_NETWORK=ueb-core-proxy
CADDY_CHANGE_APPROVED=YES_ADD_ONLY_UEB_CORE_SITE
CADDY_RELOAD_APPROVED=YES_AFTER_VALIDATE
TLS_METHOD=CADDY_AUTOMATIC_HTTPS
RPO_APPROVED=24_HOURS
RTO_APPROVED=4_HOURS
STAGING_GUARDED_TOOLING_READY=NO
DEPLOYMENT_REHEARSAL=NOT_PERFORMED
```

Do not begin R-02 through R-10 until database bootstrap, role/provisioning,
backup/restore, fingerprint and RLS verifier tooling accepts only the exact
staging host/database and has negative tests. A blank monitoring email,
unapproved change/observation window or missing rollback-image compatibility is
also a stop condition.

## 9. Exit criteria

```text
DEPLOYMENT_REHEARSAL=PASS
PRE_DEPLOY_BACKUP=PASS
BACKUP_CHECKSUM_CATALOG=PASS
OFF_HOST_RETRIEVAL=PASS
RESTORE_REHEARSAL=PASS
MIGRATION_STATUS=UP_TO_DATE
RUNTIME_ACL=PASS
HEALTH_READINESS_TLS=PASS
RLS_DEFAULT_DENY=PASS
SMOKE_TESTS=PASS
APPLICATION_ROLLBACK_REHEARSAL=PASS
RESTORE_DECISION_REHEARSAL=PASS
UNEXPLAINED_DATA_DELTA=0
```
