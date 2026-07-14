# Biên bản xác nhận kết thúc Giai đoạn 0

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | Draft — Giai đoạn 0 hoàn thành có điều kiện, chờ ký xác nhận |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-14 |

## Hồ sơ đầu vào

| Tài liệu | Trạng thái yêu cầu | Trạng thái thực tế | Người xác nhận | Ghi chú |
| --- | --- | --- | --- | --- |
| `00_scope_and_principles.md` | Approved | Draft |  |  |
| `01_data_source.sha256` | Checksum được phê duyệt | Chưa xác định |  |  |
| `02_data_acceptance.md` | Approved | Draft |  |  |
| `03_business_decisions.md` | Approved | Draft |  |  |
| `04_edit_permissions.md` | Approved | Draft |  |  |
| `05_approval_units.csv` | Đã xác nhận | Đã có 6 đơn vị; chưa phân công lãnh đạo |  | Cả 6 dòng đang `PENDING_ASSIGNMENT` |
| `06_server_inventory.md` | Approved | Draft |  |  |
| `07_infrastructure_decision.md` | Approved | Draft |  |  |
| `08_risk_register.md` | Approved | Draft |  |  |
| `10_identity_and_access.md` | Approved | Draft |  |  |

## Cổng kiểm soát

- [ ] Bản dữ liệu đầu vào đối chiếu checksum thành công.
- [ ] Checksum dùng cho Giai đoạn 2 đã được người có thẩm quyền phê duyệt.
- [ ] Không có file Excel, dữ liệu cá nhân hoặc secret được theo dõi bởi Git.
- [ ] Tiêu chí chấp nhận dữ liệu đã được xác nhận.
- [ ] Quyết định nghiệp vụ bắt buộc đã được phê duyệt.
- [ ] Đơn vị phê duyệt và ma trận quyền đã được xác nhận.
- [ ] Kiểm kê máy chủ và quyết định hạ tầng có đủ căn cứ.
- [ ] Rủi ro còn mở đã có chủ sở hữu và phương án xử lý được chấp nhận.
- [ ] Đã chốt một submission bằng một dòng.
- [ ] Một phê duyệt tạo đúng một dòng.
- [ ] Đã chốt cách xác định phiên bản hiện hành theo `record_uid`: lấy `version_no` lớn nhất trong từng `record_uid`.
- [ ] Dòng cũ chỉ dùng để đối chiếu với submission mới, không được phê duyệt hoặc từ chối lại.
- [ ] Đã xác định tuyến duyệt theo `don_vi`.
- [ ] Đã loại bỏ `don_vi_phu_trach_hoc_phan` khỏi logic định tuyến.
- [ ] Đã đối chiếu đủ 6 giá trị `don_vi`.
- [ ] Mỗi đơn vị đã có người phê duyệt và email được xác nhận.
- [ ] `approval_unit` không lấy từ payload của trình duyệt.
- [ ] Lãnh đạo không được truy cập submission ngoài đơn vị được giao.
- [ ] Đã chốt đủ 20 trường phải được hiển thị.
- [ ] Đã chốt danh sách sáu trường chỉ đọc.
- [ ] Đã chốt danh sách mười bốn trường được sửa.
- [ ] Backend không tin trường khóa từ trình duyệt.
- [ ] Đã chốt ba loại submission: `CONFIRM_UNCHANGED`, `UPDATE_EXISTING`, `CREATE_NEW`.
- [ ] Dòng mới chỉ có `stt` sau phê duyệt.
- [ ] Submission lưu toàn bộ nội dung một dòng.
- [ ] Dòng `PENDING` không được chỉnh sửa hoặc gửi lại.
- [ ] Đã phân biệt `user_id` và `lecturer_uid`.
- [ ] Đã chốt quan hệ tài khoản–giảng viên.
- [ ] Đã chốt ba vai trò tối thiểu: `LECTURER`, `FACULTY_LEADER`, `SYSTEM_ADMIN`.
- [ ] Đã chốt một tài khoản có thể có nhiều vai trò.
- [ ] Đã chốt `SYSTEM_ADMIN` không mặc nhiên được phê duyệt.
- [ ] Đã chốt `FACULTY_LEADER` phải được gán `approval_unit`.
- [ ] Đã chốt không đăng ký công khai.
- [ ] Đã chốt vòng đời tài khoản: `INVITED`, `ACTIVE`, `SUSPENDED`, `DISABLED`.
- [ ] Đã chốt chuẩn hóa email trước khi so sánh.
- [ ] Đã chốt phương án chuyển sang OIDC/SSO VNU.
- [ ] Đã chốt xử lý khi giảng viên chuyển đơn vị.
- [ ] Đã chốt việc thu hồi phiên đăng nhập khi đình chỉ hoặc vô hiệu hóa tài khoản.

## Kiểm soát backup

- [x] Đã xác định scheduler backup là crontab của user `deploy`, không phải systemd timer.
- [x] Đã xác minh `cron.service` đang `enabled` và `active`.
- [ ] Restore thực tế đã được kiểm thử thành công.
- [ ] Đã xác minh có bản sao backup ngoài máy chủ production.
- [ ] Đã xác nhận production readiness.

Hai tiêu chí backup được đánh dấu hoàn thành phản ánh bằng chứng vận hành đã xác minh, không thay thế chữ ký và không đồng nghĩa production readiness. Các quyết định nghiệp vụ BD-08, BD-09, BD-10, BD-11 và BD-12 đã chốt về nội dung nhưng đang chờ ký xác nhận; các tiêu chí đó tiếp tục để chưa hoàn thành. Tiêu chí về người phê duyệt và email còn thiếu dữ liệu vì `leader_name` và `leader_email` của cả sáu đơn vị đang trống. Tài liệu tiếp tục là `Draft`.

## Quyết định chuyển giai đoạn

Trạng thái Giai đoạn 0: HOÀN THÀNH CÓ ĐIỀU KIỆN.

Cho phép chuyển sang Giai đoạn 1 để khởi tạo dự án và môi trường phát triển.

Các quyết định nghiệp vụ và kiến trúc đã được chốt về mặt kỹ thuật, nhưng một số nội dung vẫn chờ người có thẩm quyền ký xác nhận.

### Nội dung đã hoàn thành

- Nguồn dữ liệu Excel đã được khóa bằng SHA-256.
- Sheet `csdlcore` là nguồn import duy nhất.
- Dữ liệu có 20 trường nghiệp vụ.
- Một submission chứa đúng một dòng.
- Một lần phê duyệt thành công tạo đúng một dòng mới bằng `INSERT`.
- Dòng cũ chỉ dùng để đối chiếu và không được xét duyệt lại.
- Các phiên bản của cùng một dòng được liên kết bằng `record_uid`.
- Mỗi `record_uid` chỉ có tối đa một submission `PENDING`.
- Tất cả 20 trường được hiển thị.
- Sáu trường chỉ đọc và mười bốn trường được phép sửa đã được chốt.
- Tuyến duyệt dựa trên `don_vi`.
- `approval_unit` do backend xác định, không tin dữ liệu từ trình duyệt.
- Mô hình `user_id`, `lecturer_uid`, vai trò và vòng đời tài khoản đã được chốt.
- Phiên bản đầu sử dụng tài khoản nội bộ được quản trị viên tạo trước.
- Không cho đăng ký công khai.
- Kiến trúc hạ tầng sử dụng lại Caddy hiện có.
- UEB Core sử dụng PostgreSQL container riêng.
- Database không publish cổng `5432`.
- Ứng dụng tham gia network của Caddy và một private network riêng.
- Máy chủ, Docker, Caddy, PostgreSQL, volume và backup hiện có đã được kiểm kê.
- Backup hiện tại được chạy bằng crontab user `deploy`.
- Lịch backup, freshness, checksum và retention 14 ngày đã được xác minh.

### Nội dung còn mở

1. Chưa có tên và email VNU của lãnh đạo cho đủ sáu đơn vị.
2. Bài kiểm thử restore hiện tại đã chứng minh archive đọc được và `pg_restore` chạy xong, nhưng bước xác minh sau restore chưa hoàn thành do race condition trong quá trình khởi tạo PostGIS của container tạm.
3. Chưa có bằng chứng backup nằm ngoài máy chủ production.
4. Các quyết định vẫn chờ chữ ký xác nhận chính thức.
5. Backup và restore riêng cho UEB Core chưa được triển khai vì ứng dụng chưa tồn tại.

### Điều kiện bắt buộc

- Danh sách lãnh đạo phải hoàn thành trước khi kết thúc Giai đoạn 3 và trước UAT.
- Backup ngoài máy chủ phải được cấu hình trước production.
- Backup/restore của UEB Core phải được kiểm thử thành công trước production.
- Các quyết định nghiệp vụ phải được ký trước UAT.
- Không được coi production đã sẵn sàng tại thời điểm kết thúc Giai đoạn 0.

### Phạm vi được phép trong Giai đoạn 1

- Khởi tạo Next.js TypeScript.
- Tạo môi trường phát triển local.
- Tạo PostgreSQL local dành riêng cho UEB Core.
- Tạo Docker Compose local.
- Thiết lập lint, format và test.
- Tạo health endpoint.
- Tạo skeleton xác thực.
- Thiết lập cấu trúc thư mục dự án.

### Không được phép trong Giai đoạn 1 nếu chưa có lệnh riêng

- Thay đổi Caddy production.
- Tạo database production.
- Import dữ liệu production.
- Mở domain production.
- Tạo tài khoản người dùng thật.
- Chạy migration trên production.

## Ngoại lệ còn mở

| Mã | Ngoại lệ | Ảnh hưởng | Người chấp nhận | Điều kiện/Hạn xử lý | Trạng thái |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## Kết luận

- Kết luận Giai đoạn 0: Hoàn thành có điều kiện, chờ ký xác nhận.
- Cho phép chuyển sang giai đoạn tiếp theo: Có, chỉ trong phạm vi Giai đoạn 1 và môi trường phát triển local.
- Điều kiện kèm theo: Các điểm chặn UAT/production trong risk register phải được xử lý đúng hạn; production readiness chưa đạt.

## Ký xác nhận

| Vai trò | Họ và tên | Ý kiến | Ngày ký | Chữ ký/Xác nhận |
| --- | --- | --- | --- | --- |
| Chủ trì Giai đoạn 0 |  |  |  |  |
| Chủ sở hữu nghiệp vụ |  |  |  |  |
| Chủ sở hữu dữ liệu |  |  |  |  |
| Đại diện kỹ thuật/hạ tầng |  |  |  |  |
| Đại diện an toàn thông tin |  |  |  |  |
