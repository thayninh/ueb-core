#!/usr/bin/env bash

set -u
set -o pipefail

# Audit output may contain infrastructure details. New files are private by default.
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
REQUESTED_OUTPUT="${1:-${REPO_ROOT}/infra/audit/ueb-core-server-audit-${TIMESTAMP}.txt}"
OUTPUT_DIR="$(dirname -- "${REQUESTED_OUTPUT}")"
OUTPUT_NAME="$(basename -- "${REQUESTED_OUTPUT}")"

if ! mkdir -p -- "${OUTPUT_DIR}"; then
  printf '[FATAL] Cannot create output directory: %s\n' "${OUTPUT_DIR}" >&2
  exit 2
fi

if ! OUTPUT_DIR_ABS="$(cd -- "${OUTPUT_DIR}" && pwd -P)"; then
  printf '[FATAL] Cannot resolve output directory: %s\n' "${OUTPUT_DIR}" >&2
  exit 2
fi

OUTPUT_FILE="${OUTPUT_DIR_ABS}/${OUTPUT_NAME}"

if [[ -e "${OUTPUT_FILE}" ]]; then
  printf '[FATAL] Refusing to overwrite existing audit file: %s\n' "${OUTPUT_FILE}" >&2
  exit 2
fi

if ! (set -o noclobber; : > "${OUTPUT_FILE}") 2>/dev/null; then
  printf '[FATAL] Cannot create audit file: %s\n' "${OUTPUT_FILE}" >&2
  exit 2
fi

GROUP_SUCCESS=0
GROUP_FAILED=0

log() {
  printf '%s\n' "$*" | tee -a "${OUTPUT_FILE}"
}

blank_line() {
  printf '\n' | tee -a "${OUTPUT_FILE}"
}

heading() {
  blank_line
  log "================================================================================"
  log "$1"
  log "================================================================================"
}

subheading() {
  blank_line
  log "--- $1 ---"
}

run_cmd() {
  local label="$1"
  shift
  local -a pipeline_status
  local command_status
  local tee_status

  subheading "${label}"
  "$@" 2>&1 | tee -a "${OUTPUT_FILE}"
  pipeline_status=("${PIPESTATUS[@]}")
  command_status="${pipeline_status[0]:-1}"
  tee_status="${pipeline_status[1]:-1}"

  if ((command_status != 0)); then
    log "[ERROR] ${label} failed or was not permitted (exit ${command_status}); continuing."
    return 1
  fi
  if ((tee_status != 0)); then
    log "[ERROR] Could not append ${label} output to the audit file; continuing."
    return 1
  fi
  return 0
}

run_available() {
  local label="$1"
  shift
  local command_name="$1"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    subheading "${label}"
    log "[ERROR] Required command is unavailable: ${command_name}; continuing."
    return 1
  fi
  run_cmd "${label}" "$@"
}

run_group() {
  local title="$1"
  local function_name="$2"

  heading "${title}"
  if "${function_name}"; then
    GROUP_SUCCESS=$((GROUP_SUCCESS + 1))
    log "[GROUP STATUS] Completed successfully: ${title}"
  else
    GROUP_FAILED=$((GROUP_FAILED + 1))
    log "[GROUP STATUS] Not fully completed: ${title}"
  fi
}

group_host_time() {
  local rc=0

  run_available "Current date and time" date || rc=1
  run_available "Time synchronization status" timedatectl || rc=1
  run_available "Host identity" hostnamectl || rc=1
  run_available "Kernel and architecture" uname -a || rc=1
  run_cmd "Operating-system release" cat /etc/os-release || rc=1
  run_available "System uptime" uptime || rc=1

  return "${rc}"
}

group_compute_storage() {
  local rc=0

  run_available "Logical CPU count" nproc || rc=1
  if command -v lscpu >/dev/null 2>&1; then
    run_cmd "General CPU information (CPU flags excluded)" \
      bash -o pipefail -c \
      'LC_ALL=C lscpu | awk -F: '\''/^(Architecture|CPU\(s\)|On-line CPU\(s\) list|Vendor ID|Model name|Thread\(s\) per core|Core\(s\) per socket|Socket\(s\)|NUMA node\(s\)|Virtualization|Hypervisor vendor|CPU max MHz|CPU min MHz):/ {gsub(/^[[:space:]]+/, "", $2); print $1 ": " $2}'\'' ' || rc=1
  else
    subheading "General CPU information (CPU flags excluded)"
    log "[ERROR] Required command is unavailable: lscpu; continuing."
    rc=1
  fi
  run_available "Memory usage" free -h || rc=1
  run_available "Filesystem usage" df -hT || rc=1
  run_available "Block devices and filesystems" lsblk -f || rc=1

  return "${rc}"
}

group_ports_firewall() {
  local rc=0
  local port

  run_available "Listening TCP/UDP sockets" ss -lntup || rc=1

  if command -v ufw >/dev/null 2>&1; then
    run_cmd "UFW status" ufw status verbose || rc=1
  else
    subheading "UFW status"
    log "[INFO] UFW is not installed; this optional check was skipped."
  fi

  if command -v ss >/dev/null 2>&1; then
    for port in 80 443 3200 5432; do
      run_cmd "Listener holding port ${port}" ss -lntup "sport = :${port}" || rc=1
    done
  else
    subheading "Selected port ownership"
    log "[ERROR] Required command is unavailable: ss; continuing."
    rc=1
  fi

  return "${rc}"
}

group_docker() {
  local rc=0

  if ! command -v docker >/dev/null 2>&1; then
    log "[ERROR] Required command is unavailable: docker; Docker checks were skipped."
    return 1
  fi

  run_cmd "Docker version" docker version || rc=1
  run_cmd "Docker Compose version" docker compose version || rc=1
  run_cmd "Docker general information (selected safe fields)" docker info --format \
    $'Server version: {{.ServerVersion}}\nContainers: {{.Containers}}\nRunning: {{.ContainersRunning}}\nPaused: {{.ContainersPaused}}\nStopped: {{.ContainersStopped}}\nImages: {{.Images}}\nStorage driver: {{.Driver}}\nCgroup driver: {{.CgroupDriver}}\nCPUs: {{.NCPU}}\nMemory bytes: {{.MemTotal}}\nOperating system: {{.OperatingSystem}}\nOS type: {{.OSType}}\nArchitecture: {{.Architecture}}' || rc=1
  run_cmd "Running containers (name, image, status, published ports)" docker ps \
    --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' || rc=1
  run_cmd "All containers (name, image, status, published ports)" docker ps -a \
    --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' || rc=1
  run_cmd "Docker Compose projects" docker compose ls || rc=1
  run_cmd "Docker networks" docker network ls || rc=1
  run_cmd "Docker volumes" docker volume ls || rc=1
  run_cmd "Docker disk usage" docker system df || rc=1
  run_cmd "Docker one-shot statistics" docker stats --no-stream \
    --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}' || rc=1

  return "${rc}"
}

group_compose_files() {
  run_cmd "Compose file paths under /opt, /srv, and /home (content is not read)" \
    find /opt /srv /home -maxdepth 6 -type f \
    \( -name compose.yml -o -name compose.yaml -o -name docker-compose.yml -o -name docker-compose.yaml \) \
    -print
}

service_state() {
  local service_name="$1"
  local output
  local rc

  subheading "Service state: ${service_name}"
  if ! command -v systemctl >/dev/null 2>&1; then
    log "[ERROR] Required command is unavailable: systemctl; continuing."
    return 1
  fi

  output="$(systemctl is-active "${service_name}" 2>&1)"
  rc=$?
  printf '%s\n' "${output}" | tee -a "${OUTPUT_FILE}"
  case "${rc}" in
    0 | 3 | 4)
      return 0
      ;;
    *)
      log "[ERROR] Could not determine ${service_name} state (exit ${rc}); continuing."
      return 1
      ;;
  esac
}

group_reverse_proxy() {
  local rc=0

  service_state nginx || rc=1
  service_state apache2 || rc=1
  service_state caddy || rc=1

  if command -v docker >/dev/null 2>&1; then
    run_cmd "Traefik containers (name, image, status, published ports)" \
      bash -o pipefail -c \
      'docker ps --format '\''{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'\'' | awk '\''BEGIN {IGNORECASE=1} /traefik/ {print}'\''' || rc=1
  else
    subheading "Traefik containers"
    log "[ERROR] Docker is unavailable, so the Traefik container check could not run."
    rc=1
  fi

  if command -v nginx >/dev/null 2>&1; then
    run_cmd "Nginx configuration syntax test" nginx -t || rc=1
    run_cmd "Nginx enabled configuration file paths" \
      find /etc/nginx/sites-enabled /etc/nginx/conf.d -maxdepth 1 \
      \( -type f -o -type l \) -print || rc=1
    run_cmd "Nginx server_name and listen directives only" \
      grep -RnHE '^[[:space:]]*(server_name|listen)[[:space:]]' \
      /etc/nginx/sites-enabled /etc/nginx/conf.d || rc=1
  else
    subheading "Nginx detail checks"
    log "[INFO] Nginx executable is not installed; detail checks were skipped."
  fi

  return "${rc}"
}

group_postgresql() {
  local rc=0
  local listing
  local docker_rc
  local found=0
  local name
  local image
  local status
  local ports
  local searchable

  if ! command -v docker >/dev/null 2>&1; then
    log "[ERROR] Docker is unavailable; PostgreSQL container checks were skipped."
    return 1
  fi

  listing="$(docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>&1)"
  docker_rc=$?
  if ((docker_rc != 0)); then
    log "[ERROR] Could not list containers (exit ${docker_rc}); details were not printed."
    return 1
  fi

  subheading "PostgreSQL/PostGIS containers"
  while IFS='|' read -r name image status ports; do
    [[ -z "${name}" ]] && continue
    searchable="${name,,} ${image,,}"
    if [[ "${searchable}" != *postgres* && "${searchable}" != *postgis* ]]; then
      continue
    fi

    found=1
    log "Name: ${name}"
    log "Image: ${image}"
    log "Status: ${status}"
    log "Published ports: ${ports:-none}"

    run_cmd "${name}: mount type and container destination only" docker inspect --format \
      '{{range .Mounts}}{{printf "%s -> %s\n" .Type .Destination}}{{end}}' "${name}" || rc=1
    run_cmd "${name}: connected Docker network names" docker inspect --format \
      '{{range $network, $config := .NetworkSettings.Networks}}{{println $network}}{{end}}' "${name}" || rc=1

    if [[ "${status}" == Up* ]]; then
      run_cmd "${name}: pg_isready without credentials" docker exec "${name}" pg_isready || rc=1
    else
      log "[INFO] ${name} is not running; pg_isready was skipped."
    fi
    blank_line
  done <<< "${listing}"

  if ((found == 0)); then
    log "[INFO] No container name or image matched postgres/postgis."
  fi

  return "${rc}"
}

check_root_crontab() {
  local content
  local rc
  local line
  local lower_line
  local line_number=0
  local found=0
  local tool
  local -a tools=(pg_dump pg_dumpall pg_restore restic borg rclone)

  subheading "Root crontab backup-command indicators"
  if ! command -v crontab >/dev/null 2>&1; then
    log "[ERROR] Required command is unavailable: crontab; continuing."
    return 1
  fi

  content="$(crontab -l -u root 2>&1)"
  rc=$?
  if ((rc != 0)); then
    log "[ERROR] Root crontab was unavailable or not permitted (exit ${rc}); no contents were printed."
    return 1
  fi

  while IFS= read -r line; do
    line_number=$((line_number + 1))
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    lower_line="${line,,}"
    for tool in "${tools[@]}"; do
      if [[ "${lower_line}" == *"${tool}"* ]]; then
        log "Root crontab line ${line_number}: contains ${tool} (command content suppressed)."
        found=1
      fi
    done
  done <<< "${content}"

  if ((found == 0)); then
    log "[INFO] No requested backup-command indicators were found in root crontab."
  fi
  return 0
}

group_backup() {
  local rc=0
  local backup_pattern='pg_dump|pg_dumpall|pg_restore|restic|borg|rclone'

  if command -v systemctl >/dev/null 2>&1; then
    run_cmd "Systemd timers related to backup/PostgreSQL" \
      bash -o pipefail -c \
      'systemctl list-timers --all --no-pager | awk '\''BEGIN {IGNORECASE=1} NR == 1 || /backup|postgres|pg_dump/ {print}'\''' || rc=1
  else
    subheading "Systemd timers related to backup/PostgreSQL"
    log "[ERROR] Required command is unavailable: systemctl; continuing."
    rc=1
  fi

  check_root_crontab || rc=1

  run_cmd "Cron file paths containing approved backup-command names (contents suppressed)" \
    find /etc/cron.d /etc/cron.daily /etc/cron.weekly -maxdepth 2 -type f \
    -exec grep -IlE "${backup_pattern}" '{}' + || rc=1

  return "${rc}"
}

group_basic_security() {
  local rc=0

  if command -v ss >/dev/null 2>&1; then
    run_cmd "SSH listening sockets" \
      bash -o pipefail -c \
      'ss -lntp | awk '\''NR == 1 || tolower($0) ~ /sshd/ {print} END {print "[INFO] If no sshd row is visible, elevated privileges may be required to identify the process."}'\''' || rc=1
    run_cmd "PostgreSQL port 5432 exposure" \
      bash -o pipefail -c \
      'ss -lnt | awk '\''NR == 1 {print; next} $4 ~ /:5432$/ {scope="specific interface"; if ($4 ~ /^(0\.0\.0\.0|\[::\]|\*):5432$/) scope="all interfaces"; print "[" scope "] " $0; found=1} END {if (!found) print "[INFO] No TCP listener found on port 5432."}'\''' || rc=1
    run_cmd "Listening application bind scope" \
      bash -o pipefail -c \
      'ss -lntp | awk '\''NR == 1 {print "SCOPE\t" $0; next} {scope="specific-interface"; if ($4 ~ /^(127\.0\.0\.1|\[::1\]):/) scope="loopback"; else if ($4 ~ /^(0\.0\.0\.0|\[::\]|\*):/) scope="all-interfaces"; print scope "\t" $0}'\''' || rc=1
  else
    log "[ERROR] Required command is unavailable: ss; socket security checks were skipped."
    rc=1
  fi

  if command -v docker >/dev/null 2>&1; then
    run_cmd "PostgreSQL/PostGIS container published-port exposure" \
      bash -o pipefail -c \
      'docker ps -a --format '\''{{.Names}}|{{.Image}}|{{.Ports}}'\'' | awk -F"|" '\''BEGIN {IGNORECASE=1} /postgres|postgis/ {scope="not published on all interfaces"; if ($3 ~ /0\.0\.0\.0:|\[::\]:/) scope="published on all interfaces"; print "[" scope "] name=" $1 " image=" $2 " ports=" $3}'\''' || rc=1
  else
    subheading "PostgreSQL/PostGIS container published-port exposure"
    log "[ERROR] Docker is unavailable; container port exposure could not be checked."
    rc=1
  fi

  if [[ -e /var/run/docker.sock ]]; then
    run_cmd "Docker socket permissions" stat -c '%A %a %U %G %n' /var/run/docker.sock || rc=1
  else
    subheading "Docker socket permissions"
    log "[INFO] /var/run/docker.sock does not exist."
  fi

  run_cmd "Audit output directory permissions" stat -c '%A %a %U %G %n' "${OUTPUT_DIR_ABS}" || rc=1
  run_cmd "Audit output file permissions" stat -c '%A %a %U %G %n' "${OUTPUT_FILE}" || rc=1

  return "${rc}"
}

heading "UEB Core — Read-only server inventory"
log "Started at: $(date --iso-8601=seconds 2>/dev/null || date)"
log "This script collects metadata only and does not remediate detected issues."
log "It does not read container environment variables, .env files, Compose contents, credentials, or private keys."
log "Output file: ${OUTPUT_FILE}"

run_group "A. Time and host" group_host_time
run_group "B. CPU, memory, and storage" group_compute_storage
run_group "C. Ports and firewall" group_ports_firewall
run_group "D. Docker" group_docker
run_group "E. Docker Compose file paths" group_compose_files
run_group "F. Reverse proxy" group_reverse_proxy
run_group "G. PostgreSQL" group_postgresql
run_group "H. Backup" group_backup
run_group "I. Basic security" group_basic_security

heading "Inventory summary"
log "Result file: ${OUTPUT_FILE}"
log "Successful check groups: ${GROUP_SUCCESS}"
log "Check groups unavailable or incomplete: ${GROUP_FAILED}"
log "WARNING: Do not add this audit file to Git or share it publicly until it has been reviewed and redacted."

exit 0
