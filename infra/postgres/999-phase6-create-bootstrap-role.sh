#!/bin/sh

set -eu

if [ "${POSTGRES_DB:-}" != "postgres" ] || \
  [ "${POSTGRES_USER:-}" != "ueb_core_staging_cluster_admin" ] || \
  [ -z "${STAGING_BOOTSTRAP_PASSWORD:-}" ]; then
  echo "Phase 6 PostgreSQL bootstrap contract is invalid." >&2
  exit 1
fi

printf '%s\n%s\n' \
  "$STAGING_BOOTSTRAP_PASSWORD" \
  "$STAGING_BOOTSTRAP_PASSWORD" | \
  PGDATABASE=postgres \
  createuser \
    --username "$POSTGRES_USER" \
    --login \
    --no-superuser \
    --createdb \
    --createrole \
    --no-inherit \
    --no-replication \
    --no-bypassrls \
    --pwprompt \
    ueb_core_staging_bootstrap

unset STAGING_BOOTSTRAP_PASSWORD
