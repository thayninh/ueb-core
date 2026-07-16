# Contract submission theo từng dòng

## 1. Đơn vị nghiệp vụ

Một submission đại diện cho đúng một logical row và xử lý đúng một `record_uid`. Submission không phải snapshot toàn bộ giảng viên, không chứa danh sách dòng và không làm phiên bản lại các dòng khác khi được duyệt.

`submission_id` định danh một lần gửi để xét duyệt. `record_uid` định danh logical row xuyên suốt các phiên bản và cả chuỗi resubmit. Hai định danh có vòng đời khác nhau và không được dùng thay nhau.

Mỗi `SUBMITTED` event lưu đủ nội dung của một dòng để kiểm toán:

- `submission_type`;
- `record_uid` do server resolve hoặc sinh;
- `base_stt` và `base_version_no` là metadata riêng đối với dòng hiện có, cùng là `NULL` đối với dòng mới;
- đúng 19 trường nghiệp vụ non-`stt` trong `row`;
- `payload_checksum` chỉ bao phủ canonical 19-field `row`, không bao phủ `stt`, base/result metadata hoặc technical fields;
- `lecturer_uid` từ active principal;
- `approval_unit` do server suy ra;
- `parent_submission_id` hợp lệ hoặc `NULL`.

Client input chỉ là yêu cầu chưa đáng tin cậy. Event đã lưu phải là canonical payload do server dựng lại; không sao chép nguyên payload client vào workflow history.

## 2. Submission types

| Type | Điều kiện | Canonical row tại submit | Kết quả khi approve |
| --- | --- | --- | --- |
| `CONFIRM_UNCHANGED` | `record_uid` đã có core row hiện hành của lecturer | Server copy đúng 19 trường non-`stt` từ phiên bản hiện hành; client không gửi business mutation; `base_stt` lưu riêng | Giữ `record_uid`, `version_no = current + 1`, giữ nguyên 19 giá trị payload; `stt` mới do sequence cấp |
| `UPDATE_EXISTING` | `record_uid` đã có core row hiện hành của lecturer | Server lấy 5 trường identity read-only từ current row, merge đúng 14 trường editable đã validate; `base_stt` lưu riêng | Giữ `record_uid`, `version_no = current + 1`, insert 19 giá trị canonical và để sequence cấp `stt` |
| `CREATE_NEW` | Logical row chưa tồn tại trong core | Server sinh `record_uid`, lấy 5 trường identity từ canonical lecturer identity/current data và merge 14 trường editable; payload không có `stt` | Dùng `record_uid` đã sinh, `version_no = 1`, không truyền `stt` để sequence cấp |

`CREATE_NEW` không được cấp trước `stt` và không được dự đoán sequence. `CONFIRM_UNCHANGED` và `UPDATE_EXISTING` phải tham chiếu phiên bản hiện hành tại thời điểm submit.

## 3. Contract input và trust boundary

### Dòng hiện có

Client có thể gửi opaque row locator để thể hiện dòng người dùng chọn. Locator, `record_uid` hoặc base version từ client không có thẩm quyền. Server phải:

1. lấy `lecturer_uid` từ active principal có role `LECTURER`;
2. resolve locator trong RLS scope của principal;
3. đọc lại latest row theo `record_uid`;
4. xác minh row thuộc đúng `lecturer_uid`;
5. lưu `record_uid` và `base_version_no` từ kết quả database.

Nếu client gửi field ngoài allowlist hoặc cố gửi/thay đổi field chỉ đọc/kỹ thuật, toàn bộ request bị từ chối. Không âm thầm bỏ qua field trái phép.

### Dòng mới

Client chỉ cung cấp 14 trường editable. Server lấy 5 identity fields từ canonical current data của chính lecturer, sinh `record_uid`, suy ra `approval_unit`; submission payload không có key `stt`. Client không được cấp UUID hoặc giá trị kỹ thuật cho logical row mới.

### Server-derived fields

Client không quyết định:

- `event_id`, `submission_id`, `parent_submission_id`, `event_type`, `actor_user_id`;
- `stt`, `lecturer_uid`, `record_uid`, `approval_unit`, `version_no`;
- `snapshot_id`, `identity_status`, `source_row_number`, `source_row_checksum`;
- `source_import_run_id`, `source_submission_id`, `origin`;
- `approved_by`, `approved_at`, `created_at`;
- 6 trường nghiệp vụ read-only ở input/UI; trong persisted payload chỉ có 5 identity fields read-only vì `stt` được loại khỏi payload.

`record_uid`/row locator nhận từ client, nếu có, chỉ được dùng làm giá trị tìm kiếm chưa tin cậy. Giá trị persisted phải đến từ row server đã authorize hoặc UUID server sinh.

## 4. Latest-version query contract

Current data là đúng một row có `version_no` lớn nhất trong mỗi `record_uid`. Contract SQL logic là:

```sql
SELECT *
FROM (
  SELECT
    core.*,
    row_number() OVER (
      PARTITION BY core.record_uid
      ORDER BY core.version_no DESC
    ) AS version_rank
  FROM public.ueb_core_data AS core
) AS ranked
WHERE ranked.version_rank = 1;
```

Schema triển khai phải bảo đảm `(record_uid, version_no)` là duy nhất để truy vấn không cần tie-break bằng `stt`. Nếu phát hiện hai row cùng version của một `record_uid`, đó là integrity failure; không chọn tùy ý bằng `MAX(stt)`.

RLS và role filter vẫn áp dụng. Lecturer portal trả latest row của từng `record_uid` thuộc `lecturer_uid` của principal. Leader/admin portal cũng không trả nhiều phiên bản của cùng logical row trong current-data view. History cần endpoint/query riêng và phải được ghi nhãn là lịch sử.

Cấm dùng:

- snapshot mới nhất của toàn giảng viên;
- `MAX(stt)` của giảng viên;
- global latest `snapshot_id` để xác định current rows;
- order theo `created_at` thay cho `version_no`.

## 5. Approval-unit derivation

### Existing record

`approval_unit` lấy từ phiên bản core hiện hành đã server-resolve của `record_uid`. Nó được lưu bất biến trên `SUBMITTED` event. Client value, `don_vi_phu_trach_hoc_phan` và unit filter trên URL không được dùng để định tuyến.

### Create new

Server đọc current-data view của lecturer, lấy tập giá trị đơn vị chuẩn chính xác và chỉ chấp nhận khi có đúng một `approval_unit` không null ánh xạ tới một `organization_unit` active. Không normalize, suy luận hoặc chọn một giá trị khi có nhiều giá trị.

Submit bị chặn nếu không xác định được duy nhất unit. Thiếu leader assignment không làm unit mất hợp lệ: unit chưa gán lãnh đạo vẫn nhận submission `PENDING`. Không tạo leader giả và không suy luận tên/email lãnh đạo.

## 6. Pending rule

Trong transaction đã lấy advisory lock theo `record_uid`, server phải chứng minh không tồn tại submission có `SUBMITTED` nhưng chưa có terminal event cho cùng `record_uid`. Nếu đã có, trả conflict và không ghi event.

Giới hạn là theo `record_uid`, không theo lecturer. Do đó một lecturer có thể có nhiều pending submission cho các logical row khác nhau.

## 7. Resubmit contract

Resubmit chỉ áp dụng sau `REJECTED`:

- tạo `submission_id` mới;
- `parent_submission_id` trỏ trực tiếp tới submission bị reject;
- parent phải có đúng một `SUBMITTED`, đúng một `REJECTED` và không có `APPROVED`;
- parent phải thuộc cùng `lecturer_uid` và `record_uid`;
- submission cũ không bị sửa và không nhận thêm event;
- server đọc lại current data và validate toàn bộ submission mới.

Với logical row đã tồn tại, resubmit có thể là `CONFIRM_UNCHANGED` hoặc `UPDATE_EXISTING` tùy thao tác mới. Với `CREATE_NEW` đã reject và chưa có core row, resubmit tiếp tục dùng `CREATE_NEW` và giữ server-generated `record_uid` của chuỗi. Nếu `record_uid` đã xuất hiện trong core, `CREATE_NEW` bị từ chối.

Không resubmit từ `PENDING` hoặc `APPROVED`. Không cho client tự chọn parent khác để đổi lecturer, record hoặc approval route.

## 8. Approved core row contract

Mỗi approval tạo một batch một dòng:

- `snapshot_id`: UUID mới cho approval đó;
- `source_submission_id`: đúng `submission_id`, unique toàn cục;
- `origin = APPROVED_SUBMISSION`;
- `approved_by`: current authorized principal;
- `approved_at` và `created_at`: thời gian database trong transaction;
- `stt`: PostgreSQL identity/sequence, không có explicit value từ application.
- `result_stt`: giá trị `stt` thực tế từ `INSERT ... RETURNING`, lưu trên `APPROVED` event chứ không nằm trong submitted payload.

Legacy provenance tiếp tục tham chiếu `import_run`. Approved-submission provenance phải dùng `source_submission_id`; triển khai sau phải cho phép các cột chỉ có ý nghĩa với legacy import là `NULL` thay vì tạo import metadata giả.
