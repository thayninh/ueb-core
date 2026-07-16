# Security, RLS và negative-test plan Phase 4

## 1. Trust boundaries

- Session cookie chỉ xác thực request; role, lecturer mapping và unit scope phải đọc từ database.
- `lecturer_uid` lấy từ active principal, không từ form/URL.
- `record_uid` từ client chỉ là locator chưa tin cậy; server resolve và authorize lại.
- `approval_unit` lấy từ current core/canonical lecturer data.
- `approved_by` lấy từ current terminal actor.
- Field allowlist áp dụng trước khi tạo canonical `SUBMITTED` payload.
- DAL/application authorization và PostgreSQL RLS cùng bảo vệ; UI/proxy không phải security boundary.

Runtime role tiếp tục khác owner, `NOBYPASSRLS`, không `SUPERUSER` và không có quyền schema mutation.

## 2. RLS proposal cho `workflow_event`

Migration triển khai sau phải bật RLS trên `workflow_event`. Policy dùng `app.current_user_id` transaction-local và default-deny khi thiếu context.

### SELECT

Cho phép row khi current user có active profile và ít nhất một grant:

- active `ADMIN`: đọc mọi workflow event;
- active `LECTURER`: `profile.lecturer_uid = event.lecturer_uid`;
- active `FACULTY_LEADER`: có active unit assignment tới active `organization_unit` với exact `source_value = event.approval_unit`.

Multiple roles/units lấy union. Leader không scope hoặc unit inactive thấy 0 row từ leader grant. Parent lookup cũng phải đi qua policy này để tránh IDOR.

### INSERT `SUBMITTED`

`WITH CHECK` tối thiểu yêu cầu:

- current user có active profile, active `LECTURER` role và non-null mapping;
- event `actor_user_id = current user`;
- event `lecturer_uid = profile.lecturer_uid`;
- `event_type = SUBMITTED`;
- `approval_unit` ánh xạ exact active organization unit;
- server transaction/constraints xác nhận record ownership, field policy, parent, pending và canonical payload.

RLS không được coi raw JSON payload là thẩm quyền.

### INSERT terminal event

`WITH CHECK` yêu cầu event `REJECTED`/`APPROVED`, `actor_user_id = current user`, matching `SUBMITTED` tồn tại và current user là:

- active `ADMIN`; hoặc
- active `FACULTY_LEADER` với active exact unit scope của submission.

Database validation phải buộc terminal `lecturer_uid`, `record_uid`, `approval_unit` và `submission_id` khớp `SUBMITTED`. Không có policy `UPDATE`/`DELETE`; runtime không có các privilege đó và append-only triggers vẫn bật.

## 3. Core `INSERT` policy đề xuất

RLS `ueb_core_data` giữ SELECT policy Phase 3 nhưng current-data DAL phải lọc latest version. Approval dùng đúng thứ tự atomic sau trong một transaction:

1. xác minh submission có đúng một `SUBMITTED` event và chưa có terminal event;
2. authorize current actor là active `ADMIN`, hoặc active `FACULTY_LEADER` có exact active unit scope khớp stored `approval_unit`;
3. lấy advisory lock theo `record_uid`, đọc lại current state và từ chối stale base;
4. insert đúng một core row mà không truyền `stt`, dùng `INSERT ... RETURNING stt, version_no` để lấy kết quả PostgreSQL thực tế;
5. insert `APPROVED` event với `result_stt` và `result_version_no` từ kết quả `RETURNING`;
6. commit cả core row và terminal event; nếu insert `APPROVED` hoặc bước validation nào thất bại thì rollback toàn transaction.

Core `INSERT` policy hoặc validation trigger chỉ được cho phép approved workflow transaction khi:

- current user là active `ADMIN` hoặc assigned active leader khớp `approval_unit`;
- `origin = APPROVED_SUBMISSION`;
- `source_submission_id IS NOT NULL`, chưa từng được dùng và tham chiếu đúng một matching `SUBMITTED` event;
- matching submission chưa có `APPROVED` hoặc `REJECTED` terminal event;
- `SUBMITTED.actor_user_id`, lecturer ownership, parent/pending state và immutable metadata hợp lệ;
- core `lecturer_uid`, `record_uid`, `approval_unit` và đúng 19 submission payload fields khớp immutable `SUBMITTED` event;
- `approved_by = current user`;
- provenance legacy-only không bị giả mạo;
- base version chưa stale và version rule đúng với submission type;
- `stt` đến từ identity sequence/default, không từ client/application payload.

Policy/trigger không được yêu cầu matching `APPROVED` event đã tồn tại trước core insert. Database validation chỉ so sánh 19 field trong canonical submission payload; generated `stt` không thuộc payload, checksum hoặc phép so sánh này. Core row sau insert vẫn có đủ 20 trường hiển thị vì PostgreSQL sequence cấp field thứ 20 là `stt`.

Runtime chỉ được grant `INSERT` trên các cột cần cho approved row và `USAGE` trên identity sequence; không grant sequence `UPDATE`/`setval`, core `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` hoặc `TRIGGER`.

Policy là defense-in-depth. Transaction service vẫn phải kiểm tra state, stale base, exact row count và field contract trước insert. Partial unique terminal-event index, global uniqueness của non-null `source_submission_id`, advisory lock và transaction atomic cùng bảo vệ double approval; không lớp nào yêu cầu terminal event phải được ghi trước core row.

## 4. Role behavior

| Actor | Submit | Đọc workflow | Approve/reject |
| --- | --- | --- | --- |
| Active `LECTURER` có mapping | Cho chính lecturer | Event của chính lecturer | Không, trừ khi cùng user còn có grant terminal hợp lệ |
| Active assigned `FACULTY_LEADER` | Không nhờ role này | Exact assigned units | Exact assigned units |
| Active `ADMIN` | Không nhờ role này | Tất cả | Tất cả, gồm unit chưa gán leader |
| Disabled/missing profile | Không | Không | Không |

Nếu một user có nhiều role, mỗi action vẫn cần grant tương ứng; không dùng mere authentication. Unit chưa gán leader nhận pending nhưng chỉ `ADMIN` xử lý cho tới khi có leader scope hợp lệ.

## 5. Negative test matrix

| Nhóm | Trường hợp | Kết quả bắt buộc |
| --- | --- | --- |
| Identity | Client giả `lecturer_uid` | Từ chối; không event/core |
| Identity | Lecturer locator trỏ row của lecturer khác | 404/forbidden không tiết lộ row |
| Scope | Client giả `approval_unit` hoặc `don_vi` | Từ chối field; server không dùng giá trị |
| Scope | Dùng `don_vi_phu_trach_hoc_phan` để route | Test thất bại nếu route thay đổi |
| Scope | CREATE_NEW không có unique current unit | Chặn submit |
| Scope | Unit active nhưng chưa có leader | Submit thành công ở `PENDING`; leader không scope thấy 0 |
| Scope | Leader unit A xử lý unit B | Forbidden; không terminal/core |
| Scope | `ADMIN` xử lý unassigned unit | Được phép nếu state/base hợp lệ |
| Account | Disabled/revoked actor dùng session cũ | Không đọc/ghi; session policy có hiệu lực |
| Field | Payload chứa một trong 6 read-only fields | Validation error; không âm thầm bỏ qua |
| Field | Payload chứa technical/unknown field | Validation error |
| Field | UPDATE thiếu/không hợp lệ editable contract | Validation error |
| Field | CONFIRM gửi mutation | Validation error |
| Field | CREATE_NEW gửi `stt`/`record_uid` | Validation error |
| Version | Portal query trả hai version cùng `record_uid` | Test fail; chỉ latest được trả |
| Version | Query dùng latest lecturer snapshot/`MAX(stt)` | Static/unit contract test fail |
| Version | Existing submit dựa trên non-latest row | Stale conflict; không event |
| Version | Approve sau khi base đã tăng version | `STALE_BASE_VERSION`; không terminal/core |
| Pending | Hai submit tuần tự cùng `record_uid` | Request thứ hai conflict |
| Pending | Hai submit đồng thời cùng `record_uid` | Đúng một `SUBMITTED` winner |
| Pending | Hai pending cùng lecturer, khác record | Cả hai được phép |
| State | Terminal không có `SUBMITTED` | Database/app từ chối |
| State | Submission thứ hai dùng cùng `submission_id` | Unique violation/controlled conflict |
| State | Reject rồi approve | Approve conflict; không core |
| State | Approve rồi reject | Reject conflict |
| State | Approve hai lần tuần tự | Một event, một core row |
| State | Approve/approve đồng thời | Đúng một terminal/core winner |
| State | Approve/reject đồng thời | Đúng một terminal winner; core chỉ khi approve thắng |
| Resubmit | Resubmit pending/approved parent | Từ chối |
| Resubmit | Parent thuộc lecturer/record khác | Từ chối, không tiết lộ dữ liệu |
| Resubmit | CREATE_NEW rejected chain đổi `record_uid` từ client | Từ chối; server giữ UID parent |
| Approval | REJECTED tạo core row | Test fail; count phải 0 |
| Approval | APPROVED tạo 0 hoặc hơn 1 core row | Transaction rollback/test fail |
| Approval | Core insert thành công nhưng insert `APPROVED` thất bại | Toàn transaction rollback; không còn core row |
| Approval | `result_stt`/`result_version_no` khác `INSERT ... RETURNING` | Database/app từ chối; rollback |
| Approval | Duplicate `source_submission_id` ở record khác | Unique violation; rollback |
| Approval | Application truyền explicit `stt` | Contract/RLS test từ chối |
| Approval | Application tính `MAX(stt) + 1` | Static/SQL contract test fail |
| Approval | Validation so sánh generated `stt` với payload | Static/SQL contract test fail; chỉ so sánh 19 payload fields |
| Approval | Approved row giả `source_import_run_id` | Từ chối provenance |
| RLS | Thiếu `app.current_user_id` | SELECT 0 row, INSERT denied |
| RLS | Runtime trực tiếp insert arbitrary workflow/core row | RLS/constraint denied |
| Append-only | Runtime/owner UPDATE/DELETE/TRUNCATE event/core | Privilege hoặc trigger denied |
| Retry | Serialization failure rồi retry | Re-run auth/state checks; tối đa một result |
| Privacy | Error/log chứa full business payload hoặc secret | Security test fail |

Concurrency tests phải chạy trên PostgreSQL test database cô lập; unit mocks không đủ bằng chứng cho lock/unique/RLS behavior.

## 6. Audit và observability

Workflow history chính là business audit cho successful state transitions. Failed authorization/validation không được tạo workflow event giả. Security telemetry nếu bổ sung phải dùng taxonomy/allowlist riêng, không lưu password, token, cookie, full row payload hoặc clear identifier không cần thiết.

Hiển thị status dựa trên event chain hiện hành. Phase 4 không gửi email notification và không suy luận địa chỉ người duyệt.

## 7. External UAT và production gates

Các gate sau tiếp tục `OPEN`:

- formal business decisions/signatures trước external UAT;
- assignment và xác nhận người duyệt theo đơn vị;
- Phase 4 migration replay, RLS, append-only, concurrency và E2E acceptance;
- production backup/restore UEB Core;
- off-host backup evidence;
- infrastructure sign-off, credential/network review và rollback plan;
- production SSO/provisioning/deployment authorization riêng.

Local contract, test hoặc migration rehearsal sau này không tự đóng các gate trên. Public signup, production SSO và production deployment không thuộc Phase 4.
