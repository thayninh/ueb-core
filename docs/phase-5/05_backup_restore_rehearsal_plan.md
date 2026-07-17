# Phase 5 backup and restore rehearsal plan

## 1. Mục tiêu

Chứng minh UEB Core UAT target có backup usable và có thể restore vào database cô lập trước khi provisioning apply. Bằng chứng backup của hệ thống khác hoặc local dump Phase 2/4 không thay thế rehearsal này.

## 2. Hard gate

Hai gate độc lập đều phải `PASS`:

1. `BACKUP_EXCLUSION`: backup/dump/checksum/raw log không bị Git track và không vào application image/build context.
2. `RESTORE_REHEARSAL`: backup được restore và kiểm tra đầy đủ trên target tạm.

Nếu một gate chưa `PASS`, provisioning apply bị chặn. Không cho phép waiver trong Phase 5 contract.

## 3. Safety constraints

- Không kết nối hoặc restore vào production.
- Không restore đè canonical acceptance `ueb_core` hoặc Phase 5 UAT database.
- Restore target phải có exact isolated name marker và local/non-production host guard.
- Không log password, URL đầy đủ, PII row, dump content hoặc secret.
- Không commit backup, checksum file chứa path nhạy cảm, restore log thô hoặc audit output.
- Không gọi `nextval()` khi kiểm tra sequence metadata.

## 4. Backup exclusion verification

### Git

- Backup artifact phải nằm ngoài repository hoặc dưới approved ignored audit path.
- `git check-ignore` xác nhận artifact mẫu bị ignore.
- `git ls-files`/tracked-file scan không có `.dump`, `.sql`, `.backup`, archive, Excel, raw identity manifest hoặc restore output.
- `git status --short` không hiển thị artifact.

### Build context

- `.dockerignore` loại `.env*`, data, audit output và docs theo cấu hình hiện hành.
- Kiểm tra build context/image không chứa dump, manifest PII, raw logs hoặc secret.
- Không sao chép backup vào Docker layer tạm rồi xóa ở layer sau.

### Storage

- Ghi opaque storage reference, checksum, timestamp, retention và access owner.
- Backup được mã hóa/kiểm soát quyền theo policy ngoài repository.
- Off-host requirement cho production readiness vẫn là gate riêng; rehearsal local không tự đóng R-36.

## 5. Backup capture

Trước provisioning apply:

1. Xác minh target fingerprint và non-production marker.
2. Ghi commit/image digest, migrations, aggregate counts và sequence metadata.
3. Tạo consistent database backup bằng owner/backup role được phê duyệt.
4. Tính SHA-256 và xác minh archive đọc được.
5. Lưu artifact ngoài Git/build context.
6. Không thay đổi UAT data trong quá trình capture ngoài lock/snapshot behavior cần thiết của công cụ.

## 6. Restore rehearsal

1. Tạo database restore tạm với exact isolated name; từ chối `ueb_core` và UAT live target.
2. Restore archive bằng credential dành cho rehearsal.
3. Chờ database readiness đầy đủ; không bỏ qua race/init failure.
4. Xác minh schema/migration history và object inventory.
5. Đối chiếu aggregate table counts, import/auth/workflow counts và approved checksum/report.
6. Đối chiếu sequence metadata mà không tăng sequence.
7. Xác minh constraints, indexes, append-only triggers và RLS policies tồn tại.
8. Reconcile runtime ACL; runtime phải non-owner, non-superuser, `NOBYPASSRLS` và least privilege.
9. Xác minh RLS default-deny bằng runtime no-context.
10. Chạy health/readiness smoke test nếu app target được dựng cho rehearsal.
11. Ghi duration, RTO observation và sanitized result.
12. Drop database restore tạm trong cleanup có guard; giữ evidence summary, không giữ raw data ngoài retention.

## 7. Pass criteria

```text
BACKUP_EXCLUSION=PASS
BACKUP_CHECKSUM=PASS
ARCHIVE_READABLE=PASS
RESTORE_TARGET_GUARD=PASS
RESTORE_COMMAND=PASS
MIGRATION_HISTORY=PASS
DATA_RECONCILIATION=PASS
SEQUENCE_RECONCILIATION=PASS
RLS_AND_ACL=PASS
HEALTH_READINESS=PASS|NOT_APPLICABLE_WITH_APPROVAL
CLEANUP=PASS
RESTORE_REHEARSAL=PASS
```

Thiếu bất kỳ verification bắt buộc nào làm rehearsal `BLOCKED`, kể cả khi `pg_restore` exit code 0.

## 8. Failure và rollback readiness

- Không sửa archive hoặc live target để làm verification pass.
- Phân loại lỗi capture, archive, restore, init race, schema, data, ACL/RLS, readiness hoặc cleanup.
- Giữ UAT/provisioning ở trạng thái blocked cho tới khi chạy lại toàn bộ rehearsal với backup mới hoặc fix đã review.
- Rollback plan của provisioning phải trỏ đúng backup checksum đã rehearsal, đồng thời vẫn ưu tiên logical rollback account/role/scope; restore toàn database chỉ dùng theo incident decision đã phê duyệt.

## 9. Evidence summary

Evidence được phép commit chỉ gồm timestamp, target fingerprint, backup checksum, tool version, aggregate counts, duration, gate results và opaque storage/change reference. Không commit path chứa username, database URL, PII, dump hoặc raw log.
