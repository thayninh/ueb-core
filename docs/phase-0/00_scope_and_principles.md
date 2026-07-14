# Phạm vi và nguyên tắc Giai đoạn 0

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | Draft |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-14 |

## Mục tiêu

Xác lập phạm vi, nguyên tắc dữ liệu, các quyết định cần phê duyệt và điều kiện kết thúc Giai đoạn 0 trước khi triển khai hệ thống.

## Trong phạm vi

- Ghi nhận nguồn dữ liệu và checksum của bản dữ liệu đầu vào đã khóa.
- Xác định tiêu chí chấp nhận dữ liệu.
- Lập danh sách quyết định nghiệp vụ cần phê duyệt.
- Xác định đơn vị phê duyệt và ma trận quyền chỉnh sửa.
- Kiểm kê máy chủ ở mức không chứa thông tin xác thực.
- Ghi nhận quyết định hạ tầng sau khi có đủ căn cứ.
- Theo dõi rủi ro và điều kiện ký kết thúc Giai đoạn 0.

## Ngoài phạm vi

- Phát triển mã nguồn ứng dụng.
- Tạo cấu hình triển khai hoặc Docker Compose.
- Import dữ liệu vào cơ sở dữ liệu.
- Sửa trực tiếp file Excel nguồn đã khóa.
- Tự động phê duyệt quyết định nghiệp vụ.

## Nguyên tắc

- File dữ liệu đầu vào không được đưa vào Git, kể cả repository riêng tư.
- Git chỉ lưu checksum, mô tả dữ liệu và quyết định nghiệp vụ đã được phê duyệt.
- Mỗi bản dữ liệu thay đổi phải có tên file mới và checksum mới.
- Chỉ import bản dữ liệu có checksum đã được phê duyệt.
- Không ghi mật khẩu, secret, token, private key hoặc nội dung dữ liệu cá nhân vào tài liệu.
- Nội dung chưa có căn cứ phải được đánh dấu là chưa xác định và không được xem là quyết định.
- Một phiên bản là một dòng nghiệp vụ.
- Mỗi submission chứa đúng một dòng; không dùng submission như snapshot toàn bộ hồ sơ giảng viên.
- Giảng viên xem, xác nhận hoặc thay đổi từng dòng; lãnh đạo chỉ phê duyệt hoặc từ chối dòng thuộc submission tương ứng.
- Các phiên bản của cùng một dòng dùng chung `record_uid`; `version_no` tăng dần và phiên bản hiện hành là phiên bản có `version_no` lớn nhất trong cùng `record_uid`.
- Dòng mới hoàn toàn có `record_uid` mới và `version_no = 1`.
- Dòng phiên bản cũ chỉ được dùng để đối chiếu với submission mới; dòng cũ không được phê duyệt hoặc từ chối lại và việc hiển thị dòng cũ không làm thay đổi trạng thái, nội dung hoặc hiệu lực của dòng đó.
- Quyết định phê duyệt hoặc từ chối chỉ áp dụng cho submission mới đang ở trạng thái `PENDING`.
- Phê duyệt thành công tạo đúng một dòng mới; từ chối không thêm dòng vào bảng lõi.
- Mỗi `record_uid` chỉ được có tối đa một submission ở trạng thái `PENDING`.
- Không đăng ký tài khoản công khai; phiên bản đầu dùng tài khoản nội bộ do quản trị viên tạo trước.
- Áp dụng nguyên tắc quyền tối thiểu.
- Backend kiểm tra quyền cho mọi request.
- Không dùng giao diện làm lớp bảo vệ quyền duy nhất.
- Danh tính kỹ thuật (`user_id`) và danh tính nghiệp vụ (`lecturer_uid`) phải được tách biệt.

## Điều kiện hoàn thành

- [ ] Tiêu chí chấp nhận dữ liệu được phê duyệt.
- [ ] Các quyết định nghiệp vụ bắt buộc được ghi nhận và phê duyệt.
- [ ] Đơn vị phê duyệt và quyền chỉnh sửa được xác nhận.
- [ ] Kiểm kê máy chủ hoàn tất và đã loại bỏ dữ liệu nhạy cảm.
- [ ] Quyết định hạ tầng có căn cứ và người phê duyệt.
- [ ] Rủi ro còn mở có chủ sở hữu và phương án xử lý.
- [ ] Biên bản kết thúc Giai đoạn 0 được ký.

## Ký xác nhận

| Vai trò | Họ và tên | Ý kiến | Ngày ký | Chữ ký/Xác nhận |
| --- | --- | --- | --- | --- |
| Chủ trì Giai đoạn 0 |  |  |  |  |
| Đại diện nghiệp vụ |  |  |  |  |
| Đại diện kỹ thuật |  |  |  |  |
