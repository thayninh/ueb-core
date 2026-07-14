# Sổ đăng ký rủi ro Giai đoạn 0

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | Draft |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-14 |

## Thang đánh giá

Thang đánh giá vẫn là `Draft`. Với nhóm rủi ro danh tính và truy cập, mức độ sơ bộ được dùng như sau: `Cao` khi rủi ro có thể dẫn tới sai danh tính, truy cập/phê duyệt trái phép, phiên truy cập tồn tại sau đình chỉ hoặc lộ thông tin xác thực; `Trung bình` khi rủi ro chủ yếu làm gián đoạn vận hành hoặc giảm khả năng kiểm toán. Mức độ phải được xác nhận khi ký tài liệu.

## Danh sách rủi ro

| Mã | Rủi ro | Căn cứ | Khả năng | Ảnh hưởng | Mức rủi ro | Biện pháp hiện có/Đề xuất | Chủ sở hữu | Hạn xử lý | Trạng thái |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | File Excel chứa dữ liệu cá nhân bị đưa vào Git | Quy định bảo vệ dữ liệu đầu vào | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | `.gitignore`; kiểm tra thay đổi trước commit | Chưa phân công | Chưa xác định | Open |
| R-02 | Bản dữ liệu đã khóa bị thay đổi nhưng vẫn được sử dụng | Quy tắc khóa file bằng checksum | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Xác minh checksum trước mọi lần sử dụng | Chưa phân công | Chưa xác định | Open |
| R-03 | Giai đoạn 2 import checksum chưa được phê duyệt | Điều kiện import đã nêu | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Thiết lập cổng phê duyệt checksum trước import | Chưa phân công | Chưa xác định | Open |
| R-04 | Tài liệu kiểm kê làm lộ thông tin xác thực | Quy định không lưu secret/token/private key | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Loại bỏ dữ liệu nhạy cảm; không commit kết quả kiểm kê thô | Chưa phân công | Chưa xác định | Open |
| R-05 | Các quyết định nghiệp vụ chưa được ký xác nhận chính thức | Các tài liệu quyết định đang ở trạng thái Draft | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Hoàn tất chữ ký trước UAT; không coi quyết định kỹ thuật là phê duyệt chính thức | Chưa phân công | Trước UAT | OPEN |
| R-06 | Phê duyệt hai lần cùng một submission làm phát sinh nhiều hơn một dòng mới | Quy tắc một phê duyệt tạo đúng một dòng | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Bảo đảm mỗi submission chỉ được xử lý phê duyệt thành công một lần | Chưa phân công | Chưa xác định | Open |
| R-07 | Có hai submission `PENDING` cho cùng một `record_uid` | Quy tắc tối đa một submission `PENDING` cho mỗi `record_uid` | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Giai đoạn 2: kiểm soát tính duy nhất của submission `PENDING` theo `record_uid` khi tạo và gửi submission | Chưa phân công | Chưa xác định | Open |
| R-08 | Truy vấn nhầm `MAX(stt)` của toàn bộ giảng viên để xác định phiên bản hiện hành | Quy tắc phiên bản theo từng `record_uid` | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Xác định phiên bản hiện hành bằng `version_no` lớn nhất trong từng `record_uid`; không dùng `MAX(stt)` của giảng viên | Chưa phân công | Chưa xác định | Open |
| R-09 | Hiển thị đồng thời phiên bản cũ và mới như hai dòng hiện hành | Quy tắc một phiên bản hiện hành cho mỗi `record_uid` | Chưa đánh giá | Chưa đánh giá | Chưa đánh giá | Chỉ đánh dấu/hiển thị dòng có `version_no` lớn nhất trong từng `record_uid` là hiện hành; phiên bản cũ chỉ thuộc lịch sử | Chưa phân công | Chưa xác định | Open |

## Rủi ro tuyến phê duyệt

| Mã | Rủi ro | Biện pháp xử lý | Giai đoạn dự kiến thực thi | Chủ sở hữu | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| R-10 | Dùng nhầm `don_vi_phu_trach_hoc_phan` để định tuyến | Backend chỉ định tuyến theo `don_vi` trong hồ sơ định danh đã được quản trị viên xác nhận; kiểm thử riêng trường hợp hai giá trị đơn vị khác nhau | Giai đoạn 2 | Chưa phân công | Open |
| R-11 | Tin cậy giá trị `don_vi` hoặc `approval_unit` từ trình duyệt | Backend tự xác định `approval_unit` từ `lecturer_uid`, bỏ qua các giá trị định tuyến do trình duyệt gửi lên và kiểm thử giả mạo payload | Giai đoạn 2 | Chưa phân công | Open |
| R-12 | Chưa phân công lãnh đạo và email VNU cho đủ sáu đơn vị | Hoàn tất `leader_name`, `leader_email` và xác nhận quyền cho cả sáu đơn vị; không cho gửi submission khi chưa có đơn vị phê duyệt hợp lệ | Trước khi kết thúc Giai đoạn 3 và trước UAT | Chưa phân công | OPEN |
| R-13 | Lãnh đạo xem hoặc xử lý submission ngoài đơn vị được giao | Kiểm tra quyền theo `approval_unit` ở backend cho thao tác danh sách, xem chi tiết, phê duyệt và từ chối | Giai đoạn 2 | Chưa phân công | Open |
| R-14 | Tên đơn vị trong nguồn dữ liệu không khớp chính xác với danh mục đơn vị | Đối chiếu chính xác `source_don_vi` với sáu giá trị đã xác nhận; chặn giá trị không có ánh xạ và yêu cầu quản trị viên xử lý | Giai đoạn 0 trước ký xác nhận và Giai đoạn 2 khi import | Chưa phân công | Open |
| R-15 | Tài khoản lãnh đạo bị vô hiệu hóa nhưng đơn vị chưa có người thay thế | Theo dõi trạng thái tài khoản, cảnh báo đơn vị thiếu người phê duyệt và yêu cầu gán người thay thế; giữ `approval_unit` của submission không đổi | Giai đoạn 2 và vận hành | Chưa phân công | Open |

## Rủi ro quyền trường và nội dung submission

Rủi ro có hai submission `PENDING` cho cùng `record_uid` được quản lý tại R-07 và dự kiến kiểm soát trong Giai đoạn 2.

| Mã | Rủi ro | Biện pháp kiểm soát | Giai đoạn thực thi | Chủ sở hữu | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| R-16 | Trình duyệt gửi thay đổi đối với trường khóa | Backend lấy lại trường khóa từ `lecturer_uid`, hồ sơ định danh và dòng hiện hành; từ chối payload có giá trị trường khóa bị thay đổi | Giai đoạn 2 | Chưa phân công | Open |
| R-17 | Backend âm thầm chấp nhận hoặc bỏ qua trường trái phép | Trả lỗi xác định cho toàn bộ yêu cầu chứa thay đổi trái phép và ghi nhận sự kiện phục vụ kiểm toán | Giai đoạn 2 | Chưa phân công | Open |
| R-18 | Submission chỉ lưu phần chênh lệch, không đủ để kiểm toán | Backend dựng và lưu đầy đủ dữ liệu một dòng cho mọi loại submission; kiểm thử tính đầy đủ của 20 trường | Giai đoạn 2 | Chưa phân công | Open |
| R-19 | Xác nhận không thay đổi nhưng dùng dữ liệu không còn hiện hành | Backend đọc lại phiên bản hiện hành theo `record_uid` tại thời điểm tạo submission và từ chối khi phiên bản cơ sở không còn hiện hành | Giai đoạn 2 | Chưa phân công | Open |
| R-20 | Cấp `stt` trước khi phê duyệt làm phát sinh khoảng trống không cần thiết | Chỉ cấp `stt` chính thức trong luồng phê duyệt thành công; submission `CREATE_NEW` chưa duyệt không giữ `stt` chính thức | Giai đoạn 2 | Chưa phân công | Open |
| R-21 | Giảng viên chỉnh sửa submission đang `PENDING` | Coi submission `PENDING` là bất biến; backend từ chối cập nhật hoặc gửi lại submission đang chờ duyệt | Giai đoạn 2 | Chưa phân công | Open |
| R-22 | Giao diện không hiển thị đủ 20 trường | Dùng danh mục 20 trường đã chốt làm tiêu chí kiểm thử giao diện cho cả năm thao tác A–E | Giai đoạn 2 | Chưa phân công | Open |

## Rủi ro danh tính và truy cập

| Mã | Rủi ro | Mức độ sơ bộ | Biện pháp kiểm soát | Giai đoạn thực thi | Chủ sở hữu | Trạng thái |
| --- | --- | --- | --- | --- | --- | --- |
| R-23 | Một `lecturer_uid` bị liên kết với hai tài khoản hoạt động | Cao | Kiểm tra tính duy nhất trước khi kích hoạt; chặn tài khoản hoạt động thứ hai và chuyển quản trị viên xử lý xung đột | Giai đoạn 2 | Chưa phân công | Open |
| R-24 | Hai `lecturer_uid` bị liên kết nhầm với cùng một người | Cao | Đối chiếu hồ sơ định danh đã xác nhận; dừng liên kết khi có mâu thuẫn và yêu cầu chủ sở hữu dữ liệu xử lý | Giai đoạn 0 trước ký xác nhận và Giai đoạn 2 | Chưa phân công | Open |
| R-25 | Email viết hoa/thường tạo tài khoản trùng | Cao | Trim và chuyển email về chữ thường trước khi so sánh; chặn tạo tự động khi email chuẩn hóa bị trùng | Giai đoạn 2 | Chưa phân công | Open |
| R-26 | Tài khoản lãnh đạo có vai trò nhưng chưa được gán `approval_unit` | Trung bình | Mặc định từ chối xem/xử lý submission; cảnh báo quản trị viên và chỉ cấp quyền khi có đơn vị được gán | Giai đoạn 0 trước ký xác nhận và Giai đoạn 2 | Chưa phân công | Open |
| R-27 | `SYSTEM_ADMIN` vô tình có quyền phê duyệt | Cao | Không gộp quyền duyệt vào vai trò admin; yêu cầu gán rõ `FACULTY_LEADER` và `approval_unit`, kiểm tra quyền ở backend | Giai đoạn 2 | Chưa phân công | Open |
| R-28 | Tài khoản bị đình chỉ nhưng phiên đăng nhập cũ còn hiệu lực | Cao | Thu hồi toàn bộ phiên khi chuyển sang `SUSPENDED` hoặc `DISABLED`; kiểm tra trạng thái tài khoản trên các request cần xác thực | Giai đoạn 2 | Chưa phân công | Open |
| R-29 | SSO tạo tài khoản trùng với tài khoản nội bộ | Cao | Liên kết SSO với `user_id` hiện có sau đối chiếu; khi mâu thuẫn, không tự tạo/gộp và chuyển quản trị viên xử lý | Giai đoạn chuyển đổi SSO | Chưa phân công | Open |
| R-30 | Chuyển đơn vị làm đổi `approval_unit` của submission đang `PENDING` | Cao | Lưu `approval_unit` bất biến khi tạo submission; chỉ submission mới dùng đơn vị mới đã xác nhận | Giai đoạn 2 | Chưa phân công | Open |
| R-31 | Thay đổi vai trò hoặc email nhưng không có audit | Trung bình | Ghi audit giá trị trước/sau, người thực hiện, thời điểm và căn cứ cho mọi thay đổi email, vai trò, đơn vị duyệt hoặc trạng thái | Giai đoạn 2 | Chưa phân công | Open |
| R-32 | Mật khẩu hoặc token bị đưa vào Git hoặc tài liệu | Cao | Duy trì quy tắc loại trừ, kiểm tra trước commit, không ghi thông tin xác thực vào tài liệu và áp dụng quy trình thu hồi/thay thế khi phát hiện lộ lọt | Giai đoạn 0 và vận hành | Chưa phân công | Open |

## Rủi ro vận hành backup

| Mã | Rủi ro | Mức độ sơ bộ | Biện pháp kiểm soát | Giai đoạn thực thi | Chủ sở hữu | Trạng thái |
| --- | --- | --- | --- | --- | --- | --- |
| R-33 | Scheduler backup bị xóa hoặc crontab của user `deploy` bị thay đổi | Cao | Quản lý thay đổi crontab, lưu bản cấu hình đã rà soát, giám sát lần backup gần nhất và cảnh báo khi không có backup đúng lịch | Giai đoạn 0 và vận hành | Chưa phân công | Open |
| R-34 | User `deploy` bị khóa hoặc mất quyền làm backup không chạy | Cao | Giám sát trạng thái tài khoản/quyền cần thiết, kiểm tra kết quả job hằng ngày và cảnh báo khi backup hoặc freshness thất bại | Vận hành | Chưa phân công | Open |
| R-35 | Restore hiện tại chưa được xác minh hoàn chỉnh | Cao | Archive đã đọc được và `pg_restore` đã chạy xong; cần xử lý race condition khởi tạo PostGIS của container tạm, hoàn tất xác minh sau restore và lưu bằng chứng | Trước production readiness và định kỳ vận hành | Chưa phân công | OPEN |
| R-36 | Backup nằm trên cùng máy chủ production | Cao | Xác định bản sao ngoài máy chủ, kiểm chứng truyền bản sao và kiểm tra khả năng sử dụng bản sao đó khi phục hồi | Trước production readiness | Chưa phân công | OPEN |
| R-37 | Root cron không rõ chức năng gây sử dụng tài nguyên hoặc xung đột lịch | Trung bình | Giữ phân loại `UNRELATED_OR_UNKNOWN`, xác minh chủ sở hữu/nội dung an toàn và đánh giá thời điểm 00:23 trước khi kết luận ảnh hưởng | Giai đoạn 0 | Chưa phân công | Open |
| R-38 | Log tăng trưởng không có log rotation | Trung bình | Xác minh dung lượng, retention và cơ chế rotation; thiết lập giám sát/cảnh báo trước khi log ảnh hưởng dung lượng đĩa | Giai đoạn 2 và vận hành | Chưa phân công | Open |
| R-39 | Backup và restore riêng cho UEB Core chưa được triển khai vì ứng dụng chưa tồn tại | Cao | Thiết kế, triển khai và kiểm thử backup/restore UEB Core trước production; không dùng bằng chứng của hệ thống hiện tại để thay thế | Trước production | Chưa phân công | OPEN |
| R-40 | Khuyến nghị hạ tầng chưa được ký xác nhận chính thức | Cao | Hoàn tất rà soát và chữ ký của người có thẩm quyền trước khi thay đổi hạ tầng hoặc triển khai production | Trước production | Chưa phân công | OPEN |

## Rủi ro còn mở và điểm chặn

- R-12 tiếp tục `Open`: chưa phân công lãnh đạo và email VNU cho đủ sáu đơn vị.
- R-35 tiếp tục `Open`: restore hiện tại chưa được xác minh hoàn chỉnh.
- R-36 tiếp tục `Open`: chưa có bằng chứng backup nằm ngoài máy chủ production.
- R-39 tiếp tục `Open`: backup/restore riêng cho UEB Core chưa được triển khai.
- R-05 tiếp tục `Open`: các quyết định nghiệp vụ chưa được ký chính thức.
- R-40 tiếp tục `Open`: khuyến nghị hạ tầng chưa được ký chính thức.

| Rủi ro | Điểm chặn |
| --- | --- |
| Thiếu lãnh đạo đơn vị | Trước khi kết thúc Giai đoạn 3 và trước UAT |
| Chưa có restore UEB Core thành công | Trước production |
| Chưa có backup ngoài máy chủ | Trước production |
| Chưa có chữ ký nghiệp vụ | Trước UAT |
| Chưa có chữ ký hạ tầng | Trước production |

## Chấp nhận rủi ro và ngoại lệ

| Mã rủi ro | Quyết định xử lý | Lý do | Người có thẩm quyền | Ngày hiệu lực | Ngày xem xét lại |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## Ký xác nhận

| Vai trò | Họ và tên | Phạm vi xác nhận | Ngày ký | Chữ ký/Xác nhận |
| --- | --- | --- | --- | --- |
| Chủ trì Giai đoạn 0 |  |  |  |  |
| Đại diện nghiệp vụ |  |  |  |  |
| Đại diện an toàn thông tin |  |  |  |  |
