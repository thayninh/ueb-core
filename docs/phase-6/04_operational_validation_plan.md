# Phase 6 operational validation plan

## 1. Scope

Operational validation chứng minh staging có thể được quan sát, backup, phục hồi,
contain và hỗ trợ theo contract. Không tích hợp production monitoring/SSO và
không authorize production deployment.

## 2. Ownership and escalation

External roster phải chỉ rõ staging operator, application owner, database owner,
security contact, infrastructure owner và business smoke-test owner. Repository
ghi approved owner identifier `thayninh` cho deployment, DNS, TLS, monitoring và
incident contact; email/số liên hệ cụ thể vẫn chỉ nằm trong restricted external
configuration.

Severity/response proposal cần được phê duyệt:

| Severity | Example | Initial target |
| --- | --- | --- |
| BLOCKER | Data/RLS exposure, DB loss, backup unavailable | Immediate |
| HIGH | Readiness outage, credential/audit/provisioning failure, restart loop | 15 minutes proposed |
| MEDIUM | Sustained auth failures or resource pressure | 4 hours proposed |
| LOW | Non-security cosmetic issue | Next business cycle |

## 3. Monitoring validation matrix

Approved method is Docker healthcheck plus host cron probes and email alert.
`MONITORING_EMAIL_TO` must be filled and verified with a redacted test alert
before deployment; a blank recipient is a hard stop.

| Signal | Planned validation | Pass condition |
| --- | --- | --- |
| App health | Probe `/api/health` through TLS every 30 s | Alert after 3 consecutive failures |
| Readiness | Probe `/api/ready`, verify no-cache | Alert/rollout stop after 3 failures |
| PostgreSQL | Observe DB health and readiness dependency | BLOCKER within 2 minutes |
| Authentication failures | Generate fake staging-only failures | Redacted aggregate alert at approved threshold |
| Audit failure | Safe test double/operator simulation | Privileged operation stops; evidence retained |
| Provisioning failure | Dry-run/safe simulation only | Batch stops; reconciliation required |
| Backup | Simulate freshness/checksum/catalog failure | Deployment blocked and owner alerted |
| Disk | Threshold test without filling evidence volume | 70/85/95% routing verified |
| CPU/memory | Bounded load on staging rehearsal | Saturation/OOM alert and containment verified |
| Restart loop | Stop/fail app safely | Alert at ≥3 restarts/10 min; cycling stopped |
| TLS expiry | Synthetic expiry threshold | Alert at ≤21 days |

Alert không chứa identity, secret, token, cookie, URL đầy đủ hoặc business payload.

## 4. Logging validation

- App, DB và Caddy logs đi stdout/approved collection, structured và redacted.
- Docker `json-file` rotation mặc định 10 MiB × 5 hoặc lower approved limits.
- Không log authorization/cookie headers, password, DB URL hoặc raw payload.
- Operator outputs chỉ counts, checksum, PASS/FAIL và opaque references.
- Test rotation bằng generated non-sensitive logs; không làm đầy disk hoặc xóa
  evidence thật.
- Xác minh access control, retention và export-redaction process.

## 5. Backup and restore operations

Validation cần chứng minh:

- daily custom-format backup schedule và freshness check;
- SHA-256/catalog verification cho mọi backup;
- encrypted local retention và off-host retention được phê duyệt;
- off-host upload/retrieval monitoring;
- guarded restore quarterly, sau major migration/PostgreSQL/tool/credential change;
- exact-target/minimum-age/dry-run guards cho retention cleanup;
- không backup/copy UAT credential sang staging;
- không dùng UAT DB làm staging restore target.

Approved RPO là 24 giờ và approved RTO là 4 giờ. Phase 6 staging acceptance vẫn
phải chứng minh schedule, checksum/catalog, off-host copy/retrieval và restore
rehearsal thực tế đạt hai giá trị này.

## 6. Credential and session operations

Rehearse riêng cho runtime, owner, provisioning, Better Auth, audit HMAC và TLS:

1. tạo/rotate trong external secret store;
2. update only authorized operator/app consumer;
3. restart/roll forward theo change control;
4. verify runtime ACL/RLS và probes;
5. revoke affected staging sessions bằng guarded staging procedure;
6. preserve audit, không delete users/roles/scopes/core/workflow.

Không reuse UAT secret, không print secret và không dùng UAT-only session command
để bypass staging target guard.

## 7. Capacity and resilience

- Capture baseline CPU, memory, disk, connection pool, latency và restart counts.
- Validate configured app/DB CPU-memory-PID limits không làm readiness fail ở
  approved smoke load.
- Verify disk headroom cho database, backup scratch, logs và image layers.
- Test app restart and DB temporary-unavailable behavior without data mutation.
- Record observation window; any saturation, restart loop hoặc unexplained error
  blocks acceptance.

Approved fixed limits are app `512m`/`0.75` CPU and database `768m`/`0.75` CPU,
total memory limit 1280 MiB. Do not increase them without a new capacity review.
Alert at >=85% of either container memory limit for 10 minutes, any OOM, or
readiness impact.

## 8. Security operations

- Verify app/runtime cannot migrate, create role hoặc provision.
- Verify runtime/provisioning non-owner, non-superuser, `NOBYPASSRLS`.
- Verify no-context core/workflow visibility 0.
- Verify anonymous, cross-user/unit and pure-admin boundaries.
- Run secret/backup/credential/PII scans before evidence commit.
- Validate incident procedure for credential exposure includes rotate + session
  revoke + image rebuild where needed.

## 9. UAT preservation

`ueb_core_uat_phase5` remains untouched during Phase 6 planning. Cleanup is a
separate authorized operation only after this plan is approved and retention/
evidence requirements are confirmed. Staging operations must not mount, mutate,
restore or derive credentials from the UAT database.

## 10. Approved operations snapshot

```text
MONITORING_METHOD=DOCKER_HEALTHCHECK_PLUS_HOST_CRON_CURL_AND_EMAIL_ALERT
MONITORING_OWNER=thayninh
INCIDENT_CONTACT=thayninh
MONITORING_EMAIL_DESTINATION=REQUIRED_BEFORE_DEPLOYMENT
LOCAL_BACKUP_DIRECTORY=/var/backups/ueb-core/staging
OFF_HOST_BACKUP_DESTINATION=/Users/thayninh/Secure/ueb-core-phase6/off-host-backups
BACKUP_RETENTION=14_DAILY_8_WEEKLY
RPO_APPROVED=24_HOURS
RTO_APPROVED=4_HOURS
APP_MEMORY_LIMIT=512M
DATABASE_MEMORY_LIMIT=768M
STAGING_GUARDED_BACKUP_RESTORE=NOT_IMPLEMENTED
```

Minimal probes must cover Docker app/DB health and restart count,
`/api/health`, `/api/ready`, the public Caddy HTTPS endpoint, disk usage and
verified-backup freshness (maximum 26 hours). Exact non-secret commands are in
`docs/phase-6/07_staging_change_and_rollback_plan.md`.

## 11. Operational exit criteria

```text
MONITORING_VALIDATION=PASS
LOG_ROTATION_VALIDATION=PASS
BACKUP_FRESHNESS_ALERT=PASS
OFF_HOST_BACKUP_RETRIEVAL=PASS
RESTORE_CADENCE_APPROVED=YES
INCIDENT_ROUTING=PASS
CREDENTIAL_ROTATION_REHEARSAL=PASS
SESSION_REVOKE_REHEARSAL=PASS
CAPACITY_VALIDATION=PASS
RPO_RTO_APPROVED=YES
BLOCKER_DEFECT_COUNT=0
HIGH_DEFECT_COUNT=0
```
