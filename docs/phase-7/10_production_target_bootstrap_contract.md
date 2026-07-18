# Phase 7 guarded production target bootstrap contract

## 1. Execution status

This contract records the approved target decisions and defines local-only plan
validation. It does not connect to PostgreSQL, create a role/database, apply a
migration, import canonical rows, provision an identity, connect over SSH/SCP,
change DNS/Caddy or deploy an image.

```text
PRODUCTION_TARGET_TOOLING=LOCAL_PLAN_ONLY
DATABASE_CONNECTIONS=0
DATABASE_MUTATIONS=0
PRODUCTION_DEPLOYMENT=NOT_PERFORMED
PRODUCTION_PROVISIONING=NOT_PERFORMED
```

The command implementation rejects database credential environment variables.
There is no `--force` path. A future executable implementation requires a new,
explicitly authorized change and must not reinterpret these plan-only commands
as database execution.

## 2. Operator decision contract

| Decision | Approved value | Current gate |
| --- | --- | --- |
| Domain strategy | `PROMOTE_CURRENT_DOMAIN_AND_MOVE_STAGING` | approved for planning |
| Production domain | `ueb-core.cargis.vn` | cutover not performed |
| Staging domain after go-live | `ueb-core-staging.cargis.vn` | DNS/TLS/Caddy evidence required |
| Production database | `ueb_core_prod` | dedicated and guarded |
| Migration owner | `ueb_core_owner` | credential not created |
| Runtime role | `ueb_core_app` | must be non-owner, non-superuser and `NOBYPASSRLS` |
| Provisioning role | `ueb_core_provisioner` | must be non-owner, non-superuser and `NOBYPASSRLS` |
| Change window | `2026-07-19T20:00:00+07:00/2026-07-19T23:00:00+07:00` | revalidate immediately before execution |
| Rollback release source | `971c42027873f7de3140f815b06c2dddcfb61ba6` | Git commit exists; immutable image evidence still required |
| RPO | `24h` | approved for planning |
| RTO | `4h` | approved for planning |
| Email alert transport | `BLOCK_GO_LIVE_UNTIL_APPROVED_TRANSPORT_IS_CONFIGURED_AND_TESTED` | hard blocker |

Role names are distinct. Credential values must also be separately generated,
stored and distributed; sharing a password between these roles is forbidden.
The production target must not reuse a canonical acceptance, staging, UAT,
restore, `postgres`, `template0` or `template1` database.

## 3. Immutable source gates

```text
TARGET_STATE_MODE=PLANNED_EMPTY_TARGET
ROSTER_MANIFEST_SHA256=c622297ee3a0b31c6265b01973fa4589d8be949e9e720d9e04d6cd59be85f8b4
ROSTER_BLOCK_COUNT=0
ROSTER_CONFLICT_COUNT=0
CANONICAL_SOURCE_SHA256=e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972
CANONICAL_CORE_ROW_COUNT=2497
EXPECTED_MIGRATION_COUNT=8
EXPECTED_IDENTITY_CREATE_COUNT=254
EXPECTED_CANONICAL_LECTURER_CREATE_COUNT=246
EXPECTED_FACULTY_LEADER_CREATE_COUNT=6
EXPECTED_TEST_IDENTITY_CREATE_COUNT=2
```

The roster SHA is an input guard only. These commands do not rebuild or change
the authoritative roster manifest.

## 4. Required evidence outside Git

Every command requires three absolute evidence paths outside the repository.
Each file must be regular, non-symlinked, at most 1 MiB and mode `0600`.

The backup evidence must contain exact lines:

```text
BACKUP_STATUS=PASS
BACKUP_CHECKSUM_STATUS=PASS
RESTORE_REHEARSAL_STATUS=PASS
```

The off-host evidence must contain:

```text
OFF_HOST_BACKUP_STATUS=PASS
```

The rollback evidence must contain:

```text
ROLLBACK_IMAGE_EXISTS=YES
ROLLBACK_VERIFY=PASS
ROLLBACK_IMAGE_SHA=971c42027873f7de3140f815b06c2dddcfb61ba6
```

Evidence content is necessary but not production authorization. The actual
rollback image ID/digest, architecture and registry/transfer evidence must be
verified in the change window before any mutation.

## 5. Local-only command contract

Set only non-secret shell variables. Do not export a database URL when running
these commands.

```bash
AUTHORIZED_GIT_SHA="$(git rev-parse HEAD)"
PRODUCTION_BACKUP_EVIDENCE="/absolute/secure/path/production-backup-evidence.txt"
OFF_HOST_BACKUP_EVIDENCE="/absolute/secure/path/off-host-backup-evidence.txt"
ROLLBACK_IMAGE_EVIDENCE="/absolute/secure/path/rollback-image-evidence.txt"

production_plan_args=(
  --target-database=ueb_core_prod
  --expected-git-sha="$AUTHORIZED_GIT_SHA"
  --roster-manifest-sha=c622297ee3a0b31c6265b01973fa4589d8be949e9e720d9e04d6cd59be85f8b4
  --canonical-checksum=e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972
  --expected-block-count=0
  --target-state-mode=PLANNED_EMPTY_TARGET
  --domain-strategy=PROMOTE_CURRENT_DOMAIN_AND_MOVE_STAGING
  --production-domain=ueb-core.cargis.vn
  --staging-domain-after-go-live=ueb-core-staging.cargis.vn
  --owner-role=ueb_core_owner
  --runtime-role=ueb_core_app
  --provisioner-role=ueb_core_provisioner
  --change-window=2026-07-19T20:00:00+07:00/2026-07-19T23:00:00+07:00
  --rollback-image-sha=971c42027873f7de3140f815b06c2dddcfb61ba6
  --backup-evidence="$PRODUCTION_BACKUP_EVIDENCE"
  --off-host-backup-evidence="$OFF_HOST_BACKUP_EVIDENCE"
  --rollback-evidence="$ROLLBACK_IMAGE_EVIDENCE"
)
```

Run the guarded plan stages independently:

```bash
pnpm phase7:preflight-production-target -- \
  "${production_plan_args[@]}" \
  --confirm-production-preflight-plan

pnpm phase7:bootstrap-production-target -- \
  "${production_plan_args[@]}" \
  --confirm-production-bootstrap-plan

pnpm phase7:verify-production-target -- \
  "${production_plan_args[@]}" \
  --confirm-production-verify-plan

pnpm phase7:reconcile-production-identities -- \
  "${production_plan_args[@]}" \
  --confirm-production-identity-reconciliation-plan
```

All commands require a clean working tree and `--expected-git-sha` equal to
`HEAD`. Unknown/duplicate flags, missing confirmation, non-zero roster blockers,
wrong hashes, unsafe database names, role collisions, expired/invalid windows,
missing evidence or a missing rollback source commit fail closed.

## 6. Future empty-target bootstrap order

The local plan fixes this order; it does not execute it:

1. Reconfirm production authorization, target host and change window.
2. Verify pre-change backup, SHA-256, restore rehearsal and off-host copy.
3. Verify immutable app/operator/rollback images and their digests.
4. Create only `ueb_core_prod` and the three separately credentialed roles.
5. Apply the eight immutable migrations using only `ueb_core_owner`.
6. Reconcile minimal runtime/provisioning ACL; verify both roles are non-owner,
   non-superuser and `NOBYPASSRLS`.
7. Verify RLS default deny before loading data.
8. Import the exact canonical artifact transactionally as exactly `2,497`
   core rows; do not import auth/session/staging/UAT data.
9. Verify canonical checksum/count, empty workflow/auth/session baselines,
   append-only behavior, sequence metadata and migration status.
10. Run the exact-roster identity dry-run, bounded apply and reconciliation as
    separate authorized operations.

Any unexpected existing target object/row, checksum mismatch, extra migration,
role collapse or RLS failure stops before the next stage.

## 7. Domain and Caddy cutover plan

1. Back up the current Caddy configuration and record its checksum.
2. Provision DNS and TLS for `ueb-core-staging.cargis.vn` without changing the
   current staging route.
3. Validate the relocated staging upstream, health/readiness and independent
   rollback route.
4. Stage the production upstream privately and verify health/readiness/RLS.
5. Validate the full Caddy configuration before any reload.
6. Move staging to `ueb-core-staging.cargis.vn`, then promote
   `ueb-core.cargis.vn` to production within the approved window.
7. Verify public TLS, redirects, security headers and both endpoints.
8. On failure, restore the checksummed Caddy backup and prior staging route;
   do not modify the production database to repair routing.

No DNS, certificate, Caddy or container action is performed by the local tool.

## 8. Production smoke and rollback gates

Before public cutover, verify internal health/readiness, TLS plan, runtime RLS
default deny, role isolation, exact `2,497` baseline, zero unexplained workflow
events, identity reconciliation and monitoring. After cutover, run the Phase 7
smoke checklist with the approved test identities, then take and verify a new
off-host backup.

Rollback is mandatory when health/readiness/TLS, RLS, identity isolation,
canonical counts, alerting or unexplained-delta checks fail. A database rollback
after any production write requires explicit data-owner reconciliation and is
never automatic.

## 9. Current hard gate

```text
PRODUCTION_TARGET_CONTRACT=DEFINED
LOCAL_PLAN_TESTABILITY=REQUIRED
EMAIL_ALERT_TRANSPORT_GATE=BLOCKED
PRODUCTION_AUTHORIZATION_REFERENCE=REQUIRED_BEFORE_EXECUTION
BACKUP_EVIDENCE=REQUIRED_BEFORE_EXECUTION
OFF_HOST_BACKUP_EVIDENCE=REQUIRED_BEFORE_EXECUTION
ROLLBACK_IMAGE_EVIDENCE=REQUIRED_BEFORE_EXECUTION
PRODUCTION_DATABASE_CREATED=NO
PRODUCTION_DEPLOYMENT=NOT_PERFORMED
PRODUCTION_PROVISIONING=NOT_PERFORMED
```
