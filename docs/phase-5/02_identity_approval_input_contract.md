# Phase 5 identity approval input contract

> **Step 6 executable-contract note:** `11_identity_input_runbook.md` defines
> the authoritative JSON field names and validation behavior for approved
> lecturer and faculty-leader inputs. Its strict Step 6 schema supersedes the
> generic manifest shape in Section 3 below for files passed to
> `phase5:validate-identities`. This document remains the provisioning and
> approval-policy context; neither contract authorizes a database write.

## 1. Mục đích

Contract này quy định dữ liệu tối thiểu để phê duyệt từng pilot identity trước provisioning. Nó không phải danh sách người dùng và không cho phép đưa PII thật vào repository.

## 2. Nguyên tắc bắt buộc

- Không mass-provision. Mỗi record phải được chọn và phê duyệt riêng cho pilot scope.
- Không suy luận email từ tên, mã cán bộ, đơn vị, domain convention hoặc identity khác.
- Email phải đến từ nguồn authoritative đã được người có thẩm quyền xác nhận.
- Không tự merge identity, chọn một trong nhiều match hoặc sửa dữ liệu lõi để làm mapping hợp lệ.
- Không commit input manifest chứa PII. Git chỉ lưu contract, checksum, aggregate count và opaque approval reference.
- Không chứa password, temporary password, token, session, password hash hoặc secret.
- Một người đã có account hợp lệ phải được đánh giá để reuse account thay vì tạo account thứ hai.

## 3. Secure input record

Mỗi record ngoài Git phải có:

| Field | Bắt buộc | Quy tắc |
| --- | --- | --- |
| `request_id` | Có | Opaque, unique trong batch |
| `approval_reference` | Có | Tham chiếu phê duyệt ngoài Git |
| `approval_effective_at` | Có | Timestamp có timezone |
| `approved_account_action` | Có | `CREATE` hoặc `REUSE`; không tự suy ra |
| `email` | Có | Giá trị authoritative; trim/lowercase chỉ để so sánh |
| `display_name` | Có | Dùng cho account; không ghi vào report commit |
| `lecturer_uid` | Với `LECTURER` | UUID đã được chủ dữ liệu xác nhận |
| `roles` | Có | Tập con explicit của `LECTURER`, `FACULTY_LEADER`, `ADMIN` |
| `unit_scope_source_values` | Với leader | Danh sách explicit các unit đã duyệt |
| `identity_source_reference` | Có | Nguồn và phiên bản dữ liệu authoritative |
| `approved_by_role` | Có | Vai trò người phê duyệt; không cần đưa tên vào Git |
| `expires_at` | Khuyến nghị | Hết hạn approval nếu chưa apply |

`roles` và unit scope không được dùng wildcard như `ALL`, `*`, “mọi đơn vị” hoặc range ngầm định.

## 4. Validation

### Lecturer

- Email normalized khớp chính xác một `lecturer_uid` trong read-only identity inspection.
- `lecturer_uid` chưa gắn với account active khác.
- Existing normalized email không được tạo account thứ hai.
- Role `LECTURER` bắt buộc có mapping.

### Faculty leader

- Identity và email được phê duyệt trực tiếp; không suy luận từ unit.
- Có ít nhất một active organization unit trong approved input.
- Mỗi unit scope khớp exact `organization_unit.source_value` hoặc opaque ID đã resolve server-side.
- Role leader không có unit scope là blocker.

### Multiple roles

- Cùng một người dùng một account duy nhất.
- Nếu vừa lecturer vừa leader, record phải chứa cả mapping lecturer và unit scopes đã duyệt.
- `ADMIN` không mặc nhiên có quyền approve; quyền quyết định workflow phải theo implementation/contract được xác nhận riêng.

## 5. Conflict codes

Dry-run phải dừng record với code ổn định:

| Code | Ý nghĩa |
| --- | --- |
| `IDENTITY_APPROVAL_MISSING` | Không có approval reference hợp lệ |
| `IDENTITY_APPROVAL_EXPIRED` | Approval hết hiệu lực |
| `IDENTITY_EMAIL_UNVERIFIED` | Email không đến từ nguồn được duyệt |
| `IDENTITY_EMAIL_AMBIGUOUS` | Email khớp nhiều identity/account |
| `IDENTITY_LECTURER_MISMATCH` | Email và `lecturer_uid` không khớp duy nhất |
| `IDENTITY_ACCOUNT_REVIEW_REQUIRED` | Existing account không tương thích với action |
| `IDENTITY_UNIT_SCOPE_MISSING` | Leader không có unit scope |
| `IDENTITY_UNIT_SCOPE_INVALID` | Unit không tồn tại/inactive/không được duyệt |
| `IDENTITY_MASS_PROVISION_FORBIDDEN` | Input có wildcard hoặc scope không hữu hạn |

Không tự sửa conflict. Chủ dữ liệu/quản trị identity phải phát hành input mới.

## 6. Manifest handling

1. Nhận manifest qua secure channel ngoài repository.
2. Kiểm tra file nằm ngoài Git workspace hoặc trong approved ignored path.
3. Tính checksum và ghi nhận checksum cùng aggregate counts.
4. Không log record, email, display name hoặc `lecturer_uid`.
5. Report commit chỉ được ghi dạng:

```text
MANIFEST_SHA256=<digest>
APPROVAL_REFERENCE=<opaque-reference>
RECORD_COUNT=<integer>
LECTURER_COUNT=<integer>
LEADER_COUNT=<integer>
UNIT_SCOPE_COUNT=<integer>
VALIDATION_STATUS=PASS|BLOCKED
```

6. Xóa secure working copy theo retention policy sau khi hoàn tất và không đưa nó vào backup/build artifact không được phép.

## 7. Approval completeness

Identity input chỉ `PASS` khi mọi record hợp lệ, không có inferred email, không có duplicate/ambiguity, toàn bộ pilot unit có leader phù hợp và người phê duyệt xác nhận manifest checksum. Một record fail làm batch dry-run `BLOCKED`; không tự bỏ qua rồi apply phần còn lại nếu chưa có manifest/version mới.
