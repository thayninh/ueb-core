# Source contract Giai đoạn 2

## 1. File nguồn đã chốt

Source contract phiên bản `2.0.0` áp dụng duy nhất cho:

| Thuộc tính | Giá trị |
| --- | --- |
| File nguồn | `CSDLCore_chuan_hoa_PostgreSQL.xlsx` |
| SHA-256 | `e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972` |
| Sheet | `csdlcore` |
| Số cột nghiệp vụ | `20` |
| Số dòng dữ liệu | `2497` |

Contract máy đọc được tại `config/phase-2/source-contract.json` là nguồn chuẩn cho các phép kiểm tra tự động. Tài liệu này không chứa đường dẫn tuyệt đối, dữ liệu cá nhân hoặc giá trị nghiệp vụ cụ thể.

File 2.497 dòng thay thế kỳ vọng cũ 2.571 dòng. Có 74 STT không còn xuất hiện trong khoảng từ `-1` đến `2569`; các khoảng trống này được giữ nguyên, không đánh lại và không tái sử dụng. Vì 74 dòng đó không còn thuộc nguồn đã chốt, chúng không được import và không được tạo thành 74 dòng có `identity_status = UNRESOLVED`.

## 2. Header và ánh xạ PostgreSQL

Header phải khớp nguyên văn, đủ 20 cột và đúng thứ tự dưới đây. Không trim, đổi tên hoặc sắp xếp lại header để làm cho kiểm tra đạt.

| Vị trí | Excel header | PostgreSQL column | Kiểu | Nullable | Unique |
| ---: | --- | --- | --- | :---: | :---: |
| 1 | `stt` | `stt` | `integer` | Không | Có |
| 2 | `don_vi_phu_trach_hoc_phan` | `don_vi_phu_trach_hoc_phan` | `text` | Có | Không |
| 3 | `bo_mon_phu_trach_hoc_phan` | `bo_mon_phu_trach_hoc_phan` | `text` | Có | Không |
| 4 | `khoi_kien_thuc` | `khoi_kien_thuc` | `text` | Có | Không |
| 5 | `ma_hoc_phan` | `ma_hoc_phan` | `text` | Có | Không |
| 6 | `ten_hoc_phan` | `ten_hoc_phan` | `text` | Có | Không |
| 7 | `ten_giang_vien` | `ten_giang_vien` | `text` | Có | Không |
| 8 | `ma_so_can_bo` | `ma_so_can_bo` | `text` | Có | Không |
| 9 | `email_tai_khoan_vnu` | `email_tai_khoan_vnu` | `text` | Có | Không |
| 10 | `bo_mon` | `bo_mon` | `text` | Có | Không |
| 11 | `don_vi` | `don_vi` | `text` | Có | Không |
| 12 | `core_1_2_3` | `core_1_2_3` | `text` | Có | Không |
| 13 | `TC1:Trợ Giảng` | `tc1_tro_giang` | `text` | Có | Không |
| 14 | `TC2: SH Chuyên môn` | `tc2_sh_chuyen_mon` | `text` | Có | Không |
| 15 | `TC3: Tốt nghiệp/NCKH/Bài báo/Chính cương` | `tc3_tong_hop` | `text` | Có | Không |
| 16 | `tc3_1_nganh_tot_nghiep_phu_hop` | `tc3_1_nganh_tot_nghiep_phu_hop` | `text` | Có | Không |
| 17 | `tc3_2_bien_soan_de_cuong_giao_trinh` | `tc3_2_bien_soan_de_cuong_giao_trinh` | `text` | Có | Không |
| 18 | `tc3_3_chu_nhiem_de_tai_nckh_lien_quan` | `tc3_3_chu_nhiem_de_tai_nckh_lien_quan` | `text` | Có | Không |
| 19 | `tc3_4_bai_bao_lien_quan` | `tc3_4_bai_bao_lien_quan` | `text` | Có | Không |
| 20 | `TC4: Giảng thử` | `tc4_giang_thu` | `text` | Có | Không |

Chỉ `stt` có yêu cầu unique. Việc contract ghi kiểu và nullability không tự tạo schema vật lý hoặc migration.

## 3. Quy tắc giá trị

### 3.1 Blank và text

- Blank Excel cell ánh xạ thành SQL `NULL`.
- Empty text và text chỉ chứa whitespace không được coi là blank; phải giữ nguyên.
- Không trim, đổi hoa/thường, chuẩn hóa Unicode hoặc viết lại giá trị nghiệp vụ khi lưu.
- `ma_so_can_bo` luôn ánh xạ sang PostgreSQL `text`; không chuyển thành số và không tự tạo giá trị.

### 3.2 Ngày và trạng thái TC

- Các giá trị ngày và trạng thái TC được lưu dưới dạng PostgreSQL `text`.
- Chuỗi ngày chỉ hợp lệ khi đúng `DD/MM/YYYY` và ngày tồn tại thực tế.
- Blank được phép và ánh xạ thành SQL `NULL`.
- Không tự chuyển đổi ngày sang kiểu khác hoặc sửa chuỗi nguồn.
- `tc3_3_chu_nhiem_de_tai_nckh_lien_quan` chỉ cho phép blank hoặc ngày hợp lệ.
- Bảy cột TC hỗn hợp được liệt kê trong JSON cho phép blank, ngày hợp lệ hoặc chính xác trạng thái `Đã hoàn thành`.
- Kết quả inspect đã kiểm tra 19.976 ô thuộc các cột này và ghi nhận `0` giá trị không hợp lệ.

### 3.3 Formula và duplicate

- Formula cell bị từ chối; nguồn đã chốt có `0` formula cell và `0` error cell.
- Không tự xóa, gộp hoặc deduplicate dòng.
- Cả 14 dòng thuộc 7 nhóm trùng phải được giữ và import đầy đủ.

## 4. Chỉ tiêu và cảnh báo đã biết

| Chỉ tiêu | Giá trị contract |
| --- | ---: |
| STT nhỏ nhất | `-1` |
| STT lớn nhất | `2569` |
| STT distinct | `2497` |
| STT tiếp theo | `2570` |
| STT trùng | `0` |
| STT thiếu trong khoảng min/max | `74` |
| Dòng thiếu đồng thời mã cán bộ và email | `0` |
| Nhóm dòng nghiệp vụ trùng | `7` nhóm, `14` dòng |
| Nhóm biến thể tên giảng viên theo mã cán bộ | `5` |
| Nhóm biến thể tên học phần theo mã học phần | `19` |
| Giá trị ngày/trạng thái không hợp lệ | `0` |

Các cảnh báo duplicate và biến thể tên là số liệu phải đối chiếu, không phải chỉ thị tự sửa dữ liệu. Import verification phải kỳ vọng đúng 2.497 dòng và không được quay lại kỳ vọng cũ 2.571 dòng.

## 5. Điều kiện thay đổi contract

Contract `2.0.0` mất hiệu lực nếu xảy ra bất kỳ thay đổi nào sau đây:

- tên file hoặc raw SHA-256 thay đổi;
- sheet thay đổi;
- số dòng hoặc số cột thay đổi;
- header thay đổi giá trị hoặc thứ tự;
- mapping, kiểu dữ liệu, nullability hoặc quy tắc unique thay đổi;
- chính sách blank, bảo toàn text, ngày, formula, duplicate hoặc mã cán bộ thay đổi;
- số lượng cảnh báo được chấp nhận thay đổi.

Khi có thay đổi, phải inspect lại raw workbook, lập phiên bản contract mới và ghi rõ lý do. Không sửa contract hiện tại để khớp một file mới mà không thay version và không dùng checksum của nguồn cũ.

Source contract này không tạo hoặc cho phép tự động tạo migration. Migration chỉ được thực hiện ở bước thiết kế database riêng sau khi contract được review và các gate liên quan tiếp tục đạt.
