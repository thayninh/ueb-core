# Biên bản nghiệm thu Giai đoạn 2

| Thuộc tính | Trạng thái |
| --- | --- |
| Phase 2 technical acceptance | **PASS** |
| Local acceptance import | **COMPLETED** |
| Production import | **NOT PERFORMED** |
| Production deployment | **NOT PERFORMED** |
| Formal business sign-off evidence | **PENDING** |
| Trạng thái tổng thể | **COMPLETED WITH OPEN FORMAL AND PRODUCTION CONDITIONS** |

## 1. Phạm vi được nghiệm thu

Technical acceptance bao gồm:

- source contract 20 cột và pipeline inspect/profile/dry-run;
- database design với `khoi_kien_thuc INTEGER NOT NULL`;
- hai migration có thể clean replay theo đúng thứ tự;
- controlled import append-only, deterministic IDs/checksums và provenance;
- runtime role least privilege và sáu append-only triggers;
- rehearsal import, verify, duplicate rejection, append-only tests và transaction rollback;
- local acceptance import 2.497 dòng và row-by-row verification;
- local health/readiness và local audit backup evidence.

Không bao gồm authentication, production deployment/import, production backup/restore, reverse proxy hoặc workflow approval nghiệp vụ.

## 2. Acceptance evidence

| Chỉ tiêu | Kết quả |
| --- | --- |
| Source SHA-256 | `e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972` |
| Dataset SHA-256 | `fb6cf9a90695e8105697695ed47678518789898139b829f01ddeacc6335f5a94` |
| Source/database rows | `2497` / `2497` |
| `import_run` / `workflow_event` | `1` / `0` |
| Distinct STT, min, max | `2497`, `-1`, `2569` |
| Legacy invariants | `version_no = 1`, `origin = LEGACY_IMPORT`, submission `NULL` cho 2.497 dòng |
| Duplicate warnings | `7` nhóm, `14` dòng, giữ đầy đủ |
| Lecturer/course variants | `5` / `19` nhóm |
| Invalid dates/status | `0` trên `19.976` ô |
| Verify | PASS, anomalies `0`, đủ 20 business columns |
| Duplicate acceptance import | Bị từ chối; dữ liệu không đổi |
| Identity sequence | Start `2570`, chưa tiêu thụ |

74 khoảng trống STT được giữ nguyên và không được tái sử dụng.

## 3. Migration và guards

Migration order:

1. `20260715135204_phase_2_initial`;
2. `20260715164205_align_khoi_kien_thuc_integer`.

Migration đầu đã apply không bị sửa. Clean replay, Prisma status và schema/live diff đều PASS. Runtime role không có elevated attributes/ownership/mutation privileges. Sáu trigger chặn `UPDATE`, `DELETE` và `TRUNCATE` trên ba bảng append-only; rehearsal negative tests PASS 18/18.

## 4. Formal business sign-off

Technical source decision là `APPROVED`, nhưng formal business sign-off evidence vẫn `PENDING` vì chưa có đủ:

- họ tên người phê duyệt;
- vai trò/đơn vị;
- ngày phê duyệt chính thức;
- bằng chứng hoặc tham chiếu ký xác nhận.

Technical acceptance không được trình bày như chữ ký nghiệp vụ hoàn tất.

## 5. Điều kiện Phase 0 tiếp tục OPEN

| Mã | Trạng thái | Điều kiện |
| --- | --- | --- |
| R-05 | OPEN | Các quyết định nghiệp vụ chưa được ký xác nhận chính thức |
| R-12 | OPEN | Chưa phân công lãnh đạo và email VNU cho đủ sáu đơn vị |
| R-35 | OPEN | Restore hiện tại chưa được xác minh hoàn chỉnh |
| R-36 | OPEN | Chưa có bằng chứng backup ngoài máy chủ production |
| R-39 | OPEN | Backup/restore riêng cho UEB Core chưa được triển khai và kiểm thử production-ready |
| R-40 | OPEN | Khuyến nghị hạ tầng chưa được ký xác nhận chính thức |

BD-02 đến BD-07 giữ nguyên trạng thái trong hồ sơ Giai đoạn 0. Không tài liệu Phase 2 nào tự động đóng, hạ mức hoặc thay đổi các điều kiện này.

## 6. Điều kiện trước production

Tối thiểu phải có một quy trình/phê duyệt riêng để:

- hoàn tất formal business và infrastructure sign-off;
- xử lý các Phase 0 gates liên quan UAT/production;
- thiết kế, thực hiện và chứng minh production backup/restore;
- review production credentials, networking, migration và rollback plan;
- ủy quyền rõ ràng production deployment/import.

Local dump không thay thế production backup, off-host copy hoặc restore evidence.

## 7. Kết luận

Phase 2 đạt technical acceptance và local acceptance import đã hoàn tất. Production import/deployment chưa được thực hiện. Vì formal sign-off và production conditions còn mở, trạng thái tổng thể là:

**COMPLETED WITH OPEN FORMAL AND PRODUCTION CONDITIONS**

## 8. Hồ sơ ký xác nhận còn chờ

| Vai trò | Họ và tên | Ý kiến | Ngày | Bằng chứng/tham chiếu |
| --- | --- | --- | --- | --- |
| Chủ sở hữu nghiệp vụ |  | PENDING |  |  |
| Chủ sở hữu dữ liệu |  | PENDING |  |  |
| Đại diện kỹ thuật/hạ tầng |  | PENDING |  |  |
