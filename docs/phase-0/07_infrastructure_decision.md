# Quyết định hạ tầng

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | Draft — Khuyến nghị kỹ thuật đã chốt, chờ ký xác nhận |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-14 |

## Trạng thái quyết định

- Trạng thái: Khuyến nghị kỹ thuật đã chốt — chờ ký xác nhận.
- Quyết định được chọn: Tái sử dụng Caddy hiện có; triển khai ứng dụng và PostgreSQL riêng cho UEB Core theo mô hình network tách biệt.
- Căn cứ kiểm kê: `docs/phase-0/06_server_inventory.md`.
- Người có thẩm quyền phê duyệt: Chưa xác định.
- Ngày hiệu lực: Chưa xác định.

## Yêu cầu và ràng buộc

| Mã | Yêu cầu/Ràng buộc | Mức độ bắt buộc | Căn cứ | Trạng thái xác minh |
| --- | --- | --- | --- | --- |
| INF-BKP-01 | Scheduler backup hiện tại là crontab của user `deploy`, không phải systemd timer | Bắt buộc ghi nhận đúng hiện trạng | `06_server_inventory.md` | Đã xác minh |
| INF-BKP-02 | `cron.service` phải hoạt động để lịch hiện tại được thực thi | Bắt buộc với cơ chế hiện tại | Trạng thái service | Đã xác minh: `enabled`, `active` |
| INF-BKP-03 | Retention backup hiện tại là 14 ngày | Bắt buộc ghi nhận đúng hiện trạng | File và log backup | Đã xác minh |
| INF-BKP-04 | Restore thực tế phải được kiểm thử và xác minh đầy đủ trước khi xác nhận khả năng phục hồi | Bắt buộc trước production readiness | Archive đọc được và `pg_restore` chạy xong; xác minh sau restore chưa hoàn thành do race condition khi khởi tạo PostGIS của container tạm | Chưa hoàn thành đầy đủ |
| INF-BKP-05 | Xác định và kiểm chứng bản sao backup ngoài máy chủ | Chưa chốt | Chưa có bằng chứng | Chưa xác minh |
| INF-BKP-06 | Xác định cơ chế log rotation cho log backup và kiểm tra | Chưa chốt | Chưa có bằng chứng | Chưa xác minh |

## Căn cứ backup hiện tại

- Database và uploads được backup bởi `/opt/khtc-ueb/repo/scripts/prod/backup.sh` lúc 02:15 hằng ngày qua crontab của user `deploy`.
- `/opt/khtc-ueb/repo/scripts/prod/check-backup-freshness.sh` chạy lúc 02:45 để kiểm tra freshness và checksum.
- File dump, log hoàn thành, freshness, checksum và retention 14 ngày đã được xác minh.
- `dpkg-db-backup.timer` thuộc Ubuntu và không phải backup PostgreSQL ứng dụng.
- Root cron 00:23 trỏ tới `/www/server/cron/...` được phân loại `UNRELATED_OR_UNKNOWN`; chưa có căn cứ để coi đây là backup UEB/KHTC.
- Bài restore hiện tại đã chứng minh archive đọc được và `pg_restore` chạy xong; bước xác minh sau restore chưa hoàn thành do race condition khi khởi tạo PostGIS của container tạm.
- Bản sao ngoài máy chủ chưa xác minh.

Các bằng chứng trên xác nhận lịch backup đang hoạt động nhưng không đồng nghĩa hệ thống đã đạt production readiness.

## Khuyến nghị kiến trúc đã chốt

- Tái sử dụng Caddy hiện có; không triển khai reverse proxy mới.
- UEB Core app tham gia external network `khtc-ueb-prod_public` và private network `ueb-core_internal`.
- PostgreSQL UEB Core chỉ tham gia private network `ueb-core_internal`.
- PostgreSQL không publish cổng `5432` ra host.
- Không cần publish cổng ứng dụng ra host nếu Caddy kết nối trực tiếp tới service.
- Tạo PostgreSQL container riêng cho UEB Core; không dùng chung PostgreSQL cluster của hệ thống hiện hữu.
- Pin image PostgreSQL theo phiên bản cụ thể.
- Tách migration/database-owner role và application runtime role.
- Thiết lập resource limit và monitoring.
- Có backup hằng ngày, retention và bản sao ngoài máy chủ trước production.
- Có bài kiểm thử restore định kỳ.

## Phương án đánh giá

Không bổ sung hoặc chọn phương án khi chưa có kết quả kiểm kê và yêu cầu được xác nhận.

| Mã phương án | Mô tả | Ưu điểm | Hạn chế/Rủi ro | Mức đáp ứng | Chi phí/Vận hành | Kết luận |
| --- | --- | --- | --- | --- | --- | --- |
| INF-ARCH-01 | Tái sử dụng Caddy; app kết nối external/private network; PostgreSQL riêng chỉ ở private network | Không thêm reverse proxy, cô lập database và tách dữ liệu UEB Core | Cần cấu hình, giám sát, backup ngoài máy chủ và restore test trước production | Phù hợp khuyến nghị kỹ thuật | Chưa xác định | Khuyến nghị đã chốt, chờ ký |

## Quyết định và căn cứ

| Nội dung | Giá trị |
| --- | --- |
| Phương án được chọn | INF-ARCH-01 |
| Lý do lựa chọn | Tận dụng Caddy hiện có, không mở trực tiếp PostgreSQL hoặc cổng ứng dụng ra host, đồng thời tách PostgreSQL UEB Core khỏi hệ thống hiện hữu |
| Phương án bị loại và lý do | Reverse proxy mới và dùng chung PostgreSQL cluster hiện hữu không được chọn |
| Điều kiện triển khai | Chỉ triển khai production sau khi có chữ ký hạ tầng, resource limit/monitoring, backup ngoài máy chủ và restore UEB Core thành công |
| Kế hoạch xem xét lại | Trước production và khi thay đổi kiến trúc Caddy/network/database |

Khuyến nghị này không xác nhận production readiness đã đạt.

## Ký xác nhận

| Vai trò | Họ và tên | Quyết định | Ngày ký | Chữ ký/Xác nhận |
| --- | --- | --- | --- | --- |
| Chủ sở hữu hệ thống |  |  |  |  |
| Đại diện hạ tầng |  |  |  |  |
| Đại diện an toàn thông tin |  |  |  |  |
