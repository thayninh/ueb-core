# Kế hoạch Giai đoạn 4 — Workflow theo từng dòng

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | CONTRACT PLANNING |
| Nhánh | `feat/phase-4-row-workflow` |
| Phạm vi môi trường | Thiết kế và contract; không ghi database |
| Production activation | NOT AUTHORIZED |

## 1. Mục tiêu

Giai đoạn 4 bổ sung workflow bất biến cho từng logical row. Mỗi submission xử lý đúng một `record_uid`; workflow không đại diện cho snapshot toàn bộ hồ sơ giảng viên. Một approval thành công tạo đúng một phiên bản mới trong `ueb_core_data` bằng `INSERT`, còn rejection không tạo core row.

Nhiệm vụ contract này khóa trước:

- ba submission type và ba event type;
- state machine, pending và resubmit;
- đúng 6 trường chỉ đọc và 14 trường được sửa;
- cách lấy phiên bản hiện hành theo từng `record_uid`;
- dữ liệu do server suy ra và tuyến phê duyệt;
- transaction, concurrency, idempotency và stale-base handling;
- đề xuất RLS/permission và negative test matrix.

Contract máy đọc được nằm tại `config/phase-4/workflow-policy.ts`.

## 2. Trong phạm vi triển khai Phase 4 sau bước contract

1. Hoàn thiện schema `workflow_event` từ skeleton Phase 2 nhưng giữ mô hình nhiều event append-only cùng `submission_id`.
2. Bổ sung constraint/index để bảo vệ event chain, terminal exclusivity và idempotency.
3. Cho phép provenance của core row phân biệt legacy import với approved submission.
4. Bổ sung RLS và quyền tối thiểu cho đọc/ghi workflow cùng core `INSERT` đã duyệt.
5. Xây transaction service cho submit, reject và approve.
6. Chuyển các truy vấn portal sang latest-version-per-`record_uid`.
7. Bổ sung unit, integration, concurrency, RLS và E2E tests cho workflow.
8. Hiển thị trạng thái trong hệ thống; chưa gửi email.

Mỗi mục trên cần checkpoint triển khai riêng. Tài liệu hiện tại không thực hiện các thay đổi đó.

## 3. Ngoài phạm vi

- Cài package mới.
- Sửa Prisma schema hoặc tạo migration trong bước contract.
- Server Action, Route Handler hoặc transaction service thực thi.
- UI submit/reject/approve.
- Ghi, sửa, xóa hoặc reset database.
- Email notification.
- Public signup, production SSO hoặc production deployment.
- Suy luận lãnh đạo, email lãnh đạo hoặc tạo leader giả.
- Thay đổi tài liệu Phase 0–3.

## 4. Quyết định kiến trúc đã khóa

- `CONFIRM_UNCHANGED`, `UPDATE_EXISTING`, `CREATE_NEW` là ba submission type duy nhất.
- `SUBMITTED`, `REJECTED`, `APPROVED` là ba event type duy nhất.
- Một submission có đúng một `SUBMITTED` và tối đa một terminal event.
- `REJECTED` và `APPROVED` loại trừ lẫn nhau, đều terminal.
- Một `record_uid` có tối đa một submission `PENDING`.
- Một giảng viên có thể có nhiều submission `PENDING` nếu `record_uid` khác nhau.
- Resubmit sau rejection dùng `submission_id` mới và liên kết bằng `parent_submission_id`.
- Core và workflow event đều append-only.
- `stt` chỉ do PostgreSQL sequence cấp khi approval; application không dùng `MAX(stt)`.
- Dữ liệu hiện hành là dòng có `version_no` lớn nhất trong từng `record_uid`.
- Mỗi approval dùng `snapshot_id` mới như batch ID của đúng một dòng.
- `source_submission_id` phải unique toàn cục trong core.

## 5. Khoảng cách với schema hiện tại

Schema hiện tại là nền tảng Phase 2–3 và chưa đủ để triển khai contract này:

- `workflow_event` mới là skeleton và chưa có constraint cho submission type, event transition, một `SUBMITTED` hoặc một terminal event.
- `ueb_core_data.source_import_run_id`, `source_row_number` và `source_row_checksum` đang bắt buộc cho legacy provenance; approved rows cần provenance theo submission mà không giả lập import metadata.
- unique index hiện tại đặt trên `(source_submission_id, record_uid)`; contract Phase 4 yêu cầu partial unique trên riêng `source_submission_id` khi khác `NULL`.
- RLS `ueb_core_data` hiện chỉ có policy `SELECT`; runtime chưa có core `INSERT` policy.
- Các DAL Phase 3 hiện trả toàn bộ lịch sử phù hợp scope; Phase 4 phải trả một latest row cho mỗi `record_uid`.

Các khoảng cách này chỉ là đầu vào cho migration review sau. Không sửa schema hoặc migration trong bước contract.

## 6. Checkpoint triển khai dự kiến

### CP4-0 — Contract

- [x] Scope, non-goals và invariants được ghi rõ.
- [x] State machine và field policy được khóa.
- [x] Transaction, concurrency, RLS và negative tests được lập kế hoạch.
- [x] Contract TypeScript thuần được tạo.
- [x] Không có schema, migration, workflow code, UI hoặc database write.

### CP4-1 — Schema review

- [ ] Thiết kế migration được review mà không sửa migration cũ.
- [ ] Provenance legacy/approved không tạo dữ liệu giả.
- [ ] Event và core uniqueness phản ánh đúng contract.
- [ ] Append-only triggers tiếp tục bảo vệ core và workflow event.

### CP4-2 — Transaction service

- [ ] Submit/reject/approve chạy trong transaction `SERIALIZABLE`.
- [ ] Advisory lock theo `record_uid` được dùng nhất quán.
- [ ] Approval atomically ghi một terminal event và đúng một core row.
- [ ] Stale base, duplicate request và concurrent request bị chặn.

### CP4-3 — Security và data access

- [ ] Principal, role và unit scope được đọc lại từ database.
- [ ] Workflow RLS và core INSERT policy mặc định từ chối.
- [ ] Portal chỉ trả latest version theo từng `record_uid`.
- [ ] Negative authorization/IDOR/RLS tests đạt.

### CP4-4 — UI và local acceptance

- [ ] UI hiển thị trạng thái trong hệ thống, không gửi email.
- [ ] Ba submission type và resubmit được kiểm thử end-to-end.
- [ ] Concurrency/idempotency tests chứng minh không duyệt hai lần.
- [ ] Phase 2 legacy data và append-only invariants không thay đổi.

## 7. Cổng UAT và production tiếp tục OPEN

Technical contract Phase 4 không đóng bất kỳ điều kiện Phase 0 nào. Formal business sign-off, lãnh đạo đơn vị, restore, off-host backup, backup/restore UEB Core và infrastructure sign-off tiếp tục `OPEN` theo hồ sơ Phase 0–3.

Ngoài ra, trước external UAT phải có migration review, security acceptance, người phê duyệt hợp lệ và bằng chứng workflow acceptance. Production cần yêu cầu triển khai riêng, backup/restore thành công, credential/network review và rollback plan. Không nội dung nào trong contract này cho phép kết nối hoặc triển khai production.
