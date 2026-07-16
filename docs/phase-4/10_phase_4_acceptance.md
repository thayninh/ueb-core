# Phase 4 local technical acceptance

## 1. Kết luận

```text
PHASE 4 TECHNICAL ACCEPTANCE: PASS
LOCAL ACCEPTANCE MIGRATIONS: APPLIED
LOCAL ACCEPTANCE RUNTIME ACL: RECONCILED
ROW-LEVEL SUBMISSION WORKFLOW: COMPLETED
REJECTION AND RESUBMISSION: COMPLETED
APPROVAL AND APPEND-ONLY VERSION INSERTION: COMPLETED
CORE APPEND-ONLY: PASS
WORKFLOW APPEND-ONLY: PASS
RLS AND IDOR TESTS: PASS
CONCURRENCY TESTS: PASS
LOCAL REAL-USER UAT: NOT PERFORMED
PRODUCTION DEPLOYMENT: NOT PERFORMED
PRODUCTION SSO: NOT CONFIGURED
REAL USER PROVISIONING: NOT PERFORMED
PHASE 0 EXTERNAL CONDITIONS: OPEN
```

Ngày nghiệm thu kỹ thuật: 2026-07-16. Phạm vi chỉ gồm local acceptance và database test cô lập; không có production connection.

## 2. Acceptance invariants

```text
core rows=2497
workflow events=0
import runs=1
MAX(stt)=2569
next stt=2570
migrations=7 applied, 0 pending
```

Ba migration Phase 4 và runtime ACL reconciliation đã được apply trên local acceptance mà không thay đổi legacy core rows, import run, sequence state hoặc tạo workflow event. Full Phase 4 tests chỉ dùng database được guard; không tạo test user, test submission hoặc test core row trên acceptance.

## 3. Technical acceptance coverage

- Ba submission type, latest row per `record_uid`, 20 display/19 payload fields và generated STT.
- Submission idempotency, one pending per record, rejection reason và resubmission lineage/record UID reuse.
- Leader queue/scope, 19-field diff, approve/reject actions và admin contract.
- One approval/one append-only core version, core-before-APPROVED atomic order, stale/checksum/uniqueness validation.
- Lecturer/leader/admin isolation, RLS default-deny, IDOR/forged INSERT and append-only negative tests.
- Double submit/approve/reject, approve-reject race và rollback tests.
- Runtime ACL reconciliation/least privilege, Prisma, data verifier, quality gates, E2E và container validation.

## 4. Real-user UAT và external gates

Local real-user UAT chưa được thực hiện và tiếp tục bị chặn cho tới khi:

- lecturer mappings được chủ dữ liệu phê duyệt;
- leader identities được người có thẩm quyền phê duyệt;
- assignment cho đủ sáu organization units được xử lý, không suy luận người/email;
- business decisions và formal sign-off hoàn tất theo Phase 0.

Production SSO, real-user provisioning và production deployment cần authorization/quy trình riêng. Phase 0 external conditions vẫn OPEN, gồm restore test hoàn chỉnh, off-host backup evidence, UEB Core backup/restore, infrastructure sign-off, credential/network review và rollback plan. Technical acceptance này không đóng hoặc thay thế bất kỳ gate UAT/production nào.
