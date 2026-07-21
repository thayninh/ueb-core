# Phase 6 staging environment contract

## 1. Environment identity

```text
ENVIRONMENT=STAGING
PLANNED_DOMAIN=ueb-core-staging.cargis.vn
DATABASE=<APPROVED_DEDICATED_STAGING_DATABASE>
DATABASE_PUBLIC_PORT=NO
APP_PUBLIC_HOST_PORT=NO
REVERSE_PROXY=CADDY
```

Staging là environment độc lập. Không dùng `ueb_core_uat_phase5`, UAT named
volume, UAT credential, UAT session hoặc UAT identity bundle làm staging.

## 2. Component contract

| Component | Contract |
| --- | --- |
| Application | Approved immutable standalone image, user `node`, read-only root filesystem, tmpfs cho temporary/cache paths |
| PostgreSQL | Dedicated pinned image/volume, private database network only, không publish `5432` |
| Caddy | TLS termination cho `ueb-core-staging.cargis.vn`, private upstream, forwarded headers/security headers/request limit |
| Operator workspace | Node 24.x, restricted access, owner/provisioning secrets injected in memory |
| Secret store | External, encrypted, audited; không nằm trong repository hoặc Compose output |
| Evidence store | External restricted store cho raw logs/dumps/catalog; Git chỉ nhận redacted summaries |

Phase 6 không thay đổi `compose.staging.yaml`, `.env.staging.example` hoặc Caddy
example trong planning turn này. Mọi discovered implementation delta cần change
riêng, review và full quality gates trước deployment authorization.

## 3. Database role contract

| Role | Allowed use | Required properties | Forbidden |
| --- | --- | --- | --- |
| Migration owner | Migration, guarded backup/restore, ACL reconciliation | Own staging DB/schema; operator-only | App requests, runtime login, provisioning campaign |
| Application runtime | App `DATABASE_URL` only | Distinct, non-owner, non-superuser, `NOBYPASSRLS`, exact runtime ACL | Migration, role creation, broad grants, provisioning |
| Provisioning role | Approved small staging batch only | Distinct, non-owner, non-superuser, `NOBYPASSRLS`, exact provisioning ACL | App container, migration, mass provisioning |

Runtime target tables giữ exact `SELECT/INSERT` contract; helper auth/RBAC tables
chỉ `SELECT` khi RLS helper cần. Không cấp broad write vào helper tables và không
cấp sequence `SELECT/UPDATE` ngoài approved contract.

## 4. Environment-variable boundaries

App container chỉ được nhận:

```text
NODE_ENV
DATABASE_URL
BETTER_AUTH_URL
BETTER_AUTH_SECRET
AUTH_TRUSTED_ORIGINS
AUDIT_HMAC_SECRET
```

App container không được nhận:

```text
MIGRATION_DATABASE_URL
POSTGRES_PASSWORD
APP_DATABASE_PASSWORD
PHASE5_PROVISIONING_DATABASE_URL
PHASE5_PROVISIONING_PASSWORD
```

Migration, runtime-role/ACL và provisioning jobs là các operator executions riêng.
Không render full Compose environment vào shared logs.

## 5. Network and TLS contract

- PostgreSQL chỉ nối internal database network.
- App nối database network và external Caddy proxy network; app không publish
  host port.
- Caddy là public ingress duy nhất; upstream là private service alias.
- TLS phải hợp lệ cho `ueb-core-staging.cargis.vn`, redirect/HTTPS policy và expiry
  monitoring được xác minh trước acceptance.
- Caddy giữ trusted `Host`/forwarded context, không tin arbitrary client-supplied
  forwarded headers khi có upstream proxy khác.
- `/api/health` và `/api/ready` đi qua cùng TLS path của người dùng và không cache.

## 6. Image, resource and filesystem contract

- Image được pin bằng immutable digest liên kết source commit đã phê duyệt.
- Không build trên staging host trong rollout; dùng `--no-build`.
- App và DB có CPU/memory/PID limits, restart policy và rotated logs.
- App chạy non-root, `cap_drop: ALL`, `no-new-privileges`, read-only filesystem và
  bounded tmpfs.
- DB dùng named staging volume riêng; UAT/canonical volume không được mount.

## 7. Data lifecycle contract

- Pre-deploy backup custom format bắt buộc cho staging database hiện hữu.
- Backup có SHA-256 sidecar, catalog validation và encrypted off-host copy.
- Restore chỉ vào new guarded target; không overwrite active staging DB.
- Sequence verification không gọi `nextval()`.
- Cleanup chỉ bằng guarded procedure có exact target/marker/confirmation; không
  cleanup UAT trong Phase 6 planning hoặc trước plan approval.
- Core/workflow history append-only; không dùng destructive cleanup.

## 8. Identity contract

- Chỉ staging-only smoke identities được phê duyệt rõ ràng.
- Không mass-provision real users, không suy luận email/lecturer/unit/leader scope.
- Không reuse UAT temporary password hoặc credential file.
- Production SSO và production provisioning ngoài phạm vi.

## 9. Static acceptance contract

```text
OWNER_RUNTIME_SEPARATION=REQUIRED
OWNER_PROVISIONING_SEPARATION=REQUIRED
RUNTIME_NOBYPASSRLS=REQUIRED
PROVISIONING_NOBYPASSRLS=REQUIRED
APP_MIGRATION_CREDENTIAL=FORBIDDEN
APP_PROVISIONING_CREDENTIAL=FORBIDDEN
POSTGRES_PUBLIC_PORT=FORBIDDEN
UAT_DATABASE_REUSE=FORBIDDEN
UAT_CREDENTIAL_REUSE=FORBIDDEN
```
