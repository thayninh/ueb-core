# Nhật ký quyết định nghiệp vụ

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | Draft |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-14 |

## Quy tắc ghi nhận

- Chỉ chuyển một quyết định sang `Approved` khi có căn cứ và người có thẩm quyền xác nhận.
- Không suy diễn quyết định từ cấu trúc hoặc nội dung file Excel.
- Mỗi quyết định phải ghi rõ tác động tới dữ liệu, quyền hạn và quá trình import.
- Nếu thay đổi quyết định đã duyệt, tạo phiên bản hoặc dòng quyết định mới và liên kết quyết định bị thay thế.

## Quyết định chính thức về đơn vị submission và phiên bản dòng

| Nội dung | Giá trị |
| --- | --- |
| Mã quyết định | BD-08 |
| Trạng thái quyết định | Đã chốt, chờ ký xác nhận |
| Trạng thái tài liệu | Draft |
| Phạm vi áp dụng | Luồng giảng viên xác nhận/thay đổi và lãnh đạo phê duyệt/từ chối |

Quyết định chính thức:

1. Mỗi lần giảng viên chỉ xem, xác nhận hoặc thay đổi một dòng.
2. Mỗi submission chứa đúng một dòng.
3. Lãnh đạo chỉ phê duyệt hoặc từ chối dòng thuộc submission đó.
4. Các dòng cũ trong cơ sở dữ liệu không được xét duyệt lại.
5. Khi phê duyệt thành công, hệ thống `INSERT` đúng một dòng mới.
6. Khi giảng viên xác nhận không thay đổi, sau phê duyệt hệ thống vẫn `INSERT` một dòng mới có nội dung nghiệp vụ giống dòng cũ.
7. Khi từ chối, không thêm dòng vào bảng lõi.
8. Các phiên bản của cùng một dòng sử dụng chung `record_uid` và `version_no` tăng dần.
9. Dòng mới hoàn toàn có `record_uid` mới và `version_no = 1`.
10. Không dùng mô hình snapshot toàn bộ hồ sơ giảng viên.
11. Không tạo lại toàn bộ các dòng của giảng viên khi một dòng được duyệt.
12. Mỗi `record_uid` chỉ được có tối đa một submission đang ở trạng thái `PENDING`.

Dòng cũ và phạm vi của quyết định phê duyệt/từ chối:

- Dòng phiên bản cũ chỉ được sử dụng làm dữ liệu đối chiếu với nội dung của submission mới.
- Dòng cũ không phải là đối tượng được lãnh đạo phê duyệt hoặc từ chối lại.
- Quyết định phê duyệt hoặc từ chối chỉ áp dụng cho submission mới đang ở trạng thái `PENDING`.
- Việc hiển thị dòng cũ không làm thay đổi trạng thái, nội dung hoặc hiệu lực của dòng đó.
- Khi submission mới được phê duyệt, hệ thống `INSERT` đúng một dòng mới; dòng cũ tiếp tục được giữ nguyên.

Phiên bản hiện hành của một `record_uid` là dòng có `version_no` lớn nhất trong chính `record_uid` đó. Không dùng `MAX(stt)` trên toàn bộ các dòng của một giảng viên để xác định phiên bản hiện hành.

BD-08 thay thế mọi đề xuất trước đây cho rằng một submission chứa toàn bộ hồ sơ giảng viên hoặc việc duyệt một dòng phải tạo lại toàn bộ các dòng của giảng viên.

## Quyết định chính thức về tuyến phê duyệt

| Nội dung | Giá trị |
| --- | --- |
| Mã quyết định | BD-09 |
| Trạng thái quyết định | Đã chốt, chờ ký xác nhận |
| Trạng thái tài liệu | Draft |
| Danh mục đơn vị | `docs/phase-0/05_approval_units.csv` |

Quyết định chính thức:

1. Submission được định tuyến theo `don_vi` của giảng viên.
2. Không định tuyến theo `don_vi_phu_trach_hoc_phan`.
3. `approval_unit` được backend xác định từ `lecturer_uid` và hồ sơ định danh đã được quản trị viên xác nhận.
4. Không tin cậy `approval_unit`, `don_vi` hoặc email do trình duyệt gửi lên.
5. Giảng viên không được sửa `approval_unit`.
6. Khi submission được tạo, `approval_unit` được lưu bất biến.
7. Lãnh đạo chỉ được xem và xử lý submission có `approval_unit` nằm trong danh sách đơn vị được cấp quyền.
8. Việc thay đổi người giữ vai trò lãnh đạo không làm thay đổi `approval_unit` của submission; lãnh đạo mới của cùng đơn vị có thể tiếp tục xử lý.
9. Nếu không có đơn vị phê duyệt hợp lệ, giảng viên không được gửi submission; hệ thống phải báo quản trị viên cấu hình đơn vị.

Quy ước của danh mục đơn vị phê duyệt:

- `source_don_vi` là giá trị chính xác từ Excel và không được tự ý đổi cách viết.
- `canonical_name` hiện tạm giữ bằng `source_don_vi` cho đến khi tên đơn vị chính thức được người phụ trách xác nhận.
- `PENDING_ASSIGNMENT` nghĩa là chưa có tài khoản lãnh đạo được giao quyền.
- Sáu đơn vị trong `05_approval_units.csv` là toàn bộ các giá trị đã được xác nhận ở Giai đoạn 0; không bổ sung đơn vị khác khi chưa có quyết định mới.

## Quyết định chính thức về quyền trường và loại submission

| Nội dung | Giá trị |
| --- | --- |
| Mã quyết định | BD-10 |
| Trạng thái quyết định | Đã chốt, chờ ký xác nhận |
| Trạng thái tài liệu | Draft |
| Ma trận chi tiết | `docs/phase-0/04_edit_permissions.md` |

Quyết định chính thức:

1. Tất cả 20 trường nghiệp vụ được hiển thị cho giảng viên.
2. Sáu trường định danh/hệ thống là chỉ đọc: `stt`, `ten_giang_vien`, `ma_so_can_bo`, `email_tai_khoan_vnu`, `bo_mon`, `don_vi`.
3. Mười bốn trường nghiệp vụ được sửa: `don_vi_phu_trach_hoc_phan`, `bo_mon_phu_trach_hoc_phan`, `khoi_kien_thuc`, `ma_hoc_phan`, `ten_hoc_phan`, `core_1_2_3`, `tc1_tro_giang`, `tc2_sh_chuyen_mon`, `tc3_tong_hop`, `tc3_1_nganh_tot_nghiep_phu_hop`, `tc3_2_bien_soan_de_cuong_giao_trinh`, `tc3_3_chu_nhiem_de_tai_nckh_lien_quan`, `tc3_4_bai_bao_lien_quan`, `tc4_giang_thu`.
4. Backend không tin giá trị trường khóa từ trình duyệt; payload cố thay đổi trường khóa phải bị từ chối.
5. Xác nhận không thay đổi sử dụng dữ liệu hiện hành được backend đọc lại từ database.
6. Mỗi submission lưu toàn bộ dữ liệu của một dòng, không chỉ lưu phần chênh lệch.
7. Có ba loại submission: `CONFIRM_UNCHANGED`, `UPDATE_EXISTING`, `CREATE_NEW`.
8. Dòng mới chỉ được cấp `stt` chính thức khi được lãnh đạo phê duyệt.

`record_uid`, `version_no`, `approval_unit` và các trường kỹ thuật không thuộc 20 trường nghiệp vụ được phép sửa và không được tin cậy từ payload trình duyệt.

## Quyết định chính thức về danh tính, tài khoản và phân quyền

| Nội dung | Giá trị |
| --- | --- |
| Mã quyết định | BD-11 |
| Trạng thái quyết định | Đã chốt, chờ ký xác nhận |
| Trạng thái tài liệu | Draft |
| Tài liệu chi tiết | `docs/phase-0/10_identity_and_access.md` |

Quyết định chính thức:

1. Phiên bản đầu dùng tài khoản nội bộ được quản trị viên tạo trước.
2. Không cho đăng ký công khai.
3. Phân biệt `user_id` là định danh kỹ thuật bất biến của tài khoản và `lecturer_uid` là định danh nghiệp vụ bất biến của giảng viên.
4. Một tài khoản có thể có nhiều vai trò.
5. `SYSTEM_ADMIN` không mặc nhiên có quyền phê duyệt.
6. `FACULTY_LEADER` phải được gán `approval_unit` và chỉ được xử lý các đơn vị đã được giao.
7. Người vừa là giảng viên vừa là lãnh đạo dùng một tài khoản duy nhất.
8. Có bốn trạng thái tài khoản: `INVITED`, `ACTIVE`, `SUSPENDED`, `DISABLED`; chỉ `ACTIVE` được đăng nhập.
9. Email được trim và chuyển về chữ thường trước khi so sánh; không dùng email làm khóa chính và không suy đoán email từ họ tên.
10. Kiến trúc hỗ trợ chuyển sang OIDC/SSO VNU mà không thay đổi `user_id`, `lecturer_uid` hoặc lịch sử nghiệp vụ; dữ liệu SSO mâu thuẫn phải chuyển quản trị viên xử lý thay vì tự tạo tài khoản trùng.

## BD-12 — Chuyển sang Giai đoạn 1

Trạng thái: Đã chốt về kỹ thuật, chờ ký xác nhận.

Quyết định:

Giai đoạn 0 được kết thúc theo trạng thái “Hoàn thành có điều kiện”.

Cho phép bắt đầu Giai đoạn 1 trong phạm vi môi trường phát triển local.

Các điểm còn mở được tiếp tục quản lý trong risk register và không được bỏ qua trước các cổng kiểm soát UAT hoặc production.

## Các chủ đề cần quyết định

Các dòng có trạng thái `Draft` dưới đây là câu hỏi mở, không phải quyết định đã được thông qua. BD-01 đã được BD-08 chốt ở cấp dòng nghiệp vụ nhưng tài liệu vẫn là `Draft` cho đến khi có chữ ký xác nhận.

| Mã | Chủ đề/Câu hỏi cần quyết định | Phương án | Quyết định | Căn cứ | Người phê duyệt | Ngày | Trạng thái |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BD-01 | Định danh xuyên suốt các phiên bản của một dòng nghiệp vụ là gì? | `record_uid` | Các phiên bản của cùng một dòng dùng chung `record_uid` | BD-08 | Chờ ký xác nhận |  | Đã chốt, chờ ký |
| BD-02 | Quy tắc xử lý bản ghi trùng lặp là gì? | Chưa xác định | Chưa quyết định | Chưa có | Chưa xác định |  | Draft |
| BD-03 | Quy tắc chuẩn hóa trạng thái và danh mục là gì? | Chưa xác định | Chưa quyết định | Chưa có | Chưa xác định |  | Draft |
| BD-04 | Trường nào bắt buộc và trường nào được phép để trống? | Chưa xác định | Chưa quyết định | Chưa có | Chưa xác định |  | Draft |
| BD-05 | Quy tắc xử lý dữ liệu sai hoặc thiếu trước import là gì? | Chưa xác định | Chưa quyết định | Chưa có | Chưa xác định |  | Draft |
| BD-06 | Ai được phân công vai trò lãnh đạo cho từng `approval_unit`? | Chưa xác định | Chưa quyết định | `05_approval_units.csv` đang `PENDING_ASSIGNMENT` | Chưa xác định |  | Draft |

## Quyết định quản trị dữ liệu đối với 74 dòng đã loại

| Nội dung | Giá trị |
| --- | --- |
| Mã quyết định | BD-07 |
| Số dòng trong nguồn cũ | 2.571 |
| Số dòng trong nguồn hiện tại | 2.497 |
| Số dòng không còn trong nguồn mới | 74 |
| Lý do chính thức | Chưa được cung cấp; người phụ trách dữ liệu cần điền và xác nhận |
| Quyết định | Không import 74 dòng này vào production trong đợt triển khai đầu tiên |
| Người phê duyệt dữ liệu | Chưa được cung cấp; cần bổ sung họ tên và chức vụ |
| Trạng thái | Chờ xác nhận |

Không cần khôi phục 74 dòng khi việc loại bỏ là có chủ ý, lý do chính thức đã được ghi nhận và người phụ trách dữ liệu đã xác nhận.

Quyết định BD-07 chưa được coi là `Approved` cho đến khi có đủ lý do chính thức, họ tên/chức vụ người phê duyệt và xác nhận của người phụ trách dữ liệu.

## Lịch sử thay đổi quyết định

| Mã quyết định | Phiên bản | Nội dung thay đổi | Thay thế phiên bản | Người phê duyệt | Ngày hiệu lực |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## Ký xác nhận

| Vai trò | Họ và tên | Phạm vi xác nhận | Ngày ký | Chữ ký/Xác nhận |
| --- | --- | --- | --- | --- |
| Chủ sở hữu nghiệp vụ |  |  |  |  |
| Chủ sở hữu dữ liệu |  |  |  |  |
| Chủ trì Giai đoạn 0 |  |  |  |  |
