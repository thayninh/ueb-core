# Phase 4 contract reconciliation

## 1. Phạm vi thay thế

Tài liệu này cung cấp technical reconciliation cho phát hiện ban đầu tại `00_phase_5_overview.md` và hard gate G2. Nó không thay đổi schema, migration, RLS policy, append-only model hoặc business state machine của Phase 4.

Technical reconciliation và test `PASS` không tự tạo approval cho contract amendment. Không được chạy real-user UAT cho đến khi amendment này được authority có thẩm quyền phê duyệt bằng approval reference ngoài tài liệu này.

## 2. Transaction và lock contract

Ba mutation service submit, reject và approve đều phải truyền explicit Prisma transaction isolation `Serializable`.

Trong mỗi transaction, lock order bắt buộc là:

```text
SUBMISSION_ID -> RECORD_UID
```

Submission lock bảo vệ idempotency và serialization theo submission trước khi service resolve rồi lock logical record. Không được đảo thứ tự này. Transaction-local RLS context vẫn được thiết lập bởi transaction helper; workflow event và core data tiếp tục append-only.

Khi PostgreSQL/Prisma trả conflict `P2034`, submit service retry toàn bộ transaction với giới hạn tối đa ba attempt. Mỗi attempt tạo transaction và RLS context mới; lỗi nghiệp vụ và các lỗi khác không được retry.

## 3. Submission ID contract

`submissionId` là idempotency key ổn định cho một ý định submit. UI có thể đề xuất UUID để giữ cùng key khi retry, nhưng giá trị này là input không tin cậy.

Server Action tiếp nhận `submissionId` từ `FormData`, từ chối duplicate/unknown fields và validate bằng strict Zod schema với `z.uuid()` trước khi gọi workflow service. Service không suy luận hoặc thay thế key khi retry; nó lock `submissionId`, tìm event hiện hữu và chỉ trả lại kết quả nếu payload, principal và submission contract khớp. Authorization, lecturer identity, approval unit và record state vẫn được resolve lại ở server.

Không dựa vào việc UI tuần tự hóa Server Action để bảo đảm concurrency. Database transaction, advisory locks, constraints và idempotency checks là cơ chế authoritative khi các request đồng thời đến server.

## 4. Regression evidence

Gate G2 yêu cầu đồng thời:

- transaction contract test chứng minh cả ba service truyền explicit `Serializable`;
- contract test chứng minh `lockSubmission` đứng trước `lockRecord`;
- các test double-submit, double-reject, approve/reject race và rollback hiện có tiếp tục `PASS`;
- format, lint, typecheck, toàn bộ `test:phase4` và build đều `PASS`.

## 5. Machine-readable summary

```text
TRANSACTION_ISOLATION=SERIALIZABLE
SERIALIZATION_CONFLICT_RETRY=P2034_MAX_3_ATTEMPTS
LOCK_ORDER=SUBMISSION_ID,RECORD_UID
CONTRACT_AMENDMENT_APPROVAL=PENDING
SUBMISSION_ID_SOURCE=SERVER_ACTION_ACCEPTED_INPUT
SUBMISSION_ID_VALIDATION=STRICT_UUID
SUBMISSION_ID_ROLE=IDEMPOTENCY_KEY
RLS_CONTEXT=TRANSACTION_LOCAL
CORE_DATA_BEHAVIOR=APPEND_ONLY
WORKFLOW_EVENT_BEHAVIOR=APPEND_ONLY
```
