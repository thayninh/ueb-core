#!/usr/bin/env bash

set -uo pipefail

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077

readonly DEFAULT_CONFIG_FILE="/opt/ueb-core/config/monitor-production.env"
readonly STAGING_BACKUP_DIRECTORY="/var/backups/ueb-core/staging"
readonly EVIDENCE_DIRECTORY="/opt/ueb-core/evidence/monitoring"
readonly MONITORING_ENV_FILE="/opt/ueb-core/secrets/monitoring.env"
readonly LOG_FILE="${EVIDENCE_DIRECTORY}/monitor.log"
readonly ALERT_LATCH="${EVIDENCE_DIRECTORY}/email-alert-active"
readonly EMAIL_SCRIPT="/opt/ueb-core/config/send-monitor-alert.sh"
readonly MAX_BACKUP_AGE_SECONDS=86400
readonly DISK_WARNING_PERCENT=70
readonly DISK_HIGH_PERCENT=85
readonly MIN_MEMORY_AVAILABLE_KB=262144
readonly MAX_LOG_LINES=500

monitor_environment=""
monitor_backup_directory=""

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

file_mtime() {
  stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1"
}

record() {
  printf '%s %s\n' "$(date --iso-8601=seconds)" "$1" >>"${LOG_FILE}"
}

load_monitor_config() {
  local config_file="${1:-${DEFAULT_CONFIG_FILE}}"
  local key value
  local seen_environment=0
  local seen_directory=0

  [[ -f "${config_file}" && ! -L "${config_file}" ]] || return 1
  [[ "$(file_mode "${config_file}")" == "600" ]] || return 1

  while IFS='=' read -r key value || [[ -n "${key}${value}" ]]; do
    [[ -z "${key}${value}" || "${key}" == \#* ]] && continue
    case "${key}" in
      MONITOR_ENVIRONMENT)
        ((seen_environment == 0)) || return 1
        monitor_environment="${value}"
        seen_environment=1
        ;;
      MONITOR_BACKUP_DIRECTORY)
        ((seen_directory == 0)) || return 1
        monitor_backup_directory="${value}"
        seen_directory=1
        ;;
      *) return 1 ;;
    esac
  done <"${config_file}"

  ((seen_environment == 1 && seen_directory == 1))
}

validate_backup_directory() {
  local environment="$1"
  local directory="$2"
  local resolved

  [[ "${environment}" == "production" || "${environment}" == "staging" ]] || return 1
  [[ "${directory}" == /* && "${directory}" != *$'\n'* ]] || return 1
  [[ "/${directory#/}" != *"/../"* && "${directory}" != */.. && "${directory}" != *"/./"* ]] || return 1
  [[ -d "${directory}" && ! -L "${directory}" ]] || return 1
  resolved="$(realpath "${directory}")" || return 1
  [[ "${resolved}" == "${directory%/}" ]] || return 1

  if [[ "${environment}" == "production" ]]; then
    [[ "${directory%/}" != "${STAGING_BACKUP_DIRECTORY}" ]] || return 1
  else
    [[ "${directory%/}" == "${STAGING_BACKUP_DIRECTORY}" ]] || return 1
  fi
}

verified_backup_age_seconds() {
  local directory="$1"
  local now_seconds="${2:-$(date +%s)}"
  local dump sidecar modified newest_modified=-1 newest_dump=""
  local -a dumps

  shopt -s nullglob
  dumps=("${directory}"/*.dump)
  shopt -u nullglob
  for dump in "${dumps[@]}"; do
    [[ -n "${dump}" && -f "${dump}" && ! -L "${dump}" ]] || continue
    sidecar="${dump}.sha256"
    [[ -f "${sidecar}" && ! -L "${sidecar}" ]] || continue
    if (cd "${directory}" && sha256sum --check --status "$(basename "${sidecar}")"); then
      modified="$(file_mtime "${dump}")" || return 1
      if ((modified > newest_modified)); then
        newest_modified="${modified}"
        newest_dump="${dump}"
      fi
    fi
  done

  if [[ -n "${newest_dump}" ]]; then
    printf '%s\n' "$((now_seconds - newest_modified))"
    return 0
  fi

  return 1
}

classify_disk_usage() {
  local percent="$1"
  [[ "${percent}" =~ ^[0-9]+$ && "${percent}" -le 100 ]] || return 1
  if ((percent >= DISK_HIGH_PERCENT)); then
    printf 'HIGH\n'
  elif ((percent >= DISK_WARNING_PERCENT)); then
    printf 'WARNING\n'
  else
    printf 'PASS\n'
  fi
}

container_health_passes() {
  local container="$1"
  [[ "$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}' "${container}" 2>/dev/null)" =~ ^running\|(healthy|none)\|0$ ]]
}

http_status_is_200() {
  [[ "$(curl --silent --show-error --location --max-time 10 --output /dev/null --write-out '%{http_code}' "$1" 2>/dev/null)" == "200" ]]
}

email_transport_is_configured() {
  [[ -f "${MONITORING_ENV_FILE}" && ! -L "${MONITORING_ENV_FILE}" ]] || return 1
  [[ "$(file_mode "${MONITORING_ENV_FILE}")" == "600" ]] || return 1
  grep -Eq '^STAGING_MONITORING_EMAIL=[^[:space:]]+@[^[:space:]]+$' "${MONITORING_ENV_FILE}"
}

bound_log() {
  local temporary
  [[ -f "${LOG_FILE}" ]] || return 0
  temporary="${LOG_FILE}.tmp"
  tail -n "${MAX_LOG_LINES}" "${LOG_FILE}" >"${temporary}"
  chmod 600 "${temporary}"
  mv "${temporary}" "${LOG_FILE}"
}

main() {
  local config_file="${MONITOR_CONFIG_FILE:-${DEFAULT_CONFIG_FILE}}"
  local overall=0
  local backup_age disk_percent disk_status memory_available

  mkdir -p "${EVIDENCE_DIRECTORY}"
  chmod 700 "${EVIDENCE_DIRECTORY}"
  touch "${LOG_FILE}"
  chmod 600 "${LOG_FILE}"
  record "MONITOR_RUN=START"

  if load_monitor_config "${config_file}" && validate_backup_directory "${monitor_environment}" "${monitor_backup_directory}"; then
    record "MONITOR_CONFIG=PASS ENVIRONMENT=${monitor_environment}"
  else
    record "MONITOR_CONFIG=FAIL"
    overall=1
  fi

  for container in ueb-core-production-app ueb-core-staging-app-1 ueb-core-staging-db-1 khtc-ueb-prod-caddy-1; do
    if container_health_passes "${container}"; then
      record "CONTAINER_HEALTH=PASS CONTAINER=${container}"
    else
      record "CONTAINER_HEALTH=FAIL CONTAINER=${container}"
      overall=1
    fi
  done

  for url in \
    https://ueb-core.cargis.vn/api/health \
    https://ueb-core.cargis.vn/api/ready \
    https://ueb-core-staging.cargis.vn/api/health \
    https://ueb-core-staging.cargis.vn/api/ready; do
    if http_status_is_200 "${url}"; then
      record "HTTP_PROBE=PASS TARGET=${url}"
    else
      record "HTTP_PROBE=FAIL TARGET=${url}"
      overall=1
    fi
  done

  disk_percent="$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  disk_status="$(classify_disk_usage "${disk_percent}")" || disk_status="HIGH"
  record "DISK_STATUS=${disk_status} USED_PERCENT=${disk_percent}"
  [[ "${disk_status}" != "HIGH" ]] || overall=1

  memory_available="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
  if [[ "${memory_available}" =~ ^[0-9]+$ ]] && ((memory_available >= MIN_MEMORY_AVAILABLE_KB)); then
    record "MEMORY_AVAILABLE=PASS AVAILABLE_KB=${memory_available}"
  else
    record "MEMORY_AVAILABLE=FAIL"
    overall=1
  fi

  if ((overall == 0)) || [[ -n "${monitor_backup_directory}" ]]; then
    if backup_age="$(verified_backup_age_seconds "${monitor_backup_directory}")" && ((backup_age >= 0 && backup_age <= MAX_BACKUP_AGE_SECONDS)); then
      record "BACKUP_FRESHNESS=PASS VERIFIED_CHECKSUM=YES AGE_SECONDS=${backup_age}"
    else
      record "BACKUP_FRESHNESS=FAIL"
      overall=1
    fi
  fi

  if email_transport_is_configured; then
    record "EMAIL_ALERT_CONFIGURATION=PASS"
  else
    record "EMAIL_ALERT_CONFIGURATION=FAIL"
    overall=1
  fi

  if ((overall == 0)); then
    rm -f "${ALERT_LATCH}"
    record "MONITORING_LOCAL_CHECKS=PASS"
  elif [[ -f "${ALERT_LATCH}" ]]; then
    record "EMAIL_ALERT=DUPLICATE_SUPPRESSED"
    record "MONITORING_LOCAL_CHECKS=FAIL"
  elif [[ -x "${EMAIL_SCRIPT}" ]] && "${EMAIL_SCRIPT}" "UEB Core production monitoring incident" "A production monitoring gate failed. Review restricted host evidence." >/dev/null 2>&1; then
    touch "${ALERT_LATCH}"
    chmod 600 "${ALERT_LATCH}"
    record "EMAIL_ALERT=SENT"
    record "MONITORING_LOCAL_CHECKS=FAIL"
  else
    record "EMAIL_ALERT=FAILED"
    record "MONITORING_LOCAL_CHECKS=FAIL"
  fi

  bound_log
  return "${overall}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
