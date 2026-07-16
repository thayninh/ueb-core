# Phase 5 acceptance checklist

## 1. Trạng thái khởi tạo

```text
PHASE5_ACCEPTANCE=NOT_READY
REAL_USER_PROVISIONING=NOT_PERFORMED
PILOT_UAT=NOT_PERFORMED
STAGING_DEPLOYMENT=NOT_PERFORMED
PRODUCTION_DEPLOYMENT=NOT_PERFORMED
```

Tài liệu này là checklist; việc đánh dấu chỉ hợp lệ khi có evidence reference đã loại PII.

## 2. Repository và Phase 4 baseline

- [ ] Candidate commit/branch được ghi nhận, working tree sạch.
- [ ] HEAD chứa Phase 4 merge commit đã xác nhận.
- [ ] Format, lint, typecheck, full tests và build `PASS`.
- [ ] `test:phase4` `PASS` trên database test cô lập.
- [ ] Prisma schema valid; migration status expected và không pending/failed.
- [ ] Canonical acceptance `ueb_core` không có UAT write.

## 3. Transaction contract

- [ ] Submit explicit `SERIALIZABLE`.
- [ ] Reject explicit `SERIALIZABLE`.
- [ ] Approve explicit `SERIALIZABLE`.
- [ ] Submit/reject/approve/resubmit dùng consistent advisory lock namespace.
- [ ] Isolation/concurrency/atomic rollback tests `PASS`.
- [ ] Submit/reject `SERIALIZABLE` deviation được review và đóng trước UAT.

Nếu mục này chưa hoàn tất, pilot UAT bị `BLOCKED`.

## 4. Identity approval

- [ ] Formal business/identity approval có hiệu lực.
- [ ] Pilot manifest có checksum và opaque approval reference.
- [ ] Không mass-provision; mỗi identity được duyệt riêng.
- [ ] Không có email suy luận.
- [ ] Lecturer email-to-UID mapping unique.
- [ ] Existing account được reuse/review, không tạo duplicate.
- [ ] Mọi pilot leader có approved active unit scope.
- [ ] Không có PII roster, credential hoặc raw audit trong Git.

## 5. Backup và restore gates

- [ ] Backup artifact không bị Git track.
- [ ] Backup/manifest/raw evidence không vào Docker build context/image.
- [ ] Backup checksum/archive readability `PASS`.
- [ ] Restore target exact-name/local/non-production guard `PASS`.
- [ ] Full restore, schema/data/sequence reconciliation `PASS`.
- [ ] ACL/RLS/default-deny sau restore `PASS`.
- [ ] Restore database cleanup `PASS`.
- [ ] Backup exclusion và restore rehearsal đều `PASS` trước provisioning apply.

## 6. Provisioning

- [ ] Dry-run dùng đúng manifest checksum và UAT target fingerprint.
- [ ] Dry-run database writes = 0 và blockers = 0.
- [ ] Apply authorization, confirmation và rollback manifest được duyệt.
- [ ] Target khác canonical acceptance `ueb_core` và production.
- [ ] Apply count khớp plan; không wildcard/mass-provision.
- [ ] Audit, role, mapping và unit scope reconciliation `PASS`.
- [ ] Credential delivery không xuất hiện trong repository/log.
- [ ] Rollback walkthrough hoặc rehearsal `PASS`.

## 7. Pilot UAT

- [ ] Database UAT cô lập và guard từ chối `ueb_core`.
- [ ] Pre-UAT sanitized baseline được ghi nhận.
- [ ] Authentication/account lifecycle scenarios `PASS`.
- [ ] Lecturer ownership/IDOR/submission scenarios `PASS`.
- [ ] Leader scope/reject/resubmit scenarios `PASS`.
- [ ] Approval/version/STT/idempotency scenarios `PASS`.
- [ ] Concurrency/atomicity/append-only scenarios `PASS`.
- [ ] Runtime least privilege và RLS default-deny `PASS`.
- [ ] Không có blocker/high issue mở.
- [ ] Post-UAT reconciliation và evidence hygiene `PASS`.

## 8. Staging readiness

- [ ] Environment/network/database isolation được duyệt.
- [ ] Private database, role separation và secret handling `PASS`.
- [ ] Migration deploy/ACL reconciliation/verifier runbook được review.
- [ ] Health/readiness, monitoring, disk và log rotation `PASS`.
- [ ] Backup/restore/off-host plan có owner và evidence phù hợp.
- [ ] Incident/rollback/change window/contact matrix hoàn tất.
- [ ] Staging data và identity authorization tách biệt, không mass-provision.
- [ ] `STAGING_READINESS=PASS` được ký nhưng chưa deploy trong checklist này.

## 9. Non-goals verification

- [ ] Không production connection hoặc deployment.
- [ ] Không production migration/provisioning/SSO change.
- [ ] Không UAT write vào canonical acceptance database.
- [ ] Không commit PII, Excel, `.env`, dump, raw audit hoặc credential.
- [ ] Không thay đổi business table model ngoài authorization riêng.

## 10. Final evidence summary

```text
PHASE5_ACCEPTANCE=
PHASE4_BASELINE=
SERIALIZABLE_DEVIATION_CLOSED=
IDENTITY_APPROVAL=
MASS_PROVISIONING=NO
INFERRED_EMAILS=0
PII_FILES_COMMITTED=0
BACKUP_EXCLUSION=
RESTORE_REHEARSAL=
PROVISIONING_DRY_RUN=
PROVISIONING_APPLY=
PILOT_UAT=
CANONICAL_ACCEPTANCE_UAT_WRITES=0
STAGING_READINESS=
STAGING_DEPLOYMENT=NOT_PERFORMED
PRODUCTION_DEPLOYMENT=NOT_PERFORMED
BLOCKER_COUNT=
HIGH_RISK_COUNT=
```

Giá trị kết luận dùng `PASS`, `BLOCKED`, `NOT_PERFORMED` hoặc số nguyên phù hợp.

## 11. Sign-off

Phase 5 chỉ `PASS` khi checklist bắt buộc hoàn tất và có xác nhận của:

- chủ sở hữu nghiệp vụ;
- chủ sở hữu dữ liệu/identity;
- đại diện an toàn thông tin;
- đại diện kỹ thuật/hạ tầng;
- người chịu trách nhiệm UAT.

Phase 5 acceptance không phải authorization production. Production cần gate, backup/off-host/restore evidence, SSO/security review, change approval và deployment plan riêng.
