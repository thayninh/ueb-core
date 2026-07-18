# Phase 7 plan — production go-live

## 1. Executive status

Phase 7 defines the authorization, identity, data, deployment, rollback and
acceptance contracts for a future production go-live. This plan is not an
authorization to execute any production mutation.

```text
PHASE7_STATUS=PLANNING
PHASE7_SCOPE=PRODUCTION_GO_LIVE_PLANNING_ONLY
PRODUCTION_AUTHORIZATION=REQUIRED
PRODUCTION_DEPLOYMENT=NOT_PERFORMED
PRODUCTION_USER_PROVISIONING=NOT_PERFORMED
PRODUCTION_DATABASE=NOT_CREATED
```

Phase 6 staging is accepted at `https://ueb-core.cargis.vn`. That endpoint is
still staging. Production must not reuse staging or UAT data, credentials,
sessions, identities or databases.

## 2. Objectives

1. Obtain explicit production authorization, target topology, change window,
   accountable owners and rollback authority.
2. Establish a dedicated production database from the approved canonical
   baseline of exactly `2,497` core rows.
3. Provision production lecturer and faculty-leader identities through guarded
   dry-run, batch apply, reconciliation and rollback stages.
4. Enforce first-login password change before an initial-password user can
   reach any application feature.
5. Deploy an immutable release with role separation, append-only behavior, RLS
   default deny, backups and a rehearsed rollback path intact.
6. Complete the production smoke and acceptance matrix without weakening
   lecturer or leader isolation.

## 3. Non-goals for this planning change

- No production deployment, database, role, user, secret, Caddy route or DNS
  mutation.
- No VPS or staging mutation.
- No staging or UAT cleanup.
- No production account provisioning or canonical data import.
- No selection of the production/staging domain topology without a separate
  operator authorization.
- No password, token, database URL, roster or internal user ID in Git.

## 4. Workstreams and exit gates

| Workstream | Scope | Exit gate |
| --- | --- | --- |
| Authorization | owner, target, domain, window, release, risk and rollback approvals | every mandatory approval has an external reference |
| Identity | lecturer, leader and test-account mapping and first-login contract | dry-run is unambiguous and forced-change implementation passes |
| Data | canonical baseline, dedicated database, migration and reconciliation | exact `2,497` rows and zero unexplained deltas |
| Release | immutable images, secrets, role separation, Caddy and rollback | preflight and rollback checkpoints pass |
| Acceptance | public, workflow, isolation, admin, RLS and recovery smoke | all critical checks pass with redacted evidence |
| Operations | monitoring, alert delivery, backup and restore ownership | transport and recovery gates are approved |

## 5. Ordered planning path

1. Approve `01_production_authorization_gates.md`, including the domain topology
   decision and external email transport.
2. Implement and validate `02_first_login_password_change_contract.md` before
   provisioning any initial-password account.
3. Approve identity sources and run the guarded workflow in
   `03_production_identity_and_provisioning_contract.md`.
4. Verify the canonical artifact and rehearse
   `04_production_data_migration_plan.md` against an isolated non-production
   target.
5. Approve the immutable release and execute the future change in the order
   defined by `05_production_deployment_and_rollback_plan.md`.
6. Run `06_production_smoke_and_acceptance.md`, reconcile all counts and retain
   redacted evidence.
7. Declare production acceptance only after every hard gate is satisfied.

## 6. Global stop conditions

Stop before mutation when authorization is absent or expired; the domain
topology remains undecided; the canonical artifact does not prove exactly
`2,497` core rows; a production target resolves to staging or UAT; a credential
class is reused; an identity mapping is ambiguous; forced password change has
not passed; email transport is unavailable; backup, off-host copy, restore or
rollback is unproven; an immutable release cannot be identified; production
service health is degraded; or any secret/PII would enter tracked evidence.

## 7. Evidence contract

Tracked evidence may contain approved Git/image identifiers, redacted
authorization references, aggregate counts, allowed checksums, timestamps,
PASS/FAIL states and defect identifiers. It must not contain a password, token,
cookie, database URL, roster, personal staging administrator email, internal
user ID, dump, private key or raw log.

## 8. Machine-readable planning status

```text
PHASE7_PLAN=DEFINED
EXPLICIT_PRODUCTION_AUTHORIZATION=REQUIRED
CANONICAL_CORE_ROW_COUNT=2497
DEDICATED_PRODUCTION_DATABASE=REQUIRED
STAGING_DATABASE_REUSE=FORBIDDEN
UAT_DATABASE_REUSE=FORBIDDEN
FORCED_PASSWORD_CHANGE=REQUIRED
IDENTITY_DRY_RUN=REQUIRED
IDENTITY_RECONCILIATION=REQUIRED
DOMAIN_TOPOLOGY_DECISION=REQUIRED
EMAIL_ALERT_TRANSPORT=EXTERNAL_OPERATIONAL_GATE
PRODUCTION_DEPLOYMENT=NOT_PERFORMED
```
