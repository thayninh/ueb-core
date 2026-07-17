# Phase 5 hard-gate matrix

## 1. Quy ước

Trạng thái hợp lệ:

- `PASS`: có bằng chứng hợp lệ và người chịu trách nhiệm đã xác nhận.
- `BLOCKED`: điều kiện chưa đạt hoặc có deviation thực tế.
- `NOT_EVALUATED`: chưa chạy kiểm tra.
- `NOT_APPLICABLE`: chỉ dùng khi contract cho phép và có lý do được phê duyệt.

Không waiver hard gate bằng trao đổi miệng. Evidence không được chứa PII, secret, credential, connection string đầy đủ, dump hoặc audit output thô.

## 2. Ma trận

| Gate | Điều kiện | Bằng chứng tối thiểu | Chặn | Trạng thái ban đầu |
| --- | --- | --- | --- | --- |
| G0 | Phase 4 baseline và repository clean | HEAD/branch, working tree, quality gates, 7 applied/0 pending | Mọi công việc Phase 5 | `PASS` tại Step 0; phải recheck trước apply/UAT |
| G1 | Formal business, identity và infrastructure authority | Approval references, approver roles, effective date | Identity intake và UAT | `BLOCKED` theo Phase 0 sign-off |
| G2 | Submit/reject/approve đều explicit `SERIALIZABLE` | Code review, isolation/concurrency tests, `test:phase4` | Pilot UAT | `BLOCKED`: submit/reject deviation còn mở |
| G3 | Pilot identities và unit scopes được duyệt | Manifest digest, aggregate counts, approval references; không PII trong Git | Provisioning dry-run/apply và UAT | `BLOCKED`: approved pilot manifest chưa có |
| G4 | Backup exclusion `PASS` | Git tracked-file scan, ignore checks, Docker build-context review, artifact storage reference | Provisioning apply | `NOT_EVALUATED` |
| G5 | UEB Core restore rehearsal `PASS` | Backup checksum, restore target marker, schema/data/ACL/RLS verification summary | Provisioning apply và UAT | `BLOCKED` theo open risks R-35/R-39 |
| G6 | Provisioning dry-run không có conflict | Manifest digest, target fingerprint, counts và zero-blocker summary | Provisioning apply | `NOT_EVALUATED` |
| G7 | Apply authorization và rollback plan được duyệt | Change reference, operator/approver separation, rollback manifest | Provisioning apply | `NOT_EVALUATED` |
| G8 | UAT target cô lập và guard từ chối `ueb_core` | Sanitized target fingerprint, exact-name negative test, pre-UAT baseline | Pilot UAT | `NOT_EVALUATED` |
| G9 | Pilot UAT exit criteria đạt | Scenario result summary, issue disposition, post-UAT reconciliation | Staging readiness acceptance | `NOT_EVALUATED` |
| G10 | Staging security/operations ready | Config checklist, health/readiness, migration/ACL/backup/rollback runbooks | Staging deployment authorization | `NOT_EVALUATED` |
| G11 | Phase 5 acceptance được ký | Checklist hoàn tất và sign-off references | Kết thúc Phase 5 | `NOT_EVALUATED` |

## 3. Gate dependency

```text
G0 -> G1 -> G2 -> G3 -> provisioning dry-run (G6)
                  G4 -> G5 -> G7 -> provisioning apply
G2 + G3 + G5 + G7 + G8 -> pilot UAT (G9)
G9 + G10 -> Phase 5 acceptance (G11)
```

Hai điều kiện không được đảo thứ tự:

1. Backup exclusion (`G4`) và restore rehearsal (`G5`) phải `PASS` trước provisioning apply.
2. Submit/reject `SERIALIZABLE` deviation (`G2`) phải đóng trước bất kỳ pilot UAT nào.

## 4. Hard-stop rules

Dừng ngay khi:

- target là production hoặc canonical acceptance `ueb_core` cho thao tác ghi;
- identity không có approval reference, email bị suy luận hoặc mapping không duy nhất;
- manifest có wildcard, toàn bộ source population hoặc dấu hiệu mass-provision;
- PII/secret/dump xuất hiện trong Git diff, log hoặc build context;
- migration pending/failed, working tree ngoài phạm vi không sạch hoặc quality gate fail;
- backup exclusion hoặc restore rehearsal chưa `PASS` mà chuẩn bị apply;
- rollback plan không thể định danh chính xác các thay đổi dự kiến;
- UAT tạo dữ liệu ngoài database UAT cô lập.

## 5. Evidence register contract

Evidence summary được phép commit chỉ gồm:

- gate ID;
- thời điểm UTC;
- command/suite name và exit code;
- commit SHA hoặc image digest;
- opaque approval/change reference;
- manifest/backup checksum;
- aggregate counts;
- kết luận `PASS`/`BLOCKED` và lý do đã loại PII.

Evidence thô chứa PII, secret, database dump, screenshot tài khoản hoặc danh sách user phải lưu ngoài repository theo kênh được phê duyệt.
