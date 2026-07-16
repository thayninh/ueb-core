# Contract quyền trường Phase 4

## 1. Nguồn chuẩn

Danh sách trường dưới đây lấy nguyên văn từ `docs/phase-0/04_edit_permissions.md`. Phase 4 không đổi tên, phân loại lại hoặc suy luận quyền mới từ schema/UI.

Tất cả 20 trường nghiệp vụ phải được hiển thị. Hiển thị không đồng nghĩa được sửa.

## 2. Sáu trường read-only

1. `stt`
2. `ten_giang_vien`
3. `ma_so_can_bo`
4. `email_tai_khoan_vnu`
5. `bo_mon`
6. `don_vi`

Các trường này luôn do server/database xác định. Payload client chứa các field này bị từ chối, kể cả khi giá trị gửi lên giống database; contract dùng strict allowlist để tránh biến field server-controlled thành field client-controlled.

## 3. Mười bốn trường editable

1. `don_vi_phu_trach_hoc_phan`
2. `bo_mon_phu_trach_hoc_phan`
3. `khoi_kien_thuc`
4. `ma_hoc_phan`
5. `ten_hoc_phan`
6. `core_1_2_3`
7. `tc1_tro_giang`
8. `tc2_sh_chuyen_mon`
9. `tc3_tong_hop`
10. `tc3_1_nganh_tot_nghiep_phu_hop`
11. `tc3_2_bien_soan_de_cuong_giao_trinh`
12. `tc3_3_chu_nhiem_de_tai_nckh_lien_quan`
13. `tc3_4_bai_bao_lien_quan`
14. `tc4_giang_thu`

Validation phải giữ các quyết định data contract Phase 2: `khoi_kien_thuc` là integer bắt buộc theo miền nghiệp vụ được phê duyệt; nullability/text/date-status rules không được tự nới hoặc chuẩn hóa lại trong workflow.

## 4. Ma trận theo submission type

| Field group | `CONFIRM_UNCHANGED` | `UPDATE_EXISTING` | `CREATE_NEW` |
| --- | --- | --- | --- |
| 6 read-only ở UI/core | Server copy 5 identity fields; lưu `base_stt` riêng | Server copy 5 identity fields; lưu `base_stt` riêng | Server lấy 5 canonical identity fields; payload không có `stt` |
| 14 editable | Client không gửi; server copy current row | Client gửi đủ canonical editable payload theo schema | Client gửi đủ canonical editable payload theo schema |
| `record_uid` | Server resolve current row | Server resolve current row | Server sinh khi initial submit; resubmit giữ UID đã sinh |
| `version_no` | Server lưu base; approval lấy current + 1 | Server lưu base; approval lấy current + 1 | `NULL` ở base; approval đặt 1 |
| `approval_unit` | Current core version | Current core version | Unique current lecturer unit |
| `stt` khi approval | Omit explicit value, sequence cấp STT mới | Omit explicit value, sequence cấp STT mới | Omit explicit value, sequence cấp STT mới |

Mọi approval đều tạo row mới nên cả confirm/update cũng nhận `stt` mới từ sequence. `stt` cũ chỉ nằm ở event metadata `base_stt`; `stt` mới được ghi ở terminal metadata `result_stt`. Không giá trị nào nằm trong `row` payload hoặc payload checksum.

## 5. Canonical submission payload

Core/display contract vẫn có đủ 20 field. Persisted submission payload chỉ có đúng 19 field non-`stt`:

- server dựng object theo danh sách `PHASE_4_SUBMISSION_PAYLOAD_FIELDS`;
- server copy 5 identity fields read-only;
- server merge/validate 14 editable fields khi type cho phép;
- `stt`, `base_stt`, `result_stt` và các technical fields không nằm trong payload;
- unknown key và duplicate/ambiguous representation bị từ chối;
- không lưu raw form body hoặc technical field ngoài contract vào row payload.

Đối với `CONFIRM_UNCHANGED`, server so sánh canonical payload với đúng 19 field non-`stt` của current row. Đối với `UPDATE_EXISTING`, server chứng minh 5 identity fields không đến từ client và row sau merge đủ 19 field. Checksum canonical hóa đúng 19 field theo stable order; thay đổi `base_stt`/`result_stt` không làm đổi checksum.

## 6. Technical fields do server suy ra

| Field | Nguồn |
| --- | --- |
| `event_id`, `submission_id` | UUID server sinh |
| `parent_submission_id` | Rejected parent server đã authorize hoặc `NULL` |
| `event_type`, `actor_user_id` | Server operation và current principal |
| `lecturer_uid` | Active principal/database access profile |
| `record_uid` | Authorized current row hoặc UUID server sinh |
| `approval_unit` | Quy tắc derivation theo submission type |
| `version_no` | Current version + 1 hoặc 1 |
| `snapshot_id` | UUID mới cho mỗi approval một dòng |
| `source_submission_id` | Submission đang approve |
| `origin` | Hằng `APPROVED_SUBMISSION` |
| `approved_by` | Current authorized terminal actor |
| `approved_at` | Database transaction time |
| `created_at` | Database default/transaction time |

`identity_status` và các field provenance `source_row_number`, `source_row_checksum`, `source_import_run_id` cũng do server xác định. Với approved submission, implementation sau phải dùng giá trị Phase 4 hợp lệ/`NULL` theo schema provenance đã review; client không được điền dữ liệu legacy giả.

Client không quyết định bất kỳ field nào trong bảng trên. URL param, hidden input và form state đều là input chưa tin cậy.

## 7. Identity và unit consistency

Với existing row, 5 identity fields ngoài `stt` phải giữ đúng current core row: `ten_giang_vien`, `ma_so_can_bo`, `email_tai_khoan_vnu`, `bo_mon`, `don_vi`. `lecturer_uid` phải khớp principal.

Với new row, server chỉ dựng identity khi current-data view xác định duy nhất canonical lecturer identity và unit. Nếu các latest rows mâu thuẫn ở field identity cần thiết hoặc unit không duy nhất, chặn submit và yêu cầu admin/data-owner xử lý; không chọn `MIN`, `MAX`, first row hoặc giá trị phổ biến nhất.

Không dùng `don_vi_phu_trach_hoc_phan` để định tuyến. Không suy luận leader hoặc email leader từ bất kỳ business field nào.
