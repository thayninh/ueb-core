# Biên bản chấp nhận dữ liệu đầu vào

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | Draft |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-14 |

## Thông tin nguồn dữ liệu

- Tên nguồn: `ueb_core_source_2026-07-14.xlsx`
- Sheet duy nhất được import: `csdlcore`
- Số cột nghiệp vụ: 20
- Số dòng được chấp nhận: 2497
- STT nhỏ nhất: -1
- STT lớn nhất: 2569
- STT dành cho dòng mới tiếp theo: 2570
- Số dòng thiếu mã cán bộ: 0
- Số dòng thiếu email VNU: 0
- Nguyên tắc: Không tự động đánh lại STT
- Trạng thái: Chờ xác nhận

Hồ sơ checksum của nguồn dữ liệu: `docs/phase-0/01_data_source.sha256`.

## Xử lý các sheet báo cáo cũ

Áp dụng phương án sau:

- Chỉ coi `csdlcore` là nguồn import.
- Các sheet còn lại chỉ là tài liệu lịch sử.
- Trước production, tạo lại báo cáo kiểm tra bằng chương trình import của Giai đoạn 2.

Các sheet `Bao_cao_chuan_hoa`, `Chi_tiet_can_kiem_tra` và `Nhat_ky_ngay` không được sử dụng để quyết định số lượng dòng import.

Nguồn dữ liệu import duy nhất là sheet `csdlcore`.

Các báo cáo kiểm tra sẽ được tái sinh từ sheet `csdlcore` trong Giai đoạn 2.

## Ký xác nhận

| Vai trò | Họ và tên | Kết luận | Ngày ký | Chữ ký/Xác nhận |
| --- | --- | --- | --- | --- |
| Chủ sở hữu dữ liệu |  |  |  |  |
| Đại diện nghiệp vụ |  |  |  |  |
| Đại diện kỹ thuật |  |  |  |  |
