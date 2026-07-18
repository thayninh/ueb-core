# Phase 7 production identity tooling

## 1. Scope and safety boundary

The Phase 7 identity commands are offline, read-only checks. They do not import
the application database client, open a database connection, create an account,
or write a roster/report. Both commands consume operator-controlled files
outside the repository and emit only aggregate counts, checksums and stable
issue codes.

```text
PRODUCTION_CONNECTIONS=0
PRODUCTION_WRITES=0
PROVISIONING_APPLY=NOT_IMPLEMENTED_BY_THESE_COMMANDS
ROSTER_OUTPUT=FORBIDDEN
CREDENTIAL_OUTPUT=FORBIDDEN
```

`DRY_RUN` compares the deterministic desired roster with an externally
captured read-only target snapshot and classifies each identity as planned
create, unchanged or conflicting. `RECONCILE` requires every desired identity
to exist with exact state and at least one provisioning audit event. An
unexpected target identity is a blocker in both modes.

The target snapshot must be produced by a separately approved read-only
production inspection. These commands are not authorization to connect to or
mutate production.

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

Password values and password-environment names are not manifest fields. Leader
password variables are fixed by unit, preventing a manifest from redirecting
credential lookup. Real leaders have no lecturer mapping. The test lecturer UID
must not collide with canonical lecturer UIDs. All emails must be unique across
real lecturer, real leader, test and optional admin identities.

## 5. Read-only target-state contract

The secure state JSON is strict and contains:

- `snapshotVersion: 1`;
- `transactionMode: "READ_ONLY"`;
- `targetEnvironment: "PRODUCTION"`;
- a sanitized SHA-256 `targetFingerprint`;
- `canonicalCoreRowCount`;
- all target identities with email/name, access status, nullable lecturer UID,
  forced-change flag, active role set, active unit-code set and aggregate
  provisioning-audit count.

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

Only `STATUS=PASS` with `BLOCKER_COUNT=0` is eligible for a later, separately
authorized provisioning decision. This workstream contains no apply command.
