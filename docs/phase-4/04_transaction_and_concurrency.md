# Transaction và concurrency contract Phase 4

## 1. Nguyên tắc chung

- Submit, reject và approve dùng transaction database `SERIALIZABLE`.
- RLS request context được đặt transaction-local bằng verified `principal.userId`.
- Mọi thao tác của một logical row lấy PostgreSQL transaction advisory lock theo `record_uid`.
- Sau khi lấy lock phải đọc lại state/current row; dữ liệu đọc trước lock không dùng để quyết định commit.
- Core và workflow event chỉ `INSERT`; không `UPDATE`, `DELETE` hoặc `TRUNCATE`.
- Unique constraint/index là lớp bảo vệ cuối cùng, không thay thế authorization và validation.

## 2. Advisory lock strategy

Khóa logic là `record_uid`, không phải lecturer, `stt`, snapshot hoặc process memory. Implementation dự kiến dùng transaction lock với namespace ổn định, ví dụ khóa 64-bit từ:

```sql
SELECT pg_advisory_xact_lock(
  hashtextextended('ueb-core:phase-4:record:' || $1::text, 0)
);
```

Mọi đường submit/reject/approve/resubmit phải dùng cùng namespace và cách tạo key. Hash collision chỉ làm serialize thêm hai record không liên quan, không được làm sai dữ liệu.

Với existing row, server resolve candidate trong authorized scope, lấy lock theo server-resolved `record_uid`, rồi đọc lại latest row. Với initial `CREATE_NEW`, server sinh UUID trước, lấy lock theo UUID đó và xác nhận chưa có core/event chain không hợp lệ. Resubmit lấy UID từ rejected parent ở server.

Không dùng mutex trong Node.js vì không bảo vệ nhiều process/container. Không dùng `MAX(stt)` làm lock key hoặc cấp identity.

## 3. Transaction submit

### Các bước chung

1. Bắt đầu `SERIALIZABLE` transaction và đặt RLS context transaction-local.
2. Đọc lại active principal; yêu cầu role `LECTURER` và non-null `lecturer_uid`.
3. Resolve/generate `record_uid` theo type; không tin client value.
4. Lấy advisory lock theo `record_uid`.
5. Re-read current core row, parent chain và pending state trong transaction.
6. Từ chối nếu đã có pending submission cho `record_uid`.
7. Suy ra `approval_unit`; chặn khi thiếu/không duy nhất/inactive.
8. Dựng canonical full-row payload bằng strict field allowlist.
9. Sinh server `submission_id`, insert đúng một `SUBMITTED` event.
10. Commit và trả server representation; không insert core.

### Existing types

`CONFIRM_UNCHANGED`/`UPDATE_EXISTING` phải re-read latest row bằng max `version_no` của riêng `record_uid`, kiểm tra `lecturer_uid` khớp principal và lưu `base_version_no` từ database. Nếu UI dựa trên version cũ, server trả stale conflict trước khi insert event.

### Create new

`CREATE_NEW` phải chứng minh `record_uid` chưa có core row, canonical lecturer identity/unit là duy nhất và `row.stt = NULL`. Không gọi `nextval()` ở submit.

### Resubmit

Parent được đọc lại sau lock. Chỉ parent `REJECTED` cùng lecturer/record được chấp nhận. New submission được validate lại như request mới; không copy mù payload cũ.

## 4. Transaction reject

1. Bắt đầu `SERIALIZABLE` transaction và đặt RLS context.
2. Tìm `SUBMITTED` event bằng `submission_id` trong authorized workflow scope để lấy server `record_uid`.
3. Lấy advisory lock theo `record_uid`, sau đó đọc lại toàn event chain.
4. Xác minh đúng một `SUBMITTED`, chưa có terminal và immutable fields nhất quán.
5. Authorize current actor: active `ADMIN`, hoặc active `FACULTY_LEADER` có exact active unit scope khớp stored `approval_unit`.
6. Validate reason và insert đúng một `REJECTED` event với actor từ principal.
7. Xác nhận không có core insert trong transaction và commit.

Retry sau rejection không insert event mới. Service có thể trả trạng thái `ALREADY_REJECTED` chỉ khi existing terminal đúng là rejection; nếu đã approved thì trả conflict.

## 5. Transaction approve

1. Bắt đầu `SERIALIZABLE` transaction và đặt RLS context.
2. Tìm `SUBMITTED` event trong authorized scope để lấy `record_uid`.
3. Lấy advisory lock theo `record_uid`, rồi đọc lại event chain/current core state.
4. Xác minh state `PENDING` và authorize active `ADMIN` hoặc assigned active leader.
5. Chạy stale-base checks.
6. Dựng đúng một core row từ canonical submitted payload và server fields.
7. Insert `APPROVED` terminal event.
8. Insert đúng một core row với `source_submission_id = submission_id`; không truyền `stt` để PostgreSQL sequence cấp.
9. Yêu cầu `INSERT ... RETURNING` trả đúng một row; commit cả event/core hoặc rollback cả hai.

Terminal event được insert trước core trong cùng transaction để core INSERT RLS policy có thể yêu cầu một matching `APPROVED` event đã visible trong transaction. Thứ tự này không làm lộ partial state vì transaction atomic.

PostgreSQL sequence không transactional; rollback có thể để lại khoảng trống `stt`. Khoảng trống được chấp nhận, không được lấp hoặc tái sử dụng và không ảnh hưởng version logic.

## 6. Core row construction

### `CONFIRM_UNCHANGED`

- current version phải bằng stored `base_version_no`;
- submitted 20-field payload phải bằng base current row;
- giữ `record_uid`, đặt `version_no = base + 1`;
- dùng 20 business values của current row, trừ `stt` được sequence cấp mới.

### `UPDATE_EXISTING`

- current version phải bằng stored `base_version_no`;
- giữ `record_uid`, đặt `version_no = base + 1`;
- 6 read-only fields phải bằng current row;
- dùng 14 editable fields từ immutable canonical submitted payload;
- `stt` do sequence cấp mới.

### `CREATE_NEW`

- không có core row nào cho `record_uid`;
- `base_version_no IS NULL`;
- đặt `version_no = 1`;
- `stt` do sequence cấp;
- giữ server-derived lecturer/unit/identity fields từ submitted payload.

Mọi type tạo `snapshot_id` mới, `origin = APPROVED_SUBMISSION`, actor/time từ server/database và `source_submission_id` unique.

## 7. Stale-base conflict strategy

Existing submission stale khi latest core `version_no` của `record_uid` khác stored `base_version_no`, hoặc current row không còn khớp immutable lecturer/identity assumptions.

Khi stale:

- approval trả conflict có code ổn định như `STALE_BASE_VERSION`;
- không insert terminal event;
- không insert core row;
- không tự reject;
- client phải reload latest data; người có quyền có thể reject pending submission, sau đó lecturer tạo submission mới.

`CREATE_NEW` conflict khi `record_uid` đã xuất hiện trong core. Không chuyển ngầm request thành `UPDATE_EXISTING`.

## 8. Idempotency strategy

Các lớp bảo vệ bắt buộc:

- partial unique: một `SUBMITTED` trên mỗi `submission_id`;
- partial unique: tối đa một terminal trên mỗi `submission_id`;
- partial unique: một core row trên mỗi non-null `source_submission_id`;
- unique: một `(record_uid, version_no)`;
- advisory lock: serialize state transition theo logical row;
- one transaction: terminal/core cùng commit hoặc rollback;
- append-only triggers: không sửa lịch sử để retry.

Duplicate approval retry sau commit trả existing approved result hoặc conflict nhưng không insert thêm event/core. Concurrent approve/approve tạo đúng một winner. Concurrent approve/reject tạo đúng một terminal winner. Concurrent submit cùng `record_uid` tạo đúng một pending winner.

`source_submission_id` uniqueness phải là global uniqueness trên cột, không phải composite uniqueness với `record_uid`; nếu một submission xuất hiện ở record khác, đó vẫn là duplicate approval.

## 9. Failure handling

Serialization failure, deadlock hoặc unique violation phải rollback toàn transaction. Retry tự động chỉ được áp dụng với giới hạn nhỏ cho lỗi transaction có thể retry và phải chạy lại toàn bộ authorization/state/stale checks. Không retry validation, forbidden, stale hoặc terminal conflict như lỗi hạ tầng.

Không log full payload chứa dữ liệu cá nhân. Log/audit chỉ dùng identifier cần thiết và metadata allowlist đã phê duyệt.
