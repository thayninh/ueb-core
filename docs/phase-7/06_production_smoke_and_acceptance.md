# Phase 7 production smoke and acceptance plan

## 1. Status

This is the mandatory future production smoke and acceptance matrix. No smoke
identity is provisioned and no production workflow is executed by this document.

```text
PRODUCTION_SMOKE=NOT_PERFORMED
PRODUCTION_ACCEPTANCE=NOT_EVALUATED
PRODUCTION_DEPLOYMENT=NOT_PERFORMED
```

The forced-change application contract has passed unit, local PostgreSQL
integration and local Playwright coverage. This does not authorize or represent
a production smoke, identity apply or deployment.

## 2. Preconditions

- explicit production authorization and selected domain topology are current;
- exact release/image/database/canonical-data identities match the approval;
- existing production services, Caddy, internal health and readiness pass;
- identity batch reconciliation is clean;
- email transport delivery test passes;
- backup, off-host copy, restore rehearsal and rollback checkpoints pass; and
- the smoke operator has authority to stop and roll back.

## 3. Mandatory smoke sequence

1. Public login page renders over valid HTTPS.
2. The test lecturer `testgiangvien@vnu.edu.vn` logs in with the secure
   initial lecturer password and is forced to change it before any other route.
3. Successful change revokes the old session; the initial password and old
   session no longer work; fresh login succeeds.
4. Lecturer `confirm unchanged` creates only the expected append-only workflow
   evidence.
5. Lecturer `update existing` creates a pending change without overwriting the
   current core row.
6. Lecturer `create new` creates a pending submission without premature core
   insertion.
7. Test leader `testlanhdao@vnu.edu.vn`, with only `KTPT` scope, rejects the
   approved test submission.
8. The lecturer sees the reason, resubmits the rejected change and preserves the
   immutable history link.
9. The test leader approves the resubmission and exactly one expected core
   version/event is appended.
10. A lecturer cannot read or mutate another lecturer's records/submissions.
11. A leader cannot read, reject or approve outside the exact unit scope.
12. Admin data, users and audit portals work without granting lecturer or leader
    capabilities to a pure admin.
13. Direct database checks confirm RLS default deny for missing/invalid context,
    exact runtime/provisioner ACL and append-only protections.
14. Public health/readiness/TLS, monitoring and all pre-existing production
    services remain healthy.
15. Production backup/checksum/off-host copy pass after smoke; restore rehearsal
    verifies the approved backup in an isolated guarded target and cleans up by
    the approved contract.
16. Every rollback checkpoint and the final route/application rollback path is
    either rehearsed or verified against the approved immutable artifacts.

For step 2, all browser business/admin/workflow routes redirect to
`/change-password`. Auth APIs outside `/api/auth/get-session` and
`/api/auth/sign-out` return HTTP `403` and `PASSWORD_CHANGE_REQUIRED`. Direct
`/api/auth/change-password` is blocked for forced users; the canonical page
executes the atomic application service. Step 3 also verifies
`password_changed_at`, event `AUTH_REQUIRED_PASSWORD_CHANGED`, metadata
`secretFields=NONE`, and deletion of all database sessions before fresh login.

## 4. Identity and scope assertions

- The test lecturer uses a dedicated test-only lecturer mapping.
- The test leader has exactly one `FACULTY_LEADER` role and only `KTPT` scope.
- Neither test account substitutes for a real lecturer or leader account.
- Real lecturer email/`lecturer_uid` mapping reconciles one-to-one with canonical
  data.
- Six real leader accounts reconcile exactly to `KTPT`, `QTKD`, `KTKDQT`,
  `KTCT`, `TCNH` and `KTKT`, with no inferred email or scope.
- No staging admin, staging/UAT session or credential exists in production.

## 5. Acceptance and failure rules

Any authentication, forced-change, isolation, RLS, append-only, count, backup,
restore, Caddy, existing-service, TLS, monitoring or rollback failure blocks
acceptance and invokes the appropriate checkpoint. A failed check is not waived
by manual UI success.

Email delivery is an external operational gate. The prior
`BLOCKED_TRANSPORT_NOT_CONFIGURED` state must be replaced by verified `PASS`
before production acceptance.

Evidence is redacted and aggregate. It contains no password, token, cookie,
database URL, complete roster, personal staging-admin email, internal user ID,
dump or raw audit/log export.

Incorrect current password, confirmation mismatch, same-as-current password,
credential update error, audit error or transaction error must keep
`must_change_password=true` and must not report success. A successful change
sets the flag false only after password update within the same transaction,
then commits timestamp, audit and revoke-all together.

## 6. Future machine-readable acceptance

```text
PRODUCTION_AUTHORIZATION=<PASS|FAIL>
DOMAIN_TOPOLOGY=<AUTHORIZED_VALUE>
PRODUCTION_DEPLOYMENT=<PASS|FAIL>
CANONICAL_CORE_ROW_COUNT=2497
IDENTITY_DRY_RUN=<PASS|FAIL>
IDENTITY_BATCH_APPLY=<PASS|FAIL>
IDENTITY_RECONCILIATION=<PASS|FAIL>
FORCED_PASSWORD_CHANGE=<PASS|FAIL>
OLD_SESSION_REVOCATION=<PASS|FAIL>
LECTURER_ISOLATION=<PASS|FAIL>
LEADER_UNIT_ISOLATION=<PASS|FAIL>
RLS_DEFAULT_DENY=<PASS|FAIL>
PRODUCTION_BACKUP=<PASS|FAIL>
OFF_HOST_BACKUP=<PASS|FAIL>
RESTORE_REHEARSAL=<PASS|FAIL>
ROLLBACK_PATH=<PASS|FAIL>
EMAIL_ALERT_DELIVERY=<PASS|FAIL>
PRODUCTION_ACCEPTANCE=<PASS|FAIL>
```
