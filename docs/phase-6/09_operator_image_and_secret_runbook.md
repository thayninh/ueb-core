# Phase 6 operator image and secret runbook

## 1. Scope

Runbook này quy định local preparation và future server execution cho staging.
Nó không authorize SCP, SSH mutation hoặc deployment. Không dùng `set -x`, không
print/cat secret file, không dùng UAT credential và không tạo tag `latest`.

## 2. Exact local order

### 2.1 Generate secure files

Monitoring email phải được inject từ secure operator environment. Output phải
chưa tồn tại và nằm ngoài Git:

```bash
export STAGING_SECRET_DIRECTORY=/Users/thayninh/Secure/ueb-core-phase6/staging-secrets

pnpm phase6:generate-staging-secrets -- \
  --output-directory="$STAGING_SECRET_DIRECTORY" \
  --database-host=db \
  --database-port=5432 \
  --database-name=ueb_core_staging \
  --public-url=https://ueb-core.cargis.vn \
  --confirm-generate-staging-secrets
```

### 2.2 Validate secure files

```bash
pnpm phase6:validate-staging-secrets -- \
  --input-directory="$STAGING_SECRET_DIRECTORY"
```

Chỉ tiếp tục khi validator trả `PASS`, count và manifest SHA-256. Không ghi
monitoring email, database URLs hoặc secret values vào repository/evidence.

### 2.3 Build immutable app image

```bash
export GIT_SHA="$(git rev-parse HEAD)"
test -z "$(git status --short)"
export UEB_CORE_IMAGE="ueb-core:${GIT_SHA}"
docker build --platform linux/amd64 --target runner --tag "$UEB_CORE_IMAGE" .
```

### 2.4 Build immutable operator image

```bash
export UEB_CORE_OPERATOR_IMAGE="ueb-core-operator:${GIT_SHA}"
docker build --platform linux/amd64 --file Dockerfile.operator \
  --tag "$UEB_CORE_OPERATOR_IMAGE" .
```

Operator image contains Node 24, package-manager-pinned pnpm, `tsx`, Prisma
CLI/client, schema, exactly 7 migrations, Phase 6 scripts, PostgreSQL 18 client
and CA certificates. It runs as `operator`, exposes no port and has no app
runtime entrypoint.

### 2.5 Archive and checksum both images

```bash
export ARTIFACT_DIRECTORY="/Users/thayninh/Secure/ueb-core-phase6/images/${GIT_SHA}"
mkdir -p "$ARTIFACT_DIRECTORY"
chmod 0700 "$ARTIFACT_DIRECTORY"

docker save --output "$ARTIFACT_DIRECTORY/ueb-core-${GIT_SHA}.tar" \
  "$UEB_CORE_IMAGE"
docker save --output "$ARTIFACT_DIRECTORY/ueb-core-operator-${GIT_SHA}.tar" \
  "$UEB_CORE_OPERATOR_IMAGE"
chmod 0600 "$ARTIFACT_DIRECTORY"/*.tar
shasum -a 256 "$ARTIFACT_DIRECTORY"/*.tar
```

Sidecars và metadata manifest chỉ chứa Git SHA, tags, image IDs, architecture,
archive hashes và build timestamp; mode `0600`, ngoài repository.

### 2.6 Run deployment preflight

Chạy exact two-image command trong
`08_staging_guarded_tooling_runbook.md`. Preflight phải verify cả app/operator
archive hashes, local image IDs, clean commit, restricted secret file,
rollback evidence, monitoring và change window.

## 3. Future transfer order (not performed by this runbook)

Chỉ sau authorization riêng và preflight PASS:

1. SCP hai immutable archives, checksum/metadata và required Compose files.
2. SCP split secret files vào `/opt/ueb-core/secrets` bằng restricted modes;
   không render hoặc log values.
3. Verify remote checksums trước `docker load`.
4. Validate merged Compose without rendering environment.
5. Start dedicated database only after target/volume absence gate.
6. Run guarded operator one-off jobs in Section 4.
7. Start app with only `app-runtime.env` after migration/ACL/RLS PASS.

## 4. Future server operator execution

Operator services are profile-gated and attach only to internal `database`.
Owner, runtime and provisioner operations use separate Compose services so the
app never receives owner/provisioner connections:

- `operator-owner`: owner/bootstrap environment only; no runtime or provisioner
  `DATABASE_URL`.
- `operator-runtime`: owner URL for ACL reconciliation plus runtime
  `DATABASE_URL` from `app-runtime.env`.
- `operator-provisioner`: owner URL for ACL reconciliation plus
  `PHASE6_PROVISIONING_DATABASE_URL` from `provisioner.env`, explicitly mapped
  to its container-local `DATABASE_URL`.
- `app`: `app-runtime.env` only; never receives owner or provisioner URL.

The provisioning command does not fall back between credential classes.
Missing `DATABASE_URL`, an owner/runtime identity, a wrong database, or an
unsafe provisioner role fails before any ACL mutation.

`postgres-bootstrap.env` starts PostgreSQL with the isolated
`ueb_core_staging_cluster_admin` only for first-cluster initialization. The
tracked init hook creates `ueb_core_staging_bootstrap` as `NOSUPERUSER` with
only `CREATEDB` and `CREATEROLE`; all operator jobs use that restricted
bootstrap identity or a narrower role, never the cluster-admin credential.

```bash
docker compose \
  --env-file /opt/ueb-core/secrets/postgres-bootstrap.env \
  --env-file /opt/ueb-core/secrets/database-owner.env \
  --env-file /opt/ueb-core/secrets/app-runtime.env \
  --env-file /opt/ueb-core/secrets/provisioner.env \
  -f compose.yaml \
  -f compose.staging.yaml \
  -f compose.staging.operator.yaml \
  --profile operator run --rm operator-owner \
  pnpm phase6:bootstrap-staging-database -- \
  --expected-database=ueb_core_staging \
  --confirm-create-staging-database
```

Run the provisioning ACL job with the same split owner/provisioner inputs;
Compose performs the explicit mapping without copying or rendering the secret
value:

```bash
docker compose \
  --env-file /opt/ueb-core/secrets/postgres-bootstrap.env \
  --env-file /opt/ueb-core/secrets/database-owner.env \
  --env-file /opt/ueb-core/secrets/provisioner.env \
  -f compose.yaml \
  -f compose.staging.yaml \
  -f compose.staging.operator.yaml \
  --profile operator run --rm operator-provisioner
```

Continue in the exact database command order in
`08_staging_guarded_tooling_runbook.md`: bootstrap roles, reconcile runtime and
provisioner ACLs, verify RLS/security, fingerprint, backup/checksum/off-host
evidence, restore rehearsal and explicit cleanup. Operator root filesystem stays
read-only with `/tmp` tmpfs; backup output is the only writable bind mount.

Restore database creation trên PostgreSQL 18 chạy bằng restricted role-admin và
guarded temporary `SET ROLE` helper; operator image không dùng superuser và
không giữ owner membership. Owner verification và revoke verification phải PASS
trước `pg_restore`. Failure giữ target/lock để investigation, không auto-drop.
Nếu target absent nhưng lock còn lại, chỉ chạy
`phase6:clear-stale-staging-restore-lock` với exact target/backup/confirmation;
command phải chứng minh không có target hoặc active restore process trước khi
xóa lock. Source staging fingerprint trước/sau phải bất biến.

## 5. Hard stops

Stop on any Git/image/checksum mismatch, secret validation failure, UAT
reference, role collision, unexpected existing target, non-private database
endpoint, migration count other than 7, ACL/RLS failure or production service
health failure. Secret is never baked into either image and is never printed.
