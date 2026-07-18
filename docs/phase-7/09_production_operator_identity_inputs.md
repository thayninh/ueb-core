# Phase 7 production operator identity inputs

## 1. Secure workspace

Operator identity inputs live outside Git under the operator-selected secure
directory. For the current local preparation the approved directory is
`/Users/thayninh/Secure/ueb-core-phase7/`.

```text
SECURE_DIRECTORY_MODE=0700
SECURE_FILE_MODE=0600
SYMLINKS=FORBIDDEN
OVERWRITE=FORBIDDEN
```

The initializer copies the canonical workbook without changing its filename or
checksum and creates these exclusive templates:

- `lecturer-exceptions.json`;
- `faculty-leaders.json`;
- `test-identities.json`;
- `production-target-state.json`;
- `phase7-secrets.env`.

The copied workbook and all templates are untracked external artifacts. The
initializer never writes a password value and reports only aggregate counts.

## 2. Lecturer decisions

`lecturer-exceptions.json` is generated from the exact canonical checksum. It
contains secure lecturer UID/source-row locators and candidate values needed by
the operator; these values never enter tracked reports.

The non-VNU identity requires exactly one decision:

- `APPROVE_EXCEPTION`;
- `REPLACE_WITH_AUTHORIZED_VNU_EMAIL`; or
- `EXCLUDE_WITH_JUSTIFICATION`.

Every decision requires a justification. Replacement additionally requires an
explicit syntactically valid `@vnu.edu.vn` email. The tool never rewrites the
source or derives a replacement.

Each ambiguous-name record requires `selectedDisplayName` matching one of that
record's canonical variants. Matching is by the generated lecturer UID and
source-row reference, never by display name.

## 3. Leader and test records

`faculty-leaders.json` contains exactly one fixed slot for each of `KTPT`,
`QTKD`, `KTKDQT`, `KTCT`, `TCNH` and `KTKT`. The operator supplies email,
display name, an explicit `requirePasswordChange` boolean and the opaque
external change reference covering the six records. Each fixed
`passwordSecretReference` must match its unit-specific key in
`phase7-secrets.env`; password values are forbidden in JSON.

`test-identities.json` fixes the two approved test emails, exact roles and
scopes, `requirePasswordChange: true`, test markers, and the shared lecturer
password reference. The operator supplies both display names and a dedicated
test lecturer UUID. The test lecturer has only `LECTURER` and no scope; the test
leader has only `FACULTY_LEADER` and `KTPT` scope. Neither record can contain
`ADMIN`.

## 4. Redacted target-state snapshot

`production-target-state.json` is a strict read-only snapshot contract. Each
identity record contains only:

- auth-user email and display name;
- access-profile status and forced-password-change flag;
- nullable lecturer mapping;
- active business roles;
- active unit codes;
- aggregate provisioning-audit count; and
- explicit test-identity marker.

Password hashes, credentials, tokens, sessions, database URLs and internal
database user IDs are not schema fields. The snapshot must declare
`snapshotStatus: "READY"`, `transactionMode: "READ_ONLY"`, the sanitized target
fingerprint and exact canonical core-row count before any workflow can pass.

## 5. Commands and hard stops

Initialization is an explicit one-time, no-overwrite operation:

```bash
pnpm phase7:initialize-production-inputs -- \
  --canonical-source=<ABSOLUTE_APPROVED_SOURCE_PATH> \
  --secure-directory=<ABSOLUTE_SECURE_DIRECTORY>
```

The operator exports only the directory locator, then runs:

```bash
export PHASE7_SECURE_DIRECTORY=<ABSOLUTE_SECURE_DIRECTORY>
pnpm phase7:build-production-roster
pnpm phase7:validate-production-roster
pnpm phase7:dry-run-production-provisioning
pnpm phase7:reconcile-production-provisioning
```

All four commands are offline and read-only. They output deterministic
manifest hash and aggregate `CREATE`, `NOOP`, `BLOCK` and `CONFLICT` counts only
after inputs are complete. Missing decisions, files, fields, secrets or target
state fail closed by exact input name. No command in this workstream provisions
an account.

```text
DATABASE_CONNECTIONS=0
DATABASE_MUTATIONS=0
SECRET_LEAKAGE=0
PRODUCTION_PROVISIONING=NOT_PERFORMED
```

## 6. Current aggregate readiness

The secure templates were initialized with one email-exception decision and
five display-name decisions outstanding. Six leader slots and two fixed test
records exist but contain no invented operator identity data. The target-state
file remains an input-required template and all seven credential variables are
empty.

```text
LECTURER_EMAIL_EXCEPTION=INPUT_REQUIRED
DISPLAY_NAME_AMBIGUITY_GROUPS=5_INPUT_REQUIRED
LEADER_TEMPLATE_SLOTS=6
LEADER_COMPLETE_RECORDS=0
TEST_TEMPLATE_RECORDS=2
TEST_COMPLETE_RECORDS=0
TARGET_STATE_SNAPSHOT=INPUT_REQUIRED
SECURE_VARIABLES_PRESENT=0_OF_7
ROSTER_VALIDATION=BLOCKED
DRY_RUN=BLOCKED
RECONCILIATION=BLOCKED
DATABASE_MUTATIONS=0
```
