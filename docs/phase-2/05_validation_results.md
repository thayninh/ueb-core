# Kết quả validation Giai đoạn 2

| Thuộc tính | Kết quả |
| --- | --- |
| Technical validation | PASS |
| Rehearsal | PASS |
| Local acceptance import | COMPLETED |
| Production import | NOT PERFORMED |
| Ngày ghi nhận | 2026-07-16 |

Tài liệu chỉ ghi metric tổng hợp và checksum; không chứa dữ liệu cá nhân, credential hoặc đường dẫn tuyệt đối.

## 1. Source validation

| Chỉ tiêu | Kết quả |
| --- | ---: |
| Raw source SHA-256 | `e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972` |
| Sheet | `csdlcore` |
| Business columns | `20` |
| Data rows | `2497` |
| STT distinct | `2497` |
| STT min/max | `-1` / `2569` |
| Missing STT trong khoảng min/max | `74` |
| Formula cells / error cells | `0` / `0` |
| Dòng thiếu đồng thời mã cán bộ và email | `0` |
| Ngày/trạng thái không hợp lệ | `0` trên `19.976` ô được kiểm tra |

`khoi_kien_thuc` có 2.497 safe integer, range `1`–`5`, không decimal, non-safe integer, blank, formula, error hoặc giá trị ngoài int32. Source inspection, column profile và dry-run đều PASS; contract violations bằng `0`.

## 2. Cảnh báo được chấp nhận

| Cảnh báo | Kết quả |
| --- | ---: |
| Nhóm dòng nghiệp vụ trùng | `7` nhóm, `14` dòng |
| Nhóm biến thể tên giảng viên | `5` |
| Nhóm biến thể tên học phần | `19` |

Tất cả 14 dòng trùng được giữ. Không tự sửa, gộp hoặc xóa dữ liệu theo các cảnh báo này.

## 3. Canonical result

- Canonical rows: `2497`.
- Dataset SHA-256: `fb6cf9a90695e8105697695ed47678518789898139b829f01ddeacc6335f5a94`.
- Technical IDs và row checksums deterministic qua các lần dry-run/import/verify.

## 4. Migration rehearsal

Clean database replay PASS với đúng thứ tự:

1. `20260715135204_phase_2_initial`;
2. `20260715164205_align_khoi_kien_thuc_integer`.

Migration đầu không bị sửa. Prisma status up to date và schema/live diff không có khác biệt. Rehearsal xác nhận `khoi_kien_thuc INTEGER NOT NULL`, identity start `2570`, sequence chưa tiêu thụ và đủ sáu append-only trigger.

## 5. Runtime role và append-only

- Bootstrap role idempotent PASS hai lần.
- Role không có elevated attributes hoặc ownership.
- Quyền runtime đúng ma trận `SELECT`/`INSERT`, không có mutation/schema privileges.
- 18/18 append-only negative tests PASS: owner bị trigger chặn, runtime bị privilege chặn.
- Runtime health và readiness đều trả HTTP 200 mà không cần owner credential.

## 6. Rehearsal import và rollback

| Kiểm tra | Kết quả |
| --- | --- |
| Rehearsal controlled import | `COMMITTED`, 2.497 rows |
| Row-by-row verify | PASS, anomalies `0` |
| Duplicate import | Bị từ chối, inserted rows `0` |
| Intentional-failure rollback | PASS, ba bảng trở về `0/0/0` |
| Sequence sau rollback | Chưa tiêu thụ |

Hai database rehearsal/rollback test được drop sau kiểm thử.

## 7. Local acceptance import

| Chỉ tiêu | Kết quả |
| --- | ---: |
| `ueb_core_data` | `2497` |
| `import_run` | `1` |
| `workflow_event` | `0` |
| Distinct STT | `2497` |
| STT min/max | `-1` / `2569` |
| `version_no = 1` | `2497` |
| `origin = LEGACY_IMPORT` | `2497` |
| `source_submission_id IS NULL` | `2497` |
| Unresolved rows | `0` |

Acceptance row-by-row verify PASS với anomalies `0`; đủ 20 business columns, từng row checksum, source checksum và dataset checksum đều khớp. Duplicate acceptance import bị từ chối, inserted rows `0`; counts và dataset checksum không đổi.

Sequence sau acceptance import giữ `start_value = 2570`, `increment_by = 1`, `cycle = false`, `last_value = NULL`. Không gọi `nextval()` trong validation.

## 8. Local backup evidence

Schema-only snapshot trước import và custom-format dump sau import đã được tạo trong audit output và bị Git ignore. Archive sau import chứa data của ba bảng, sequence state và sáu triggers; `_prisma_migrations` được loại khi dump bằng runtime role theo least privilege.

Bằng chứng này không đóng production backup/restore conditions và không chứng minh production readiness.

## 9. Quality gates

Format, lint, typecheck, unit tests, build, Prisma validate/generate/status, Docker Compose config và diff checks đều PASS trong chuỗi rehearsal/acceptance. Không có Excel, secret, `.env` hoặc audit output được Git track.
