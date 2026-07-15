# Quyết định về file nguồn Giai đoạn 2

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái ban đầu | **PENDING BUSINESS APPROVAL** |
| File được kiểm kê | `CSDLCore_chuan_hoa_PostgreSQL.xlsx` |
| SHA-256 | `e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972` |

## 1. Phạm vi của tài liệu

Tài liệu này ghi nhận kết quả kiểm kê và mở quyết định nghiệp vụ đối với file nguồn nêu trên. Tài liệu này **không phải source contract**, không xác nhận source contract đã `PASS` và không cho phép tạo Prisma model hoặc migration khi quyết định chưa được phê duyệt.

## 2. Kết quả kiểm kê thực tế

- Sheet được kiểm kê: `csdlcore`.
- Số cột: `20`.
- Số dòng dữ liệu: `2497`.
- Số STT distinct: `2497`.
- STT nhỏ nhất: `-1`.
- STT lớn nhất: `2569`.
- STT tiếp theo được đề xuất: `2570`.
- Không có STT trùng.
- Không có formula cell hoặc error cell.
- Không còn dòng thiếu đồng thời mã cán bộ và email.
- Có `7` nhóm dòng trùng, gồm tổng cộng `14` dòng.
- Có `5` nhóm biến thể tên giảng viên theo mã cán bộ.
- Có `19` nhóm biến thể tên học phần theo mã học phần.
- Kiểm tra `19.976` ô thuộc các cột ngày/TC theo cấu hình tập trung: `2.732` chuỗi ngày hợp lệ, `9.414` trạng thái `Đã hoàn thành`, `7.830` ô blank và `0` ô ngày hoặc trạng thái không hợp lệ.

## 3. Ghi nhận chênh lệch 74 dòng

So với nguồn trước, file được kiểm kê có ít hơn `74` dòng. Theo thông tin do người dùng cung cấp, việc loại `74` dòng này là thay đổi có chủ đích.

Ghi nhận trên chỉ mô tả nguồn gốc của chênh lệch và **không cấu thành phê duyệt nghiệp vụ**. File `CSDLCore_chuan_hoa_PostgreSQL.xlsx` chưa được coi là nguồn chính thức hoặc source contract chính thức cho đến khi quyết định dưới đây là `APPROVED` và có đầy đủ thông tin phê duyệt.

Tại thời điểm kiểm tra, file nguồn `CSDLCore_chuan_hoa_PostgreSQL_2571.xlsx` không còn trong `data/input`. Vì vậy chưa thực hiện được việc đối chiếu từng dòng giữa nguồn 2.571 dòng và file 2.497 dòng. Chưa có bằng chứng kỹ thuật từ công cụ so sánh để xác nhận rằng 74 STT bị loại là toàn bộ sai khác, rằng dữ liệu nghiệp vụ của các dòng còn lại không thay đổi, hoặc rằng tất cả dòng bị loại đều thiếu đồng thời mã cán bộ và email trong nguồn cũ.

## 4. Quyết định nghiệp vụ

| Trường | Giá trị cần điền |
| --- | --- |
| Decision | `PENDING` / `APPROVED` / `REJECTED` — hiện tại: `PENDING` |
| Approved by | Chưa điền |
| Role/unit | Chưa điền |
| Approval date | Chưa điền |
| Approval evidence/reference | Chưa điền |
| Notes | Chưa điền |

## 5. Điều kiện kiểm soát

- Không đánh lại STT của các dòng còn lại.
- Không tái sử dụng các STT đã bị loại.
- Không tạo migration khi `Decision` chưa là `APPROVED`.
- Việc phê duyệt file nguồn không tự động đồng nghĩa source contract đã `PASS`; source contract phải được lập và kiểm tra theo hard gate riêng của Giai đoạn 2.
- Quyết định này chỉ áp dụng cho đúng file và SHA-256 được ghi trong tài liệu.
- Nếu raw bytes của file thay đổi làm SHA-256 thay đổi, quyết định này lập tức mất hiệu lực và phải thực hiện lại kiểm kê cùng quy trình phê duyệt.
