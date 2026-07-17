# Phase 5 pilot UAT plan

## 1. Mục tiêu

Pilot UAT xác minh workflow Phase 4 với một nhóm identity nhỏ, được phê duyệt rõ ràng, trong môi trường non-production cô lập. Pilot tập trung vào correctness, authorization, usability và operational recovery; không phải mass rollout.

## 2. Điều kiện vào UAT

Không bắt đầu UAT cho tới khi:

- G0 repository/baseline còn `PASS`;
- formal business và identity approvals có hiệu lực;
- submit/reject `SERIALIZABLE` deviation đã đóng và `test:phase4` `PASS`;
- pilot manifest validation và provisioning dry-run `PASS`;
- backup exclusion và restore rehearsal `PASS`;
- provisioning apply/reconciliation trên UAT target `PASS`;
- exact-name guard chứng minh mọi UAT write từ chối canonical acceptance `ueb_core`;
- UAT owner, support contact, time window, stop authority và rollback decision maker đã chỉ định.

## 3. Pilot population

- Chỉ các identity trong approved manifest checksum được tham gia.
- Không mass-provision và không mở public registration.
- Mỗi lecturer có mapping unique; mỗi leader có unit scope explicit.
- Không suy luận email hoặc leader assignment.
- Pilot phải nhỏ, hữu hạn và đủ bao phủ các role/scenario được duyệt; tăng scope cần manifest version và approval mới.
- PII roster được lưu ngoài Git qua secure channel. Repository chỉ ghi count và opaque approval reference.

## 4. UAT environment

- Database riêng cho Phase 5 UAT, có name marker rõ và exact-name guard.
- Database name phải khác `ueb_core`; mọi command ghi phải refuse `ueb_core`.
- Không kết nối production.
- UAT baseline được backup và restore rehearsal thành công trước provisioning apply.
- Runtime dùng least-privilege role; owner chỉ dùng migration/controlled read-only verifier.
- Không dùng test runner destructive trên canonical acceptance.
- URL, secrets và credentials nằm ngoài Git/log.

## 5. Pre-UAT baseline

Ghi sanitized evidence:

- commit SHA và build/image digest;
- migration applied/pending;
- target fingerprint;
- core/workflow/import/auth aggregate counts;
- sequence metadata read-only, không gọi `nextval()`;
- runtime ACL và RLS default-deny;
- pilot manifest checksum và aggregate identity/role/scope counts;
- backup checksum và restore rehearsal reference.

## 6. Kịch bản

### Authentication và account lifecycle

1. Approved active pilot user đăng nhập thành công.
2. Unknown/disabled user bị từ chối bằng thông báo an toàn.
3. Logout/revoke session có hiệu lực.
4. Không có public sign-up, impersonation hoặc password/token display.

### Lecturer isolation và submission

1. Lecturer chỉ thấy latest rows/history/submissions của mapping của mình.
2. `CONFIRM_UNCHANGED` tạo đúng một `PENDING`, không insert core.
3. `UPDATE_EXISTING` chỉ nhận 14 editable fields và bảo vệ identity fields.
4. `CREATE_NEW` chưa có STT trước approval.
5. Double submit/stale base/forged locator safe-fail.
6. Submission detail có 19 payload fields, không lộ checksum/internal actor ID.

### Leader scope và rejection

1. Leader chỉ thấy queue của active unit scope.
2. Cross-unit detail/action bị từ chối không lộ dữ liệu.
3. Reject cần reason, tạo đúng một terminal event và không insert core.
4. Lecturer thấy trạng thái/reason và resubmit tạo submission mới giữ lineage/record UID.

### Approval

1. Approve pending tạo đúng một append-only core version và một `APPROVED` event.
2. Generated STT/version/result hiển thị đúng; old version không đổi.
3. Double-click/retry tạo đúng một result.
4. Approve/reject race có một winner.
5. Stale/checksum/scope failure không để lại core/terminal partial write.

### Audit và least privilege

1. Account/role/scope/session changes có audit.
2. Runtime không UPDATE/DELETE/TRUNCATE core/workflow.
3. No-context runtime nhìn thấy 0 core/workflow rows.
4. Log/evidence không chứa full payload, PII, secret hoặc credential.

## 7. Stop conditions

Dừng pilot ngay khi:

- phát hiện write vào `ueb_core` hoặc production target;
- cross-user/cross-unit data exposure;
- duplicate core version/terminal event;
- partial commit làm core/event mất atomicity;
- email/mapping/scope khác approved manifest;
- credential/PII xuất hiện trong log hoặc repository;
- backup/restore evidence không còn hợp lệ;
- migration drift, runtime privilege expansion hoặc rollback không khả thi.

Stop authority phải revoke sessions và kích hoạt rollback plan nếu rủi ro truy cập/dữ liệu còn tiếp diễn.

## 8. Evidence và issue handling

- Ghi scenario ID, role, expected/actual, exit code và opaque test identity reference.
- Không screenshot/email/name thật trong Git.
- Severity `BLOCKER`/`HIGH` phải đóng và retest trước exit.
- `MEDIUM`/`LOW` chỉ được defer khi có owner, deadline và risk acceptance reference.
- Mọi rerun phải ghi commit, manifest checksum và target fingerprint mới.

## 9. Exit criteria

Pilot `PASS` khi toàn bộ required scenarios đạt, không có blocker/high issue mở, reconciliation khớp, rollback vẫn khả thi, evidence đã loại PII và người đại diện nghiệp vụ/identity/security xác nhận.

Pilot `PASS` không cho phép production deployment. Nó chỉ là input cho staging readiness và Phase 5 acceptance.
