# Phase 5 staging deployment runbook

## 1. Scope and status

This runbook defines the controlled staging deployment contract for UEB Core.
It does not authorize or perform a staging or production deployment.

```text
STAGING_CONFIGURATION=DEFINED
STAGING_DEPLOYMENT=NOT_PERFORMED
PRODUCTION_DEPLOYMENT=NOT_AUTHORIZED
PUBLIC_DATABASE_PORT=NO
APP_OWNER_CREDENTIAL=NO
APP_PROVISIONING_CREDENTIAL=NO
```

The approved application artifact must be the standalone production image from
`Dockerfile`. The app runs as `node`, has no host port, and is reachable only
from the shared reverse-proxy network. PostgreSQL is attached only to the
internal database network and has no published host port.

Caddy preserves `Host`, manages the standard `X-Forwarded-For`,
`X-Forwarded-Host` and `X-Forwarded-Proto` headers through its default trusted
proxy behavior, and adds `X-Real-IP` for the upstream. If another proxy is
placed before Caddy, its address ranges must be explicitly approved/configured
as trusted proxies; do not trust arbitrary client-provided forwarded headers.

## 2. Entry gates and role separation

Stop before deployment unless all of the following are approved and recorded:

- target host, staging database name and change window;
- immutable application image digest and source commit;
- owner, runtime and provisioning roles are three distinct identities;
- runtime is non-owner, non-superuser and `NOBYPASSRLS`;
- secrets come from the approved secret store, not Git or a command transcript;
- pre-deploy backup destination, off-host copy and retention owner;
- guarded staging backup, security verifier and fingerprint commands;
- RPO/RTO, monitoring destination and escalation owner;
- external Caddy network and TLS/DNS readiness.

The current `phase5:backup`, restore and controlled-provisioning guards accept
local acceptance/UAT targets only. They must not be pointed at staging or
bypassed with manual `createdb`, `pg_restore` or role changes. Before the first
real staging deployment, an approved staging-safe wrapper with equivalent
negative tests and redacted output is mandatory.

| Context | Allowed database credential | Forbidden credential |
| --- | --- | --- |
| App container | Dedicated runtime `DATABASE_URL` | Owner, migration, provisioning |
| Migration job | `MIGRATION_DATABASE_URL` owner | Runtime substitution |
| Runtime-role/ACL job | Owner plus runtime role name/password | Provisioning URL |
| Provisioning job | Dedicated provisioning URL and approved actor | App runtime, owner bypass |
| Backup/restore job | Owner through guarded operator job | App runtime |

## 3. Configuration preflight

Use a secure environment file outside the repository. Never print the rendered
Compose environment.

```bash
export STAGING_ENV_FILE=<ABSOLUTE_SECURE_STAGING_ENV_PATH>

docker compose \
  --env-file "$STAGING_ENV_FILE" \
  -f compose.yaml \
  -f compose.staging.yaml \
  config --quiet
```

Inspect only service/environment key names. The rendered `app` service must
contain exactly `NODE_ENV`, `DATABASE_URL`, `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET`, `AUTH_TRUSTED_ORIGINS` and `AUDIT_HMAC_SECRET`. It must not
contain `MIGRATION_DATABASE_URL`, `POSTGRES_PASSWORD`, `APP_DATABASE_PASSWORD`,
`PHASE5_PROVISIONING_DATABASE_URL` or any provisioning password.

## 4. Ordered deployment procedure

### Step 1 — Verify commit and immutable image

```bash
git status --short
git rev-parse HEAD
docker image inspect "$UEB_CORE_IMAGE" --format '{{.Id}}'
```

The working tree must be clean and the image ID must equal the approved digest.
A mutable tag alone is insufficient evidence.

### Step 2 — Create a pre-deploy backup

Run only the approved staging backup operator job, using owner credentials and
custom format. The output contract is:

```text
TARGET_DATABASE=<APPROVED_STAGING_DATABASE>
BACKUP_FORMAT=CUSTOM
BACKUP_STATUS=PASS
DATABASE_WRITES=0
```

Do not reuse `pnpm phase5:backup` against staging: its guard is intentionally
restricted to local `127.0.0.1:55432/ueb_core`.

### Step 3 — Verify checksum and catalog

The backup and sidecar stay outside Git and the Docker build context.

```bash
shasum -a 256 "$BACKUP_PATH"
test -f "$BACKUP_PATH.sha256"
pg_restore --list "$BACKUP_PATH" >/dev/null
```

The calculated and approved SHA-256 values must match. Never commit or print the
catalog because object names may be sensitive. Copy the verified artifact to an
approved encrypted off-host location before migration.

### Step 4 — Deploy migrations with the owner credential

Run from the approved operator workspace with Node 24.x:

```bash
MIGRATION_DATABASE_URL="<SECURE_STAGING_OWNER_URL_IN_MEMORY>" \
pnpm exec prisma migrate deploy
```

Stop on any failed, modified or unexpected migration. Never edit or delete an
applied migration and never use the app runtime role for migration.

### Step 5 — Bootstrap/reconcile runtime role and ACL

```bash
MIGRATION_DATABASE_URL="<SECURE_STAGING_OWNER_URL_IN_MEMORY>" \
APP_DATABASE_USER="<STAGING_RUNTIME_ROLE>" \
APP_DATABASE_PASSWORD="<SECURE_RUNTIME_PASSWORD_IN_MEMORY>" \
pnpm db:bootstrap-runtime-role

MIGRATION_DATABASE_URL="<SECURE_STAGING_OWNER_URL_IN_MEMORY>" \
APP_DATABASE_USER="<STAGING_RUNTIME_ROLE>" \
pnpm phase4:grant-runtime-permissions -- \
  --confirm-runtime-grants \
  --expected-database=<APPROVED_STAGING_DATABASE>
```

Require `PERMISSION_RECONCILIATION=PASS`, runtime non-owner/non-superuser/
`NOBYPASSRLS`, target tables `SELECT/INSERT` only, helper tables `SELECT` only,
and no sequence `SELECT/UPDATE`.

Provisioning role bootstrap, grants and apply are separate change-controlled
jobs. They are not part of app startup and their variables must not enter the
app container. Current Phase 5 provisioning commands are UAT-only; staging use
is blocked until an equivalent guarded staging implementation is approved.

### Step 6 — Start the application with runtime credentials only

For an existing healthy database, start/update the app after Steps 1–5. For a
new staging stack, database creation itself requires a separately approved
bootstrap change before Step 2.

```bash
docker compose \
  --env-file "$STAGING_ENV_FILE" \
  -f compose.yaml \
  -f compose.staging.yaml \
  up -d --no-build app
```

Confirm the image is immutable, the app user is non-root, its filesystem is
read-only, and neither app nor database publishes a host port.

### Step 7 — Health

```bash
curl --fail --silent --show-error \
  https://ueb-core-staging.cargis.vn/api/health >/dev/null
```

Require HTTP 200. Health proves the process responds; it does not prove database
readiness.

### Step 8 — Readiness

```bash
curl --fail --silent --show-error \
  https://ueb-core-staging.cargis.vn/api/ready >/dev/null
```

Require HTTP 200 and verify the response is not cached. A 503 blocks rollout.

### Step 9 — Migration status

```bash
MIGRATION_DATABASE_URL="<SECURE_STAGING_OWNER_URL_IN_MEMORY>" \
pnpm exec prisma migrate status
```

Require zero failed and zero pending migrations.

### Step 10 — RLS default deny

Run the approved guarded staging security verifier with the runtime role and no
`app.current_user_id`. It must be a read-only transaction and report:

```text
RUNTIME_IS_OWNER=NO
RUNTIME_IS_SUPERUSER=NO
RUNTIME_BYPASSRLS=NO
RUNTIME_CORE_VISIBLE_ROWS=0
RUNTIME_WORKFLOW_VISIBLE_ROWS=0
DATABASE_WRITES=0
RLS_DEFAULT_DENY=PASS
```

`phase5:verify-uat-baseline` is not a staging verifier and must not be used to
evade its UAT target guard. Missing staging verifier is a deployment stop.

### Step 11 — Anonymous and authenticated smoke tests

- `/api/health` and `/api/ready` return 200 through TLS.
- Anonymous protected-route access redirects or safe-denies.
- Login uses an approved staging-only account; no production credential.
- Logout revokes the session and emits sanitized audit evidence.
- No core/workflow count changes occur during read-only smoke tests.

### Step 12 — Admin/latest-data smoke test

With an approved staging `ADMIN` account, verify `/admin/data`, `/admin/users`
and `/admin/audit`. Latest-data count/semantics must match the staging baseline,
all 20 core fields must render, and `/admin/data` must expose no workflow
mutation controls.

### Step 13 — Pilot role/scope smoke test

Use staging-only identities and approved mappings. Verify a lecturer sees only
their latest rows, a leader sees only assigned unit scope, pure admin cannot
submit as lecturer, IDOR safe-denies, and the test creates no workflow/core
mutation. Do not mass-provision or infer identities/scopes.

### Step 14 — Canonical and staging fingerprint evidence

Capture the canonical read-only fingerprint with the guarded canonical command
and the staging fingerprint with the approved staging-safe verifier. Evidence
contains only digest, aggregate counts, commit and image digest.

```bash
pnpm phase5:fingerprint-database -- \
  --expected-database=ueb_core
```

The canonical fingerprint must remain unchanged. The staging before/after
fingerprints must change only by approved migrations or changes. A missing or
unexplained delta blocks acceptance.

## 5. Final acceptance and stop conditions

Stop and invoke the rollback runbook for any checksum mismatch, migration
failure, unexpected schema drift, public database/app port, prohibited app
environment key, TLS failure, readiness failure, RLS visibility, role/ACL
drift, smoke-test authorization failure, unexplained fingerprint delta, secret
exposure, blocker/high defect or missing off-host backup.

Staging acceptance evidence must record all 14 steps as `PASS`, with no secret,
PII, raw catalog, database URL or unredacted log committed to Git.
