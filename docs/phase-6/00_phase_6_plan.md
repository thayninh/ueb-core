# Phase 6 plan — staging rollout and operational validation

## 1. Executive status

Phase 6 lập kế hoạch triển khai có kiểm soát lên **staging** và xác minh khả
năng vận hành. Tài liệu này không phải authorization triển khai và không ghi
nhận staging đã được tạo.

```text
PHASE6_STATUS=PLANNING
PHASE6_SCOPE=STAGING_ONLY
STAGING_DEPLOYMENT=NOT_AUTHORIZED
PRODUCTION_DEPLOYMENT=OUT_OF_SCOPE
PLANNED_DOMAIN=ueb-core.cargis.vn
```

Phase 5 đã nghiệm thu controlled UAT, backup/restore rehearsal, least-privilege
roles, KTPT pilot UAT và staging configuration contract. Phase 6 chỉ được bắt
đầu thao tác hạ tầng khi các authorization gates trong
`01_staging_authorization_gates.md` được phê duyệt rõ ràng.

## 2. Mục tiêu

1. Chốt authorization, owner, change window và staging target.
2. Chuẩn bị staging database, secret store, immutable image, private network và
   TLS mà không tái sử dụng UAT database hoặc credential.
3. Rehearse tuần tự backup, migration, runtime ACL, app start và rollback.
4. Xác minh health, readiness, TLS, RLS default deny, role/scope isolation và
   read-only smoke tests.
5. Xác minh monitoring, log rotation, backup/off-host copy, restore, incident và
   credential/session procedures.
6. Tạo evidence đã khử nhạy cảm để quyết định staging acceptance.

## 3. Phạm vi

- Dedicated staging PostgreSQL database và named volume riêng.
- Production standalone image chạy non-root sau Caddy tại domain dự kiến
  `ueb-core.cargis.vn`.
- Ba database identities tách biệt: migration owner, application runtime và
  provisioning role.
- Pre-deploy backup, checksum/catalog, off-host copy và guarded restore
  rehearsal.
- Migration deploy, runtime-role/ACL reconciliation và app start là ba operator
  steps độc lập.
- Staging-only smoke identities tối thiểu, được phê duyệt rõ ràng.
- Monitoring/alerting, backup/restore, rollback và observation window.

## 4. Non-goals

- Không triển khai production.
- Không cấu hình production SSO.
- Không provision production identities.
- Không mass-provision real users trên staging.
- Không dùng `ueb_core_uat_phase5` làm staging database.
- Không copy UAT password, session, token, roster hoặc credential sang staging.
- Không thay đổi business schema, applied migration, RLS hoặc workflow contract
  chỉ để triển khai staging.
- Không cleanup `ueb_core_uat_phase5` cho đến khi Phase 6 plan được phê duyệt và
  có quyết định retention/cleanup riêng.

## 5. Nguyên tắc an toàn

- Mọi secret ở external secret store; không nằm trong Git, Compose render,
  command transcript hoặc evidence.
- Staging owner, runtime và provisioning roles phải khác nhau. Runtime và
  provisioning là non-owner, non-superuser, `NOBYPASSRLS`.
- App container chỉ nhận runtime `DATABASE_URL`; không nhận owner/migration hoặc
  provisioning credential.
- PostgreSQL không publish public host port. App chỉ được Caddy truy cập qua
  private/external proxy network đã phê duyệt.
- Không bypass guard bằng raw `createdb`, `pg_restore`, broad grants hoặc owner
  connection trong application request.
- Không `UPDATE`, `DELETE` hoặc `TRUNCATE` core/workflow để cleanup rehearsal.
- Không retry migration/provisioning/workflow khi transaction status hoặc residue
  chưa được reconcile.

## 6. Workstreams

| Workstream | Nội dung | Exit gate |
| --- | --- | --- |
| A. Authorization | Target, DNS/TLS, owners, window, RPO/RTO, data class | Tất cả mandatory approvals có external reference |
| B. Environment | Host/network/volume/image/secret/role separation | Static contract và secret handling `PASS` |
| C. Data safety | Pre-deploy backup, checksum/catalog, off-host copy, restore | Backup và guarded restore rehearsal `PASS` |
| D. Rollout rehearsal | Migration, ACL, app start, probes, smoke, fingerprint | Ordered rehearsal không có unexplained delta |
| E. Operations | Logs, alerts, capacity, incident, rotation, sessions | Operational validation `PASS` |
| F. Acceptance | Evidence, defects, external sign-off | Phase 6 checklist quyết định `PASS` hoặc `FAIL` |

## 7. Thứ tự thực hiện dự kiến

1. Phê duyệt Phase 6 plan và authorization matrix.
2. Chốt staging target, database name, domain/DNS/TLS và change window.
3. Chốt immutable image digest, source commit và rollback image.
4. Tạo riêng owner/runtime/provisioning identities và staging secrets.
5. Kiểm tra Compose/Caddy contract bằng dữ liệu placeholder hoặc redacted key
   inventory; không log rendered secret values.
6. Chạy pre-deploy backup, checksum/catalog và off-host-copy verification.
7. Rehearse restore vào guarded isolated staging-rehearsal target.
8. Chạy migration owner job.
9. Chạy runtime role bootstrap và exact ACL reconciliation.
10. Start/update app bằng runtime credential duy nhất.
11. Chạy health, readiness, TLS, migration status và RLS default deny.
12. Chạy anonymous/admin/pilot role-scope smoke tests không tạo core/workflow
    mutation ngoài kịch bản được phê duyệt.
13. Rehearse application rollback và new-target restore decision path.
14. Chạy operational/monitoring observation window và final reconciliation.
15. Lập Phase 6 acceptance evidence; không suy ra production readiness.

## 8. Global stop conditions

Dừng ngay khi thiếu explicit authorization; target không rõ; UAT/production
credential xuất hiện; database target là `ueb_core_uat_phase5`; backup/checksum/
catalog/off-host copy fail; migration hoặc ACL drift; runtime là owner/superuser/
`BYPASSRLS`; health/readiness/TLS fail; RLS visibility khác 0; public database
port; secret/PII leak; unexplained data delta; blocker/high defect hoặc rollback
path chưa chứng minh.

## 9. Evidence contract

Evidence commit chỉ gồm commit/image digest, opaque authorization/change
reference, aggregate counts, checksums được phép, timestamps, PASS/FAIL và defect
IDs đã khử nhạy cảm. Không commit URL đầy đủ, password, token, cookie, identity
roster, internal user ID, database dump, raw catalog hoặc unredacted logs.

## 10. Machine-readable plan status

```text
PHASE6_PLAN=DEFINED
STAGING_AUTHORIZATION=REQUIRED
STAGING_DOMAIN=ueb-core.cargis.vn
ROLE_SEPARATION=REQUIRED
PRE_DEPLOY_BACKUP=REQUIRED
BACKUP_RESTORE_REHEARSAL=REQUIRED
ROLLBACK_REHEARSAL=REQUIRED
HEALTH_READINESS_TLS=REQUIRED
RLS_DEFAULT_DENY=REQUIRED
UAT_DATABASE_REUSE=FORBIDDEN
UAT_CREDENTIAL_REUSE=FORBIDDEN
MASS_PROVISIONING=FORBIDDEN
PRODUCTION_SSO=OUT_OF_SCOPE
PRODUCTION_PROVISIONING=OUT_OF_SCOPE
PRODUCTION_DEPLOYMENT=OUT_OF_SCOPE
UAT_CLEANUP=DEFERRED_UNTIL_PLAN_APPROVAL
```
