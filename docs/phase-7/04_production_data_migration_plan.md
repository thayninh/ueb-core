# Phase 7 production data migration plan

## 1. Target and source contract

Production uses a dedicated database with separately authorized migration owner,
runtime and provisioning roles. It must not be the staging database, a UAT
database or a restored copy containing staging/UAT accounts or sessions.

The only approved business-data source is the canonical baseline manifest with
exactly `2,497` core rows. Before use, the operator verifies the artifact
checksum, schema/version identity, row count and authorization reference. A
count or checksum mismatch is a hard stop, not a reconciliation tolerance.

## 2. Preserved security and data invariants

- Applied migrations remain immutable and run only through the migration owner.
- Application runtime and provisioner are non-owner, non-superuser and
  `NOBYPASSRLS`.
- Runtime, provisioning and migration credentials are distinct.
- Core/workflow append-only rules and RLS policies remain enabled.
- RLS default deny is verified before and after data load.
- No staging admin, staging/UAT session, token, audit identity or credential is
  copied.
- Canonical lecturer UID/VNU-email fields are retained for the approved identity
  mapping; account creation remains a separate provisioning stage.

## 3. Pre-migration rehearsal and dry-run

Rehearse the exact immutable release against an isolated non-production target.
The dry-run validates all migration files and checksums, expected schema, empty
target state, canonical `2,497` count, duplicate keys, lecturer UID/email
quality, unit references and deterministic import results. It reports only
aggregate/redacted evidence.

Do not continue on duplicate email, missing lecturer UID, invalid VNU email,
unknown unit, schema drift, unexpected existing rows or any target guard
mismatch.

## 4. Future production sequence

1. Confirm explicit authorization, exact target and maintenance window.
2. Create/verify a pre-change backup and checksum; copy it off host.
3. Verify restore rehearsal and rollback ownership.
4. Run pending schema migrations with the dedicated migration owner.
5. Reconcile runtime/provisioning ACL and RLS default deny.
6. Import the canonical baseline transactionally with an opaque run identifier.
7. Verify exactly `2,497` latest canonical core rows and zero unexplained
   workflow/auth/session rows before identity provisioning.
8. Re-run constraints, append-only, ACL, RLS and checksum/fingerprint checks.
9. Hand the reconciled lecturer UID/VNU-email manifest to the guarded identity
   dry-run; do not embed passwords in the data load.

## 5. Reconciliation contract

The operator records expected/actual aggregate counts for core rows, logical
latest rows, workflow events, identities, mappings, roles, scopes and sessions.
Before identity apply, the expected authentication/session counts are zero.
Every difference must be explained by an approved run stage or the migration
stops.

## 6. Rollback contract

Before public cutover, a failed new production target is quarantined and the
approved prior target remains authoritative. Recovery uses a verified backup or
recreates the new target from the immutable canonical artifact; it does not
edit an applied migration or destructively rewrite append-only records.

After cutover, rollback follows the approved application/database checkpoint in
`05_production_deployment_and_rollback_plan.md`. Any new production write makes
database rollback a data-reconciliation decision owned by the deployment and
data owners, never an automatic drop/restore.

## 7. Planning status

```text
PRODUCTION_DATABASE=DEDICATED_REQUIRED
CANONICAL_CORE_ROW_COUNT=2497
CANONICAL_CHECKSUM=REQUIRED
STAGING_DATA_COPY=FORBIDDEN
UAT_DATA_COPY=FORBIDDEN
STAGING_ADMIN_SESSION_COPY=FORBIDDEN
APPEND_ONLY_VERIFY=REQUIRED
RLS_DEFAULT_DENY_VERIFY=REQUIRED
DATA_MIGRATION=NOT_PERFORMED
```
