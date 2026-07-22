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

## 3. Immutable operator image

```bash
export RELEASE_SHA="$(git rev-parse HEAD)"
MIGRATION_LEDGER_JSON="$(pnpm --silent phase6:migration-ledger)"
MIGRATION_COUNT="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(String(value.count))' "$MIGRATION_LEDGER_JSON")"
MIGRATION_LEDGER_FINGERPRINT="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(value.fingerprint)' "$MIGRATION_LEDGER_JSON")"

docker build --platform linux/amd64 --file Dockerfile.operator \
  --build-arg "UEB_CORE_SOURCE_GIT_SHA=${RELEASE_SHA}" \
  --build-arg "UEB_CORE_MIGRATION_COUNT=${MIGRATION_COUNT}" \
  --build-arg "UEB_CORE_MIGRATION_LEDGER_FINGERPRINT=${MIGRATION_LEDGER_FINGERPRINT}" \
  --tag "ueb-core-operator:${RELEASE_SHA}" .
```

The build verifies the supplied ledger arguments against the ledger generated
inside the image. Preflight reads OCI labels to verify source SHA, migration
count and migration fingerprint without starting a container.

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

## 5. Read-only staging preflight

The local dry-run is machine-readable and performs no SSH connection:

```bash
pnpm phase9:staging-read-only-preflight -- \
  --target=staging \
  --release-sha="$RELEASE_SHA" \
  --dry-run
```

It plans checks for image/source identity, Compose services, container image
digest, public health/readiness, source/database migration compatibility,
backup checksum/catalog/freshness, rollback metadata, Caddy staging route and
monitoring/alert evidence. The plan contains no `docker load`, Compose start,
backup, migration, ACL, Caddy reload or secret operation.

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

## 6. UAT manifest

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

## 7. Execution hard gate

Before a later server preflight or staging deployment, require a separate
authorization covering target, release SHA, image IDs, read-only SSH scope,
change window, current staging migration ledger, verified backup, rollback
metadata, operator identities and any mutating UAT cases. No Phase 9A artifact
grants that authorization.
