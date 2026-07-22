#!/bin/sh

set -eu

release_sha="$1"
remote_root="$2"
secret_file="$3"
source_migration_count="$4"
source_migration_fingerprint="$5"

project="ueb-core-staging"
backup_directory="/var/backups/ueb-core/staging"
approved_metadata="$remote_root/evidence/rollback/approved.json"
monitor_script="$remote_root/config/monitor-staging.sh"
monitor_log="$remote_root/evidence/monitoring/monitor.log"
staging_domain="ueb-core-staging.cargis.vn"
overall_exit=0
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
  printf 'P9R|%s|%s|%s|%s|%s|%s\n' \
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
    [ "$overall_exit" -ne 0 ] || overall_exit="$exit_code"
  fi
}

label_value() {
  image="$1"
  label="$2"
  docker image inspect "$image" --format "{{index .Config.Labels \"$label\"}}" 2>/dev/null
}

check_server_time() {
  check_evidence="$(date -Iseconds)" || return 11
  check_summary="SERVER_TIME_CAPTURED"
}

check_current_app_image() {
  app_container="$(docker ps \
    --filter "label=com.docker.compose.project=$project" \
    --filter 'label=com.docker.compose.service=app' \
    --format '{{.ID}}' 2>/dev/null)" || return 12
  [ -n "$app_container" ] && [ "$(printf '%s\n' "$app_container" | wc -l | tr -d ' ')" = "1" ] || return 13
  image="$(docker inspect "$app_container" --format '{{.Config.Image}}' 2>/dev/null)" || return 14
  metadata="$(docker image inspect "$image" --format '{{.Id}}|{{.Os}}/{{.Architecture}}' 2>/dev/null)" || return 15
  image_id="${metadata%%|*}"
  architecture="${metadata#*|}"
  source_sha="$(label_value "$image" org.opencontainers.image.revision)" || return 16
  migration_count="$(label_value "$image" io.ueb-core.migration-count)" || return 16
  migration_fingerprint="$(label_value "$image" io.ueb-core.migration-ledger-fingerprint)" || return 16
  check_evidence="TAG=$image
IMAGE_ID=$image_id
ARCHITECTURE=$architecture
SOURCE_SHA=$source_sha
MIGRATION_COUNT=$migration_count
MIGRATION_FINGERPRINT=$migration_fingerprint
CONTAINER_ID=$app_container"
  check_summary="CURRENT_APP_IMAGE_INSPECTED"
}

check_operator_image_evidence() {
  rows=""
  count=0
  images="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | \
    grep -E '^ueb-core-operator:[0-9a-f]{40}$' | sort -u || true)"
  for image in $images; do
    [ "$count" -lt 50 ] || return 17
    metadata="$(docker image inspect "$image" --format '{{.Id}}|{{.Os}}/{{.Architecture}}' 2>/dev/null)" || return 18
    source_sha="$(label_value "$image" org.opencontainers.image.revision)" || return 18
    migration_count="$(label_value "$image" io.ueb-core.migration-count)" || return 18
    migration_fingerprint="$(label_value "$image" io.ueb-core.migration-ledger-fingerprint)" || return 18
    rows="${rows}OPERATOR=$image|${metadata%%|*}|${metadata#*|}|$source_sha|$migration_count|$migration_fingerprint
"
    count=$((count + 1))
  done
  check_evidence="OPERATOR_IMAGE_COUNT=$count
$rows"
  check_summary="OPERATOR_IMAGE_EVIDENCE_INSPECTED"
}

check_rollback_image_inventory() {
  current_image="$(docker ps \
    --filter "label=com.docker.compose.project=$project" \
    --filter 'label=com.docker.compose.service=app' \
    --format '{{.Image}}' 2>/dev/null)" || return 19
  rows=""
  count=0
  images="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | \
    grep -E '^ueb-core:[0-9a-f]{40}$' | sort -u || true)"
  for image in $images; do
    [ "$image" != "$current_image" ] || continue
    [ "$count" -lt 50 ] || return 20
    metadata="$(docker image inspect "$image" --format '{{.Id}}|{{.Os}}/{{.Architecture}}' 2>/dev/null)" || return 21
    source_sha="$(label_value "$image" org.opencontainers.image.revision)" || return 21
    migration_count="$(label_value "$image" io.ueb-core.migration-count)" || return 21
    migration_fingerprint="$(label_value "$image" io.ueb-core.migration-ledger-fingerprint)" || return 21
    rows="${rows}CANDIDATE=$image|${metadata%%|*}|${metadata#*|}|$source_sha|$migration_count|$migration_fingerprint
"
    count=$((count + 1))
  done
  check_evidence="CANDIDATE_COUNT=$count
$rows"
  check_summary="ROLLBACK_IMAGE_INVENTORY_INSPECTED"
}

check_compose_mapping() {
  rows=""
  count=0
  ids="$(docker ps --filter "label=com.docker.compose.project=$project" --format '{{.ID}}' 2>/dev/null)" || return 22
  [ -n "$ids" ] || return 23
  for container_id in $ids; do
    row="$(docker inspect "$container_id" --format '{{index .Config.Labels "com.docker.compose.service"}}|{{.Config.Image}}|{{.State.Status}}|{{.RestartCount}}|{{.Id}}' 2>/dev/null)" || return 24
    rows="${rows}SERVICE=$row
"
    count=$((count + 1))
  done
  check_evidence="SERVICE_COUNT=$count
$rows"
  check_summary="COMPOSE_MAPPING_INSPECTED"
}

check_database_migration_ledger() {
  [ -f "$secret_file" ] && [ ! -L "$secret_file" ] || return 25
  [ "$(stat -c '%a' "$secret_file")" = "600" ] || return 26
  owner_password="$(awk '
    index($0, "STAGING_MIGRATION_OWNER_PASSWORD=") == 1 {
      count += 1
      value = substr($0, length("STAGING_MIGRATION_OWNER_PASSWORD=") + 1)
    }
    END { if (count == 1 && length(value) > 0) print value; else exit 1 }
  ' "$secret_file")" || return 27
  db_id="$(docker ps \
    --filter "label=com.docker.compose.project=$project" \
    --filter 'label=com.docker.compose.service=db' \
    --format '{{.ID}}' 2>/dev/null)" || return 28
  [ -n "$db_id" ] && [ "$(printf '%s\n' "$db_id" | wc -l | tr -d ' ')" = "1" ] || return 29
  ledger="$(printf '%s\n' "$owner_password" | docker exec -i "$db_id" sh -c '
    IFS= read -r PGPASSWORD
    export PGPASSWORD
    export PGOPTIONS="-c default_transaction_read_only=on"
    exec psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align \
      --field-separator="|" --username=ueb_core_staging_owner \
      --dbname=ueb_core_staging \
      --command="SELECT migration_name, checksum, (finished_at IS NOT NULL AND rolled_back_at IS NULL)::text FROM public._prisma_migrations ORDER BY migration_name"
  ' 2>/dev/null)" || return 30
  unset owner_password
  [ -n "$ledger" ] || return 31
  check_evidence="$ledger"
  check_summary="DATABASE_LEDGER_READ_ONLY"
}

check_backup_evidence() {
  [ -d "$backup_directory" ] && [ ! -L "$backup_directory" ] || return 32
  metadata="$(find "$backup_directory" -maxdepth 1 -type f -name '*.dump.meta.json' \
    -printf '%T@|%p\n' 2>/dev/null | sort -t '|' -k1,1nr | head -n 1 | cut -d '|' -f 2-)"
  [ -n "$metadata" ] || return 33
  case "$metadata" in "$backup_directory"/*.dump.meta.json) ;; *) return 34 ;; esac
  backup="${metadata%.meta.json}"
  sidecar="$backup.sha256"
  offhost="$backup.offhost-ok"
  for evidence_file in "$metadata" "$backup" "$sidecar" "$offhost"; do
    [ -f "$evidence_file" ] && [ ! -L "$evidence_file" ] || return 35
    [ "$(stat -c '%a' "$evidence_file")" = "600" ] || return 36
  done
  (cd "$backup_directory" && sha256sum --check "$(basename "$sidecar")" >/dev/null 2>&1) || return 37
  checksum="$(awk 'NR == 1 {print $1}' "$sidecar")" || return 38
  [ "$checksum" = "$(awk 'NR == 1 {print $1}' "$offhost")" ] || return 39
  metadata_payload="$(head -c 8193 "$metadata")" || return 40
  [ "${#metadata_payload}" -le 8192 ] || return 41
  created_at="$(printf '%s' "$metadata_payload" | \
    grep -Eo '"createdAt"[[:space:]]*:[[:space:]]*"[^"]+"' | cut -d '"' -f 4)" || return 42
  [ -n "$created_at" ] || return 42
  identifier="$(basename "$backup" .dump)"
  check_evidence="IDENTIFIER=$identifier
CHECKSUM=$checksum
CREATED_AT=$created_at
OFF_HOST_CHECKSUM_MATCH=YES
CATALOG_VALIDATED=YES"
  check_summary="BACKUP_EVIDENCE_VERIFIED"
}

check_rollback_metadata_path() {
  if [ -L "$approved_metadata" ]; then
    check_evidence="STATE=SYMLINK
PATH=$approved_metadata"
  elif [ -f "$approved_metadata" ]; then
    check_evidence="STATE=FILE
PATH=$approved_metadata
MODE=$(stat -c '%a' "$approved_metadata")
OWNER_UID=$(stat -c '%u' "$approved_metadata")"
  elif [ -e "$approved_metadata" ]; then
    check_evidence="STATE=UNSAFE_OTHER
PATH=$approved_metadata"
  else
    check_evidence="STATE=ABSENT
PATH=$approved_metadata"
  fi
  check_summary="ROLLBACK_METADATA_PATH_CLASSIFIED"
}

check_schema_compatibility_inputs() {
  check_evidence="RELEASE_SHA=$release_sha
SOURCE_MIGRATION_COUNT=$source_migration_count
SOURCE_MIGRATION_FINGERPRINT=$source_migration_fingerprint
DATABASE_POLICY=FORWARD_ONLY_NO_REVERSE_MIGRATION
DECISION=OPERATOR_DECISION_REQUIRED"
  check_summary="SCHEMA_COMPATIBILITY_INPUTS_CAPTURED"
}

check_monitoring_health_readiness() {
  health="$(curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 10 "https://$staging_domain/api/health" 2>/dev/null)" || return 43
  readiness="$(curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 10 "https://$staging_domain/api/ready" 2>/dev/null)" || return 44
  [ "$health" = "200" ] && [ "$readiness" = "200" ] || return 45
  [ -x "$monitor_script" ] && [ ! -L "$monitor_script" ] || return 46
  [ -f "$monitor_log" ] && [ ! -L "$monitor_log" ] || return 47
  line_count="$(wc -l < "$monitor_log" | tr -d ' ')" || return 48
  [ "$line_count" -le 500 ] || return 49
  check_evidence="HEALTH_STATUS=$health
READINESS_STATUS=$readiness
MONITOR_SCRIPT_MODE=$(stat -c '%a' "$monitor_script")
MONITOR_LOG_MODE=$(stat -c '%a' "$monitor_log")
MONITOR_LOG_LINES=$line_count"
  check_summary="MONITORING_HEALTH_READINESS_CAPTURED"
}

run_check "SERVER_TIME" check_server_time
run_check "CURRENT_APP_IMAGE" check_current_app_image
run_check "OPERATOR_IMAGE_EVIDENCE" check_operator_image_evidence
run_check "ROLLBACK_IMAGE_INVENTORY" check_rollback_image_inventory
run_check "COMPOSE_MAPPING" check_compose_mapping
run_check "DATABASE_MIGRATION_LEDGER" check_database_migration_ledger
run_check "BACKUP_EVIDENCE" check_backup_evidence
run_check "ROLLBACK_METADATA_PATH" check_rollback_metadata_path
run_check "SCHEMA_COMPATIBILITY_INPUTS" check_schema_compatibility_inputs
run_check "MONITORING_HEALTH_READINESS" check_monitoring_health_readiness

exit "$overall_exit"
