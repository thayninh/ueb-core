# Phase 7 guarded production target executor

## 1. Scope and authorization

The Phase 7 operator can create and validate only the dedicated database
`ueb_core_prod`. Executable operations require an authorization reference that
starts with `CREATE_AND_VALIDATE_PRODUCTION_TARGET_ONLY`, exact immutable
release inputs and an active operator-supplied change window. This authorization
does not permit application start, Caddy/DNS changes or identity provisioning.

Preflight and `bootstrap --dry-run` reject database credentials and make zero
database connections or mutations. Apply modes fail closed, never accept
`--force`, redact credentials and require reconciliation after any failure once
an operation may have started.

## 2. Immutable contract

```text
PRODUCTION_DATABASE=ueb_core_prod
PRODUCTION_OWNER_ROLE=ueb_core_owner
PRODUCTION_RUNTIME_ROLE=ueb_core_app
PRODUCTION_PROVISIONER_ROLE=ueb_core_provisioner
ROSTER_MANIFEST_SHA256=c622297ee3a0b31c6265b01973fa4589d8be949e9e720d9e04d6cd59be85f8b4
CANONICAL_SOURCE_SHA256=e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972
CANONICAL_CORE_ROW_COUNT=2497
EXPECTED_MIGRATION_COUNT=8
EXPECTED_EMPTY_IDENTITY_COUNT=0
EXPECTED_ROSTER_IDENTITY_COUNT=254
```

Canonical, acceptance, staging, UAT, maintenance and non-production restore
database names are rejected. Restore rehearsal targets must use the prefix
`ueb_core_prod_restore_` and an executor-owned database marker.

## 3. Change-window contract

The source does not pin a date or time. Every command accepts:

```text
--change-window-start=<ISO-8601 with timezone>
--change-window-end=<ISO-8601 with timezone>
```

The end must be later than the start and the duration must not exceed four
hours. Mutation commands reject execution before the start and after the end.
Read-only preflight and bootstrap dry-run may validate an upcoming window but
reject an expired or malformed window.

## 4. Credential and endpoint separation

Apply operations use restricted environment supplied outside Git:

- `PRODUCTION_BOOTSTRAP_DATABASE_URL`: distinct non-superuser role with only
  the required role/database bootstrap capabilities, targeting `postgres`;
- `MIGRATION_DATABASE_URL`: exact `ueb_core_owner` connection;
- `DATABASE_URL`: exact `ueb_core_app` connection;
- `PHASE7_PROVISIONING_DATABASE_URL`: exact `ueb_core_provisioner` connection;
- three different strong role passwords for initial role creation.

All URLs must use the approved private `PRODUCTION_DATABASE_HOST`, and
`PRODUCTION_DATABASE_PUBLIC_PORT=NO` is mandatory. Secrets are never accepted as
CLI arguments or printed. The application image is not started by this tooling.

## 5. Immutable artifact and evidence gates

Every mode verifies restricted, non-symlinked app/operator archives against
their exact SHA-256 values. Email evidence must be mode `0600`, redacted,
credential-free, successful and no older than 24 hours. Rollback evidence must
prove both image existence and verification. Canonical Excel data is never
baked into an image: the authorized file is mounted separately and verified
before the first database mutation.

## 6. Commands

The root package and immutable operator image expose:

```text
phase7:preflight-production-target
phase7:bootstrap-production-target
phase7:verify-production-target
phase7:reconcile-production-identities
phase7:backup-production-target
phase7:restore-production-rehearsal
phase7:cleanup-production-restore
```

All commands take the common exact target, role, Git SHA, roster SHA, canonical
checksum, authorization, change-window, email/rollback evidence and app/operator
archive arguments. Mode-specific inputs are:

- bootstrap: `--canonical-source`, `--canonical-audit-directory`, plus either
  `--dry-run` or `--confirm-create-production-target`;
- backup: `--backup`, `--off-host-directory`,
  `--confirm-production-backup`;
- restore: exact source, disposable target, backup and
  `--confirm-production-restore-rehearsal`;
- cleanup: exact source, marked disposable target, backup and
  `--confirm-cleanup-production-restore`.

An unmarked disposable target is blocked by default. Cleanup may acknowledge
`--confirm-known-unmarked-restore-residue` only after the exact target is known
to have been created by the diagnosed
`RESTORE_MARKER_COMMENT_PERMISSION_DENIED` failure. The executor still requires
the production restore prefix, exact owner, zero active database connections,
the separate source database, and the normal explicit cleanup confirmation.

Unknown/duplicate inputs and confirmation plus `--dry-run` are rejected.

## 7. Executable order

1. Preflight immutable inputs and evidence without credentials.
2. Dry-run bootstrap with zero connections/mutations.
3. During the active window, verify the canonical artifact before mutation.
4. Create the exact owner and database; create distinct runtime/provisioner
   roles; apply eight immutable migrations.
5. Import exactly 2,497 canonical rows transactionally using the owner.
6. Reconcile minimal runtime and provisioning ACLs and verify RLS default deny.
7. Verify zero workflow, auth and session rows before identity provisioning.
8. Create a custom-format backup, checksum and catalog; copy only a verified
   archive to the approved off-host directory.
9. Restore to a new marked `ueb_core_prod_restore_*` database. PostgreSQL 18
   restore creation and cleanup use the same temporary owner membership as
   target bootstrap: exact `SET` capability only, no admin option, followed by
   an explicit `SET ROLE` before every owner-only CREATE, COMMENT or DROP,
   `RESET ROLE`, revoke and a negative capability check on success or failure.
   The executor verifies the restored counts and fingerprint and proves the
   source production fingerprint did not change before guarded cleanup.
10. Reconcile the exact roster SHA read-only against the empty identity target.

The identity reconciliation reads lecturer mappings from the existing
`access_profile.lecturer_uid` column. There is no separate
`lecturer_user_mapping` table. The test-identity marker remains immutable roster
metadata; the empty-target plan therefore expects two marked test identities to
be created later without writing during reconciliation.

The executor never drops `ueb_core_prod`, never retries a partial apply blindly,
never deletes a backup and never provisions identities.

## 8. Operator image contract

The operator image contains Node 24, PostgreSQL client tools, Prisma schema and
all eight migrations, Phase 2 canonical import code and contract, Phase 3/4 ACL
reconciliation code, and `scripts/phase-7`. It does not contain the canonical
Excel artifact, credentials, backup data or a `latest` image tag.

Before building, the operator must verify `git rev-parse HEAD`, require an empty
`git status --short`, and pass that exact commit as the
`UEB_CORE_SOURCE_GIT_SHA` build argument. The build stores it as the root-owned,
read-only `/operator/.source-git-sha` file. Runtime commands compare this
embedded value with `--expected-git-sha` and fail closed when the file is
missing, malformed or different. The operator image contains neither the Git
binary nor `.git` metadata.

## 9. Failure and hard-stop policy

Before target creation, invalid source/evidence/window/artifacts produce zero
database mutations. A failed database creation attempts to remove the newly
created unused owner role. After the target may exist, failures report
`UNKNOWN_RECONCILIATION_REQUIRED`; the target and evidence are preserved.
Operators must run guarded verification before any retry. Production app start,
domain/Caddy cutover and identity provisioning require separate authorization.
