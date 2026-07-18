# Phase 6 staging acceptance

## 1. Executive status

Phase 6 staging deployment and operational validation are accepted as `PASS`
for the staging-only scope. The immutable application is healthy behind HTTPS,
the database security contract passes, backup/restore evidence is complete,
minimal host monitoring is active, and an authenticated pure-admin smoke test
passes without core or workflow mutations.

Production go-live was not performed.

## 2. Release identity and topology

| Item | Accepted value |
| --- | --- |
| Source Git SHA | `971c42027873f7de3140f815b06c2dddcfb61ba6` |
| Application image | `ueb-core:971c42027873f7de3140f815b06c2dddcfb61ba6` |
| Application image ID | `sha256:2da49d04e42acb603b547154d52d3edabaca83023f9fc21e4ee7b2bada10be05` |
| Operator image | `ueb-core-operator:971c42027873f7de3140f815b06c2dddcfb61ba6` |
| Operator image ID | `sha256:23797da0ff281ac6dde2b143a25982dc6b29997359d4d9345132dbc681dc9480` |
| Image platform | `linux/amd64` |
| VPS | `103.200.25.54` |
| Public domain | `ueb-core.cargis.vn` |
| Deployment directory | `/opt/ueb-core` |
| External proxy network | `ueb-core-proxy` |
| Existing proxy | `khtc-ueb-prod-caddy-1` |
| Staging database | `ueb_core_staging` |

The application and PostgreSQL containers publish no host ports. Caddy is the
only public ingress and reaches the staging application through the approved
external proxy network. The application runs with the accepted `512 MiB`
memory limit and the database with the accepted `768 MiB` memory limit.

## 3. Database, migration, ACL and RLS acceptance

The database owner, runtime and provisioning identities are distinct:

- migration owner: `ueb_core_staging_owner`;
- application runtime: `ueb_core_staging_app`;
- controlled provisioner: `ueb_core_staging_provisioner`.

Runtime and provisioner are non-owner, non-superuser and `NOBYPASSRLS`. Exact
core, workflow, RLS helper, runtime and provisioning ACL checks pass, with zero
provisioner excess privileges. Seven migrations are applied, zero are pending,
and the schema is up to date. The final security verifier reports
`RLS_DEFAULT_DENY=YES` and `SECURITY_VERIFY=PASS`.

The final aggregate state is:

```text
CORE_ROW_COUNT=0
WORKFLOW_EVENT_COUNT=0
AUTH_USER_COUNT=1
ACTIVE_ADMIN_ROLE_COUNT=1
ACTIVE_SESSION_COUNT=0
MIGRATIONS_APPLIED=7
MIGRATIONS_PENDING=0
```

Authentication, session and append-only audit writes were authorized for the
staging smoke. Core and workflow mutations remained zero.

## 4. HTTPS, Caddy and public smoke

- Public `/api/health`: `PASS` (`HTTP 200`).
- Public `/api/ready`: `PASS` (`HTTP 200`).
- TLS verification and certificate lifetime greater than seven days: `PASS`.
- Production Caddy container health and config validation: `PASS`.
- Caddy restart count: `0`.
- Caddy config SHA-256 remained
  `7a20d3a634cdd639911ff27a029f4f30b7b6475039ebabe6ffd6b87cff230c0f`.
- All seven existing `khtc-ueb-prod-*` services remained running; every
  healthchecked production service remained healthy.

Two unrelated `hello-world` test containers were already exited successfully
before acceptance and were not changed. They are not production services.

## 5. Backup, off-host copy and restore rehearsal

The server-side custom-format staging backup, SHA-256 sidecar and catalog
verification pass. The retained server backup SHA-256 is
`46c81e0b987dda89cb5c467724e20712bde4beaecf7467fb3176ddd79dbc9e53`.

The off-host copy is retained outside the repository under the restricted Phase
6 operator directory, has mode `0600`, and its SHA-256 sidecar verifies. Restore
rehearsal and restore verification pass. Guarded cleanup subsequently verified
the restore owner, zero active restore processes and connections, dropped only
the approved restore target, revoked temporary membership, and cleared the
matching lock. Final restore target and restore lock counts are both zero.

## 6. Minimal monitoring

Host monitoring is installed at `/opt/ueb-core/config/monitor-staging.sh` with
mode `0700`. It runs every five minutes through one idempotent cron entry with a
non-blocking lock. Evidence is stored in `/opt/ueb-core/evidence/monitoring/`;
the directory is mode `0700`, the bounded 500-line log is mode `0600`, and
output contains no credentials.

The monitor checks application, database and Caddy health; public health and
readiness; TLS expiry; restart counts; disk and memory availability; backup
freshness; and restore evidence. All local checks pass. The host has no approved
mail transport, so alert delivery is explicitly recorded as
`BLOCKED_TRANSPORT_NOT_CONFIGURED`. No mail service was installed and no alert
storm was generated.

## 7. Staging-only admin and authenticated smoke

One staging-only account was created through the controlled provisioner. The
account has an active profile and exactly one active `ADMIN` role. It has no
lecturer mapping, no `FACULTY_LEADER` role and no unit scope. Aggregate audit
evidence confirms successful account, temporary credential and role events.

Playwright exercised the real public UI and verified:

- login page render and credential login pass;
- a session is created;
- `/admin/data` shows zero latest rows;
- `/admin/users` and `/admin/audit` are accessible;
- the pending queue shows zero submissions;
- pure ADMIN exposes no lecturer feature or submit control;
- logout passes;
- a protected route after logout redirects safely;
- final active session count is zero.

No lecturer or faculty-leader account was provisioned in Phase 6.

## 8. Production safety and resources

The staging application and database containers are healthy with restart count
zero. App and database public port counts are zero. The final resource check
reported approximately `134 MiB / 512 MiB` for the application and
`51 MiB / 768 MiB` for PostgreSQL, with `22 GiB` free on the root filesystem and
approximately `2.5 GiB` memory available. The accepted constrained resource
profile remains adequate for staging monitoring and smoke scope.

No production image, service, route, database, user or credential was changed.
No production deployment was performed.

## 9. Unresolved items and Phase 7 requirements

The following item remains open before production readiness:

- configure and approve an email alert transport, then exercise one redacted
  alert-delivery test without creating an alert storm.

The operator has fixed these Phase 7 account requirements:

- lecturer accounts use VNU emails from canonical data;
- their shared initial password comes only from secure environment and must be
  changed on first login;
- the operator configures email/password for six faculty-leader accounts;
- the lecturer test account is `ktpt.giangvientest@gmail.com`;
- the leader test account is `ktpt.lanhdaotest@gmail.com`;
- both test accounts use the shared initial lecturer password;
- the test leader has only the `KTPT` scope.

These lecturer and faculty-leader accounts were not created in Phase 6.
Production authorization, production credentials, production roster approval,
alert delivery and the production change window remain separate Phase 7 hard
gates.

## 10. Machine-readable summary

```text
PHASE6_STATUS=PASS
STAGING_DEPLOYMENT=PASS
STAGING_HTTPS=PASS
STAGING_BACKUP=PASS
OFF_HOST_BACKUP=PASS
RESTORE_REHEARSAL=PASS
RESTORE_CLEANUP=PASS
MONITORING_LOCAL_CHECKS=PASS
STAGING_ADMIN_SMOKE=PASS
RLS_DEFAULT_DENY=PASS
PRODUCTION_SERVICES_HEALTH=PASS
PRODUCTION_DEPLOYMENT=NO
```

Production go-live was not performed.
