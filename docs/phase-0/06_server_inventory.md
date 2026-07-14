# Kiểm kê máy chủ

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | Draft |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-14 |

## Nguyên tắc thu thập

- Chỉ ghi thông tin cần thiết để đánh giá khả năng triển khai.
- Không ghi mật khẩu, secret, token, private key, cookie, chuỗi kết nối hoặc nội dung file môi trường.
- Không đưa kết quả kiểm kê thô trong `infra/audit` vào Git.
- Trước khi đưa bằng chứng vào tài liệu, phải loại bỏ dữ liệu nhạy cảm và thông tin định danh không cần thiết.

## Phạm vi kiểm kê

| Mục | Giá trị | Nguồn xác minh | Ngày xác minh | Người xác minh |
| --- | --- | --- | --- | --- |
| Môi trường/mục đích sử dụng | Chưa xác định | Chưa có |  |  |
| Hệ điều hành và phiên bản | Chưa xác định | Chưa có |  |  |
| Kiến trúc CPU | Chưa xác định | Chưa có |  |  |
| Số CPU | Chưa xác định | Chưa có |  |  |
| Bộ nhớ | Chưa xác định | Chưa có |  |  |
| Dung lượng lưu trữ khả dụng | Chưa xác định | Chưa có |  |  |
| Mạng và phân vùng mạng | Chưa xác định | Chưa có |  |  |
| Cơ chế cân bằng tải/proxy | Chưa xác định | Chưa có |  |  |
| Cơ sở dữ liệu hiện có | Chưa xác định | Chưa có |  |  |
| Cơ chế sao lưu/khôi phục | Backup database và uploads chạy bằng crontab của user `deploy`; restore thực tế chưa kiểm thử | Crontab, log và file backup đã xác minh | 2026-07-14 | Chưa ghi nhận |
| Giám sát và nhật ký | Có kiểm tra health mỗi 15 phút, dung lượng đĩa mỗi 6 giờ và kiểm tra freshness/checksum sau backup | Crontab và log đã xác minh | 2026-07-14 | Chưa ghi nhận |
| Yêu cầu sẵn sàng cao | Chưa xác định | Chưa có |  |  |

## Kết quả xác minh lịch backup

Backup database và uploads của hệ thống hiện tại được kích hoạt bằng crontab của user `deploy`, không phải systemd timer. Dịch vụ `cron.service` đang `enabled` và `active`.

| Lịch | Tác vụ đã xác minh |
| --- | --- |
| `15 2 * * *` | Chạy `/opt/khtc-ueb/repo/scripts/prod/backup.sh` |
| `45 2 * * *` | Chạy `/opt/khtc-ueb/repo/scripts/prod/check-backup-freshness.sh` |
| `*/15 * * * *` | Chạy kiểm tra health |
| `0 */6 * * *` | Chạy kiểm tra dung lượng đĩa |

Log và file backup xác nhận backup thực tế được tạo khoảng 02:15 mỗi ngày. Kiểm tra freshness và checksum chạy sau backup khoảng 30 phút.

`dpkg-db-backup.timer` là timer hệ thống của Ubuntu và không được coi là backup PostgreSQL ứng dụng.

Root crontab có một job lúc 00:23 trỏ tới `/www/server/cron/...`. Nội dung và chức năng chưa được xác định; job này được phân loại `UNRELATED_OR_UNKNOWN`, không được suy đoán chức năng và không được coi là backup UEB/KHTC.

## Trạng thái kiểm soát backup

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Lịch tự động | Đã xác minh | Crontab của user `deploy` |
| File dump được tạo | Đã xác minh | Có file backup thực tế khoảng 02:15 mỗi ngày |
| Log hoàn thành | Đã xác minh | Log xác nhận tác vụ hoàn thành |
| Freshness | Đã xác minh | Chạy sau backup khoảng 30 phút |
| Checksum | Đã xác minh | Chạy cùng bước kiểm tra sau backup |
| Retention 14 ngày | Đã xác minh | Chính sách hiện tại đã được xác minh |
| Restore thực tế | Chưa kiểm thử | Chưa có bằng chứng restore thành công |
| Bản sao ngoài máy chủ | Chưa xác minh | Chưa có bằng chứng backup được sao chép ra ngoài production |

## Hạn chế và phụ thuộc

| Mã | Hạn chế/Phụ thuộc | Ảnh hưởng | Người xử lý | Trạng thái |
| --- | --- | --- | --- | --- |
| INF-01 | Chưa kiểm thử restore thực tế | Chưa chứng minh khả năng phục hồi dữ liệu | Chưa phân công | Open |
| INF-02 | Chưa xác minh bản sao backup ngoài máy chủ | Backup có thể cùng chịu sự cố với production | Chưa phân công | Open |
| INF-03 | Root cron 00:23 tại `/www/server/cron/...` chưa rõ chức năng | Chưa đánh giá được mức dùng tài nguyên hoặc xung đột lịch | Chưa phân công | `UNRELATED_OR_UNKNOWN` |
| INF-04 | Chưa xác minh cơ chế log rotation cho log backup/kiểm tra | Có nguy cơ log tăng trưởng không kiểm soát | Chưa phân công | Open |

## Kết luận kiểm kê

- Mức độ đầy đủ: Đã xác minh lịch, scheduler, file dump, log hoàn thành, freshness, checksum và retention của backup hiện tại; các phần kiểm kê hạ tầng khác vẫn chưa hoàn tất.
- Các thông tin còn thiếu: Restore thực tế, bản sao ngoài máy chủ, nội dung root cron 00:23 và cơ chế log rotation.
- Đủ căn cứ để quyết định hạ tầng: Chưa đủ căn cứ để xác nhận production readiness.

## Ký xác nhận

| Vai trò | Họ và tên | Kết luận | Ngày ký | Chữ ký/Xác nhận |
| --- | --- | --- | --- | --- |
| Quản trị máy chủ |  |  |  |  |
| Đại diện hạ tầng |  |  |  |  |
| Đại diện an toàn thông tin |  |  |  |  |
