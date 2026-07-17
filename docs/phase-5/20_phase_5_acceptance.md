# Phase 5 acceptance — controlled UAT and staging readiness

## 1. Executive status

Phase 5 is accepted for the scope of controlled local UAT and staging
configuration readiness. Guarded backup/restore, isolated UAT bootstrap,
approved-identity validation, least-privilege provisioning, the KTPT pilot UAT,
the read-only admin latest-data portal and the staging deployment contract all
passed their defined gates.

This acceptance does not authorize or record a staging or production
deployment. Production SSO, production provisioning and production deployment
remain external gates.

## 2. Completed scope

- Defined Phase 5 scope, hard gates, identity-input contracts, controlled
  provisioning, pilot UAT, backup/restore and staging-readiness plans.
- Reconciled Phase 4 submit/reject transaction isolation with the explicit
  `SERIALIZABLE` contract while preserving lock order, idempotency, RLS and
  append-only workflow behavior.
- Protected backup artifacts from Git and Docker build context.
- Added guarded custom-format backup, checksum/catalog verification, disposable
  restore rehearsal and dedicated UAT bootstrap/cleanup commands.
- Removed external-font network dependency from production builds.
- Added redacted approved-identity validation and controlled provisioning with
  dry-run, confirmation, reconciliation and non-destructive rollback contracts.
- Established distinct non-owner application runtime and provisioning roles.
- Provisioned and reconciled the approved pilot identities in a dedicated UAT
  database without changing the canonical acceptance database.
- Executed all 12 KTPT pilot UAT scenarios through the application UI/HTTP
  actions and recorded redacted acceptance evidence.
- Added the read-only `/admin/data` latest-approved-data portal.
- Defined production-image Compose, Caddy/TLS, deployment, rollback, operations,
  monitoring and security contracts for staging.

## 3. Branch and commit inventory

```text
PHASE5_BRANCH=feat/phase-5-uat-staging-readiness
PHASE4_BASELINE=b4f2df85f7b73485244c4c11d6c3cc232280db27
PHASE5_ACCEPTANCE_PREDECESSOR=35b303ec0e3825be55684ea940b9e996be4483ee
```

Phase 5 commits, in implementation order:

| Commit | Purpose |
| --- | --- |
| `a2dd1fb` | Define controlled UAT and staging plan |
| `ac796a1` | Reconcile Phase 4 transaction contract |
| `8b3a9c6` | Protect backup artifacts from source/build context |
| `2eaa8bf` | Add guarded backup and restore rehearsal |
| `613e3a1` | Make production build network-independent |
| `bcedc69` | Validate approved identity inputs |
| `d6ad85f` | Add controlled provisioning |
| `353cd88` | Add guarded UAT bootstrap |
| `eec5d4f` | Correct UAT session verification column |
| `2c24c03` | Type UAT sequence privilege parameters |
| `e4100f5` | Grant runtime access to required RLS helper tables |
| `d66f584`, `f87a1fb` | Set RLS actor context for provisioning reads |
| `f33af71` | Add dedicated provisioning role |
| `90fff2e` | Define KTPT pilot UAT execution |
| `8487f9a` | Add admin latest-data portal |
| `14726a9` | Record KTPT pilot UAT acceptance |
| `35b303e` | Define staging deployment contract |

The final acceptance commit is intentionally identified by repository history
rather than a self-referential SHA in this document.

## 4. Phase 4 regression

Phase 4 unit, integration, RLS/default-deny, IDOR, concurrency and browser E2E
regressions pass. Submit, reject and approve use explicit `SERIALIZABLE`
transactions. The lock order remains `submission_id` before `record_uid`, and
double-submit, double-reject, approve/reject race, resubmission and rollback
coverage remains active.

No applied migration or business schema was modified in Phase 5.

## 5. Backup and restore rehearsal

The backup workflow uses the local owner connection, PostgreSQL custom format,
SHA-256 verification and in-memory `pg_restore --list` validation. Restore is
allowed only into a new marked disposable target with the approved prefix;
guarded cleanup cannot target the canonical database.

The rehearsal passed with 7 applied and 0 pending migrations, 2,497 baseline
core rows, 0 workflow events, 1 import run, `MAX(stt)=2569`, next STT 2570 and
runtime RLS default deny. Backup, checksum sidecar and catalog remain outside
tracked evidence.

## 6. UAT bootstrap and canonical protection

The dedicated UAT database was created through the guarded bootstrap contract,
not by raw `createdb`/`pg_restore`. The accepted archive checksum/catalog,
target non-existence, target marker, source ownership, baseline and runtime ACL
were verified. Copied sessions were revoked before pilot use.

Canonical fingerprints captured around bootstrap, provisioning and UAT matched.
Canonical core/workflow mutation count was zero.

## 7. Identity validation and controlled provisioning

Approved lecturer and leader/scope inputs were stored outside the repository.
Validation passed with no duplicate email/lecturer mapping, unknown unit or
unresolved ambiguity. Email remained a login identifier rather than an
authorization key; authorization used internal identity, role, lecturer mapping
and unit scope.

Provisioning dry-run wrote zero rows. Apply required the approved batch,
checksum, actor, UAT target, restore-rehearsal evidence and rollback dry-run
confirmation. Five pilot lecturer accounts, roles and mappings were created and
the existing pilot leader role/scope remained singular. Reconciliation covered
6 records with zero drift. Generated credentials remained outside Git with
restrictive filesystem permissions.

Rollback is non-destructive: disable/revoke/deactivate and session revocation
replace account or audit-history deletion.

## 8. Least-privilege database roles

The application runtime role is distinct from the database owner, non-superuser
and `NOBYPASSRLS`. It receives only the table/sequence/helper access required by
the Phase 4 runtime contract and cannot perform migration or provisioning work.

The provisioning role is also distinct from owner and application runtime. It
is used only by controlled operator commands; its credential is never passed to
the application container. Provisioning retains authorization, audit and RLS
context rather than bypassing services with raw SQL.

## 9. KTPT pilot UAT

All 12 scenarios passed using the real application UI and HTTP/server actions:
login/latest profile, lecturer isolation, unchanged/update/create approvals,
rejection, linked resubmission, leader queue/diff, cross-unit isolation,
lecturer IDOR, admin access and no-context RLS default deny.

```text
PILOT_UAT_SCENARIOS=12/12
UAT_FINAL_CORE_ROW_COUNT=2501
UAT_FINAL_WORKFLOW_EVENT_COUNT=10
UAT_FINAL_MAX_STT=2573
UAT_FINAL_NEXT_STT=2574
UAT_SUBMITTED_EVENT_COUNT=5
UAT_APPROVED_EVENT_COUNT=4
UAT_REJECTED_EVENT_COUNT=1
UAT_UNEXPLAINED_CORE_ROWS=0
UAT_UNEXPLAINED_WORKFLOW_EVENTS=0
UAT_DUPLICATE_TERMINAL_COUNT=0
UAT_SOURCE_SUBMISSION_ANOMALY_COUNT=0
ROLE_SCOPE_ISOLATION=PASS
IDOR=PASS
RLS_DEFAULT_DENY=PASS
```

## 10. Admin latest-data portal

`/admin/data` permits active administrators to read all latest approved records
using server-side DAL access with transaction-local actor context and RLS. It
shows all 20 core fields and contains no edit, submit, approve or reject control.
Lecturers and non-admin leaders safe-deny, while `/leader/data` retains its
unit-scope contract.

## 11. Staging configuration readiness

The staging contract uses an immutable standalone production image, non-root
app user, read-only filesystem, tmpfs, CPU/memory/PID limits, health/readiness
checks, restart policy and rotated container logs. PostgreSQL has no published
host port and is reachable only on the private database network. The app is
reachable only through the reverse-proxy network and does not receive owner,
migration or provisioning variables.

The Caddy example defines TLS, forwarded-host/client context, security headers,
request-size limits and proxy routing for health/readiness and application
traffic. Deployment, rollback and operations runbooks define ordered gates,
monitoring/alerting, backups, restore rehearsal, credential/session response,
escalation and evidence retention.

## 12. Security controls

- Owner, runtime and provisioning database identities are separated.
- Runtime and provisioning roles are non-superuser and `NOBYPASSRLS`.
- Runtime no-context visibility remains zero for core/workflow tables.
- Core approval and workflow history remain append-only; cleanup does not use
  `UPDATE`, `DELETE` or `TRUNCATE` against business history.
- Applied migrations are immutable and schema changes require new migrations.
- Backup paths are excluded by repository `.gitignore` and `.dockerignore`.
- No secret, credential, PII source, backup, dump, raw catalog or private key is
  committed. Committed evidence contains only aggregate/redacted results.
- Production builds do not require Google Fonts or another external font fetch.

## 13. Open external gates

- Staging deployment is not authorized and was not performed.
- Production SSO is not configured.
- Production identities have not been provisioned.
- Production deployment is not authorized and was not performed.
- A real staging rollout still requires target/change-window approval,
  staging-safe guarded backup/security/fingerprint tooling, immutable image
  approval, secret-store integration, off-host backup ownership, monitoring
  destination, escalation ownership and approved RPO/RTO.

## 14. Final acceptance decision

Phase 5 passes the implemented controlled-UAT and staging-configuration scope.
The repository is ready for review and merge, but merge alone does not authorize
staging or production deployment. The open external gates above remain hard
stops for operational rollout.

## 15. Machine-readable summary

```text
PHASE5_STATUS=PASS
PHASE5_BRANCH=feat/phase-5-uat-staging-readiness
PHASE4_REGRESSION=PASS
BACKUP_RESTORE_REHEARSAL=PASS
UAT_BOOTSTRAP=PASS
CANONICAL_PROTECTION=PASS
IDENTITY_VALIDATION=PASS
PILOT_PROVISIONING=PASS
PROVISIONING_RECONCILIATION=PASS
PILOT_UAT=PASS
UAT_FINAL_CORE_ROW_COUNT=2501
UAT_FINAL_WORKFLOW_EVENT_COUNT=10
ROLE_SCOPE_ISOLATION=PASS
IDOR=PASS
RLS_DEFAULT_DENY=PASS
APP_RUNTIME_LEAST_PRIVILEGE=PASS
PROVISIONING_ROLE_LEAST_PRIVILEGE=PASS
ADMIN_DATA_PORTAL=PASS
STAGING_CONFIGURATION=PASS
STAGING_DEPLOYMENT=NOT_PERFORMED
PRODUCTION_SSO=NOT_IMPLEMENTED
PRODUCTION_PROVISIONING=NO
PRODUCTION_DEPLOYMENT=NO
```
