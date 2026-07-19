# Phase 7 production identity tooling

> The split-file operator workflow in
> `09_production_operator_identity_inputs.md` is the authoritative execution
> path. The combined manifest/state interface below remains a lower-level typed
> contract used by that workflow.

## 1. Scope and safety boundary

The Phase 7 roster build, validation, dry-run and reconciliation commands are
offline, read-only checks. They do not import the application database client,
open a database connection, create an account, or write a roster/report. They
consume operator-controlled files outside the repository and emit only
aggregate counts, checksums and stable issue codes.

```text
PRODUCTION_CONNECTIONS=0
PRODUCTION_WRITES=0
PROVISIONING_APPLY=SEPARATELY_GUARDED_COMMAND
ROSTER_OUTPUT=FORBIDDEN
CREDENTIAL_OUTPUT=FORBIDDEN
```

`DRY_RUN` compares the deterministic desired roster with either an externally
captured read-only target snapshot or an explicitly approved
`PLANNED_EMPTY_TARGET` contract and classifies each identity as planned create,
unchanged or conflicting. `RECONCILE` requires every desired identity
to exist with exact state and at least one provisioning audit event. An
unexpected target identity is a blocker in both modes.

An `EXISTING_TARGET` snapshot must be produced by a separately approved
read-only production inspection. A `PLANNED_EMPTY_TARGET` is local-only,
requires a null fingerprint, null core-row count and empty identities, and
cannot pass reconciliation until replaced by an observed existing-target
snapshot. These commands are not authorization to connect to or mutate
production.

## 2. Secure input locations and modes

The operator supplies only environment-variable references. Paths and secret
values are never CLI arguments and are never printed.

| Variable | Contract |
| --- | --- |
| `PHASE7_CANONICAL_SOURCE_FILE` | Absolute path to the approved `.xlsx` source |
| `PHASE7_IDENTITY_MANIFEST_FILE` | Absolute path to the strict production identity manifest |
| `PHASE7_IDENTITY_STATE_FILE` | Absolute path to a read-only target-state JSON snapshot |
| `PHASE7_SHARED_LECTURER_INITIAL_PASSWORD` | Shared real/test lecturer initial password; also used by both approved test identities |
| `PHASE7_LEADER_<UNIT>_INITIAL_PASSWORD` | One separate password for each of `KTPT`, `QTKD`, `KTKDQT`, `KTCT`, `TCNH`, `KTKT` |
| `PHASE7_PRODUCTION_ADMIN_INITIAL_PASSWORD` | Required only when the optional production-admin manifest record is present |

Every file must be a regular non-symlink file outside the Git workspace with
mode `0600`. Its immediate parent must be a regular non-symlink directory with
mode `0700`. JSON input is limited to 5 MiB and the workbook to 10 MiB. Invalid
or missing input reports only the variable name and a stable error code.

## 3. Normalization and canonical audit

Identity comparison applies only these transformations:

1. Unicode NFC;
2. trim surrounding Unicode whitespace;
3. lowercase email;
4. map the exact canonical unit source value through the six-unit allowlist.

The tool never synthesizes an email/domain, rewrites a local-part, corrects a
typo, selects one of multiple names/emails/units, or changes a lecturer UID.
Unknown units, non-`vnu.edu.vn` real-lecturer emails, test-like canonical
emails, ambiguous display names and non-bijective email/UID mappings block the
roster.

The canonical audit records source checksum, row/column counts, distinct UID
and normalized-email counts, VNU/non-VNU counts, exact duplicate counts and
whether an employment-status column exists. It does not emit any row value,
name, email, lecturer UID or source-row number.

## 4. Strict identity manifest

The external manifest is a strict JSON object (`manifestVersion: 1`) containing:

- opaque `changeReference`;
- exact `canonicalSourceSha256`;
- exactly six `facultyLeaders`, one for each allowlisted unit, with explicit
  email, display name and `requirePasswordChange` boolean;
- `testLecturer` with the literal approved email, explicit dedicated UUID,
  display name and `requirePasswordChange: true`;
- `testLeader` with the literal approved email, exact `KTPT` scope, display
  name and `requirePasswordChange: true`; and
- optional `productionAdmin` with explicit email/name and
  `requirePasswordChange: false`.

Password values are not manifest fields. Each record carries only a fixed
`passwordSecretReference`; leader references are fixed by unit and both test
records reference the shared lecturer key, preventing a manifest from
redirecting credential lookup. Real leaders have no lecturer mapping. The test
lecturer UID must not collide with canonical lecturer UIDs. All emails must be
unique across real lecturer, real leader, test and optional admin identities.

## 5. Read-only target-state contract

The secure state JSON is strict and contains:

- `snapshotVersion: 1`;
- `transactionMode: "READ_ONLY"`;
- `targetEnvironment: "PRODUCTION"`;
- `targetMode: "EXISTING_TARGET" | "PLANNED_EMPTY_TARGET"`;
- for `EXISTING_TARGET`, a sanitized SHA-256 `targetFingerprint` and observed
  `canonicalCoreRowCount`;
- for `PLANNED_EMPTY_TARGET`, `targetFingerprint: null`,
  `canonicalCoreRowCount: null` and `identities: []`;
- all target identities with email/name, access status, nullable lecturer UID,
  forced-change flag, active role set, active unit-code set and aggregate
  provisioning-audit count; and
- an explicit boolean test-identity marker for every state record.

Exact desired state is:

| Identity | Lecturer mapping | Active roles | Active unit scopes |
| --- | --- | --- | --- |
| Real/test lecturer | Exactly the manifest/canonical UID | `LECTURER` only | None |
| Real/test leader | None | `FACULTY_LEADER` only | Exactly one manifest unit |
| Optional admin | None | `ADMIN` only | None |

Duplicate state emails/lecturer UIDs, extra roles/scopes, missing identities,
forced-change mismatch, inactive state, unexpected identities or missing audit
evidence block reconciliation.

## 6. Commands

After the operator has populated a secure environment without printing it:

```bash
pnpm phase7:identity-dry-run
pnpm phase7:identity-reconcile
```

Both outputs end with:

```text
DATABASE_CONNECTIONS=0
DATABASE_WRITES=0
ROSTER_VALUES_OUTPUT=0
CREDENTIAL_VALUES_OUTPUT=0
```

Only `STATUS=PASS` with zero blockers and conflicts is eligible for the
separately authorized apply command:

```bash
pnpm phase7:apply-production-identities -- \
  --target-database=ueb_core_prod \
  --authorization-reference=RETRY_PRODUCTION_IDENTITY_PROVISIONING_AND_CONTINUE_GO_LIVE_PHASE7_2026-07-19 \
  --change-window-start=<ISO_8601_WITH_TIMEZONE> \
  --change-window-end=<ISO_8601_WITH_TIMEZONE> \
  --expected-git-sha=<EXACT_IMMUTABLE_IMAGE_SHA> \
  --roster-manifest-sha=c622297ee3a0b31c6265b01973fa4589d8be949e9e720d9e04d6cd59be85f8b4 \
  --canonical-checksum=e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972 \
  --confirm-production-identity-apply
```

The command reads `PHASE7_SECURE_DIRECTORY` and
`PHASE7_PROVISIONING_DATABASE_URL` only from the secure operator environment.
It refuses owner/runtime fallback, requires the exact dedicated production
database and provisioner role, and revalidates the secure roster before opening
the database transaction. All 254 identities, credentials, profiles, roles,
scopes and redacted audit evidence are created in one `Serializable`
transaction. An exact rerun is a `NOOP`; a partial or conflicting target fails
closed. The output contains counts and stable codes only, never roster values,
passwords, hashes, URLs or internal user IDs.
