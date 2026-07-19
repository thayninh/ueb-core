#!/bin/sh

set -eu

source_directory="/mnt/ueb-core-secrets"
target_directory="/run/ueb-core-secrets"
operator_user="operator"
stage_requested="${UEB_CORE_STAGE_PHASE7_SECRETS:-0}"

fail() {
  printf '%s\n' \
    "OPERATOR_SECRET_STAGING=BLOCKED" \
    "ERROR_CODE=$1" \
    "SECRET_LEAKAGE=0" \
    "DATABASE_CONNECTIONS=0" \
    "DATABASE_MUTATIONS=0" >&2
  exit 2
}

require_mount_option() {
  options="$1"
  required="$2"
  case ",$options," in
    *",$required,"*) ;;
    *) fail "OPERATOR_SECRET_MOUNT_OPTION_REQUIRED" ;;
  esac
}

if [ "$stage_requested" != "0" ] && [ "$stage_requested" != "1" ]; then
  fail "OPERATOR_SECRET_STAGING_FLAG_INVALID"
fi

if [ "$stage_requested" = "0" ] && [ -n "${PHASE7_SECURE_DIRECTORY:-}" ]; then
  fail "OPERATOR_DIRECT_SECRET_DIRECTORY_FORBIDDEN"
fi

if [ "$stage_requested" = "1" ]; then
  [ "$(id -u)" = "0" ] || fail "OPERATOR_SECRET_INIT_ROOT_REQUIRED"
  [ -d "$source_directory" ] || fail "OPERATOR_SECRET_SOURCE_MISSING"
  [ ! -L "$source_directory" ] || fail "OPERATOR_SECRET_SOURCE_SYMLINK_FORBIDDEN"
  [ "$(stat -c '%a' "$source_directory")" = "700" ] ||
    fail "OPERATOR_SECRET_SOURCE_DIRECTORY_MODE_INVALID"

  source_options="$(findmnt -n -o OPTIONS --target "$source_directory")"
  require_mount_option "$source_options" "ro"

  [ -d "$target_directory" ] || fail "OPERATOR_SECRET_TMPFS_MISSING"
  [ "$(findmnt -n -o FSTYPE --target "$target_directory")" = "tmpfs" ] ||
    fail "OPERATOR_SECRET_TMPFS_REQUIRED"
  target_options="$(findmnt -n -o OPTIONS --target "$target_directory")"
  require_mount_option "$target_options" "rw"
  require_mount_option "$target_options" "nosuid"
  require_mount_option "$target_options" "nodev"
  require_mount_option "$target_options" "noexec"
  [ "$(find "$target_directory" -mindepth 1 -maxdepth 1 | wc -l)" = "0" ] ||
    fail "OPERATOR_SECRET_TMPFS_NOT_EMPTY"

  set -- \
    "CSDLCore_chuan_hoa_PostgreSQL.xlsx" \
    "lecturer-exceptions.json" \
    "faculty-leaders.json" \
    "test-identities.json" \
    "production-target-state.json" \
    "phase7-secrets.env" \
    -- "$@"

  allowlisted_count=0
  while [ "$1" != "--" ]; do
    file_name="$1"
    source_file="$source_directory/$file_name"
    target_file="$target_directory/$file_name"
    [ -f "$source_file" ] || fail "OPERATOR_SECRET_ALLOWLIST_FILE_MISSING"
    [ ! -L "$source_file" ] || fail "OPERATOR_SECRET_FILE_SYMLINK_FORBIDDEN"
    [ "$(stat -c '%a' "$source_file")" = "600" ] ||
      fail "OPERATOR_SECRET_FILE_MODE_INVALID"
    [ "$(stat -c '%h' "$source_file")" = "1" ] ||
      fail "OPERATOR_SECRET_FILE_HARDLINK_FORBIDDEN"
    install -o "$operator_user" -g "$operator_user" -m 0400 \
      "$source_file" "$target_file"
    allowlisted_count=$((allowlisted_count + 1))
    shift
  done
  shift

  [ "$(find "$source_directory" -mindepth 1 -maxdepth 1 | wc -l)" = "$allowlisted_count" ] ||
    fail "OPERATOR_SECRET_SOURCE_CONTAINS_UNEXPECTED_ENTRY"

  operator_uid="$(id -u "$operator_user")"
  operator_gid="$(id -g "$operator_user")"
  for target_file in "$target_directory"/*; do
    [ -f "$target_file" ] || fail "OPERATOR_SECRET_TMPFS_COPY_INVALID"
    [ ! -L "$target_file" ] || fail "OPERATOR_SECRET_TMPFS_SYMLINK_FORBIDDEN"
    [ "$(stat -c '%a' "$target_file")" = "400" ] ||
      fail "OPERATOR_SECRET_TMPFS_MODE_INVALID"
    [ "$(stat -c '%u' "$target_file")" = "$operator_uid" ] ||
      fail "OPERATOR_SECRET_TMPFS_OWNER_INVALID"
    [ "$(stat -c '%g' "$target_file")" = "$operator_gid" ] ||
      fail "OPERATOR_SECRET_TMPFS_GROUP_INVALID"
  done

  chown "$operator_user:$operator_user" "$target_directory"
  chmod 0500 "$target_directory"
  [ "$(stat -c '%a' "$target_directory")" = "500" ] ||
    fail "OPERATOR_SECRET_TMPFS_DIRECTORY_MODE_INVALID"
  [ "$(stat -c '%u' "$target_directory")" = "$operator_uid" ] ||
    fail "OPERATOR_SECRET_TMPFS_DIRECTORY_OWNER_INVALID"

  export PHASE7_SECURE_DIRECTORY="$target_directory"
  printf '%s\n' \
    "OPERATOR_SECRET_STAGING=PASS" \
    "OPERATOR_SECRET_FILE_COUNT=$allowlisted_count" \
    "OPERATOR_SECRET_FILE_MODE=0400" \
    "PROVISIONING_RUNTIME_USER=$operator_user" \
    "SECRET_LEAKAGE=0"
fi

exec gosu "$operator_user" "$@"
