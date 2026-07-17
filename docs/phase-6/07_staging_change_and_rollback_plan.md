# Phase 6 staging change and rollback plan

## 1. Status and execution gate

Tài liệu này chuyển các quyết định staging đã được operator phê duyệt thành một
ordered rehearsal plan. Nó không tự authorize execution, không chứa secret và
không được dùng để bypass target guards.

```text
STAGING_AUTHORIZATION=APPROVED
RESOURCE_PROFILE_ACCEPTED=YES_CONDITIONAL_WITH_RESOURCE_LIMITS
STAGING_DEPLOYMENT=NOT_PERFORMED
SERVER_MUTATIONS=0
DATABASE_MUTATIONS=0
STAGING_GUARDED_TOOLING_READY=YES_STATIC_NOT_EXECUTED
EXECUTION_HARD_GATE=BLOCKED_PENDING_OPERATOR_INPUTS_AND_REHEARSAL
```

Phase 6 wrappers hiện có exact host/database/role guards và negative tests.
Execution chỉ được mở khi commit được phê duyệt, Node 24 operator job chạy trên
private database network, monitoring/change-window/rollback inputs PASS và
command order trong `08_staging_guarded_tooling_runbook.md` được tuân thủ. Không
dùng raw SQL hoặc Phase 5 UAT commands.

## 2. Approved topology and resource contract

| Contract | Approved value | Static compatibility |
| --- | --- | --- |
| Host/domain | `103.200.25.54`, `ueb-core.cargis.vn` | SSH/DNS discovery match |
| Deployment directory | `/opt/ueb-core` | Không trùng `/opt/khtc-ueb` |
| App image | `ueb-core:<GIT_COMMIT_SHA>` | `Dockerfile` runner dùng Node 24, non-root |
| App limit | `512m`, `0.75` CPU | Override `STAGING_APP_*` defaults |
| Database limit | `768m`, `0.75` CPU | Override `STAGING_DB_*` defaults |
| Combined memory limit | `1280 MiB` | Không vượt approved ceiling 1280 MiB |
| Database network | `ueb-core-staging-database`, internal | `compose.staging.yaml` đã định nghĩa |
| Proxy network | `ueb-core-proxy`, external | Set `CADDY_NETWORK_NAME=ueb-core-proxy` |
| App proxy alias | `ueb-core-staging-app:3000` | Khớp Caddy example và Compose alias |
| App host port | None | Staging override reset `ports` |
| Database host port | None | Staging override reset `ports` |
| Database volume | `ueb-core-staging-pgdata` | Dedicated staging name |

VPS có 3.777 GiB usable RAM, 2.2 GiB available, 3.8 GiB swap và production
containers dùng khoảng 610 MiB. Approved app + database limits tổng 1280 MiB;
không tự tăng. Observation phải alert khi app hoặc DB dùng >=85% limit trong 10
phút, có OOM hoặc readiness fail.

## 3. Change variables and preflight

Chạy trong approved operator window, Node 24.x và clean commit. Secret values chỉ
được load từ restricted files ngoài repository; không dùng `set -x` hoặc render
Compose environment.

```bash
source "$HOME/.nvm/nvm.sh"
nvm use 24
node --version

export CHANGE_REF=<APPROVED_CHANGE_REFERENCE>
export GIT_SHA="$(git rev-parse HEAD)"
export UEB_CORE_IMAGE="ueb-core:${GIT_SHA}"
export LOCAL_ARTIFACT_DIR=/Users/thayninh/Secure/ueb-core-phase6/images
export IMAGE_ARCHIVE_NAME="ueb-core-${GIT_SHA}.tar"
export REMOTE_STAGING_ENV_FILE=/opt/ueb-core/secrets/staging.env
export CADDY_NETWORK_NAME=ueb-core-proxy
export STAGING_APP_MEMORY_LIMIT=512m
export STAGING_APP_CPU_LIMIT=0.75
export STAGING_DB_MEMORY_LIMIT=768m
export STAGING_DB_CPU_LIMIT=0.75
export STAGING_MONITORING_EMAIL=<RESTRICTED_OPERATOR_VALUE>
export STAGING_CHANGE_WINDOW_START=<APPROVED_ISO_TIMESTAMP_WITH_OFFSET>
export STAGING_CHANGE_WINDOW_END=<APPROVED_ISO_TIMESTAMP_WITH_OFFSET>
export STAGING_TIMEZONE=Asia/Ho_Chi_Minh

test -n "$CHANGE_REF"
test -z "$(git status --short)"
test "$(node --version | cut -d. -f1)" = v24
test "$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" = 7
```

Stop nếu change/observation window, rollback owner, monitoring email, staging-safe
tooling evidence hoặc rollback image compatibility chưa được ghi trong external
change record.

## 4. Immutable image delivery

Build runner image local, record immutable image ID, save archive, checksum và
transfer bằng SSH alias. Không tạo hoặc dùng tag `latest`.

```bash
docker build --target runner --tag "$UEB_CORE_IMAGE" .
LOCAL_IMAGE_ID="$(docker image inspect "$UEB_CORE_IMAGE" --format '{{.Id}}')"
test -n "$LOCAL_IMAGE_ID"

mkdir -p "$LOCAL_ARTIFACT_DIR"
docker save --output "$LOCAL_ARTIFACT_DIR/$IMAGE_ARCHIVE_NAME" \
  "$UEB_CORE_IMAGE"
(
  cd "$LOCAL_ARTIFACT_DIR"
  shasum -a 256 "$IMAGE_ARCHIVE_NAME" >"${IMAGE_ARCHIVE_NAME}.sha256"
  shasum -a 256 --check "${IMAGE_ARCHIVE_NAME}.sha256"
)

scp "$LOCAL_ARTIFACT_DIR/$IMAGE_ARCHIVE_NAME" \
  "$LOCAL_ARTIFACT_DIR/${IMAGE_ARCHIVE_NAME}.sha256" \
  ueb-core-staging:/opt/ueb-core/images/

ssh -o BatchMode=yes ueb-core-staging \
  "cd /opt/ueb-core/images && sha256sum --check '${IMAGE_ARCHIVE_NAME}.sha256'"
ssh -o BatchMode=yes ueb-core-staging \
  "docker load --input '/opt/ueb-core/images/${IMAGE_ARCHIVE_NAME}'"
REMOTE_IMAGE_ID="$(ssh -o BatchMode=yes ueb-core-staging \
  "docker image inspect '${UEB_CORE_IMAGE}' --format '{{.Id}}'")"
test "$REMOTE_IMAGE_ID" = "$LOCAL_IMAGE_ID"
```

Archive/checksum ở ngoài Git. Approval evidence chỉ ghi commit, image tag, image
ID, archive SHA-256 và PASS/FAIL.

## 5. Directory, network and Compose preflight

Các command dưới đây là future mutation steps, chưa chạy trong lượt soạn plan.
Tạo directories bằng approved owner/modes, rồi kiểm tra external network trước
khi attach existing production Caddy.

```bash
ssh -t ueb-core-staging '
  sudo install -d -m 0750 -o deploy -g deploy /opt/ueb-core
  sudo install -d -m 0750 -o deploy -g deploy /opt/ueb-core/images
  sudo install -d -m 0750 -o deploy -g deploy /opt/ueb-core/change
  sudo install -d -m 0700 -o deploy -g deploy /opt/ueb-core/secrets
  sudo install -d -m 0750 -o deploy -g deploy /var/backups/ueb-core/staging
'

scp compose.yaml compose.staging.yaml \
  ueb-core-staging:/opt/ueb-core/
scp infra/caddy/Caddyfile.ueb-core.example \
  ueb-core-staging:/opt/ueb-core/change/Caddyfile.ueb-core

LOCAL_SITE_SHA="$(shasum -a 256 infra/caddy/Caddyfile.ueb-core.example | \
  awk '{print $1}')"
REMOTE_SITE_SHA="$(ssh -o BatchMode=yes ueb-core-staging \
  "sha256sum /opt/ueb-core/change/Caddyfile.ueb-core" | awk '{print $1}')"
test "$REMOTE_SITE_SHA" = "$LOCAL_SITE_SHA"

ssh -o BatchMode=yes ueb-core-staging '
  docker network inspect ueb-core-proxy >/dev/null 2>&1 ||
    docker network create --driver bridge ueb-core-proxy

  docker network inspect ueb-core-proxy \
    --format "{{range .Containers}}{{println .Name}}{{end}}" |
    grep -Fx khtc-ueb-prod-caddy-1 >/dev/null ||
    docker network connect ueb-core-proxy khtc-ueb-prod-caddy-1
'
```

Secure env phải đặt ít nhất các approved non-secret values sau cùng secret
references/values cần thiết:

```text
POSTGRES_DB=ueb_core_staging
POSTGRES_USER=ueb_core_staging_owner
APP_DATABASE_USER=ueb_core_staging_app
UEB_CORE_IMAGE=ueb-core:<GIT_COMMIT_SHA>
CADDY_NETWORK_NAME=ueb-core-proxy
STAGING_DB_VOLUME_NAME=ueb-core-staging-pgdata
STAGING_APP_MEMORY_LIMIT=512m
STAGING_APP_CPU_LIMIT=0.75
STAGING_DB_MEMORY_LIMIT=768m
STAGING_DB_CPU_LIMIT=0.75
```

Validate mà không render values:

```bash
ssh -o BatchMode=yes ueb-core-staging '
  cd /opt/ueb-core
  docker compose \
    --env-file /opt/ueb-core/secrets/staging.env \
    -f compose.yaml \
    -f compose.staging.yaml \
    config --quiet
'
```

Require app networks `database` + external `ueb-core-proxy`, database chỉ có
internal `database`, và cả app/database có zero published host ports.

## 6. Guarded database bootstrap sequence

### 6.1 New database decision

Với first deployment, PostgreSQL image có thể tạo owner
`ueb_core_staging_owner` và database `ueb_core_staging` trên dedicated new volume
từ `POSTGRES_USER`/`POSTGRES_DB`. Trước khi start DB, guard phải chứng minh exact
volume chưa tồn tại và không có existing staging target. Nếu target/volume tồn
tại, chuyển sang pre-deploy backup path; không reinitialize hoặc overwrite.

`phase6:bootstrap-staging-database` hiện từ chối existing/ambiguous target và chỉ
chấp nhận exact target với explicit confirmation. Không dùng `createdb`, `psql`
raw SQL hoặc UAT bootstrap tool. Compose DB start dưới đây vẫn là future
authorized infrastructure step trước khi operator job kết nối private endpoint:

```bash
cd /opt/ueb-core
docker compose \
  --env-file /opt/ueb-core/secrets/staging.env \
  -f compose.yaml \
  -f compose.staging.yaml \
  up -d db
```

PostgreSQL entrypoint then creates only the approved owner/database on the new
dedicated volume; this command must not run for an existing or ambiguous target.

### 6.2 Ordered guarded operator jobs

1. Deployment/rollback preflight PASS từ immutable local artifact.
2. Nếu database đã tồn tại, guarded backup/verify/off-host evidence PASS.
3. Nếu database chưa tồn tại, guarded bootstrap tự chạy đúng 7 migrations.
4. Guarded role bootstrap tạo/reconcile `ueb_core_staging_app` và
   `ueb_core_staging_provisioner` qua distinct authorized role-admin URL.
5. Guarded runtime/provisioning ACL reconciliation PASS.
6. Read-only security verifier và metadata-only fingerprint PASS:

   ```text
   MIGRATION_COUNT=7
   OWNER_RUNTIME_PROVISIONER_DISTINCT=YES
   RUNTIME_NON_OWNER=YES
   RUNTIME_NON_SUPERUSER=YES
   RUNTIME_NOBYPASSRLS=YES
   PROVISIONING_NON_OWNER=YES
   PROVISIONING_NON_SUPERUSER=YES
   PROVISIONING_NOBYPASSRLS=YES
   DATABASE_PUBLIC_PORT=NO
   RUNTIME_CORE_VISIBLE_ROWS_WITHOUT_CONTEXT=0
   RUNTIME_WORKFLOW_VISIBLE_ROWS_WITHOUT_CONTEXT=0
   DATABASE_WRITES=0
   RLS_DEFAULT_DENY=PASS
   ```

Exact commands/confirmations nằm trong runbook 08. `phase5:*` commands tiếp tục
reject staging; raw SQL không phải substitute được phê duyệt.

## 7. Backup and off-host copy

Nếu staging DB đã tồn tại, guarded pre-deploy job phải tạo custom-format dump
trước migration. Nếu DB mới, capture `INITIAL_DATABASE_STATE=ABSENT`, volume
identity và bootstrap evidence, rồi tạo first verified backup ngay sau migration
and role verification.

Required artifact contract:

```text
BACKUP_DIRECTORY=/var/backups/ueb-core/staging
BACKUP_FORMAT=CUSTOM
BACKUP_CHECKSUM=SHA256
BACKUP_CATALOG_VALID=YES
LOCAL_RETENTION=14_DAILY_8_WEEKLY
OFF_HOST_DESTINATION=/Users/thayninh/Secure/ueb-core-phase6/off-host-backups
RPO=24_HOURS
RTO=4_HOURS
```

Sau khi `phase6:backup-staging` và `phase6:verify-staging-backup` PASS:

```bash
ssh -o BatchMode=yes ueb-core-staging \
  "pg_restore --list '$BACKUP_PATH' >/dev/null && \
   cd '$(dirname "$BACKUP_PATH")' && \
   sha256sum --check '$(basename "${BACKUP_PATH}.sha256")'"

mkdir -p /Users/thayninh/Secure/ueb-core-phase6/off-host-backups
scp "ueb-core-staging:${BACKUP_PATH}" \
  "ueb-core-staging:${BACKUP_PATH}.sha256" \
  /Users/thayninh/Secure/ueb-core-phase6/off-host-backups/

cd /Users/thayninh/Secure/ueb-core-phase6/off-host-backups
shasum -a 256 --check "$(basename "${BACKUP_PATH}.sha256")"
pg_restore --list "$(basename "$BACKUP_PATH")" >/dev/null
```

Retention job phải có exact directory prefix, minimum-age, dry-run và bảo vệ
latest verified backup. Không chạy cleanup cho đến khi negative tests PASS.

## 8. Caddy add-only change

Approved source site block là `infra/caddy/Caddyfile.ueb-core.example`; upstream
phải giữ `ueb-core-staging-app:3000`. Transfer snippet tới
`/opt/ueb-core/change/Caddyfile.ueb-core` và verify exact checksum trước edit.
Các command mutate Caddy dưới đây chạy trong interactive session
`ssh -t ueb-core-staging` sau checksum verification.

```bash
export CADDY_CONTAINER=khtc-ueb-prod-caddy-1
export CADDYFILE=/opt/khtc-ueb/repo/infra/caddy/Caddyfile
export SITE_SNIPPET=/opt/ueb-core/change/Caddyfile.ueb-core
export CADDY_BACKUP="${CADDYFILE}.phase6.$(date -u +%Y%m%dT%H%M%SZ).bak"

sudo grep -nF 'ueb-core.cargis.vn' "$CADDYFILE" && exit 1 || true
sudo cp --preserve=mode,ownership,timestamps "$CADDYFILE" "$CADDY_BACKUP"
sudo sh -c 'printf "\n" >>"$1"; cat "$2" >>"$1"' \
  sh "$CADDYFILE" "$SITE_SNIPPET"

docker exec "$CADDY_CONTAINER" \
  caddy validate --config /etc/caddy/Caddyfile
docker exec "$CADDY_CONTAINER" \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Không restart container. Sau reload, require exact domain match, successful TLS
certificate issuance, `/api/health` and `/api/ready` HTTP 200. Nếu validate,
reload hoặc TLS fail, restore ngay từ exact backup:

```bash
sudo cp --preserve=mode,ownership,timestamps "$CADDY_BACKUP" "$CADDYFILE"
docker exec "$CADDY_CONTAINER" \
  caddy validate --config /etc/caddy/Caddyfile
docker exec "$CADDY_CONTAINER" \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

## 9. Application start and technical validation

Chỉ start app sau DB bootstrap/migrations/ACL/security/backup gates PASS:

```bash
ssh -o BatchMode=yes ueb-core-staging '
  cd /opt/ueb-core
  docker compose \
    --env-file /opt/ueb-core/secrets/staging.env \
    -f compose.yaml \
    -f compose.staging.yaml \
    up -d --no-build app
  docker compose \
    --env-file /opt/ueb-core/secrets/staging.env \
    -f compose.yaml \
    -f compose.staging.yaml \
    ps
'

curl --fail --silent --show-error \
  https://ueb-core.cargis.vn/api/health >/dev/null
curl --fail --silent --show-error \
  https://ueb-core.cargis.vn/api/ready >/dev/null
```

Verify immutable image ID, health, readiness no-cache, TLS hostname, restart
count, zero public app/DB ports, resource limits and RLS default deny.

## 10. Minimal monitoring contract

Monitoring method is Docker healthcheck plus host cron curl and email alert. The
operator must fill `STAGING_MONITORING_EMAIL` in restricted host configuration before
deployment; a blank destination is a stop condition.

Các command dưới đây chạy trong restricted host monitoring script từ
`/opt/ueb-core`; email value không được ghi vào repository hoặc shared output.

```bash
cd /opt/ueb-core
export STAGING_ENV_FILE=/opt/ueb-core/secrets/staging.env
export STAGING_MONITORING_EMAIL=<OPERATOR_MUST_FILL>
test -n "$STAGING_MONITORING_EMAIL"

APP_ID="$(docker compose \
  --env-file "$STAGING_ENV_FILE" \
  -f compose.yaml -f compose.staging.yaml ps -q app)"
DB_ID="$(docker compose \
  --env-file "$STAGING_ENV_FILE" \
  -f compose.yaml -f compose.staging.yaml ps -q db)"

docker inspect "$APP_ID" \
  --format 'APP_HEALTH={{.State.Health.Status}} APP_RESTARTS={{.RestartCount}}'
docker inspect "$DB_ID" \
  --format 'DB_HEALTH={{.State.Health.Status}} DB_RESTARTS={{.RestartCount}}'
curl --fail --silent --show-error \
  https://ueb-core.cargis.vn/api/health >/dev/null
curl --fail --silent --show-error \
  https://ueb-core.cargis.vn/api/ready >/dev/null
curl --fail --silent --show-error --head \
  https://ueb-core.cargis.vn >/dev/null
df -P / /var/backups/ueb-core/staging
```

Backup freshness alert triggers nếu không có verified backup trong 26 giờ.
Cron/script installation, mail transport and recipient verification require a
separate reviewed change and redacted test alert.

## 11. Rollback order

1. Stop rollout and preserve image/container/Caddy/migration/health evidence.
2. Nếu chỉ Caddy change fail, restore exact Caddy backup, validate và reload;
   không restart production Caddy.
3. Nếu app regression và schema compatible, set previous immutable image and
   run `docker compose ... up -d --no-build app`.
4. Không reverse/edit/delete applied migration. Prefer forward fix.
5. Restore chỉ vào a new guarded staging target sau checksum/catalog/RPO/RTO
   decision; không overwrite active staging.
6. Sau app removal, disconnect existing Caddy khỏi `ueb-core-proxy` chỉ khi
   network membership evidence xác nhận không còn staging consumer:

   ```bash
   docker network disconnect ueb-core-proxy khtc-ueb-prod-caddy-1
   ```

7. Không xóa database, volume, backup, secret hoặc network trong incident
   containment. Cleanup là separate approved change.

## 12. Remaining blockers

```text
STAGING_GUARDED_DATABASE_BOOTSTRAP=IMPLEMENTED_NOT_EXECUTED
STAGING_OPERATOR_IMAGE_OR_JOB=NOT_IMPLEMENTED
STAGING_PROVISIONING_GUARD=IMPLEMENTED_NOT_EXECUTED
STAGING_BACKUP_RESTORE_GUARD=IMPLEMENTED_NOT_EXECUTED
STAGING_SECURITY_FINGERPRINT_GUARD=IMPLEMENTED_NOT_EXECUTED
MONITORING_EMAIL_DESTINATION=REQUIRED_BEFORE_DEPLOYMENT
CHANGE_AND_OBSERVATION_WINDOW=REQUIRED_BEFORE_DEPLOYMENT
ROLLBACK_IMAGE_COMPATIBILITY=REQUIRED_BEFORE_DEPLOYMENT
HARD_GATE=BLOCKED
```
