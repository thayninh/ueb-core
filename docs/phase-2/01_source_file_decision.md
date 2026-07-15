# Quyết định về file nguồn Giai đoạn 2

| Thuộc tính | Giá trị |
| --- | --- |
| Technical source decision | **APPROVED** |
| Formal business sign-off record | **PENDING** — chưa có tên, vai trò/đơn vị và bằng chứng ký xác nhận chính thức |
| File được kiểm kê | `CSDLCore_chuan_hoa_PostgreSQL.xlsx` |
| SHA-256 | `e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972` |

## 1. Phạm vi của tài liệu

Tài liệu này ghi nhận technical source decision đã được phê duyệt đối với đúng file nguồn và SHA-256 nêu trên. Hồ sơ formal business sign-off vẫn `PENDING` cho tới khi có tên, vai trò/đơn vị và bằng chứng ký xác nhận chính thức. Source contract máy đọc được vẫn phải vượt qua toàn bộ kiểm tra tự động; quyết định kỹ thuật này không cho phép bỏ qua validation, sửa workbook, tự chuyển đổi dữ liệu hoặc tự động thay đổi Prisma model/migration.

## 2. Kết quả kiểm kê thực tế

- Sheet được kiểm kê: `csdlcore`.
- Số cột: `20`.
- Số dòng dữ liệu: `2497`.
- Số STT distinct: `2497`.
- STT nhỏ nhất: `-1`.
- STT lớn nhất: `2569`.
- STT tự sinh tiếp theo: `2570`.
- Có đúng `74` STT bị thiếu trong khoảng từ `-1` đến `2569`.
- Không có STT trùng.
- Không có formula cell hoặc error cell.
- Không còn dòng thiếu đồng thời mã cán bộ và email.
- Có `7` nhóm dòng trùng, gồm tổng cộng `14` dòng.
- Có `5` nhóm biến thể tên giảng viên theo mã cán bộ.
- Có `19` nhóm biến thể tên học phần theo mã học phần.
- Kiểm tra `19.976` ô thuộc các cột ngày/TC theo cấu hình tập trung: `2.732` chuỗi ngày hợp lệ, `9.414` trạng thái `Đã hoàn thành`, `7.830` ô blank và `0` ô ngày hoặc trạng thái không hợp lệ.

## 3. Ghi nhận chênh lệch 74 dòng

File 2.497 dòng được phê duyệt làm nguồn chính thức thay thế kỳ vọng cũ 2.571 dòng. Việc loại `74` dòng thiếu đồng thời mã cán bộ và email là thay đổi có chủ đích và đã được chấp nhận theo quyết định nghiệp vụ này.

Các khoảng trống STT phải được giữ nguyên. Không đánh lại STT và không tái sử dụng bất kỳ STT nào trong danh sách 74 STT đã bị loại. Identity tự sinh cho dữ liệu tương lai bắt đầu từ `2570`.

File nguồn 2.571 dòng không còn tại thời điểm kiểm tra nên việc đối chiếu kỹ thuật từng dòng giữa hai workbook chưa được thực hiện. Hạn chế bằng chứng này được ghi nhận, nhưng không thay đổi quyết định phê duyệt có chủ đích đối với đúng file 2.497 dòng và checksum nêu trên.

## 4. Quyết định kiểu dữ liệu `khoi_kien_thuc`

- Giá trị có kiểu Excel bắt buộc là `number`.
- Giá trị logic và kiểu PostgreSQL là `INTEGER`.
- Không chuyển number thành text và không coercion từ string number.
- Không chấp nhận decimal hoặc blank.
- Không có số 0 đầu mang ý nghĩa nghiệp vụ.
- Miền dữ liệu được phê duyệt cho nguồn hiện tại là số nguyên từ `1` đến `5`, nằm trong giới hạn PostgreSQL integer 32-bit.

## 5. Hồ sơ quyết định

| Trường | Giá trị cần điền |
| --- | --- |
| Technical source decision | `APPROVED` |
| Formal business sign-off record | `PENDING` |
| Approved by | Chưa được cung cấp cho hồ sơ sign-off chính thức |
| Role/unit | Chưa được cung cấp |
| Technical decision record date | `2026-07-15` — ngày ghi nhận quyết định trong yêu cầu triển khai |
| Formal approval date | Chưa được cung cấp |
| Approval evidence/reference | Yêu cầu triển khai Phase 2 là căn cứ cho technical source decision; chưa có bằng chứng sign-off chính thức |
| Notes | Không coi formal business sign-off đã hoàn tất cho tới khi bổ sung đủ tên, vai trò/đơn vị, ngày và bằng chứng phê duyệt |

## 6. Điều kiện kiểm soát

- Không đánh lại STT của các dòng còn lại.
- Không tái sử dụng các STT đã bị loại.
- Source contract chỉ `PASS` khi checksum, header, số dòng, STT, kiểu dữ liệu, ngày và mọi hard gate tự động đều đạt.
- Không thay đổi Prisma model hoặc migration trong bước cập nhật quyết định/contract này.
- Quyết định này chỉ áp dụng cho đúng file và SHA-256 được ghi trong tài liệu.
- Nếu raw bytes của file thay đổi làm SHA-256 thay đổi, quyết định này lập tức mất hiệu lực và phải thực hiện lại kiểm kê cùng quy trình phê duyệt.
