# Phase 5 staging rollback runbook

## 1. Safety contract

Rollback is a separately authorized operational change. It does not authorize
production access, migration deletion, destructive cleanup or restoration over
an existing database.

- Roll back the application image only when the previous image is compatible
  with the already-applied schema.
- Never edit, remove or mark an applied migration as reverted to force startup.
- Never `UPDATE`, `DELETE` or `TRUNCATE` core/workflow rows for cleanup.
- Prefer a forward fix when schema/data compatibility is known.
- Restore only into a new, explicitly guarded target after checksum/catalog
  verification and an approved recovery decision.
- Preserve audit, session, app, database, proxy, migration, backup and
  fingerprint evidence before any recovery action.

## 2. Immediate containment

1. Declare the incident/change reference and severity.
2. Stop user traffic at Caddy or stop only the app service; keep PostgreSQL and
   evidence intact.
3. Record the failing image ID, commit, container state, health/readiness,
   migration status and sanitized log window.
4. Capture a read-only staging fingerprint if the database is reachable.
5. Confirm the canonical database fingerprint is unchanged.
6. Do not retry a migration, provisioning batch or workflow action blindly.

```bash
docker compose \
  --env-file "$STAGING_ENV_FILE" \
  -f compose.yaml \
  -f compose.staging.yaml \
  stop app
```

## 3. Decision matrix

| Condition | Approved path | Forbidden path |
| --- | --- | --- |
| App regression; schema backward-compatible | Previous immutable app image | Database cleanup |
| Migration applied; app fix available | Forward-fix image/migration | Delete or rewrite migration |
| Partial/failed migration | Stop, preserve evidence, DBA review | Blind rerun or manual status edit |
| Data integrity failure | Incident decision: forward repair or new-target restore | In-place destructive correction |
| Credential exposure | Rotate affected credential, revoke sessions, rebuild | Continue using exposed secret |
| RLS/ACL failure | Stop app, reconcile through approved owner job, reverify | Grant broad rights or bypass RLS |

## 4. Application image rollback

This path is allowed only after an explicit compatibility check against current
migration status.

```bash
export UEB_CORE_IMAGE=<PREVIOUS_APPROVED_IMMUTABLE_IMAGE_DIGEST>

docker compose \
  --env-file "$STAGING_ENV_FILE" \
  -f compose.yaml \
  -f compose.staging.yaml \
  up -d --no-build app
```

Then repeat health, readiness, migration status, RLS default deny, admin/latest
data and role/scope smoke tests. Failure returns to containment; do not cycle
images repeatedly.

## 5. Forward fix

A forward fix requires a reviewed change, regression test, full quality gates,
new immutable image and a new change reference. Applied migrations remain
immutable. If a corrective migration is necessary, create a new migration; do
not modify prior migration files.

## 6. Restore decision and guarded target

Restore is not the default rollback. Before restore, require:

- incident owner and data owner approval;
- verified pre-incident custom-format backup and matching SHA-256 sidecar;
- successful `pg_restore --list` without committing the catalog;
- approved RPO/RTO impact assessment;
- a new database name and guard marker;
- plan to preserve and reconcile the failed database.

The current Phase 5 restore commands accept local `ueb_core_restore_*` or UAT
targets only. They must not be bypassed for staging. Implement/approve an
equivalent staging-safe target guard before a real restore. Never restore over
the active staging database and never auto-drop it.

After new-target restore: verify migrations, baseline/fingerprint, sequence
metadata without `nextval()`, runtime ACL/RLS default deny, auth/session policy,
latest-row semantics and application smoke tests before a controlled cutover.

## 7. Exact stop conditions

Stop all rollback actions when any of these is true:

- backup/sidecar/catalog is missing or checksum differs;
- target already exists, target identity is ambiguous or target guard fails;
- current migration state is unknown, failed or differs from source code;
- a prior attempt may have mutated data and residue is not reconciled;
- application image/schema compatibility is unproven;
- runtime becomes owner, superuser or `BYPASSRLS`;
- RLS no-context visibility is non-zero;
- canonical fingerprint changes;
- any password, URL, token, cookie, PII or raw catalog enters output/evidence;
- blocker/high defect or missing authorized decision.

## 8. Evidence retention and closure

Retain the change/incident reference, UTC timeline, image IDs, commit SHAs,
aggregate fingerprints, migration status, backup checksum, catalog `PASS/FAIL`,
health/readiness results, sanitized log checksum, decision owner, recovery path
and final reconciliation. Keep sensitive/raw artifacts in approved restricted
storage outside Git.

Closure requires all security and smoke gates to pass, monitoring to remain
stable for the approved observation window, no unexplained core/workflow delta,
and formal incident/change-owner acceptance.
