# Phase 6 staging acceptance checklist

## 1. Decision rule

Phase 6 chỉ `PASS` khi toàn bộ mandatory items dưới đây có redacted evidence,
không có blocker/high defect và external approvers ký staging-only acceptance.
Checklist không authorize production hoặc thay thế change authorization.

## 2. Authorization and scope

- [ ] `AUTH-01` đến `AUTH-14` đều `PASS` với external references.
- [ ] Environment ghi rõ `STAGING`; domain là `ueb-core.cargis.vn`.
- [ ] Change/observation windows và rollback owner được phê duyệt.
- [ ] Production deployment, SSO và provisioning ghi `OUT_OF_SCOPE`.
- [ ] UAT database/credential/volume/session không được reuse.
- [ ] `ueb_core_uat_phase5` chưa cleanup trước Phase 6 plan approval.
- [ ] Không mass-provision real users; staging smoke roster nhỏ và approved.

## 3. Artifact and environment

- [ ] Source commit và immutable image digest khớp approval.
- [ ] Rollback image có schema compatibility review.
- [ ] App chạy non-root, read-only filesystem, bounded tmpfs, dropped capabilities.
- [ ] CPU/memory/PID limits, restart policy và log rotation hoạt động.
- [ ] PostgreSQL/app không publish host port; private networks đúng contract.
- [ ] Caddy TLS/hostname/forwarded/security headers/request limit `PASS`.
- [ ] App environment chỉ có runtime allowlist; owner/provisioning keys vắng mặt.
- [ ] Secret store/access/rotation evidence `PASS`; tracked secrets bằng 0.

## 4. Database safety and roles

- [ ] Staging database/volume là dedicated target, không phải UAT/canonical.
- [ ] Migration owner, app runtime và provisioning role là ba identities khác nhau.
- [ ] Runtime và provisioning non-owner, non-superuser, `NOBYPASSRLS`.
- [ ] Exact runtime/provisioning ACL reconciliation `PASS`.
- [ ] Applied migrations không modified; failed/pending migration bằng 0.
- [ ] Migration, ACL reconciliation và app start chạy bằng các operator steps riêng.
- [ ] App không dùng owner hoặc provisioning connection.
- [ ] RLS no-context core/workflow visibility bằng 0 và writes bằng 0.

## 5. Backup and restore

- [ ] Pre-deploy custom-format backup `PASS`.
- [ ] SHA-256 sidecar và in-memory catalog verification `PASS`.
- [ ] Encrypted off-host copy và retrieval `PASS`.
- [ ] Retention, freshness alert, deletion guard và owner được phê duyệt.
- [ ] Guarded restore vào new isolated target `PASS`.
- [ ] Restore verifies migrations, counts, latest rows, sequence metadata, ACL/RLS.
- [ ] Restore không overwrite active staging và không target UAT/canonical.
- [ ] Restore/cleanup commands có negative guard tests.

## 6. Deployment and smoke validation

- [ ] Artifact/configuration preflight `PASS`.
- [ ] Migration owner job `PASS`.
- [ ] Runtime bootstrap/ACL job `PASS`.
- [ ] Application runtime-only start `PASS`.
- [ ] `/api/health` qua TLS trả 200.
- [ ] `/api/ready` qua TLS trả 200 và không cache.
- [ ] TLS certificate/hostname/security headers `PASS`.
- [ ] Anonymous protected routes safe-deny/redirect.
- [ ] Admin latest-data/users/audit smoke `PASS`, không mutation controls.
- [ ] Lecturer/leader scope isolation và IDOR `PASS`.
- [ ] Pure admin không submit thay lecturer.
- [ ] No unexplained core/workflow/fingerprint delta.

## 7. Rollback and resilience

- [ ] Application image rollback rehearsal `PASS`.
- [ ] Forward-fix decision path được phê duyệt.
- [ ] New-target restore decision rehearsal `PASS`.
- [ ] Không reverse/delete applied migration.
- [ ] Không `UPDATE`/`DELETE`/`TRUNCATE` core/workflow để cleanup.
- [ ] App/DB failure containment và evidence preservation `PASS`.
- [ ] Không blind retry khi transaction/residue chưa rõ.

## 8. Operational validation

- [ ] Health/readiness/DB/TLS alerts `PASS`.
- [ ] Auth/audit/provisioning failure alerts dùng fake/redacted data `PASS`.
- [ ] Disk/CPU/memory/restart-loop alerts `PASS`.
- [ ] Logging redaction, access và rotation `PASS`.
- [ ] Credential rotation và staging session revoke rehearsals `PASS`.
- [ ] Incident severity/routing/support roster được phê duyệt.
- [ ] RPO/RTO, backup schedule, off-host retention, restore cadence được phê duyệt.
- [ ] Observation window ổn định; blocker/high defect bằng 0.

## 9. Evidence and repository hygiene

- [ ] Evidence chỉ có aggregate counts/digests/opaque references/PASS-FAIL.
- [ ] Tracked secret, credential, backup, dump, raw catalog, PII và private key bằng 0.
- [ ] Migration diff bằng 0; working tree/commit inventory rõ ràng.
- [ ] Canonical and staging fingerprints được reconcile; canonical mutation bằng 0.
- [ ] Explicit statement: no production deployment was performed.

## 10. Final sign-off

| Role | External approval reference | Decision |
| --- | --- | --- |
| Application owner |  | `PENDING` |
| Infrastructure owner |  | `PENDING` |
| Database owner |  | `PENDING` |
| Security owner |  | `PENDING` |
| Business smoke-scope owner |  | `PENDING` |

## 11. Machine-readable acceptance template

```text
PHASE6_STATUS=PENDING
PHASE6_SCOPE=STAGING_ONLY
STAGING_AUTHORIZATION=PENDING
STAGING_DEPLOYMENT=NOT_PERFORMED
DOMAIN=ueb-core.cargis.vn
PRE_DEPLOY_BACKUP=PENDING
BACKUP_RESTORE_REHEARSAL=PENDING
MIGRATION_DEPLOY=PENDING
RUNTIME_ACL=PENDING
HEALTH=PENDING
READINESS=PENDING
TLS=PENDING
RLS_DEFAULT_DENY=PENDING
SMOKE_TESTS=PENDING
ROLLBACK_REHEARSAL=PENDING
OPERATIONAL_VALIDATION=PENDING
UAT_DATABASE_REUSE=NO
UAT_CREDENTIAL_REUSE=NO
MASS_PROVISIONING=NO
UAT_CLEANUP=DEFERRED
PRODUCTION_SSO=OUT_OF_SCOPE
PRODUCTION_PROVISIONING=OUT_OF_SCOPE
PRODUCTION_DEPLOYMENT=NO
BLOCKER_DEFECT_COUNT=0
HIGH_DEFECT_COUNT=0
```
