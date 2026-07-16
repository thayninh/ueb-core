# Leader decision workflow Phase 4

## 1. Queue và scope

Leader queue chỉ trả submission có một `SUBMITTED` và chưa có terminal event, tức state PENDING. Active unit scope được đọc lại từ database; client unit/filter không cấp quyền. `FACULTY_LEADER` chỉ thấy exact active units được gán, leader không scope thấy 0, multi-unit leader thấy hợp các scope. Active `ADMIN` đọc và xử lý toàn bộ submission theo contract, kể cả unit chưa được gán leader.

Queue hỗ trợ search, submission-type/unit filter và pagination theo submission. Detail dựng diff đủ 19 payload fields: before từ latest/current base khi có, after từ immutable submitted payload; `CREATE_NEW` đánh dấu toàn bộ là new. Terminal submission không còn action approve/reject.

## 2. Reject

Reject yêu cầu reason đã trim, không rỗng và trong giới hạn contract. Service khóa `submission_id` rồi `record_uid`, đọc lại chain và current scope trong transaction `SERIALIZABLE`, sau đó insert đúng một `REJECTED`. Reject không ghi core. Concurrent reject/reject hoặc reject/approve chỉ có một terminal winner.

## 3. Approve

Approve reauthorize actor, khóa theo cùng thứ tự, xác minh PENDING, checksum, scope và stale base. Với existing row, current STT/version/lecturer/unit phải khớp base; với `CREATE_NEW`, record chưa được tồn tại và version bắt đầu từ 1.

Thứ tự ghi atomic là:

1. insert đúng một core row từ 19-field immutable payload và server metadata, không truyền `stt`;
2. PostgreSQL sequence sinh STT; `INSERT ... RETURNING stt, version_no` trả kết quả thực;
3. insert `APPROVED` event với `result_stt` và `result_version_no` từ `RETURNING`;
4. commit cả hai; nếu terminal insert hoặc validation thất bại thì rollback core row cùng transaction.

`CONFIRM_UNCHANGED` và `UPDATE_EXISTING` giữ `record_uid`, tăng `version_no` đúng một. `CREATE_NEW` reuse record UID của submission và dùng `version_no = 1`. Mỗi approval có snapshot mới và unique `source_submission_id`.

## 4. Race và stale protection

Transaction advisory locks luôn theo `submission_id` trước, `record_uid` sau. Partial unique terminal index, unique `source_submission_id`, unique `(record_uid, version_no)`, approval trigger, checksum và `SERIALIZABLE` transaction là các lớp defense-in-depth.

Double approve tạo tối đa một core row/APPROVED event; double reject tạo tối đa một REJECTED; approve/reject race tạo đúng một terminal. Stale base trả conflict và không insert terminal/core. Khoảng trống sequence sau rollback được chấp nhận; application không dùng `MAX(stt)` hoặc tái sử dụng STT.
