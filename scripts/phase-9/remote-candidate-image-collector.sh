#!/bin/sh

set -eu

release_sha="$1"
source_migration_count="$2"
source_migration_fingerprint="$3"

check_evidence=""

emit_result() {
  started="$1"
  status="$2"
  exit_code="$3"
  summary="$4"
  finished="$(date +%s)"
  duration_ms="$(((finished - started) * 1000))"
  encoded="$(printf '%s' "$check_evidence" | base64 | tr -d '\n')"
  printf 'P9B|CANDIDATE_IMAGES|%s|%s|%s|%s|%s\n' \
    "$status" "$duration_ms" "$exit_code" "$summary" "$encoded"
}

started="$(date +%s)"
app_image="ueb-core:$release_sha"
operator_image="ueb-core-operator:$release_sha"
if ! app_metadata="$(docker image inspect "$app_image" \
  --format '{{.Id}}|{{.Os}}/{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "io.ueb-core.migration-count"}}|{{index .Config.Labels "io.ueb-core.migration-ledger-fingerprint"}}' 2>/dev/null)"; then
  emit_result "$started" "BLOCKED" "61" "CANDIDATE_APP_IMAGE_MISSING"
  exit 61
fi
if ! operator_metadata="$(docker image inspect "$operator_image" \
  --format '{{.Id}}|{{.Os}}/{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "io.ueb-core.migration-count"}}|{{index .Config.Labels "io.ueb-core.migration-ledger-fingerprint"}}' 2>/dev/null)"; then
  emit_result "$started" "BLOCKED" "62" "CANDIDATE_OPERATOR_IMAGE_MISSING"
  exit 62
fi
check_evidence="APP=$app_metadata
OPERATOR=$operator_metadata
EXPECTED_COUNT=$source_migration_count
EXPECTED_FINGERPRINT=$source_migration_fingerprint"
emit_result "$started" "PASS" "0" "CANDIDATE_IMAGES_INSPECTED"
