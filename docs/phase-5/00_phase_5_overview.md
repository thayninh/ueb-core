# Phase 5 — Controlled UAT and staging readiness

## 1. Mục tiêu

Phase 5 chuẩn bị một pilot UAT có kiểm soát và bộ bằng chứng staging readiness dựa trên nền tảng kỹ thuật Phase 4 đã nghiệm thu. Giai đoạn này chuyển các điều kiện còn mở về danh tính, provisioning, khả năng phục hồi và vận hành thành hard gate có bằng chứng.

Phase 5 không tự động đóng các điều kiện Phase 0. Một gate chỉ `PASS` khi có bằng chứng đã được người có thẩm quyền xác nhận; tài liệu kế hoạch hoặc kết quả kỹ thuật cũ không thay thế bằng chứng đó.

## 2. Baseline kế thừa

- Phase 4 local technical acceptance: `PASS`.
- Local canonical acceptance database `ueb_core`: 7 migration applied, 0 pending; 2.497 core rows; 0 workflow event tại thời điểm nghiệm thu Phase 4.
- Workflow, RLS, append-only, concurrency, IDOR và runtime least privilege đã có coverage trên database test cô lập.
- Real-user UAT, real-user provisioning, production SSO và production deployment chưa thực hiện.
- Formal business/infrastructure sign-off, leader assignment, off-host backup và restore evidence vẫn còn mở.

Baseline này là mốc đối chiếu, không phải môi trường để chạy UAT.

## 3. Phạm vi

Phase 5 gồm:

1. Xác định hard gate và bằng chứng bắt buộc.
2. Nhận input danh tính đã phê duyệt qua kênh ngoài Git.
3. Dry-run provisioning cho từng identity được duyệt.
4. Apply provisioning có xác nhận, giới hạn và rollback contract.
5. Chuẩn bị và thực hiện pilot UAT trên database UAT cô lập.
6. Rehearsal backup/restore của UEB Core và xác minh recovery.
7. Đánh giá cấu hình, bảo mật và vận hành staging.
8. Tổng hợp Phase 5 acceptance evidence.

## 4. Non-goals và giới hạn tuyệt đối

- Không mass-provision. Mỗi identity phải có approval record riêng và được xử lý theo danh sách pilot hữu hạn.
- Không suy luận email từ họ tên, mã cán bộ, đơn vị, chức danh hoặc pattern email.
- Không commit danh sách PII, email, họ tên, UUID nghiệp vụ, mật khẩu tạm, token, session, dump, audit output thô hoặc file provisioning input.
- Không chạy UAT hoặc tạo user/submission/workflow event/core row UAT trong canonical acceptance database `ueb_core`.
- Không production deployment, production migration, production provisioning, production SSO hoặc thay đổi production infrastructure.
- Không thay đổi business table model chỉ để phục vụ UAT hoặc staging.
- Không coi staging readiness là production authorization.

## 5. Phân tách môi trường

| Môi trường | Mục đích | Quy tắc dữ liệu |
| --- | --- | --- |
| Canonical local acceptance `ueb_core` | Baseline kỹ thuật Phase 4 | Chỉ kiểm tra read-only; không ghi UAT |
| Phase 5 UAT | Pilot user và workflow | Database riêng, exact-name guard, non-production, có backup/restore đã rehearsal |
| Restore rehearsal | Chứng minh khả năng phục hồi | Database tạm riêng; không restore đè UAT, acceptance hoặc production |
| Staging | Đánh giá deployment readiness | Chỉ dùng sau authorization riêng; không phải production |
| Production | Ngoài Phase 5 hiện tại | Không kết nối hoặc triển khai |

Mọi command có khả năng ghi phải kiểm tra hostname, database name và environment marker trước khi kết nối. UAT runner phải từ chối chính xác database `ueb_core`.

## 6. Deviation phải đóng trước UAT

Contract Phase 4 yêu cầu submit, reject và approve dùng transaction `SERIALIZABLE`. Hiện tại approve truyền explicit `Serializable`, còn submit và reject gọi transaction helper mà không truyền isolation level.

Đây là hard blocker cho pilot UAT. Deviation chỉ được đóng khi:

- implementation submit và reject dùng explicit `SERIALIZABLE`;
- integration/concurrency tests chứng minh đúng isolation và không hồi quy;
- `test:phase4`, lint, typecheck và build đều `PASS`;
- review xác nhận contract và implementation khớp nhau.

Không được dùng UAT để chấp nhận hoặc trì hoãn deviation này.

## 7. Trình tự kiểm soát

1. Đóng transaction isolation deviation.
2. Hoàn tất formal sign-off và identity approval input.
3. Xác minh backup artifacts bị loại khỏi Git/build context.
4. Chạy restore rehearsal và đạt `PASS`.
5. Chạy provisioning dry-run; xử lý mọi conflict.
6. Chỉ khi bước 3 và 4 `PASS`, xin authorization cho provisioning apply.
7. Chạy pilot UAT trên database cô lập.
8. Hoàn tất staging readiness review.
9. Ký Phase 5 acceptance.

## 8. Bộ tài liệu

- `01_hard_gate_matrix.md`: gate, trạng thái và bằng chứng.
- `02_identity_approval_input_contract.md`: input identity và PII handling.
- `03_provisioning_contract.md`: dry-run, apply và rollback.
- `04_pilot_uat_plan.md`: phạm vi và kịch bản pilot UAT.
- `05_backup_restore_rehearsal_plan.md`: backup exclusion và restore proof.
- `06_staging_readiness_plan.md`: cấu hình và operational readiness.
- `07_phase_5_acceptance.md`: checklist và sign-off cuối.
