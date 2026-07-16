# Workflow state machine Phase 4

## 1. Event model

`workflow_event` là append-only. State không được cập nhật trên event cũ; nó được suy ra từ các event có cùng `submission_id`.

| Event history hợp lệ | Derived state |
| --- | --- |
| `SUBMITTED` | `PENDING` |
| `SUBMITTED → REJECTED` | `REJECTED` |
| `SUBMITTED → APPROVED` | `APPROVED` |

Mọi history khác đều không hợp lệ, gồm terminal không có `SUBMITTED`, nhiều `SUBMITTED`, nhiều terminal, cả `REJECTED` và `APPROVED`, hoặc event sau terminal.

## 2. Bảng chuyển trạng thái

| Current state | Event yêu cầu | Next state | Side effect |
| --- | --- | --- | --- |
| Chưa tồn tại | `SUBMITTED` | `PENDING` | Insert đúng một workflow event; không insert core |
| `PENDING` | `REJECTED` | `REJECTED` | Insert đúng một terminal event; không insert core |
| `PENDING` | `APPROVED` | `APPROVED` | Cùng transaction insert terminal event và đúng một core row |
| `REJECTED` | Bất kỳ event nào | Không hợp lệ | Từ chối, không ghi gì |
| `APPROVED` | Bất kỳ event nào | Không hợp lệ | Từ chối, không ghi gì |

`REJECTED` và `APPROVED` là terminal và loại trừ lẫn nhau.

## 3. Invariants bắt buộc

1. Một submission xử lý đúng một `record_uid`.
2. Một submission có đúng một `SUBMITTED` event.
3. Một submission có tối đa một terminal event.
4. Terminal event chỉ là `REJECTED` hoặc `APPROVED`.
5. Mọi event cùng submission phải có cùng `lecturer_uid`, `record_uid` và `approval_unit` như `SUBMITTED`.
6. Actor của `SUBMITTED` là active lecturer principal tương ứng.
7. Actor terminal là active `ADMIN` hoặc active `FACULTY_LEADER` có unit scope khớp.
8. Một `APPROVED` tương ứng đúng một core row; một `REJECTED` tương ứng không core row.
9. Không `UPDATE`, `DELETE` hoặc `TRUNCATE` workflow event/core data.
10. Một `record_uid` có tối đa một state `PENDING` tại một thời điểm.

## 4. Database constraints đề xuất cho bước migration sau

Contract yêu cầu migration tương lai có các lớp bảo vệ tối thiểu:

- check constraint cho đúng ba event type và đúng ba submission type;
- partial unique index trên `submission_id` khi `event_type = 'SUBMITTED'`;
- partial unique index trên `submission_id` khi `event_type IN ('REJECTED', 'APPROVED')`;
- partial unique index trên riêng `ueb_core_data.source_submission_id` khi khác `NULL`;
- uniqueness của `(record_uid, version_no)`;
- trigger/constraint xác nhận terminal event khớp immutable fields của `SUBMITTED`;
- append-only triggers hiện có tiếp tục chặn mutation.

Pending uniqueness không thể được suy ra bằng một partial index chỉ nhìn từng event vì terminal event giải phóng logical pending state. Nó phải được bảo vệ bằng advisory lock theo `record_uid`, state query trong cùng transaction và database validation phù hợp. Concurrent tests là gate bắt buộc.

## 5. Rejection

Rejection yêu cầu reason đã validate, không rỗng và có giới hạn độ dài ở application contract. Reason thuộc terminal event; không sửa payload `SUBMITTED`. Rejection không cấp `stt`, không tạo snapshot và không insert core.

Resubmit không chuyển state của submission cũ. Nó tạo event chain mới, dùng `parent_submission_id` để giữ audit lineage.

## 6. Approval

Approval chỉ hợp lệ khi state đang `PENDING`, principal có quyền tại thời điểm xử lý và base chưa stale. `APPROVED` event cùng core insert phải commit hoặc rollback cùng nhau.

Nếu stale-base, authorization, uniqueness, validation hoặc core insert thất bại:

- không insert `APPROVED`;
- không insert core row;
- không tiêu thụ kết quả nghiệp vụ thành công;
- trả conflict/forbidden/validation error phù hợp.

Stale approval attempt không tự tạo `REJECTED`, vì rejection là terminal business decision riêng. Submission giữ `PENDING` cho tới khi người có quyền reject hoặc một quy tắc nghiệp vụ mới được phê duyệt.

## 7. Unassigned-unit behavior

Một unit active nhưng chưa có leader assignment vẫn nhận `SUBMITTED` và giữ `PENDING`. Khi xử lý terminal:

- active `ADMIN` được phép xử lý;
- `FACULTY_LEADER` chỉ được xử lý nếu có active scope khớp exact `approval_unit`;
- leader không scope, leader của unit khác và lecturer đều bị từ chối.

Không có notification email trong Phase 4. Trạng thái chỉ hiển thị trong hệ thống.
