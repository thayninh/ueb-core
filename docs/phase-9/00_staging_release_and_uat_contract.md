# Phase 9 staging release and UAT contract

## 1. Scope

This contract reconciles repository tooling for a future staging release. It
does not authorize SSH, image transfer, backup, migration, application restart,
Caddy change, database write, UAT execution, or production access.

The exact staging identity is:

```text
TARGET=staging
STAGING_DATABASE=ueb_core_staging
STAGING_DOMAIN=ueb-core-staging.cargis.vn
STAGING_URL=https://ueb-core-staging.cargis.vn
PRODUCTION_DOMAIN=ueb-core.cargis.vn
```

Staging tooling must fail closed when given the production domain. Production
runbooks and the live production topology are not changed by this contract.

## 2. Release and migration ledger

Deployment approval binds to an exact 40-character release SHA, immutable app
and operator image identities, and a clean working tree. The preflight does not
depend on a branch name. If the Phase 6 deployment command is run locally
without `--expected-git-commit`, it resolves the current `HEAD`; artifact tags
and metadata must still match that SHA exactly.

`phase6:migration-ledger` reads the ordered directories under
`prisma/migrations`, hashes each `migration.sql`, and hashes the resulting
ordered ledger. No migration count is hard-coded. Source, operator image and
database ledgers must match in count, name, checksum and fingerprint. Phase 9A
does not run migrations and does not modify any migration file.

## 3. Immutable candidate images and local artifact gate

```bash
export RELEASE_SHA="$(git rev-parse HEAD)"
MIGRATION_LEDGER_JSON="$(pnpm --silent phase6:migration-ledger)"
MIGRATION_COUNT="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(String(value.count))' "$MIGRATION_LEDGER_JSON")"
MIGRATION_LEDGER_FINGERPRINT="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(value.fingerprint)' "$MIGRATION_LEDGER_JSON")"

docker build --platform linux/amd64 --target runner \
  --build-arg "UEB_CORE_SOURCE_GIT_SHA=${RELEASE_SHA}" \
  --build-arg "UEB_CORE_MIGRATION_COUNT=${MIGRATION_COUNT}" \
  --build-arg "UEB_CORE_MIGRATION_LEDGER_FINGERPRINT=${MIGRATION_LEDGER_FINGERPRINT}" \
  --tag "ueb-core:${RELEASE_SHA}" .

docker build --platform linux/amd64 --file Dockerfile.operator \
  --build-arg "UEB_CORE_SOURCE_GIT_SHA=${RELEASE_SHA}" \
  --build-arg "UEB_CORE_MIGRATION_COUNT=${MIGRATION_COUNT}" \
  --build-arg "UEB_CORE_MIGRATION_LEDGER_FINGERPRINT=${MIGRATION_LEDGER_FINGERPRINT}" \
  --tag "ueb-core-operator:${RELEASE_SHA}" .
```

The operator build verifies the supplied ledger arguments against the ledger
generated inside the image. Both candidates expose the exact source SHA,
migration count and migration fingerprint as OCI labels. Before transfer, run
the dedicated local-only gate; it performs Docker inspection only and neither
builds, loads, pushes nor transfers an image:

```bash
pnpm phase9:verify-local-candidate-artifacts -- \
  --release-sha="$RELEASE_SHA" \
  --app-image="ueb-core:$RELEASE_SHA" \
  --operator-image="ueb-core-operator:$RELEASE_SHA" \
  --verify-local
```

## 4. Rollback metadata

Previous-image rollback is blocked unless restricted external metadata contains:

- current and previous release SHAs;
- current and previous immutable image tag or digest;
- previous image ID and architecture;
- source migration count and ledger fingerprint;
- database migration status `COMPATIBLE`;
- schema compatibility decision `APPROVED`;
- backup identifier and SHA-256;
- timestamp with timezone and operator identity reference.

Rollback never edits or reverses an applied migration. Restore remains a
separately authorized new-target recovery operation.

## 5. Gate 1 — pre-transfer remote read-only staging preflight

The local dry-run is machine-readable and performs no SSH connection:

```bash
pnpm phase9:staging-read-only-preflight -- \
  --target=staging \
  --release-sha="$RELEASE_SHA" \
  --dry-run
```

It plans checks for the running staging image/container, approved rollback
image and metadata, Compose services, public health/readiness, source/database
migration compatibility, backup checksum/catalog/freshness, Caddy staging
route and monitoring/alert evidence. It intentionally does not require the
candidate images before transfer. The plan contains no `docker load`, Compose
start, backup, migration, ACL, Caddy reload or secret operation.

### Guarded SSH execution

The same command supports a separate, explicit remote mode. It is never
inferred from environment variables and cannot be combined with `--dry-run`:

```bash
pnpm phase9:staging-read-only-preflight -- \
  --target=staging \
  --release-sha="$RELEASE_SHA" \
  --authorization-ref=PHASE9_STAGING_READ_ONLY_CHANGE_REFERENCE \
  --ssh-alias=ueb-core-staging \
  --ssh-config-file=/absolute/path/to/ssh-config \
  --expected-user=deploy \
  --expected-host=103.200.25.54 \
  --known-hosts-file=/absolute/path/to/known_hosts \
  --connect-timeout-seconds=10 \
  --command-timeout-seconds=60 \
  --remote-root=/opt/ueb-core \
  --remote-secret-file=/opt/ueb-core/secrets/database-owner.env \
  --output=/absolute/path/outside/repository/staging-preflight.json \
  --execute-read-only
```

The executor validates the alias with `ssh -G`, pins the expected user and
host, requires strict host-key checking, disables password and interactive
authentication, TTY, forwarding and local commands, and applies bounded
connect, command and output limits. A fixed collector is passed through stdin;
there is no arbitrary remote-command argument. The collector stops after the
first failed check and never uses `sudo`, writes a remote file, creates a
container, starts a service, changes Caddy, or changes a database.

The exact evidence contracts are:

- staging backup metadata and checksum evidence under
  `/var/backups/ueb-core/staging`;
- approved rollback metadata at
  `/opt/ueb-core/evidence/rollback/approved.json`;
- monitoring script `/opt/ueb-core/config/monitor-staging.sh` and bounded log
  `/opt/ueb-core/evidence/monitoring/monitor.log`;
- the owner credential is only referenced beneath `/opt/ueb-core/secrets` and
  is used by a fixed read-only migration-ledger query. Its value is never
  returned.

Missing or unsafe evidence blocks the execution. The JSON report is written
locally with mode `0600` using a temporary file and atomic rename, outside the
repository. It contains sanitized, bounded evidence and only a hash of the
remote secret reference.

### Rollback metadata readiness audit

`pnpm phase9:rollback-metadata-readiness` separates evidence discovery from
approval and installation. Its `--dry-run` mode is local-only. A separately
authorized `--execute-read-only` mode may inspect the current app/operator
images, immutable rollback-image inventory, Compose mapping, migration ledger,
latest checksum-verified/off-host staging backup, approved-path state, schema
compatibility inputs, and monitoring/health/readiness. The collector does not
pull, load, tag, remove, start or restart images or services and does not write
to the server or database.

The approved metadata schema remains fail-closed and contains:

- `imageId`, `architecture`, `composeService`;
- `releaseSha`, `previousReleaseSha`, `currentImage`, `previousImage`;
- `sourceMigrationCount`, `migrationLedgerFingerprint`,
  `databaseMigrationStatus`, `schemaCompatibilityDecision`;
- `backupIdentifier`, `backupChecksum`, `timestamp`, and
  `operatorIdentityReference`.

Runtime inspection resolves the current image/labels, Compose mapping and
database ledger. Verified backup evidence resolves the backup identifier and
checksum. Selecting a rollback release/image digest, approving schema
compatibility and providing the operator/change reference always require an
explicit operator decision. Multiple compatible candidates are never selected
automatically.

`--generate-draft` consumes a local readiness report and atomically writes a
mode-`0600` JSON draft outside the repository. The draft uses
`proposedMetadata` plus per-field `RESOLVED`, `OPERATOR_DECISION_REQUIRED` or
`BLOCKED` states; it always contains `approved: false` and is never accepted as
deploy-ready metadata.

Installing `/opt/ueb-core/evidence/rollback/approved.json` is deliberately not
implemented in Phase 9C5. A future separately authorized command must bind the
exact draft SHA-256, current and rollback releases, immutable rollback image
digest, backup identifier/checksum, approved schema-compatibility decision,
operator/change reference and exact absolute target. It must use atomic
temporary-file plus rename semantics, enforce a regular non-symlink mode-`0600`
target with restrictive ownership, and perform post-write read-only
verification.

## 6. Gate 3 — post-transfer candidate image verification

After a separately authorized transfer/load operation, use a new one-attempt
authorization reference with the dedicated read-only command. It verifies that
both exact candidate tags exist remotely and match image ID, `linux/amd64`,
source SHA and source migration-ledger labels. It cannot start or restart a
container, run a migration, read a database credential or change Compose:

```bash
pnpm phase9:verify-staging-candidate-images -- \
  --target=staging \
  --release-sha="$RELEASE_SHA" \
  --authorization-ref="$POST_TRANSFER_READ_ONLY_AUTHORIZATION" \
  --ssh-alias=ueb-core-staging \
  --ssh-config-file=/absolute/path/to/ssh-config \
  --expected-user=deploy \
  --expected-host=103.200.25.54 \
  --known-hosts-file=/absolute/path/to/known_hosts \
  --connect-timeout-seconds=5 \
  --command-timeout-seconds=90 \
  --remote-root=/opt/ueb-core \
  --remote-secret-file=/opt/ueb-core/secrets/database-owner.env \
  --output=/absolute/path/outside/repository/post-transfer-images.json \
  --execute-post-transfer-image-verify
```

The remote secret argument remains part of the shared guarded SSH identity
contract but is not passed to or read by the post-transfer collector. Gate 1,
the local candidate gate and Gate 3 are independent; passing one never implies
that either of the others passed. A consumed one-attempt authorization
reference is rejected rather than reused.

The executor parses every valid collector record before interpreting the SSH
exit code. A report therefore preserves completed checks, the first remote
`BLOCKED` or `FAIL` check, its sanitized summary and remote exit code. An SSH
failure without protocol is classified as `SSH_TRANSPORT`; malformed,
out-of-order or incomplete protocol is classified as `COLLECTOR_PROTOCOL`.
Timeout, signal and SSH exit metadata are retained without storing raw stderr.
An all-PASS protocol paired with a non-zero SSH exit is treated as an
inconsistency and fails closed.

## 7. UAT manifest

`phase9:uat-plan` contains the approved 29-case inventory: 21 read-only cases
and 8 cases that create authentication/session/password/workflow writes.

```bash
# Default: all 21 non-mutating cases only.
pnpm phase9:uat-plan -- --dry-run

# Selecting a mutating case remains blocked without this exact CLI flag.
pnpm phase9:uat-plan -- \
  --dry-run \
  --case=P9-UAT-08 \
  --authorize-mutating-uat
```

Authorization is never inferred from an environment variable. The manifest
contains no username, password, token, cookie, roster identity or real test
data. Phase 9A only validates dry-run plans; it does not execute UAT.

## 8. Execution hard gate

Before a later server preflight or staging deployment, require a separate
authorization covering target, release SHA, image IDs, read-only SSH scope,
change window, current staging migration ledger, verified backup, rollback
metadata, operator identities and any mutating UAT cases. No Phase 9A artifact
grants that authorization.
