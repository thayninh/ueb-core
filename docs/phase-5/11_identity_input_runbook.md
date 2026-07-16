# Phase 5 approved identity input validation runbook

## 1. Purpose and hard gate

Validator này kiểm tra hai approved pilot inputs hoàn toàn offline:

1. approved lecturers;
2. approved faculty leaders và unit scopes.

Đây chỉ là `DRY_RUN`. Validator không import Prisma/`pg`, không đọc database environment, không kết nối hoặc ghi database và không provision account.

`UNRESOLVED_AMBIGUITY_COUNT` phải bằng `0` trước khi chuyển sang provisioning dry-run. Technical `PASS` không thay thế business approval; manifest vẫn phải có `approval_batch_id`, `approved_at` có timezone và `approved_by` hợp lệ.

## 2. Secure file handling

- Hai input phải là file JSON tuyệt đối nằm ngoài Git workspace.
- Symlink, relative path, path trong repository, file không phải `.json`, file trùng nhau hoặc file lớn hơn 5 MiB bị từ chối trước validation.
- Không commit, copy vào repository, Docker build context, backup artifact hoặc audit log.
- Không log email, name, lecturer UID, unit assignment, approver hoặc raw record.
- Console chỉ chứa aggregate counts, row number, stable error code và combined SHA-256 checksum.

## 3. Strict JSON contracts

Mỗi file là một JSON array tối đa 100 records. Unknown field bị từ chối.
Schema trong runbook này là executable input contract cho Step 6 và supersede
generic manifest field names trong Section 3 của
`02_identity_approval_input_contract.md` khi chạy validator. Các approval vẫn
được đánh giá theo từng record; nhiều approver/timestamp trong cùng
`approval_batch_id` không tự nó là ambiguity.

Lecturer record bắt buộc:

| Field | Type/contract |
| --- | --- |
| `approval_batch_id` | Non-empty opaque approval batch reference |
| `approved_at` | ISO-8601 timestamp có `Z` hoặc UTC offset |
| `approved_by` | Non-empty authoritative approver reference |
| `email` | Explicit valid login email; chỉ trim/lowercase để so sánh |
| `lecturer_uid` | Explicit UUID được phê duyệt |
| `requested_roles` | Array chỉ chứa `LECTURER` |
| `account_action` | `CREATE` hoặc `REUSE` |

Leader record bắt buộc:

| Field | Type/contract |
| --- | --- |
| `approval_batch_id` | Non-empty opaque approval batch reference |
| `approved_at` | ISO-8601 timestamp có `Z` hoặc UTC offset |
| `approved_by` | Non-empty authoritative approver reference |
| `email` | Explicit valid login email; không suy luận từ unit/name |
| `unit_uid` | Non-empty array các stable unit UID đã duyệt |
| `requested_roles` | Array chỉ chứa `FACULTY_LEADER` |
| `scope_action` | `ASSIGN` hoặc `RETAIN` |

Email chỉ là login identifier. Authorization sau provisioning vẫn dựa trên internal user ID, explicit `lecturer_uid`, role assignment và internal unit scope; validator không dùng email làm authorization key.

## 4. Six-unit inventory

Trong validator, `unit_uid` là stable `unit_code` từ `docs/phase-0/05_approval_units.csv`, không phải database UUID:

```text
KTPT
QTKD
KTKDQT
KTCT
TCNH
KTKT
```

Provisioning sau này phải resolve explicit mỗi approved `unit_uid` sang internal organization unit ID và safe-fail khi không khớp duy nhất. Validator không suy luận unit từ email, tên hoặc lecturer mapping.

## 5. Validation behavior

Validator phát hiện và làm hard blocker:

- invalid/missing approval metadata hoặc nhiều approval batch;
- duplicate normalized email giữa hoặc trong hai inputs;
- duplicate lecturer UID;
- duplicate role trong một record;
- duplicate scope trong một leader record hoặc cùng leader/scope lặp lại;
- unknown unit UID;
- lecturer thiếu `LECTURER`/`lecturer_uid`;
- leader thiếu `FACULTY_LEADER` hoặc scope;
- role không thuộc đúng input type;
- wildcard, unknown field hoặc schema không hợp lệ.

Không tự sửa, merge, bỏ qua record hoặc suy luận giá trị. Mọi ambiguity yêu cầu approved input mới.

## 6. Commands

Quality gate:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Khi đã nhận hai file được phê duyệt qua secure channel:

```bash
pnpm phase5:validate-identities -- \
  --lecturers=<ABSOLUTE_PATH_OUTSIDE_REPOSITORY> \
  --leaders=<ABSOLUTE_PATH_OUTSIDE_REPOSITORY>
```

Pass output:

```text
IDENTITY_INPUT_VALIDATION=PASS
MODE=DRY_RUN
APPROVAL_BATCH_COUNT=1
LECTURER_RECORD_COUNT=<APPROVED_COUNT>
LEADER_RECORD_COUNT=<APPROVED_COUNT>
UNIT_SCOPE_COUNT=<APPROVED_COUNT>
DUPLICATE_EMAIL_COUNT=0
DUPLICATE_LECTURER_UID_COUNT=0
DUPLICATE_ROLE_COUNT=0
DUPLICATE_SCOPE_COUNT=0
UNKNOWN_UNIT_COUNT=0
UNRESOLVED_AMBIGUITY_COUNT=0
INPUT_CHECKSUM=<SHA256>
DATABASE_CONNECTIONS=0
DATABASE_WRITES=0
```

Failure output thêm `ERROR_<N>_ROW=<INPUT>:<ROW>` và `ERROR_<N>_CODE=<STABLE_CODE>`, không chứa giá trị record. Exit code là `2` khi còn ambiguity hoặc input/file guard fail.

## 7. Evidence and approval

Chỉ commit runbook, source và tests. Không commit input thật, report thô hoặc checksum gắn với filename/PII. Approval authority phải xác nhận đúng combined checksum qua kênh ngoài repository trước provisioning dry-run/apply.
