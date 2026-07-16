# Identity mapping Phase 3

## 1. Nguồn định danh

Identity audit đọc read-only từ `public.ueb_core_data`. Tên cột được resolve từ Prisma schema và source contract, không tự đoán:

| Thuộc tính | Cột nguồn |
| --- | --- |
| Lecturer identity | `lecturer_uid` |
| Primary email | `email_tai_khoan_vnu` |
| Lecturer name | `ten_giang_vien` |
| Organizational scope | `approval_unit` |

Công cụ không đọc Excel, không ghi database và không thay đổi source value.

## 2. Kết quả identity inspection

| Chỉ số | Giá trị |
| --- | ---: |
| Source rows | 2497 |
| Distinct lecturer UID | 246 |
| Distinct normalized email | 246 |
| Lecturer thiếu email | 0 |
| Invalid email | 0 |
| Email → nhiều lecturer UID | 0 |
| Lecturer UID → nhiều email | 0 |
| Case/whitespace variants | 0 |
| Distinct unit | 6 |
| Lecturer thuộc nhiều unit | 0 |
| Unit chưa có configured leader | 6 |

Kết quả: `PASS`, không có blocking ambiguity. Sáu warning chỉ phản ánh sáu đơn vị chưa có lãnh đạo được cấu hình.

Audit output nằm dưới `infra/audit/phase-3/` và bị Git ignore. Tài liệu này không sao chép email, tên hoặc UUID thật.

## 3. Quy tắc mapping

- Email canonical dùng `trim` và `lowercase` để đối chiếu.
- Không sửa email trong `ueb_core_data`.
- Một auth user có đúng một primary email; không hỗ trợ alias trong Phase 3.
- `access_profile.user_id` là unique.
- `access_profile.lecturer_uid` nullable và unique.
- `LECTURER` chỉ được active khi có mapping `lecturer_uid`.
- `ADMIN` có thể không có mapping.
- Không có foreign key từ `ueb_core_data` sang `auth_user`; liên kết là logical mapping qua UUID.
- Không tự merge identity, chọn email hoặc suy luận mapping từ tên/chức danh.

## 4. Organization units

Seed đọc distinct `approval_unit`, giữ nguyên chuỗi và chỉ insert unit chưa tồn tại. `source_value` là unique và phải khớp chính xác dữ liệu lõi.

Một leader có thể có nhiều active `unit_scope_assignment`. Một unit chưa được gán không cấp quyền đọc. Sáu unit hiện tại tiếp tục unassigned; không tạo leader giả và không suy đoán email lãnh đạo.

## 5. Provisioning có kiểm soát

- Không mass-provision giảng viên trong Phase 3.
- `LECTURER` yêu cầu email khớp duy nhất mapping được chỉ định.
- `FACULTY_LEADER` yêu cầu ít nhất một active unit scope.
- Multiple roles và multiple units được phép.
- Mọi tạo user, role, unit scope, lecturer mapping và session revoke phải ghi audit trong cùng transaction nghiệp vụ.
