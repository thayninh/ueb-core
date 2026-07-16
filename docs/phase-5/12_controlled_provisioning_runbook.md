# Phase 5 controlled provisioning runbook

## 1. Scope and hard gate

Workflow này provision một approved pilot batch nhỏ vào dedicated local UAT
database. Dry-run là mặc định. Không chạy production, không dùng canonical
acceptance database `ueb_core`, không mass-provision và không provision account
nào ngoài input đã duyệt.

Chưa chạy apply trong Step 7. Apply chỉ được authorize sau khi đồng thời có:

- restore rehearsal `PASS` và checksum evidence;
- dedicated UAT database;
- approved pilot bundle và business approval;
- identity validation `PASS`;
- exact bundle checksum;
- rollback dry-run `PASS`;
- active ADMIN actor và change authorization.

Không có flag override cho các guard này.

## 2. Database and credential contract

Environment local phải có:

```text
MIGRATION_DATABASE_URL=<local owner URL>
DATABASE_URL=<local runtime URL>
POSTGRES_USER=<owner role>
APP_DATABASE_USER=<runtime role>
AUDIT_HMAC_SECRET=<secret outside Git>
```

Hai URL phải cùng target `127.0.0.1:55432/ueb_core_uat` hoặc tên bắt đầu
`ueb_core_uat_`, nhưng dùng role khác nhau. Guard read-only kiểm tra:

- owner URL thực sự dùng database owner;
- runtime URL dùng non-owner, non-superuser, `NOBYPASSRLS` role;
- database name khớp `--expected-database`;
- 7 migrations applied và 0 pending;
- `NODE_ENV` không phải `production`.

Owner connection chỉ dùng catalog guard read-only. Mọi provisioning mutation dùng
runtime Prisma client và các auth service hiện hữu; không có raw mutation SQL.
Mọi provisioning plan read chạy trong một read-only transaction với
transaction-local `app.current_user_id` của active ADMIN actor. Thiếu actor,
inactive actor hoặc actor không có active `ADMIN` role đều fail closed.

## 3. Secure approved bundle

`--input` là một strict JSON file nằm ngoài repository, không phải symlink, tối
đa 5 MiB và tối đa 20 identities:

```json
{
  "lecturers": [
    {
      "approval_batch_id": "phase5-pilot-01",
      "approved_at": "2026-07-16T13:00:00+07:00",
      "approved_by": "approved-authority-reference",
      "email": "approved-login@example.invalid",
      "lecturer_uid": "10000000-0000-4000-8000-000000000001",
      "requested_roles": ["LECTURER"],
      "account_action": "CREATE"
    }
  ],
  "leaders": []
}
```

Ví dụ chỉ mô tả schema và dùng reserved domain; không thay bằng PII trong Git.
Rows sử dụng chính strict schemas của Step 6. Workflow chạy lại duplicate,
approval, role và six-unit validation trước khi kết nối database.

Step 7 checksum là lowercase SHA-256 của exact combined bundle bytes. Do Step 6
hai-file validator dùng domain-separated checksum, Step 6 evidence không tự động
approve combined bundle. Approval authority phải xác nhận riêng exact Step 7
bundle checksum qua secure channel. Không commit bundle, checksum gắn với PII,
credential output hoặc raw report.

## 4. Deterministic action rules

### Lecturer

- `CREATE`: chỉ tạo khi email chưa có account và email khớp duy nhất explicit
  `lecturer_uid` trong core source.
- `REUSE`: account và access profile phải tồn tại. Mapping trống có thể được gán
  đúng explicit `lecturer_uid`; mapping khác là blocker. Chỉ grant explicit
  `LECTURER` nếu thiếu.
- Không suy luận email hoặc lecturer mapping.

### Faculty leader

- Leader input không bao giờ tạo account. Approved email phải map tới account và
  access profile có sẵn.
- `ASSIGN` chỉ grant explicit `FACULTY_LEADER` và exact scopes trong `unit_uid`.
- `RETAIN` không ghi; role và mọi scope phải tồn tại sẵn, nếu không là blocker.
- Unit code resolve bằng inventory exact:
  `KTPT`, `QTKD`, `KTKDQT`, `KTCT`, `TCNH`, `KTKT`.
- Workflow chỉ tìm active organization unit đã seed; không tạo leader, không tạo
  organization unit và không suy luận unit từ email/name.

## 5. Dry-run

```bash
pnpm phase5:provision-users -- \
  --input=<ABSOLUTE_APPROVED_BUNDLE_OUTSIDE_REPOSITORY> \
  --approval-batch-id=<BATCH_ID> \
  --input-checksum=<BUNDLE_SHA256> \
  --expected-database=ueb_core_uat \
  --actor-user-id=<ACTIVE_ADMIN_INTERNAL_USER_ID>
```

Không truyền `--confirm-apply`. `--actor-user-id` chỉ cài RLS identity trong
transaction-local scope sau khi xác minh active `ADMIN`; không phải RLS bypass.
Dry-run transaction được PostgreSQL ép read-only và chỉ trả aggregate count:

```text
PROVISIONING_MODE=DRY_RUN
INPUT_VALIDATION=PASS
DATABASE_WRITES=0
CREATE_COUNT=<N>
UPDATE_COUNT=<N>
ROLE_ASSIGNMENT_COUNT=<N>
LECTURER_MAPPING_COUNT=<N>
UNIT_SCOPE_ASSIGNMENT_COUNT=<N>
ERROR_COUNT=0
```

Failure chỉ thêm row number và stable error code. Không output email, name,
password, token, lecturer UID, unit ID, URL hoặc role credential.

## 6. Rollback dry-run before apply

Rollback dry-run dựng expected rollback plan từ cùng approved bundle và
database state trước apply:

```bash
pnpm phase5:rollback-provisioning -- \
  --input=<ABSOLUTE_APPROVED_BUNDLE_OUTSIDE_REPOSITORY> \
  --approval-batch-id=<BATCH_ID> \
  --input-checksum=<BUNDLE_SHA256> \
  --expected-database=ueb_core_uat \
  --actor-user-id=<ACTIVE_ADMIN_INTERNAL_USER_ID>
```

Không truyền `--confirm-rollback`. `ROLLBACK_STATUS=PASS` là điều kiện bắt buộc
trước apply. Rollback dry-run xác minh active `ADMIN`, đặt transaction-local RLS
context và ép transaction read-only nên không ghi database. Operational rollback sau apply
không tin plan này để chọn target; nó chỉ tin append-only audit evidence
có exact batch ID, checksum và operation `APPLY`.

## 7. Apply contract — not executed in Step 7

Apply cần toàn bộ flags sau:

```bash
pnpm phase5:provision-users -- \
  --input=<ABSOLUTE_APPROVED_BUNDLE_OUTSIDE_REPOSITORY> \
  --approval-batch-id=<BATCH_ID> \
  --input-checksum=<BUNDLE_SHA256> \
  --expected-database=ueb_core_uat \
  --confirm-apply \
  --confirm-rollback-dry-run-pass \
  --restore-rehearsal-checksum=<RESTORED_BACKUP_SHA256> \
  --actor-user-id=<ACTIVE_ADMIN_INTERNAL_USER_ID> \
  --credential-output=<NEW_ABSOLUTE_JSON_PATH_OUTSIDE_REPOSITORY>
```

Credential output chỉ được tạo khi có lecturer `CREATE`, dùng `O_EXCL`, mode
`0600`, chứa unique generated temporary credentials và không được in. Operator
phải bảo vệ/deliver/xóa file theo secure retention procedure. Nếu apply dừng một
phần, giữ file để reconcile/rollback; output báo
`DATABASE_WRITES=PARTIAL_RECONCILE_REQUIRED` thay vì tuyên bố zero writes.

Mỗi mutation dùng transaction/audit của service hiện hữu. Batch nhỏ có thể dừng
ở record đầu tiên fail; không bỏ qua âm thầm. Cùng batch/checksum chạy lại là
no-op hoặc tiếp tục phần chưa hoàn tất. Cùng batch ID với checksum khác bị chặn.

## 8. Reconciliation

```bash
pnpm phase5:reconcile-provisioning -- \
  --input=<ABSOLUTE_APPROVED_BUNDLE_OUTSIDE_REPOSITORY> \
  --approval-batch-id=<BATCH_ID> \
  --input-checksum=<BUNDLE_SHA256> \
  --expected-database=ueb_core_uat \
  --actor-user-id=<ACTIVE_ADMIN_INTERNAL_USER_ID>
```

Reconciliation xác minh active `ADMIN` và chạy read-only với transaction-local
RLS context. Nó yêu cầu desired state khớp database và mỗi
target có audit evidence của exact batch/checksum. Drift hoặc missing audit làm
exit code khác `0`.

## 9. Operational rollback

Chỉ sau rollback authorization:

```bash
pnpm phase5:rollback-provisioning -- \
  --approval-batch-id=<BATCH_ID> \
  --input-checksum=<BUNDLE_SHA256> \
  --expected-database=ueb_core_uat \
  --confirm-rollback \
  --actor-user-id=<ACTIVE_ADMIN_INTERNAL_USER_ID>
```

Rollback:

1. revoke role assignments do exact batch grant;
2. revoke unit scopes do exact batch grant;
3. disable access profile của account do batch tạo;
4. revoke sessions của mọi affected account;
5. giữ account row, lecturer mapping và toàn bộ audit history;
6. append rollback audit context.

Reused account không bị disable; chỉ assignment do batch tạo được revoke để giữ
baseline trước apply. Không `DELETE` account, audit, workflow hoặc core data;
không reset database và không restore đè UAT database.

## 10. Test isolation and evidence hygiene

Unit/static tests không kết nối database. Mọi integration/E2E gate của repository
chỉ dùng fixed local isolated test databases `ueb_core_phase*`; không chạy test
mutation trên `ueb_core`, `ueb_core_uat` hoặc production.

Evidence được phép commit chỉ là code, test và runbook. Console report chỉ chứa
counts, PASS/FAIL và stable codes; không chứa PII hoặc secret.
