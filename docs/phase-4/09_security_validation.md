# Security validation Phase 4

## 1. Identity, scope và IDOR

Isolated integration/E2E coverage chứng minh:

- lecturer chỉ đọc current rows, history và submissions của đúng `lecturer_uid` mapping;
- leader chỉ đọc/quyết định submission thuộc exact active unit scope; multi-unit là union, no-scope là 0;
- active admin có toàn bộ workflow access theo contract;
- forged record/submission/unit locator safe-deny và không tiết lộ resource của người khác;
- disabled profile, revoked role/scope và missing request context mất quyền ngay.

Server Actions dùng strict schemas, reauthorize server-side và không nhận `lecturer_uid`, approval routing, generated STT/version hoặc approval metadata từ client. Unknown database errors không lộ stack, payload hay credential.

## 2. RLS và least privilege

Workflow SELECT/SUBMITTED/terminal RLS và core SELECT/approved INSERT RLS đều dựa trên transaction-local `app.current_user_id` rồi đọc profile/role/scope hiện hành từ database. No-context runtime SELECT trả 0 row; direct forged INSERT bị RLS, constraint hoặc trigger từ chối.

Local runtime role đã được xác minh non-owner, non-superuser và `NOBYPASSRLS`. ACL tối thiểu là core SELECT/INSERT, workflow SELECT/INSERT và STT sequence USAGE; không có core/workflow UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER hoặc sequence SELECT/UPDATE. Core/workflow append-only triggers chặn mutation kể cả khi dùng owner trong negative tests.

Operational permission script có static tests cho confirmation/expected-database/SQL safety và integration test reconciliation hai lần. Test chứng minh script idempotent, transactional, không đổi data/sequence/RLS, không dùng runtime URL để grant và không cấp wildcard/ALL/owner/BYPASSRLS.

## 3. Payload và database defenses

Canonical checksum chỉ bao phủ đúng 19 payload fields theo thứ tự khóa cố định; generated `stt` và base/result metadata bị loại. Tests sửa payload/checksum, identity/routing, provenance, technical fields, explicit STT và duplicate source submission đều bị từ chối.

`source_submission_id` unique toàn cục bảo vệ one approval/one core row. Event shape/base/parent checks, one-SUBMITTED/one-terminal partial indexes và unique `(record_uid, version_no)` bảo vệ history/version integrity. Approval trigger tái kiểm tra payload count/checksum, actor/scope, stale base và core values tại database boundary.

## 4. Concurrency và atomicity

PostgreSQL integration tests bao phủ double submit, double approve, double reject và approve/reject race. Advisory locks, `SERIALIZABLE` transaction và uniqueness tạo đúng một winner. Failure khi ghi `APPROVED` sau core INSERT làm rollback core row; stale/checksum/scope failure không để lại terminal hay core. Reject không insert core.

Kết quả full rehearsal local ghi nhận latest read model, history, submit, reject, resubmit, approval, RLS/IDOR, forged INSERT, append-only, concurrency và atomic rollback đều PASS. Mọi database test chạy trên database local có exact-name guard và cleanup; acceptance `ueb_core` không chứa test submission.

## 5. Secret và evidence hygiene

Fixture chỉ dùng UUID/email giả và placeholder environment values. Test, log và tài liệu không chứa email/password/token/connection credential thật. `.env`, Excel source, backup và `infra/audit` output không được track; audit summaries chỉ là local evidence, không phải artifact commit.
