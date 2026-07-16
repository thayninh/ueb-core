# Lecturer row workflow Phase 4

## 1. Current rows và field contract

Portal giảng viên lấy đúng phiên bản mới nhất của từng `record_uid`, xếp theo `version_no DESC, stt DESC`; không dùng snapshot mới nhất của toàn giảng viên. History là query riêng và không lẫn vào current rows.

Mỗi core row hiển thị đủ 20 trường nghiệp vụ. Submission payload lưu 19 trường, loại `stt` vì STT được PostgreSQL sinh khi approval. Năm trường identity read-only trong payload do server lấy từ current/canonical lecturer data; 14 trường editable mới được nhận từ form strict. `base_stt`, `base_version_no` và `result_stt` là event metadata, không nằm trong payload/checksum.

## 2. Ba thao tác gửi

- `CONFIRM_UNCHANGED`: copy canonical 19 field từ current core row, lưu base metadata và không ghi core.
- `UPDATE_EXISTING`: giữ 5 identity field từ database, merge 14 field editable đã validate, giữ `record_uid` và không ghi core.
- `CREATE_NEW`: server sinh `record_uid`, resolve duy nhất lecturer identity/approval unit và merge 14 field editable; không nhận STT, record identity hoặc routing từ client.

Mỗi submission đại diện đúng một logical row. Sau advisory lock, một `record_uid` chỉ được có tối đa một submission PENDING; các record khác của cùng lecturer có thể pending đồng thời. Same `submission_id` retry được đối chiếu với immutable stored event: request giống nhau trả submission cũ, request khác trả conflict và không tạo event thứ hai.

## 3. Danh sách, chi tiết và authorization

Danh sách aggregate event theo `submission_id`, hỗ trợ state/type filter và pagination theo submission, không theo event count. Chi tiết hiển thị immutable payload, base/result metadata, trạng thái và rejection reason nhưng không trả checksum, actor internals, session hoặc auth token.

Mọi query/action reauthorize server-side bằng active lecturer principal và đặt `app.current_user_id` transaction-local. RLS chỉ trả event có `lecturer_uid` khớp mapping. Locator trong URL/form không phải bằng chứng ownership; truy cập submission/record của lecturer khác safe-deny như not found, không tiết lộ dữ liệu (IDOR protection).

## 4. Rejection và resubmission

Submission bị reject hiển thị reason bất biến. Resubmit luôn tạo `submission_id` mới và đặt `parent_submission_id` trỏ tới rejected submission. Parent phải thuộc đúng lecturer, ở state REJECTED, không approved/pending và không được bằng submission mới.

Existing-row resubmit giữ cùng `record_uid`, đọc lại latest base và báo rõ khi base đã đổi. Rejected `CREATE_NEW` resubmit cũng reuse server-generated `record_uid` của parent; server không sinh logical row khác. Draft dùng lại editable values đã reject nhưng tái validate đầy đủ và lấy lại read-only/routing từ server.

Submit và resubmit chỉ insert `SUBMITTED` workflow event. Chúng không insert, update hoặc delete `ueb_core_data`; core chỉ thay đổi khi một pending submission được approve thành công.
