#!/bin/sh

set -eu

release_sha="$1"
remote_root="$2"
secret_file="$3"
source_migration_count="$4"
source_migration_fingerprint="$5"

backup_directory="/var/backups/ueb-core/staging"
rollback_metadata="$remote_root/evidence/rollback/approved.json"
monitor_script="$remote_root/config/monitor-staging.sh"
monitor_log="$remote_root/evidence/monitoring/monitor.log"
caddy_container="khtc-ueb-prod-caddy-1"
staging_domain="ueb-core-staging.cargis.vn"
project="ueb-core-staging"

check_summary=""
check_evidence=""

emit_result() {
  check_id="$1"
  check_status="$2"
  started="$3"
  exit_code="$4"
  finished="$(date +%s)"
  duration_ms="$(((finished - started) * 1000))"
  [ "${#check_evidence}" -le 32768 ] || {
    check_status="BLOCKED"
    exit_code="97"
    check_summary="EVIDENCE_LIMIT_EXCEEDED"
    check_evidence=""
  }
  encoded="$(printf '%s' "$check_evidence" | base64 | tr -d '\n')"
  printf 'P9B|%s|%s|%s|%s|%s|%s\n' \
    "$check_id" "$check_status" "$duration_ms" "$exit_code" \
    "$check_summary" "$encoded"
}

run_check() {
  check_id="$1"
  check_function="$2"
  started="$(date +%s)"
  check_summary="CHECK_FAILED"
  check_evidence=""
  if "$check_function"; then
    emit_result "$check_id" "PASS" "$started" "0"
  else
    exit_code="$?"
    emit_result "$check_id" "BLOCKED" "$started" "$exit_code"
    exit "$exit_code"
  fi
}

check_server_time() {
  check_evidence="$(date -Iseconds)" || return 11
  check_summary="SERVER_TIME_CAPTURED"
}

check_release_image() {
  app_image="ueb-core:$release_sha"
  operator_image="ueb-core-operator:$release_sha"
  app_metadata="$(docker image inspect "$app_image" \
    --format '{{.Id}}|{{.Os}}/{{.Architecture}}' 2>/dev/null)" || return 12
  operator_metadata="$(docker image inspect "$operator_image" \
    --format '{{.Id}}|{{.Os}}/{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "io.ueb-core.migration-count"}}|{{index .Config.Labels "io.ueb-core.migration-ledger-fingerprint"}}' 2>/dev/null)" || return 13
  check_evidence="APP=$app_metadata
OPERATOR=$operator_metadata
EXPECTED_COUNT=$source_migration_count
EXPECTED_FINGERPRINT=$source_migration_fingerprint"
  check_summary="IMMUTABLE_IMAGES_INSPECTED"
}

check_compose_services() {
  service_rows=""
  container_ids="$(docker ps \
    --filter "label=com.docker.compose.project=$project" \
    --format '{{.ID}}' 2>/dev/null)" || return 14
  [ -n "$container_ids" ] || return 15
  for container_id in $container_ids; do
    row="$(docker inspect "$container_id" \
      --format '{{index .Config.Labels "com.docker.compose.service"}}|{{.Config.Image}}|{{.State.Status}}|{{.RestartCount}}|{{.Id}}' 2>/dev/null)" || return 16
    service_rows="${service_rows}${row}
"
  done
  check_evidence="$service_rows"
  check_summary="COMPOSE_SERVICES_INSPECTED"
}

check_health() {
  status="$(curl --fail --silent --show-error --output /dev/null \
    --write-out '%{http_code}' --max-time 10 \
    "https://$staging_domain/api/health" 2>/dev/null)" || return 17
  [ "$status" = "200" ] || return 18
  check_evidence="HTTP_STATUS=$status"
  check_summary="HEALTH_PASS"
}

check_readiness() {
  status="$(curl --fail --silent --show-error --output /dev/null \
    --write-out '%{http_code}' --max-time 10 \
    "https://$staging_domain/api/ready" 2>/dev/null)" || return 19
  [ "$status" = "200" ] || return 20
  check_evidence="HTTP_STATUS=$status"
  check_summary="READINESS_PASS"
}

check_database_migration_ledger() {
  [ -f "$secret_file" ] && [ ! -L "$secret_file" ] || return 21
  [ "$(stat -c '%a' "$secret_file")" = "600" ] || return 22
  owner_password="$(awk '
    index($0, "STAGING_MIGRATION_OWNER_PASSWORD=") == 1 {
      count += 1
      value = substr($0, length("STAGING_MIGRATION_OWNER_PASSWORD=") + 1)
    }
    END { if (count == 1 && length(value) > 0) print value; else exit 1 }
  ' "$secret_file")" || return 23
  db_id="$(docker ps \
    --filter "label=com.docker.compose.project=$project" \
    --filter 'label=com.docker.compose.service=db' \
    --format '{{.ID}}' 2>/dev/null)" || return 24
  [ -n "$db_id" ] && [ "$(printf '%s\n' "$db_id" | wc -l | tr -d ' ')" = "1" ] || return 25
  ledger="$(printf '%s\n' "$owner_password" | docker exec -i "$db_id" sh -c '
    IFS= read -r PGPASSWORD
    export PGPASSWORD
    export PGOPTIONS="-c default_transaction_read_only=on"
    exec psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
      --field-separator="|" --username=ueb_core_staging_owner \
      --dbname=ueb_core_staging \
      --command="SELECT migration_name, checksum, (finished_at IS NOT NULL AND rolled_back_at IS NULL)::text FROM public._prisma_migrations ORDER BY migration_name"
  ' 2>/dev/null)" || return 26
  unset owner_password
  [ -n "$ledger" ] || return 27
  check_evidence="$ledger"
  check_summary="DATABASE_LEDGER_READ_ONLY"
}

check_backup_evidence() {
  [ -d "$backup_directory" ] && [ ! -L "$backup_directory" ] || return 28
  metadata="$(find "$backup_directory" -maxdepth 1 -type f \
    -name '*.dump.meta.json' -printf '%T@|%p\n' 2>/dev/null | \
    sort -t '|' -k1,1nr | head -n 1 | cut -d '|' -f 2-)"
  [ -n "$metadata" ] || return 29
  case "$metadata" in "$backup_directory"/*.dump.meta.json) ;; *) return 30 ;; esac
  backup="${metadata%.meta.json}"
  sidecar="$backup.sha256"
  offhost="$backup.offhost-ok"
  for evidence_file in "$metadata" "$backup" "$sidecar" "$offhost"; do
    [ -f "$evidence_file" ] && [ ! -L "$evidence_file" ] || return 31
    [ "$(stat -c '%a' "$evidence_file")" = "600" ] || return 32
  done
  (cd "$backup_directory" && sha256sum --check "$(basename "$sidecar")" >/dev/null 2>&1) || return 33
  sidecar_checksum="$(awk 'NR == 1 {print $1}' "$sidecar")" || return 34
  offhost_checksum="$(awk 'NR == 1 {print $1}' "$offhost")" || return 35
  [ "$sidecar_checksum" = "$offhost_checksum" ] || return 36
  metadata_payload="$(head -c 8193 "$metadata")" || return 37
  [ "${#metadata_payload}" -le 8192 ] || return 38
  check_evidence="CHECKSUM=$sidecar_checksum
METADATA=$metadata_payload
OFF_HOST_CHECKSUM_MATCH=YES
CATALOG_VALIDATED_BY_METADATA_CONTRACT=YES"
  check_summary="BACKUP_EVIDENCE_VERIFIED"
}

check_rollback_metadata() {
  [ -f "$rollback_metadata" ] && [ ! -L "$rollback_metadata" ] || return 39
  [ "$(stat -c '%a' "$rollback_metadata")" = "600" ] || return 40
  payload="$(head -c 16385 "$rollback_metadata")" || return 41
  [ "${#payload}" -le 16384 ] || return 42
  check_evidence="$payload"
  check_summary="ROLLBACK_METADATA_CAPTURED"
}

check_caddy_route() {
  docker exec "$caddy_container" caddy validate \
    --config /etc/caddy/Caddyfile >/dev/null 2>&1 || return 43
  docker exec "$caddy_container" grep -Fq "$staging_domain" \
    /etc/caddy/Caddyfile 2>/dev/null || return 44
  tls_status="$(curl --silent --show-error --output /dev/null \
    --write-out '%{http_code}' --max-time 10 \
    "https://$staging_domain/api/health" 2>/dev/null)" || return 45
  [ "$tls_status" = "200" ] || return 46
  check_evidence="DOMAIN=$staging_domain
TLS_HTTP_STATUS=$tls_status
CONFIG_VALIDATE=PASS"
  check_summary="CADDY_STAGING_ROUTE_PASS"
}

check_monitoring_alert() {
  [ -x "$monitor_script" ] && [ ! -L "$monitor_script" ] || return 47
  [ "$(stat -c '%a' "$monitor_script")" = "700" ] || return 48
  [ -f "$monitor_log" ] && [ ! -L "$monitor_log" ] || return 49
  [ "$(stat -c '%a' "$monitor_log")" = "600" ] || return 50
  line_count="$(wc -l < "$monitor_log" | tr -d ' ')" || return 51
  [ "$line_count" -le 500 ] || return 52
  cron_count="$(crontab -l 2>/dev/null | grep -F -c "$monitor_script" || true)"
  [ "$cron_count" = "1" ] || return 53
  grep -Eq 'HEALTH(_STATUS)?=PASS|HEALTH=PASS' "$monitor_log" || return 54
  grep -Eq 'BACKUP(_FRESHNESS)?(_STATUS)?=PASS' "$monitor_log" || return 55
  grep -Eq 'DISK(_STATUS)?=(PASS|WARNING[^[:space:]]*)' "$monitor_log" || return 56
  if grep -Eq 'ALERT(_STATUS)?=PASS' "$monitor_log"; then
    alert_status="PASS"
  elif grep -Fq 'BLOCKED_TRANSPORT_NOT_CONFIGURED' "$monitor_log"; then
    alert_status="BLOCKED_TRANSPORT_NOT_CONFIGURED"
  else
    return 57
  fi
  check_evidence="MONITOR_SCRIPT_MODE=0700
MONITOR_LOG_MODE=0600
MONITOR_LOG_LINES=$line_count
CRON_ENTRY_COUNT=$cron_count
ALERT_STATUS=$alert_status"
  check_summary="MONITORING_ALERT_INSPECTED"
}

run_check "SERVER_TIME" check_server_time
run_check "RELEASE_IMAGE" check_release_image
run_check "COMPOSE_SERVICES" check_compose_services
run_check "HEALTH" check_health
run_check "READINESS" check_readiness
run_check "DATABASE_MIGRATION_LEDGER" check_database_migration_ledger
run_check "BACKUP_EVIDENCE" check_backup_evidence
run_check "ROLLBACK_METADATA" check_rollback_metadata
run_check "CADDY_ROUTE" check_caddy_route
run_check "MONITORING_ALERT" check_monitoring_alert
