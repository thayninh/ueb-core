# Phase 5 staging operations and monitoring runbook

## 1. Scope and ownership

This document defines the staging operational contract. It does not configure a
real monitoring vendor, scheduler, off-host store or staging host. Those choices
require infrastructure and security approval before deployment.

The operational owner, application owner, database owner, security contact and
business/UAT escalation contact must be recorded in the external change system.
No personal contact detail belongs in this repository.

## 2. Logs and rotation

| Source | Location/command | Content rule | Rotation |
| --- | --- | --- | --- |
| App | `docker compose ... logs app` | Structured operational/auth result; no secret/token/PII | Docker `json-file`, 10 MiB × 5 by default |
| PostgreSQL | `docker compose ... logs db` | Connection/error metadata; no statement logging of payloads | Docker `json-file`, 10 MiB × 5 by default |
| Caddy | Container stdout JSON | Request metadata; do not log cookies or authorization headers | Proxy platform rotation, at least equivalent limits |
| Operator jobs | Restricted external evidence store | Counts, checksum, PASS/FAIL only | Retention per approved change/audit policy |

Use `STAGING_LOG_MAX_SIZE` and `STAGING_LOG_MAX_FILES` to lower limits if the
host capacity assessment requires it. Never disable rotation. Access to raw
logs is least-privilege and all exports require redaction.

## 3. Health, readiness and alerting contract

Monitoring must probe through the same TLS reverse-proxy path users use. It must
also observe container/database state from the private host network.

| Signal | Check and threshold | Severity | Required response |
| --- | --- | --- | --- |
| App health | `/api/health` non-200 or timeout for 3 consecutive 30 s probes | HIGH | Inspect app/restart state; do not mutate DB |
| Readiness | `/api/ready` 503/timeout for 3 consecutive 30 s probes | HIGH | Check DB/network/pool; stop rollout |
| PostgreSQL unavailable | DB healthcheck unhealthy or readiness DB failure for 2 min | BLOCKER | Freeze writes, notify DB/infrastructure owner |
| Repeated authentication failures | Sanitized `AUTH_LOGIN_FAILED` aggregate ≥10/5 min per service, no identity in alert | MEDIUM; HIGH if sustained 15 min | Security triage/rate-control review |
| Provisioning failure | Any provisioning role, apply, rollback or reconciliation `FAIL` | HIGH | Stop batch; reconcile residue; no blind retry |
| Audit failure | Audit writer/operator evidence failure ≥1 | HIGH | Stop affected privileged operation and preserve logs |
| Backup failure/freshness | Job/checksum/catalog failure, or no verified backup within 26 h | BLOCKER | Stop deployment; notify data/infrastructure owner |
| Disk usage | ≥70% warning, ≥85% HIGH, ≥95% BLOCKER | As threshold | Expand/clean only approved non-evidence artifacts |
| Memory saturation | App or DB ≥85% limit for 10 min, or OOM event | HIGH | Capture metrics/logs; scale under change control |
| CPU saturation | App or DB ≥85% allocated CPU for 15 min | MEDIUM; HIGH if readiness affected | Profile and capacity review |
| Restart loop | ≥3 restarts/10 min for app or DB | HIGH | Stop automatic cycling; preserve failure evidence |
| TLS expiry | Certificate expires in ≤21 days | HIGH | Verify Caddy ACME/DNS path; no manual secret in Git |

Alert payloads contain service, environment, timestamp, severity, aggregate
count and opaque incident reference only. They must not contain email, name,
password, token, cookie, connection URL or business payload.

## 4. Routine inspection commands

```bash
docker compose \
  --env-file "$STAGING_ENV_FILE" \
  -f compose.yaml \
  -f compose.staging.yaml \
  ps

curl --fail --silent --show-error \
  https://ueb-core.cargis.vn/api/health >/dev/null

curl --fail --silent --show-error \
  https://ueb-core.cargis.vn/api/ready >/dev/null
```

Do not render Compose configuration or inspect container environment into a
shared log because it contains secret values. Inspect only environment key
names through an approved redacted tool.

## 5. Backup, retention and off-host storage

Proposed schedule, pending infrastructure/data-owner approval:

- daily custom-format PostgreSQL backup during the approved low-traffic window;
- SHA-256 sidecar and in-memory `pg_restore --list` verification for every run;
- local encrypted retention: 14 daily copies;
- off-host encrypted retention proposal: 12 weekly and 12 monthly copies;
- immutable/off-host copy completion within four hours of backup;
- daily freshness check after the backup window;
- no backup, sidecar, catalog or object-name inventory in Git/build context.

Off-host backup is mandatory before staging acceptance. Storage must use
encryption at rest/in transit, separate access control, deletion protection and
periodic retrieval testing. A same-host Docker volume is not an off-host copy.

Backup deletion/retention jobs require a reviewed target prefix, minimum-age
guard, dry-run report and explicit change owner. They must never infer paths or
delete the latest verified copy.

## 6. Restore rehearsal cadence

Run a guarded restore into a new isolated database at least quarterly, after a
major PostgreSQL/migration change, and after any backup tooling or credential
rotation. The rehearsal must verify checksum, catalog, migrations, aggregate
counts, sequence metadata without `nextval()`, runtime ACL, RLS default deny,
latest-row semantics, auth/session handling and cleanup guard.

Current restore tooling is local acceptance/UAT-only. A staging-safe guard and
negative tests are required before staging operations; never weaken the current
guard. Retain only sanitized aggregate evidence and the external artifact
reference.

## 7. Incident severity and response

| Severity | Examples | Initial response target | Contract |
| --- | --- | --- | --- |
| BLOCKER | Data integrity, RLS exposure, canonical mutation, backup unavailable, DB loss | Immediate | Stop traffic/writes, notify all owners |
| HIGH | Readiness outage, credential exposure, audit/provisioning failure, restart loop | 15 minutes proposed | Contain, preserve evidence, rotate/revoke as needed |
| MEDIUM | Sustained auth failures, resource pressure without outage | 4 hours proposed | Triage and schedule controlled fix |
| LOW | Cosmetic/non-security operational defect | Next business cycle | Track and prioritize |

Do not retry a mutation when transaction status or residue is unknown. Use the
rollback runbook and record an opaque incident reference.

## 8. Credential rotation and session revocation

| Credential | Rotation trigger | Procedure contract |
| --- | --- | --- |
| Runtime DB | Scheduled interval, exposure, staff/access change | Create/alter through owner job, update secret store, restart app, verify ACL/RLS |
| Owner/migration | Exposure or approved schedule | DBA-controlled rotation; test migrate/backup access; never inject into app |
| Provisioning | Every approved campaign or exposure | Dedicated role password; update external secure environment; verify exact ACL |
| Better Auth | Exposure or cryptographic rotation plan | Coordinated secret rotation and session impact decision |
| Audit HMAC | Exposure or approved cryptographic plan | Preserve verification/version metadata; do not overwrite historical evidence |
| Caddy/TLS | Automatic ACME or incident | Caddy-managed renewal; no ACME account secret in repository |

Session revocation must use an approved service/operator action with an explicit
target and confirmation. `phase5:revoke-uat-sessions` is UAT-only and must not be
pointed at staging. A staging session-revoke procedure must preserve audit and
must not delete users, roles, scopes or core/workflow history.

## 9. Support escalation

Escalate in this order using the external support roster:

1. on-call staging operator;
2. application owner for app/auth/workflow failures;
3. database owner for migration, backup, restore or PostgreSQL failure;
4. security representative for credential, RLS, audit or suspicious auth;
5. business/UAT owner for data semantics and go/no-go;
6. infrastructure owner for Caddy, host, network, disk or capacity.

BLOCKER/HIGH incidents require a shared incident reference and explicit closure.
Do not place contact details, credentials or raw incident logs in Git.

## 10. RPO/RTO proposal and approval gate

```text
PROPOSED_RPO=24 hours
PROPOSED_RTO=4 hours
RPO_RTO_APPROVAL=PENDING
```

These are proposals, not commitments. Staging deployment is blocked until the
data owner and infrastructure owner approve RPO/RTO, backup schedule, off-host
retention, restore cadence, alert routing and support response targets.

## 11. Operational acceptance checklist

- [ ] Health/readiness probes and alert routing tested.
- [ ] PostgreSQL/private-network failure alert tested.
- [ ] Authentication/audit/provisioning failure alerts tested with fake data.
- [ ] Disk, CPU, memory and restart-loop alerts tested.
- [ ] Backup/checksum/catalog/freshness job passed.
- [ ] Encrypted off-host copy and retrieval passed.
- [ ] Guarded restore rehearsal passed.
- [ ] Credential rotation and session-revoke procedures approved.
- [ ] RPO/RTO and support roster approved externally.
- [ ] No staging/production secret or raw evidence committed.
