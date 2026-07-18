# Phase 7 production identity and provisioning contract

## 1. Sources of truth

Lecturer identities are derived only from the approved canonical dataset:

- account email is the canonical VNU email;
- each email maps to exactly one `lecturer_uid`;
- each `lecturer_uid` maps to exactly one lecturer identity;
- normalization rules are approved before dry-run and do not guess missing
  values.

Leader identities come only from explicit operator input. The operator supplies
the email and password for each of the six units:

- `KTPT`;
- `QTKD`;
- `KTKDQT`;
- `KTCT`;
- `TCNH`;
- `KTKT`.

Each leader receives exactly one active `FACULTY_LEADER` role and only the exact
approved unit scope. Tooling must not infer an email, reuse a lecturer mapping,
or derive a scope from an email/domain/name.

## 2. Initial credential contract

Real lecturers use one shared initial lecturer password obtained from the secure
environment. It is never committed or accepted through a CLI argument that
would expose it in process history. All initial-password lecturer and test
accounts start in the forced-change state defined in
`02_first_login_password_change_contract.md`.

Leader credentials are supplied by the operator through separate secure input.
No leader password is generated or inferred by repository tooling. Any leader
credential subject to an initial-password policy must also use the same forced
change enforcement.

Every provisioning call carries an explicit `requirePasswordChange: boolean`:

- production lecturers created with the shared initial password: `true`;
- approved shared-password test lecturer and test leader: `true`;
- each real faculty leader: explicit operator input, never inferred from role,
  email, unit or password source; and
- existing/bootstrap staging administrator: `false` and not modified by the
  backward-compatible migration.

The access-profile row stores `must_change_password` (default `false`) and the
nullable `password_changed_at`. Idempotent reconciliation requires the stored
flag to match the explicit manifest value; mismatch requires manual review.

## 3. Approved test identities

The production smoke roster includes these separate test identities:

- lecturer: `ktpt.giangvientest@gmail.com`;
- leader: `ktpt.lanhdaotest@gmail.com`.

Both use the shared initial lecturer password from the secure environment. The
test lecturer has a dedicated test-only lecturer mapping, never a real
lecturer's `lecturer_uid`. The test leader has exactly `FACULTY_LEADER` and only
the `KTPT` scope. Test accounts do not replace, suppress or impersonate any real
account.

## 4. Provisioning pipeline

### 4.1 Dry-run

The dry-run is read-only and produces redacted aggregate evidence. It validates:

- canonical artifact checksum and expected lecturer population;
- unique normalized email and unique `lecturer_uid`;
- valid email syntax and approved VNU-email source for real lecturers;
- exact lecturer-to-identity mapping;
- six explicit leader inputs and one exact scope per leader;
- separate, approved mappings for both test accounts;
- shared-password secret presence without reading it into output;
- forced-password-change implementation/test status;
- target is the approved dedicated production database; and
- zero reference to staging/UAT credentials or identities.

### 4.2 Batch apply

Apply uses bounded, restartable batches with an opaque run ID and idempotency
key. Each batch is transactional, records aggregate created/unchanged/failed
counts and stops on the first unexplained mismatch. Database provisioning uses
the dedicated non-owner provisioner identity; application runtime and migration
owner credentials are not fallbacks.

Account creation writes the explicit forced-change flag in the same identity
transaction. Provisioning audit metadata records only whether password change
is required and never contains credential material. Current lecturer
provisioning passes `true`; local bootstrap admin passes `false`. No production
provisioning is executed by this implementation change.

### 4.3 Reconciliation

After every batch and at finalization, reconcile identities, lecturer mappings,
roles, scopes, forced-change flags and append-only audit counts against the
approved manifest. There must be zero duplicate emails, duplicate lecturer
mappings, extra roles, excess scopes, missing identities or unexplained rows.

### 4.4 Rollback

Before activation, failed batches may be rolled back only by the guarded
provisioning workflow using its run manifest and exact created identities. It
must not delete pre-existing identities, core/workflow rows or audit history.
After any account has authenticated or produced dependent audit/session state,
rollback becomes disable/reconcile plus incident review, not destructive user
deletion. Credentials are rotated if exposure is suspected.

If required password change fails, the serializable application transaction
rolls back credential update, flag/timestamp, audit insert and session deletion
together and reports no false success. After success, every prior session is
revoked and the user must log in with the new password.

## 5. Mass-provisioning hard stops

Mass provisioning is forbidden when any of the following exists:

- duplicate email;
- missing `lecturer_uid`;
- invalid email;
- unit or leader ambiguity;
- shared initial password secret not supplied;
- forced-password-change implementation not passing;
- target/database/role mismatch;
- staging/UAT credential or identity reference;
- dry-run/reconciliation count mismatch; or
- unapproved real/test identity collision.

## 6. Evidence and status

Evidence includes only aggregate counts, approved unit codes, redacted defect
IDs and an opaque run ID. It excludes passwords, hashes, tokens, complete
rosters, database URLs and internal user IDs.

```text
IDENTITY_DRY_RUN=REQUIRED
BATCH_APPLY=NOT_PERFORMED
RECONCILIATION=REQUIRED
ROLLBACK_CONTRACT=DEFINED
LECTURER_UID_MAPPING=EXACT_ONE_TO_ONE
LEADER_COUNT=6
TEST_LEADER_SCOPE=KTPT_ONLY
MASS_PROVISIONING=NOT_AUTHORIZED
FORCED_CHANGE_FIELD=access_profile.must_change_password
PASSWORD_CHANGED_AT_FIELD=access_profile.password_changed_at
PROVISIONING_FLAG=EXPLICIT
```
