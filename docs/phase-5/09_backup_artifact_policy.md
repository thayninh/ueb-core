# Phase 5 backup artifact storage policy

## 1. Mục tiêu và phạm vi

Policy này bảo vệ mọi artifact nằm dưới repository path `infra/backup/`, gồm database dump, upload archive, WAL, restore scratch data, log, manifest, checksum, catalog và bản mã hóa hoặc nén của các artifact đó.

`infra/backup/` chỉ là vị trí local tạm thời cho workflow đã được phê duyệt; nó không phải kho lưu trữ backup, evidence repository hoặc Docker build input.

## 2. Source và build-context exclusion

Hai exclusion bắt buộc ở repository root:

```text
.gitignore:    /infra/backup/
.dockerignore: infra/backup
```

Mọi nội dung hiện tại và tương lai trong `infra/backup/` phải đồng thời:

- bị Git ignore bởi repository `.gitignore`, không dựa vào `.git/info/exclude` hoặc global ignore;
- bị loại khỏi Docker build context để không xuất hiện trong build cache hoặc image layer;
- không được force-add bằng `git add -f`;
- không được dùng `.gitkeep` hoặc negation rule để tạo ngoại lệ nếu chưa có policy amendment được phê duyệt.

Không được tạo thêm backup hoặc UAT dump khi một trong hai exclusion không tồn tại hoặc verification không `PASS`.

## 3. Storage contract

Backup thực phải được lưu ngoài repository và ngoài Docker build context trong storage đã được phê duyệt, với encryption at rest/in transit, least-privilege access, retention, audit và ownership rõ ràng. Encryption key hoặc credential phải được quản lý tách khỏi artifact và không được lưu trong Git.

Tên file, đường dẫn storage, object name, database object catalog và metadata có khả năng tiết lộ danh tính, cấu trúc nhạy cảm hoặc phạm vi dữ liệu phải được coi là sensitive. Không ghi các giá trị này vào tài liệu, commit message, CI log hoặc audit summary được commit.

Không tự động xóa, di chuyển, mở, giải nén, hash hoặc đọc backup đã tồn tại. Khi phát hiện artifact đã được track hoặc có nguy cơ lộ lọt, dừng workflow, giữ nguyên evidence và chuyển sang incident/change-control process có thẩm quyền.

## 4. Checksum, catalog và evidence

Checksum và catalog thô đi cùng backup, không được commit nếu có PII hoặc object names nhạy cảm. Evidence summary được phép commit chỉ gồm:

- gate ID và thời điểm UTC;
- kết quả exclusion/restore `PASS` hoặc `BLOCKED`;
- aggregate count không định danh;
- opaque reference tới evidence lưu ngoài repository;
- xác nhận đã loại PII, secret, artifact name và sensitive object names.

Không dùng tên backup thật, checksum thật hoặc danh sách database object làm evidence trong repository.

## 5. Verification không đọc artifact

Verification chỉ tạo probe giả, không mở hoặc liệt kê backup:

```bash
mkdir -p infra/backup
touch infra/backup/.phase5-ignore-probe.dump
git check-ignore -v infra/backup/.phase5-ignore-probe.dump
grep -n 'infra/backup' .gitignore .dockerignore
rm -f infra/backup/.phase5-ignore-probe.dump
git ls-files infra/backup
```

Kết quả hợp lệ yêu cầu `git check-ignore` chỉ tới repository `.gitignore`, cả hai ignore file có rule tương ứng và `git ls-files infra/backup` không có output.

## 6. Phase 5 hard gates

- Backup exclusion và restore rehearsal phải `PASS` trước provisioning apply.
- Restore chỉ chạy trên target tạm cô lập; không restore đè canonical acceptance `ueb_core`, UAT hoặc production.
- Backup artifact không được đưa vào real-user UAT evidence hoặc staging build context.
- Production backup, restore hoặc deployment cần authorization riêng và nằm ngoài bước này.

## 7. Machine-readable summary

```text
BACKUP_REPOSITORY_PATH=infra/backup/
GIT_EXCLUSION=REQUIRED
DOCKER_CONTEXT_EXCLUSION=REQUIRED
BACKUP_CONTENT_READ_DURING_EXCLUSION_CHECK=FORBIDDEN
BACKUP_ARTIFACT_COMMIT=FORBIDDEN
SENSITIVE_CHECKSUM_OR_CATALOG_COMMIT=FORBIDDEN
EXTERNAL_ENCRYPTED_STORAGE=REQUIRED
RESTORE_REHEARSAL_BEFORE_PROVISIONING_APPLY=REQUIRED
```
