# Ma trận quyền chỉnh sửa và phê duyệt

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | Draft |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-14 |

## Phạm vi

Tài liệu này ghi nhận ai được xem, sửa, xác nhận và phê duyệt theo từng dòng nghiệp vụ. Quyền xem/sửa/xác nhận được thực hiện trên từng dòng, không trên snapshot toàn bộ hồ sơ giảng viên. Chưa có quyền nào được cấp chỉ dựa trên tài liệu Draft này.

## Danh mục 20 trường nghiệp vụ

Tất cả 20 trường nghiệp vụ phải được hiển thị cho giảng viên.

### Sáu trường chỉ đọc

- `stt`
- `ten_giang_vien`
- `ma_so_can_bo`
- `email_tai_khoan_vnu`
- `bo_mon`
- `don_vi`

### Mười bốn trường được phép chỉnh sửa

- `don_vi_phu_trach_hoc_phan`
- `bo_mon_phu_trach_hoc_phan`
- `khoi_kien_thuc`
- `ma_hoc_phan`
- `ten_hoc_phan`
- `core_1_2_3`
- `tc1_tro_giang`
- `tc2_sh_chuyen_mon`
- `tc3_tong_hop`
- `tc3_1_nganh_tot_nghiep_phu_hop`
- `tc3_2_bien_soan_de_cuong_giao_trinh`
- `tc3_3_chu_nhiem_de_tai_nckh_lien_quan`
- `tc3_4_bai_bao_lien_quan`
- `tc4_giang_thu`

## Nguyên tắc hiển thị và kiểm soát dữ liệu

- Hiển thị không đồng nghĩa với được sửa.
- Backend không tin các trường khóa do trình duyệt gửi lên.
- Các trường khóa phải được lấy lại từ `lecturer_uid`, hồ sơ định danh và dòng hiện hành trong database.
- Payload cố thay đổi trường khóa phải bị backend từ chối; không được âm thầm chấp nhận hoặc bỏ qua.
- Một lần thao tác chỉ áp dụng cho một dòng.
- Submission lưu đầy đủ dữ liệu một dòng, không chỉ lưu phần thay đổi.
- `record_uid`, `version_no`, `approval_unit` và các trường kỹ thuật không được giảng viên sửa.
- Submission ở trạng thái `PENDING` là bất biến, không được chỉnh sửa hoặc gửi lại.

## Định nghĩa thao tác

| Thao tác | Mô tả |
| --- | --- |
| Xem | Đọc dữ liệu trong phạm vi được cấp. |
| Đề xuất sửa | Gửi yêu cầu thay đổi nhưng không tự áp dụng. |
| Chỉnh sửa | Giảng viên thay đổi nội dung của đúng một dòng để tạo submission một dòng. |
| Xác nhận | Giảng viên xác nhận đúng một dòng không thay đổi; sau phê duyệt vẫn tạo một phiên bản mới có nội dung nghiệp vụ giống dòng cũ. |
| Phê duyệt/Từ chối | Lãnh đạo phê duyệt hoặc từ chối đúng dòng thuộc submission; không xét duyệt lại dòng cũ. |
| Xuất dữ liệu | Tạo bản xuất dữ liệu theo phạm vi được phép. |

## Ma trận quyền

Điền mã đơn vị tham chiếu từ `05_approval_units.csv`. Không ghi tên tài khoản, email cá nhân, mật khẩu hoặc token.

| Nhóm dữ liệu/Chức năng | Vai trò | Đơn vị | Xem | Đề xuất sửa | Chỉnh sửa | Xác nhận | Phê duyệt/Từ chối | Xuất dữ liệu | Căn cứ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dòng nghiệp vụ thuộc phạm vi được cấp | Giảng viên | Chưa xác định | Có, từng dòng | Có, từng dòng | Có, từng dòng | Có, từng dòng | Không | Chưa xác định | BD-08 |
| Dòng thuộc submission trong phạm vi phê duyệt | Lãnh đạo | Chưa xác định | Có, đúng dòng thuộc submission | Không | Không | Không | Có, đúng dòng thuộc submission | Chưa xác định | BD-08 |
| Dòng cũ đã có trong bảng lõi | Giảng viên/Lãnh đạo | Chưa xác định | Theo phạm vi được cấp | Không sửa trực tiếp | Không sửa trực tiếp | Không | Không xét duyệt lại | Chưa xác định | BD-08 |

## Ma trận thao tác từng dòng

| Mã | Thao tác | Trường hiển thị | Trường được sửa | Loại submission | Quy tắc/Kết quả |
| --- | --- | --- | --- | --- | --- |
| A | Xác nhận dòng hiện có | Đủ 20 trường | Không trường nào | `CONFIRM_UNCHANGED` | Backend đọc lại toàn bộ dòng hiện hành từ database; sau phê duyệt `INSERT` đúng một dòng mới có nội dung nghiệp vụ giống dòng cũ |
| B | Thay đổi dòng hiện có | Đủ 20 trường | Chỉ 14 trường được phép chỉnh sửa | `UPDATE_EXISTING` | Backend lấy lại 6 trường chỉ đọc và trường kỹ thuật; submission lưu đầy đủ một dòng |
| C | Tạo dòng mới | Đủ 20 trường; `stt` chưa được cấp chính thức | Chỉ 14 trường được phép chỉnh sửa | `CREATE_NEW` | Backend lấy các trường định danh từ hồ sơ đã xác nhận; chỉ cấp `stt` chính thức khi lãnh đạo phê duyệt |
| D | Xem submission `PENDING` | Đủ 20 trường của submission | Không trường nào | Giữ nguyên loại đã tạo | Chỉ xem; submission `PENDING` không được chỉnh sửa hoặc gửi lại |
| E | Gửi lại sau khi bị từ chối | Đủ 20 trường | Chỉ 14 trường được phép chỉnh sửa | Một trong ba loại phù hợp với thao tác mới | Không sửa submission đã bị từ chối; tạo một submission mới chứa đầy đủ một dòng và giữ submission cũ làm lịch sử |

## Quy tắc xung đột và ngoại lệ

| Nội dung | Quyết định | Căn cứ | Người phê duyệt | Trạng thái |
| --- | --- | --- | --- | --- |
| Phân tách người chỉnh sửa và người phê duyệt | Giảng viên sửa/xác nhận từng dòng; lãnh đạo chỉ phê duyệt/từ chối dòng thuộc submission | BD-08 | Chờ ký xác nhận | Đã chốt, chờ ký |
| Quyền tạm thời và thời hạn thu hồi | Chưa quyết định | Chưa có | Chưa xác định | Draft |
| Xử lý yêu cầu ngoài phạm vi đơn vị | Chưa quyết định | Chưa có | Chưa xác định | Draft |

## Ký xác nhận

| Vai trò | Họ và tên | Phạm vi xác nhận | Ngày ký | Chữ ký/Xác nhận |
| --- | --- | --- | --- | --- |
| Chủ sở hữu nghiệp vụ |  |  |  |  |
| Đại diện quản trị truy cập |  |  |  |  |
| Đại diện an toàn thông tin |  |  |  |  |
