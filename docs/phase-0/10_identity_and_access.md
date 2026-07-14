# Quyết định danh tính, tài khoản và phân quyền

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | Draft |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-14 |

## Phạm vi

Tài liệu này quy định mô hình danh tính, tài khoản nội bộ, vai trò, vòng đời tài khoản, kiểm soát truy cập và hướng chuyển đổi sang OIDC/SSO VNU. Tài liệu không chứa mật khẩu, token, secret hoặc thông tin xác thực thực tế và không thay thế thiết kế triển khai kỹ thuật ở giai đoạn sau.

## Thuật ngữ

| Thuật ngữ | Định nghĩa |
| --- | --- |
| `user_id` | Định danh kỹ thuật bất biến của tài khoản. |
| `lecturer_uid` | Định danh nghiệp vụ bất biến của giảng viên. |
| `approval_unit` | Đơn vị phê duyệt được backend xác định và dùng để giới hạn phạm vi xử lý submission. |
| Vai trò | Tập quyền được gán cho tài khoản; một tài khoản có thể có nhiều vai trò. |
| OIDC/SSO VNU | Cơ chế đăng nhập liên kết dự kiến trong tương lai, không thay thế các định danh nội bộ. |

Không dùng email hoặc `ma_so_can_bo` làm khóa chính. Email và mã cán bộ là thuộc tính có thể cần đối chiếu, không phải định danh bất biến của tài khoản hoặc giảng viên.

## Nguyên tắc chung

- Không cho đăng ký công khai.
- Phiên bản đầu dùng tài khoản nội bộ do quản trị viên tạo trước.
- Áp dụng nguyên tắc quyền tối thiểu.
- Backend kiểm tra quyền cho mọi request; giao diện không phải lớp bảo vệ quyền duy nhất.
- Không tự suy đoán email từ họ tên.
- Không lưu mật khẩu, mật khẩu tạm, token hoặc secret trong Git, Excel hoặc tài liệu.
- Việc thay đổi email, vai trò, đơn vị duyệt hoặc trạng thái tài khoản phải được ghi audit.
- Không hỗ trợ tính năng đăng nhập giả danh người dùng trong phiên bản đầu.
- Không xóa vật lý tài khoản đã có lịch sử nghiệp vụ.

## Quan hệ `user_id` và `lecturer_uid`

- `user_id` là định danh kỹ thuật bất biến của tài khoản.
- `lecturer_uid` là định danh nghiệp vụ bất biến của giảng viên.
- Một `user_id` liên kết với tối đa một `lecturer_uid`.
- Một `lecturer_uid` chỉ có tối đa một tài khoản đang hoạt động.
- Tài khoản lãnh đạo hoặc admin có thể không có `lecturer_uid`.
- Người vừa là giảng viên vừa là lãnh đạo dùng một tài khoản duy nhất và được gán nhiều vai trò trên tài khoản đó.
- Thay đổi email, vai trò, đơn vị duyệt hoặc trạng thái tài khoản không làm thay đổi `user_id` hay `lecturer_uid`.

## Ma trận vai trò

Các vai trò tối thiểu là `LECTURER`, `FACULTY_LEADER`, `SYSTEM_ADMIN`.

| Vai trò | Có bắt buộc `lecturer_uid` | Phạm vi quyền | Giới hạn bắt buộc |
| --- | --- | --- | --- |
| `LECTURER` | Có | Xem, xác nhận, thay đổi hoặc tạo từng dòng trong phạm vi của chính giảng viên | Không được phê duyệt submission chỉ nhờ vai trò này |
| `FACULTY_LEADER` | Không | Xem, phê duyệt hoặc từ chối submission thuộc `approval_unit` được giao | Không được xem hoặc xử lý `approval_unit` ngoài danh sách được cấp quyền |
| `SYSTEM_ADMIN` | Không | Quản trị danh tính, tài khoản, vai trò, trạng thái và cấu hình đơn vị duyệt | Không mặc nhiên được phê duyệt; muốn duyệt phải được gán thêm vai trò và `approval_unit` phù hợp |

Một tài khoản có thể có nhiều vai trò. Mọi quyền được hợp thành theo các vai trò và phạm vi được gán, nhưng vẫn phải được backend kiểm tra cho từng request.

## Vòng đời tài khoản

| Trạng thái | Ý nghĩa | Được đăng nhập | Xử lý phiên hiện có |
| --- | --- | --- | --- |
| `INVITED` | Tài khoản đã được tạo trước và đang chờ hoàn tất kích hoạt | Không | Không có phiên hợp lệ |
| `ACTIVE` | Tài khoản đang hoạt động | Có | Phiên được quản lý theo chính sách xác thực |
| `SUSPENDED` | Tài khoản bị đình chỉ tạm thời | Không | Thu hồi toàn bộ phiên hiện có |
| `DISABLED` | Tài khoản bị vô hiệu hóa | Không | Thu hồi toàn bộ phiên hiện có |

Chỉ tài khoản `ACTIVE` được đăng nhập. Mọi thay đổi trạng thái phải được ghi audit. Tài khoản có lịch sử nghiệp vụ được giữ lại để bảo toàn liên kết kiểm toán và không bị xóa vật lý.

## Quy trình tạo tài khoản giảng viên

1. Quản trị viên xác nhận hồ sơ định danh và `lecturer_uid` của giảng viên.
2. Kiểm tra `lecturer_uid` chưa liên kết với một tài khoản đang hoạt động và người đó chưa có tài khoản khác cần tái sử dụng.
3. Chuẩn hóa email bằng cách trim và chuyển về chữ thường trước khi so sánh; không suy đoán email từ họ tên.
4. Tạo `user_id` bất biến, liên kết tối đa một `lecturer_uid` và gán vai trò `LECTURER`.
5. Nếu người đó đã có tài khoản hợp lệ ở vai trò khác, gán thêm `LECTURER` trên cùng tài khoản thay vì tạo tài khoản mới.
6. Tạo tài khoản ở trạng thái `INVITED` và chuyển thông tin kích hoạt qua kênh an toàn được phê duyệt; không ghi mật khẩu, mật khẩu tạm hoặc token vào Git, Excel hay tài liệu.
7. Ghi audit việc tạo tài khoản, liên kết danh tính và gán vai trò.

## Quy trình tạo tài khoản lãnh đạo

1. Xác nhận người được giao vai trò và danh sách `approval_unit` được phép xử lý.
2. Tìm tài khoản hiện có của cùng người trước khi tạo mới.
3. Nếu người đó đồng thời là giảng viên, gán `FACULTY_LEADER` trên tài khoản đang liên kết với `lecturer_uid`; không tạo tài khoản lãnh đạo riêng.
4. Nếu người đó chưa có tài khoản, tạo một `user_id` mới; `lecturer_uid` có thể để trống nếu người đó không phải giảng viên.
5. Gán vai trò `FACULTY_LEADER` cùng `approval_unit`; chỉ có vai trò mà chưa có `approval_unit` thì không được xem hoặc xử lý submission.
6. Ghi audit việc tạo tài khoản, gán vai trò và gán đơn vị duyệt.

## Quy trình đình chỉ hoặc vô hiệu hóa

1. Người có thẩm quyền xác nhận yêu cầu và lựa chọn `SUSPENDED` hoặc `DISABLED`.
2. Cập nhật trạng thái tài khoản và thu hồi toàn bộ phiên đăng nhập hiện có.
3. Từ chối mọi lần đăng nhập mới khi tài khoản không ở trạng thái `ACTIVE`.
4. Giữ nguyên `user_id`, liên kết lịch sử nghiệp vụ và các bản ghi audit; không xóa vật lý tài khoản.
5. Nếu tài khoản đang giữ vai trò lãnh đạo, cảnh báo đơn vị và yêu cầu phân công người thay thế.
6. Ghi audit người thực hiện, thời điểm, trạng thái trước/sau và căn cứ thay đổi.

## Quy tắc đổi email

- Trim và chuyển email về chữ thường trước khi so sánh hoặc kiểm tra trùng.
- Không dùng email làm khóa chính và không thay đổi `user_id` hoặc `lecturer_uid` khi đổi email.
- Không tự tạo hoặc suy đoán email từ họ tên.
- Nếu email chuẩn hóa trùng với tài khoản khác, không tự động gộp hoặc tạo tài khoản; chuyển quản trị viên xác minh.
- Mọi thay đổi email phải được ghi audit với giá trị trước/sau và người thực hiện.

## Quy tắc chuyển đơn vị

- Quản trị viên xác nhận thay đổi đơn vị trong hồ sơ định danh của giảng viên và ghi audit.
- Submission mới được định tuyến theo đơn vị mới đã xác nhận.
- Submission đang `PENDING` giữ nguyên `approval_unit` đã lưu khi tạo và tiếp tục do lãnh đạo của đơn vị đó xử lý.
- Việc chuyển đơn vị không thay đổi `user_id`, `lecturer_uid` hoặc lịch sử nghiệp vụ.

## Phương án chuyển sang OIDC/SSO VNU

- Kiến trúc phải cho phép liên kết danh tính SSO với tài khoản nội bộ hiện có mà không thay đổi `user_id`, `lecturer_uid` hoặc lịch sử nghiệp vụ.
- Thuộc tính hoặc định danh do SSO trả về chỉ được dùng để đối chiếu và liên kết sau khi vượt qua kiểm tra nhất quán.
- Khi SSO trả về dữ liệu mâu thuẫn hoặc có khả năng trùng tài khoản, không tự động tạo tài khoản mới, không tự động gộp và không tự thay đổi liên kết `lecturer_uid`; chuyển quản trị viên xử lý.
- Việc liên kết, hủy liên kết hoặc thay đổi nhà cung cấp danh tính phải được ghi audit.

## Các trường hợp lỗi và cách xử lý

| Trường hợp | Cách xử lý bắt buộc |
| --- | --- |
| Yêu cầu đăng ký công khai | Từ chối; hướng người dùng liên hệ quản trị viên. |
| `lecturer_uid` đã có tài khoản `ACTIVE` | Không tạo tài khoản thứ hai; chuyển quản trị viên kiểm tra tài khoản hiện có. |
| Một người bị gán hai `lecturer_uid` | Dừng tạo hoặc liên kết; chuyển chủ sở hữu dữ liệu và quản trị viên xác minh. |
| Email sau chuẩn hóa trùng tài khoản khác | Không tự động tạo hoặc gộp tài khoản; chuyển quản trị viên xác minh. |
| `FACULTY_LEADER` chưa có `approval_unit` | Không cho xem hoặc xử lý submission; yêu cầu quản trị viên cấu hình đơn vị. |
| Lãnh đạo yêu cầu truy cập ngoài `approval_unit` | Backend từ chối và ghi nhận sự kiện phục vụ kiểm toán. |
| Tài khoản không ở trạng thái `ACTIVE` đăng nhập | Từ chối đăng nhập; với `SUSPENDED`/`DISABLED`, bảo đảm phiên cũ đã bị thu hồi. |
| Dữ liệu SSO mâu thuẫn với tài khoản nội bộ | Không tạo tài khoản trùng; chuyển quản trị viên xử lý. |
| Yêu cầu giả danh người dùng | Từ chối vì phiên bản đầu không hỗ trợ tính năng này. |
| Phát hiện mật khẩu, token hoặc secret trong Git, Excel hay tài liệu | Dừng sử dụng thông tin bị lộ, báo người có trách nhiệm và thực hiện quy trình thu hồi/thay thế ngoài tài liệu này. |

## Ký xác nhận

| Vai trò | Họ và tên | Phạm vi xác nhận | Ngày ký | Chữ ký/Xác nhận |
| --- | --- | --- | --- | --- |
| Chủ sở hữu nghiệp vụ |  |  |  |  |
| Đại diện quản trị tài khoản |  |  |  |  |
| Đại diện an toàn thông tin |  |  |  |  |
| Chủ trì Giai đoạn 0 |  |  |  |  |
