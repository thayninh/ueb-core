# Phase 5 provisioning dry-run, apply and rollback contract

## 1. Phạm vi

Provisioning chỉ áp dụng cho identity trong manifest pilot đã phê duyệt. Không mass-provision toàn bộ lecturer source, không provisioning production và không dùng canonical acceptance database `ueb_core` làm UAT target.

Ba mode tách biệt:

- `DRY_RUN`: read-only, mặc định, không tạo account/role/scope/session/audit event.
- `APPLY`: ghi có kiểm soát sau khi mọi hard gate đạt và có confirmation riêng.
- `ROLLBACK`: vô hiệu hóa/revoke thay đổi theo rollback manifest; không hard-delete lịch sử.

## 2. Target contract

Mọi mode phải xác minh và chỉ báo cáo giá trị đã làm sạch:

- environment marker là non-production;
- host/database/port khớp change record;
- UAT database là database riêng và khác chính xác `ueb_core`;
- owner và runtime role khác nhau;
- runtime role non-owner, non-superuser, `NOBYPASSRLS`;
- migration status 7 applied, 0 pending trước Phase 5 schema changes (nếu có authorization riêng trong tương lai).

Không in connection string hoặc credential.

## 3. Preconditions

### Dry-run

- G0, G1 và G3 đạt.
- Manifest checksum và approval reference khớp.
- Working tree sạch và code revision được ghi nhận.

### Apply

Ngoài điều kiện dry-run:

- G2 transaction isolation deviation đã đóng.
- Backup exclusion `G4 = PASS`.
- Restore rehearsal `G5 = PASS`.
- Dry-run `G6 = PASS` với đúng manifest checksum và target fingerprint.
- Apply authorization và rollback plan `G7 = PASS`.
- Không có thay đổi manifest, target hoặc commit giữa dry-run và apply.

Backup exclusion và restore rehearsal bắt buộc phải `PASS` trước provisioning apply. Không có cơ chế override trong contract này.

## 4. Dry-run behavior

Với từng approved record, dry-run phải:

1. Validate schema, approval validity và manifest digest.
2. Chuẩn hóa email chỉ bằng trim/lowercase để so sánh; không sinh email.
3. Kiểm tra existing account và action `CREATE`/`REUSE`.
4. Kiểm tra unique email và unique lecturer mapping.
5. Resolve role/unit scope từ approved input, không từ browser hoặc suy luận.
6. Kiểm tra leader có ít nhất một active scope.
7. Dựng change plan và rollback plan, nhưng không ghi database.
8. Trả aggregate summary và conflict codes không chứa PII.

Dry-run output tối thiểu:

```text
MODE=DRY_RUN
TARGET_FINGERPRINT=<sanitized-hash>
MANIFEST_SHA256=<digest>
RECORDS_TOTAL=<integer>
CREATE_PLANNED=<integer>
REUSE_PLANNED=<integer>
ROLE_GRANTS_PLANNED=<integer>
UNIT_SCOPE_GRANTS_PLANNED=<integer>
BLOCKERS=<integer>
DATABASE_WRITES=0
STATUS=PASS|BLOCKED
```

## 5. Apply behavior

- Yêu cầu explicit confirmation chứa target fingerprint, manifest digest và opaque change reference.
- Refuse nếu confirmation thiếu hoặc khác dry-run.
- Xử lý đúng các record trong manifest; không query rồi provision toàn bộ source population.
- Mỗi identity change phải transactional, idempotent và ghi audit cùng transaction nghiệp vụ.
- Existing compatible account được reuse; incompatible account dừng để review.
- Không log temporary credential. Credential delivery dùng kênh an toàn ngoài repository/log.
- Dừng batch khi có lỗi; không tiếp tục âm thầm và không đổi manifest version tại chỗ.
- Sau apply, đối chiếu aggregate count, role/scope, audit count và login-disabled/active policy theo approval.

Apply summary chỉ chứa count, checksum, opaque IDs/hash và outcome.

## 6. Rollback contract

Rollback manifest phải được tạo và duyệt trước apply, liên kết từng planned change bằng opaque request ID. Rollback không xóa vật lý account hoặc audit history.

Thứ tự rollback:

1. Dừng UAT và thu hồi session của identity bị ảnh hưởng.
2. Vô hiệu hóa account mới tạo nếu cần.
3. Revoke role assignment và unit scope do change record tạo.
4. Khôi phục trạng thái trước apply cho account được reuse theo approved rollback plan.
5. Giữ lecturer mapping/audit history nếu việc gỡ mapping vi phạm lịch sử; chuyển manual review.
6. Xác minh không còn active access ngoài baseline.
7. Ghi rollback audit và sanitized summary.

Không rollback bằng `DELETE`, truncate, database reset hoặc sửa trực tiếp history table.

## 7. Idempotency và reconciliation

- Retry cùng manifest/target phải trả `EXISTING` hoặc equivalent, không tạo duplicate.
- Duplicate email, lecturer mapping, role và unit scope phải safe-fail hoặc no-op có kiểm chứng.
- Reconciliation sau apply/rollback dùng read-only query và aggregate counts.
- Sai khác bất kỳ giữa planned/applied/audited changes làm gate `BLOCKED` và kích hoạt rollback decision.

## 8. Prohibited actions

- Mass-provision hoặc wildcard scope.
- Suy luận email/người lãnh đạo.
- Apply khi backup exclusion/restore chưa `PASS`.
- Provision vào production hoặc canonical acceptance `ueb_core`.
- Commit manifest PII, credential, raw audit hay rollback list chứa PII.
- Dùng owner credential làm application runtime.
