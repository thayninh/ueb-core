# Kế hoạch Giai đoạn 2 — Database và import dữ liệu

| Thuộc tính | Giá trị |
| --- | --- |
| Trạng thái | COMPLETED WITH OPEN FORMAL AND PRODUCTION CONDITIONS |
| Nhánh thực hiện | `feat/phase-2-database-import` |
| Người phụ trách | Chưa phân công |
| Ngày cập nhật | 2026-07-16 |
| Phạm vi môi trường | Local development và local acceptance; production không được thực hiện |

## Bối cảnh và nguyên tắc

Giai đoạn 2 thiết kế nền tảng dữ liệu và quy trình import có kiểm soát trên nền tảng kỹ thuật đã được nghiệm thu ở Giai đoạn 1. Giai đoạn này không xác nhận production readiness, không kết nối production và không tự động đóng bất kỳ điều kiện nào còn mở từ Giai đoạn 0.

Các nguyên tắc bắt buộc:

- File Excel nguồn không được đưa vào Git.
- Chỉ xử lý file đã được khóa và phê duyệt bằng checksum SHA-256.
- Một phiên bản là một dòng nghiệp vụ; các phiên bản của cùng một dòng dùng chung `record_uid` và tăng `version_no`.
- Bảng lõi là append-only: chỉ thêm phiên bản mới, không cập nhật hoặc xóa phiên bản đã ghi.
- Import phải có khả năng inspect, dry-run, thực thi và đối chiếu độc lập.
- Mọi sai khác so với source contract đều phải dừng trước khi tạo hoặc thay đổi dữ liệu.
- Không suy diễn quyết định nghiệp vụ từ nội dung Excel; dữ liệu chưa giải quyết được phải được giữ lại và đánh dấu rõ.

Tài liệu này chỉ lập kế hoạch. Bước lập kế hoạch không tạo schema, migration, trigger, role database hoặc công cụ import.

## 1. Mục tiêu

1. Thiết kế database để lưu đầy đủ 20 cột nghiệp vụ của Excel cùng thông tin kỹ thuật phục vụ snapshot, phiên bản, nguồn gốc và kiểm toán.
2. Xây dựng quy trình import Excel có kiểm soát, có hard gate cho source contract và không cho phép import nhầm nguồn.
3. Đối chiếu toàn bộ dữ liệu từ Excel đến database ở mức contract, số lượng dòng, từng cột và từng dòng.
4. Bảo vệ mô hình append-only bằng cả constraint/trigger database, quyền runtime tối thiểu và kiểm thử trực tiếp.

## 2. Hard gate — Source contract

### 2.1 Trạng thái hiện tại

Source contract technical hard gate đã `PASS` đối với nguồn local được khóa dưới đây. Formal business sign-off evidence vẫn `PENDING`; trạng thái kỹ thuật này không đóng các điều kiện formal của Giai đoạn 0.

| Thuộc tính | Giá trị tham chiếu hiện tại | Trạng thái cần đạt |
| --- | --- | --- |
| File nguồn | `CSDLCore_chuan_hoa_PostgreSQL.xlsx` | PASS theo technical source decision |
| SHA-256 | `e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972` | PASS; được kiểm tra lại trước dry-run/import |
| Sheet import | `csdlcore` | PASS |
| Số dòng dữ liệu | `2497` | PASS; không tính header |
| Số cột nghiệp vụ | `20` | PASS |
| Thứ tự chính xác của header | Được khóa trong `config/phase-2/source-contract.json` | PASS; đủ 20 header nguyên văn đúng thứ tự |

Danh sách tên trường nội bộ trong tài liệu Giai đoạn 0 không được dùng thay cho việc đọc và chốt thứ tự header nguyên bản trong Excel.

### 2.2 Điều kiện PASS

Source contract chỉ được đánh dấu `PASS` khi đồng thời đáp ứng tất cả điều kiện sau:

- File nguồn đã được chốt bằng tên file và vị trí đầu vào local nằm ngoài Git.
- SHA-256 tính trực tiếp từ file khớp hồ sơ checksum và checksum đó đã được người có thẩm quyền phê duyệt.
- Sheet import được chốt chính xác.
- Số dòng dữ liệu được chốt và kết quả inspect khớp tuyệt đối.
- Số cột được chốt và kết quả inspect khớp tuyệt đối.
- Đủ 20 header nguyên văn đã được ghi theo đúng thứ tự; kết quả inspect phải so sánh cả giá trị lẫn vị trí của từng header.
- Kết quả kiểm tra được lưu thành báo cáo không chứa dữ liệu cá nhân; audit output cục bộ không được commit.
- Người chịu trách nhiệm và thời điểm xác nhận source contract được ghi nhận.

### 2.3 Quy tắc dừng

- **Không tạo migration trước khi source contract `PASS`.**
- Không tiếp tục nếu file, checksum, sheet, số dòng, số cột hoặc thứ tự header sai khác dù chỉ một mục.
- Không tự sửa Excel, đổi header, bỏ cột, thêm cột hoặc chọn sheet thay thế để làm cho kiểm tra đạt.
- Khi nguồn thay đổi, phải tạo source contract mới với tên file và checksum mới; không ghi đè lịch sử của contract cũ.

## 3. Phạm vi Giai đoạn 2

### 3.1 Thiết kế bảng lõi

Thiết kế một bảng lõi duy nhất chứa toàn bộ 20 cột nghiệp vụ từ Excel. Mapping từ header nguyên bản sang tên cột nội bộ chỉ được chốt sau khi source contract `PASS` và phải bao phủ đủ các trường đã được ghi nhận ở Giai đoạn 0:

- `stt`
- `ten_giang_vien`
- `ma_so_can_bo`
- `email_tai_khoan_vnu`
- `bo_mon`
- `don_vi`
- `don_vi_phu_trach_hoc_phan`
- `bo_mon_phu_trach_hoc_phan`
- `khoi_kien_thuc`
- `ma_hoc_phan`
- `ten_hoc_phan`
- `core_1_2_3`
- `tc1_tro_giang`
- `tc2_sh_chuyen_mon`
- `tc3_tong_hop`
- `tc3_1_nganh_tot_nghiep_phu_hop`
- `tc3_2_bien_soan_de_cuong_giao_trinh`
- `tc3_3_chu_nhiem_de_tai_nckh_lien_quan`
- `tc3_4_bai_bao_lien_quan`
- `tc4_giang_thu`

Bảng lõi đồng thời có các cột kỹ thuật cần thiết cho:

- định danh bất biến của dòng và chuỗi phiên bản bằng `record_uid`;
- số phiên bản bằng `version_no`;
- snapshot khởi tạo của giảng viên;
- trạng thái hiệu lực của dữ liệu;
- trạng thái đối chiếu danh tính bằng `identity_status`;
- liên kết provenance tới `import_run` và dòng nguồn;
- liên kết nullable tới submission bằng `source_submission_id`;
- thời điểm tạo và thông tin cần thiết để kiểm toán append-only.

Tên, kiểu dữ liệu, nullability, khóa và constraint chi tiết phải được review trong checkpoint thiết kế; tài liệu kế hoạch này không tự chốt schema vật lý.

### 3.2 Snapshot và phiên bản khởi tạo

- Mỗi giảng viên có đúng một snapshot khởi tạo từ đợt import legacy.
- Snapshot khởi tạo là ranh giới provenance của dữ liệu import, không phải một submission chứa toàn bộ hồ sơ giảng viên và không thay đổi quyết định “một submission chứa đúng một dòng”.
- Mỗi dòng legacy được import là phiên bản đầu tiên của một dòng nghiệp vụ, có `version_no = 1`.
- Mỗi dòng legacy có `record_uid` riêng; các phiên bản tương lai của chính dòng đó mới dùng lại `record_uid`.
- Quy tắc gom dòng vào snapshot phải dựa trên mapping danh tính được ghi nhận và có thể đối chiếu. Không tự gộp hai danh tính chỉ vì tên, email hoặc mã cán bộ có vẻ giống nhau.

### 3.3 Theo dõi đợt import bằng `import_run`

Thiết kế `import_run` để ghi tối thiểu:

- định danh đợt chạy;
- source contract và SHA-256;
- sheet;
- thời điểm bắt đầu/kết thúc;
- chế độ inspect, dry-run hoặc import;
- trạng thái chạy;
- số dòng đọc, hợp lệ, cảnh báo, lỗi và đã ghi;
- thông tin phiên bản công cụ cần thiết để tái lập kết quả.

`import_run` không được lưu secret hoặc sao chép nội dung dữ liệu cá nhân vào log. Thiết kế phải ngăn việc vô tình import lại cùng một nguồn đã hoàn thành mà không có quyết định rõ ràng và dấu vết kiểm toán.

### 3.4 `workflow_event` skeleton

Tạo skeleton tối thiểu cho `workflow_event` nhằm giữ chỗ cho lịch sử nghiệp vụ ở giai đoạn workflow sau. Skeleton phải thể hiện ranh giới liên kết với dòng nghiệp vụ/submission nhưng không triển khai authentication, phê duyệt, từ chối hoặc giao diện workflow trong Giai đoạn 2.

Import legacy không tạo `workflow_event`, vì dữ liệu legacy đã có hiệu lực mặc định và không đi qua workflow phê duyệt.

### 3.5 Bảo vệ append-only

Thiết kế và kiểm thử nhiều lớp bảo vệ:

- Trigger database từ chối `UPDATE` và `DELETE` trên bảng lõi.
- Runtime role không có quyền `UPDATE`, `DELETE`, `TRUNCATE` hoặc thay đổi schema của bảng lõi.
- Migration/owner role tách khỏi runtime role.
- Quyền ghi dùng cho import được giới hạn theo đúng nhu cầu và không được dùng làm runtime credential.
- Mọi thay đổi nghiệp vụ tương lai tạo dòng phiên bản mới bằng `INSERT`.
- Kiểm thử SQL trực tiếp phải chứng minh runtime role không thể vượt qua bảo vệ append-only.

### 3.6 Bộ công cụ dữ liệu

Lập và triển khai các công cụ riêng biệt:

1. **Inspect**: đọc metadata nguồn, tính SHA-256, liệt kê sheet, đếm dòng/cột, xuất header theo đúng thứ tự và thống kê chất lượng không làm lộ dữ liệu cá nhân.
2. **Dry-run**: chạy toàn bộ validation, mapping, kiểm tra danh tính, duplicate và reconciliation dự kiến nhưng không thay đổi database.
3. **Import**: chỉ chạy sau hard gate, dùng transaction và ghi provenance qua `import_run`; lỗi bắt buộc phải dừng, không để lại tập dữ liệu lõi nhập dở.
4. **Verify**: đọc lại database độc lập để đối chiếu toàn bộ kết quả với source contract và nguồn đã khóa.

Các script không được chứa đường dẫn production, credential hoặc dữ liệu Excel. File Excel và audit output phải tiếp tục nằm ngoài Git.

## 4. Quy tắc import legacy bắt buộc

- Dữ liệu legacy mặc định có hiệu lực ngay sau import thành công.
- Import legacy không tạo workflow approval event.
- `source_submission_id` của mọi dòng legacy để `NULL`.
- `version_no = 1` cho mọi dòng legacy.
- Mỗi giảng viên có một snapshot khởi tạo.
- Dòng thiếu mã cán bộ, thiếu email hoặc chưa đủ căn cứ liên kết danh tính vẫn phải được giữ; `identity_status` của dòng/snapshot liên quan phải là `UNRESOLVED`.
- Không suy đoán email, không tự liên kết danh tính và không loại dòng chỉ vì thiếu thông tin định danh.
- Không tự xóa, gộp, ghi đè hoặc bỏ qua dòng trùng. Mọi dòng nguồn đều được giữ, còn duplicate candidate phải được đánh dấu và đưa vào báo cáo đối chiếu.
- Giữ nguyên `stt` từ nguồn, kể cả giá trị bất thường; không tự đánh lại `stt`.
- Không tạo submission giả để hợp thức hóa dữ liệu legacy.

## 5. Đối chiếu toàn bộ dữ liệu

Verification phải độc lập với bước import và chứng minh tối thiểu:

- File, SHA-256, sheet, số dòng, số cột và thứ tự header khớp source contract.
- Số dòng nguồn, số dòng đủ điều kiện, số dòng import và số dòng bảng lõi thuộc `import_run` cân bằng tuyệt đối.
- Đủ 20 cột nghiệp vụ được mapping; không có cột bị bỏ hoặc tự thêm giá trị ngoài quy tắc đã chốt.
- Giá trị từng ô sau quy tắc chuyển đổi đã công bố có thể truy ngược về đúng dòng và cột nguồn.
- Có đối chiếu theo từng dòng bằng source row number và fingerprint/hash phù hợp, không ghi dữ liệu cá nhân vào audit output được commit.
- Tổng số dòng `UNRESOLVED`, dòng thiếu mã cán bộ, dòng thiếu email và duplicate candidate được báo cáo; các dòng này không bị mất.
- Mọi dòng legacy có hiệu lực mặc định, `version_no = 1` và `source_submission_id IS NULL`.
- Mỗi giảng viên/mapping danh tính có đúng một snapshot khởi tạo theo quy tắc đã chốt.
- Không có `workflow_event` được sinh bởi import legacy.
- Kiểm tra append-only bằng thử `UPDATE` và `DELETE` với runtime role đều bị từ chối.

Bất kỳ chênh lệch nào đều làm verification `FAIL`. Không được nghiệm thu bằng cách điều chỉnh số liệu kỳ vọng sau khi import mà không tạo lại source contract hoặc quyết định có thẩm quyền.

## 6. Ngoài phạm vi

- Authentication.
- Tạo hoặc kích hoạt tài khoản giảng viên.
- Role-based authorization ở tầng ứng dụng ngoài phần quyền database tối thiểu cho Phase 2.
- Giao diện nghiệp vụ.
- Chức năng gửi, phê duyệt hoặc từ chối submission.
- Production deployment.
- Production import.
- Kết nối hoặc thay đổi reverse proxy/Caddy.
- Backup production hoặc thay đổi cơ chế backup hiện tại.
- SSO/OIDC VNU.
- Tự xử lý hoặc tự đóng các quyết định nghiệp vụ đang `Draft`.

## 7. Checkpoint và tiêu chí nghiệm thu

### CP2-0 — Kế hoạch

- [x] Phạm vi, ngoài phạm vi và hard gate được ghi rõ.
- [x] Không tạo schema, migration hoặc công cụ import trong bước lập kế hoạch.
- [x] Không sửa tài liệu Giai đoạn 0 hoặc Giai đoạn 1.

### CP2-1 — Source contract hard gate

- [x] Chốt đúng file nguồn.
- [x] SHA-256 tính lại khớp technical source decision.
- [x] Chốt sheet import.
- [x] Chốt số dòng dữ liệu.
- [x] Chốt số cột.
- [x] Chốt nguyên văn đủ 20 header theo đúng thứ tự.
- [x] Inspect report đạt và không chứa dữ liệu cá nhân trong Git.
- [x] Technical source contract `PASS`; formal business sign-off evidence tiếp tục `PENDING`.

**Điều kiện chuyển checkpoint:** Tất cả mục CP2-1 phải đạt trước khi tạo migration.

### CP2-2 — Thiết kế database

- [x] Mapping đủ 20 cột nghiệp vụ được review theo source contract.
- [x] Thiết kế cột kỹ thuật cho `record_uid`, `version_no`, snapshot, hiệu lực, danh tính, provenance và submission được review.
- [x] Thiết kế `import_run` và `workflow_event` skeleton được review.
- [x] Chiến lược transaction, idempotency và rollback được mô tả và kiểm thử.
- [x] Thiết kế role và append-only được review.
- [x] Mô hình bảng nghiệp vụ chỉ thay đổi qua source-contract/migration review riêng.

### CP2-3 — Migration và bảo vệ database

- [x] Hai migration chạy thành công trên PostgreSQL local sạch theo đúng thứ tự.
- [x] Clean migration replay có thể tái lập từ đầu bằng quy trình đã ghi nhận.
- [x] Sáu trigger từ chối `UPDATE`, `DELETE` và `TRUNCATE` trên ba bảng append-only.
- [x] Runtime role chỉ có quyền tối thiểu và không thể thay đổi schema.
- [x] Test chứng minh quyền import, migration và runtime được tách biệt.

### CP2-4 — Inspect và dry-run

- [x] Inspect kiểm tra đủ các thành phần hard gate.
- [x] Dry-run không làm thay đổi database.
- [x] Dry-run báo cáo đầy đủ unresolved identity và duplicate candidate mà không loại dòng.
- [x] Mọi lỗi contract trả kết quả `FAIL` rõ ràng và dừng xử lý.

### CP2-5 — Import local

- [x] Chỉ dùng file có source contract `PASS`.
- [x] Import chạy trong transaction và không để lại dữ liệu lõi nhập dở khi lỗi.
- [x] `import_run` ghi đủ provenance và số liệu kiểm soát.
- [x] Toàn bộ 2.497 dòng thuộc nguồn đã duyệt được giữ; 14 dòng trùng không bị loại.
- [x] Không kết nối hoặc ghi dữ liệu production.

### CP2-6 — Verification

- [x] Đối chiếu contract, tổng số dòng, đủ 20 cột và từng dòng đều `PASS`.
- [x] Các invariant legacy về hiệu lực, `version_no`, `source_submission_id`, snapshot và `workflow_event` đều `PASS`.
- [x] Unresolved bằng `0`; duplicate cân bằng `7` nhóm, `14` dòng.
- [x] Append-only và quyền runtime được kiểm thử thành công 18/18 trên rehearsal.
- [x] Verify rehearsal và local acceptance cho kết quả ổn định, anomalies `0`.

### CP2-7 — Nghiệm thu kỹ thuật Phase 2

- [x] Lint đạt.
- [x] Typecheck đạt.
- [x] Test đạt.
- [x] Build đạt.
- [x] Không có `.env`, secret, Excel hoặc audit output bị Git track.
- [x] Chỉ các artifact Phase 2 được phép mới thay đổi.
- [x] Tài liệu runbook local và bằng chứng nghiệm thu không chứa dữ liệu cá nhân.
- [x] Các điều kiện Phase 0 vẫn được ghi nhận là `OPEN`.

## 8. Điều kiện Phase 0 tiếp tục OPEN

Giai đoạn 2 kế thừa nguyên trạng các điểm chặn sau và không được tự động đóng, hạ mức hoặc coi là đã giải quyết chỉ vì có thiết kế, migration, import local hay báo cáo kỹ thuật:

| Mã | Trạng thái kế thừa | Điều kiện còn mở |
| --- | --- | --- |
| R-05 | OPEN | Các quyết định nghiệp vụ chưa được ký xác nhận chính thức. |
| R-12 | OPEN | Chưa phân công lãnh đạo và email VNU cho đủ sáu đơn vị. |
| R-35 | OPEN | Restore hiện tại chưa được xác minh hoàn chỉnh. |
| R-36 | OPEN | Chưa có bằng chứng backup nằm ngoài máy chủ production. |
| R-39 | OPEN | Backup/restore riêng cho UEB Core chưa được triển khai. |
| R-40 | OPEN | Khuyến nghị hạ tầng chưa được ký xác nhận chính thức. |

Các chủ đề BD-02 đến BD-06 và BD-07 vẫn giữ trạng thái theo hồ sơ Giai đoạn 0. Chính sách “giữ mọi dòng, đánh dấu unresolved/duplicate và không tự xóa” là biện pháp import an toàn, không phải hành động phê duyệt hoặc đóng các quyết định đó.

Chỉ người có thẩm quyền và quy trình đã quy định tại `docs/phase-0/08_risk_register.md` và `docs/phase-0/09_phase_0_signoff.md` mới được thay đổi trạng thái. Mọi bằng chứng mới từ Phase 2 chỉ được cung cấp để xem xét riêng.

## 9. Thứ tự thực hiện dự kiến

1. Phê duyệt kế hoạch Phase 2.
2. Thực hiện inspect chỉ đọc và lập source contract.
3. Dừng tại hard gate cho đến khi source contract `PASS`.
4. Review thiết kế database và mapping.
5. Tạo migration, trigger và role cho môi trường local.
6. Xây dựng inspect, dry-run, import và verify.
7. Chạy dry-run và xử lý mọi sai khác mà không sửa file nguồn.
8. Import vào PostgreSQL local.
9. Chạy verification độc lập và kiểm thử append-only.
10. Chạy toàn bộ quality gates, rà soát file cấm và lập biên bản nghiệm thu kỹ thuật.

Không bước nào trong thứ tự trên cho phép triển khai hoặc import production nếu không có yêu cầu và phê duyệt riêng.
