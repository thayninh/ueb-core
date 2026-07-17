# KTPT pilot UAT execution plan

## 1. Status, scope and safety

```text
PILOT_UAT_STATUS=NOT_PERFORMED
TARGET_DATABASE=ueb_core_uat_phase5
PILOT_UNIT=KTPT
PARTICIPANTS=LEC-01..LEC-05,LEAD-01,ADMIN-01
PRODUCTION_DEPLOYMENT=NOT_AUTHORIZED
```

Kế hoạch này chưa thực hiện UAT. Approved roster và participant-to-identity map
được giữ ngoài repository. Không ghi email, name, password, token, credential,
internal user ID hoặc raw payload vào Git/evidence.

Không bắt pilot participant thực hiện race, double-terminal, simultaneous
double-submit hoặc stale-base bằng nhiều terminal. Các contract này dùng Phase 4
automated acceptance evidence tại
`docs/phase-4/04_transaction_and_concurrency.md` và
`docs/phase-4/10_phase_4_acceptance.md`; `pnpm test:phase4` phải còn `PASS` tại
candidate commit.

## 2. Entry gates and execution order

Trước UAT, ghi commit/image identifier, chạy quality gates, xác nhận Step 8
evidence, rồi chạy baseline command:

```bash
pnpm phase5:reconcile-pilot-uat -- \
  --target-database=ueb_core_uat_phase5 \
  --approval-batch-id=phase5-pilot-ktpt-20260716 \
  --input-checksum=caeba54d4d08e39e44d94f96aa4a00d4af07ee60055e912947ea954453047229 \
  --pilot-unit=KTPT
```

Command dùng owner connection trong một `REPEATABLE READ READ ONLY` transaction,
không gọi `nextval()` và output aggregate counts. Gọi command trước/sau mỗi
scenario để tính delta; gọi lại cuối UAT để reconciliation.

Nominal mutation order: UAT-01, UAT-02, UAT-03 (chèn checkpoint UAT-08 trước
approve), UAT-04, UAT-05, UAT-06, UAT-07, UAT-09, UAT-10, UAT-11, UAT-12.
Opaque locator cho UAT-10 lấy từ submission của LEC-02. UAT-09 chỉ chạy khi có
sanitized non-KTPT fixture đã được UAT owner phê duyệt; tuyệt đối không đổi scope
của LEAD-01 để tạo fixture.

## 3. Evidence handling

- UI screenshot/raw browser trace có identity data phải ở secure storage ngoài
  Git. Repository chỉ giữ sanitized evidence ID, checksum và aggregate result.
- Ghi before/after core/workflow counts cho từng scenario.
- `PASS/FAIL` ban đầu là `NOT_RUN`; operator điền trong evidence template.
- Dừng toàn bộ pilot khi có data exposure, canonical write, credential leak,
  duplicate terminal/core result, partial atomic commit, checksum/scope drift,
  blocker hoặc high-severity defect.

## 4. Scenarios

### UAT-01 — Login và latest profile

- **Mục tiêu:** xác minh approved lecturer đăng nhập và chỉ thấy latest logical
  profile rows của mapping đã duyệt.
- **Actor:** `LEC-01`.
- **Precondition:** account/profile active; mapping và `LECTURER` role đã được
  Step 8 reconciliation xác nhận; không chia sẻ credential.
- **Thao tác UI:** mở sign-in, đăng nhập, vào lecturer profile/list và mở một
  latest-row detail/history.
- **Expected result:** đăng nhập thành công; UI không lộ credential/internal ID;
  mỗi logical record hiển thị latest version và history đúng actor.
- **Expected core delta:** `0`.
- **Expected workflow event delta:** `0`.
- **Read-only verification:** before/after reconciler counts không đổi; session
  existence chỉ kiểm tra aggregate ngoài Git.
- **Evidence cần lưu:** sanitized screenshot IDs, commit/image reference,
  before/after reconciliation output checksum.
- **PASS/FAIL:** `NOT_RUN`.
- **Stop condition:** login sai account, thấy non-latest duplicate, identity leak
  hoặc unexpected database delta.

### UAT-02 — Lecturer isolation

- **Mục tiêu:** chứng minh lecturer không thấy row/history/submission của lecturer
  khác.
- **Actor:** `LEC-01`, đối chứng opaque resource của `LEC-02`.
- **Precondition:** cả hai mapping active; opaque resource locator được chuyển
  qua secure channel, không ghi locator vào Git.
- **Thao tác UI:** LEC-01 tìm kiếm/navigation bình thường và thử mở opaque
  LEC-02 resource bằng browser route.
- **Expected result:** resource không xuất hiện trong list; direct navigation bị
  deny/not-found an toàn, không lộ payload hay owner identity.
- **Expected core delta:** `0`.
- **Expected workflow event delta:** `0`.
- **Read-only verification:** reconciler before/after không đổi; runtime
  no-context vẫn bằng `0`.
- **Evidence cần lưu:** sanitized denial status/route class và aggregate counts.
- **PASS/FAIL:** `NOT_RUN`.
- **Stop condition:** cross-lecturer metadata/payload hiển thị hoặc có write.

### UAT-03 — Confirm unchanged → approve

- **Mục tiêu:** xác minh `CONFIRM_UNCHANGED` đi qua pending review và append một
  approved core version duy nhất.
- **Actor:** submit `LEC-01`; review/approve `LEAD-01`.
- **Precondition:** chọn latest KTPT row không có pending submission; ghi baseline
  counters và opaque record reference ngoài Git.
- **Thao tác UI:** LEC-01 chọn confirm unchanged và submit; LEAD-01 xem queue/diff,
  xác nhận rồi approve một lần.
- **Expected result:** trạng thái `PENDING` rồi `APPROVED`; result STT/version hiển
  thị; prior core version không đổi.
- **Expected core delta:** `+1` sau approve, `0` tại pending checkpoint.
- **Expected workflow event delta:** `+2` (`SUBMITTED`, `APPROVED`).
- **Read-only verification:** reconciler before/pending/after; core tăng đúng một,
  workflow tăng đúng hai, max/next STT tăng đúng một sau approval.
- **Evidence cần lưu:** sanitized pending/approved screenshots, aggregate deltas,
  opaque scenario evidence ID.
- **PASS/FAIL:** `NOT_RUN`.
- **Stop condition:** duplicate result, core write trước approval, immutable row
  thay đổi hoặc event/core không atomic.

### UAT-04 — Update existing → approve

- **Mục tiêu:** xác minh approved editable-field update tạo một version mới và
  giữ identity fields.
- **Actor:** submit `LEC-02`; approve `LEAD-01`.
- **Precondition:** latest KTPT row không pending; approved test edit không chứa
  sensitive free text.
- **Thao tác UI:** LEC-02 mở edit, thay một editable field, submit; LEAD-01 kiểm
  tra diff và approve.
- **Expected result:** diff chỉ chứa permitted fields; approved version phản ánh
  edit; prior version và identity fields bất biến.
- **Expected core delta:** `+1`.
- **Expected workflow event delta:** `+2`.
- **Read-only verification:** aggregate before/after; max/next STT và row/event
  counts tăng đúng contract.
- **Evidence cần lưu:** sanitized field-level diff class, counts và evidence ID.
- **PASS/FAIL:** `NOT_RUN`.
- **Stop condition:** identity field editable, diff sai, duplicate version hoặc
  partial event/core write.

### UAT-05 — Create new → approve

- **Mục tiêu:** xác minh new-row submission chưa có STT trước approval và nhận
  STT/version đúng sau approval.
- **Actor:** submit `LEC-03`; approve `LEAD-01`.
- **Precondition:** approved synthetic UAT-only field values; ghi `NEXT_STT`
  trước scenario.
- **Thao tác UI:** LEC-03 tạo row mới và submit; LEAD-01 review diff rồi approve.
- **Expected result:** pending UI không gán STT; approval tạo version `1`, STT
  bằng pre-scenario `NEXT_STT` và record xuất hiện trong latest list.
- **Expected core delta:** `+1`.
- **Expected workflow event delta:** `+2`.
- **Read-only verification:** core/max STT/next STT tăng đúng một; workflow tăng
  đúng hai; không duplicate record/version.
- **Evidence cần lưu:** sanitized pending/result displays và aggregate metrics.
- **PASS/FAIL:** `NOT_RUN`.
- **Stop condition:** STT tiêu thụ trước approval, STT gap do UI attempt,
  duplicate row hoặc payload leak.

### UAT-06 — Submit → reject

- **Mục tiêu:** xác minh rejection có reason, không ghi core và tạo một terminal
  rejection.
- **Actor:** submit `LEC-04`; reject `LEAD-01`.
- **Precondition:** KTPT row không pending; dùng approved non-sensitive reason.
- **Thao tác UI:** LEC-04 submit update; LEAD-01 mở diff, nhập reason và reject.
- **Expected result:** submission thành `REJECTED`, rời pending queue; lecturer
  thấy reason/time an toàn; không có approved result.
- **Expected core delta:** `0`.
- **Expected workflow event delta:** `+2` (`SUBMITTED`, `REJECTED`).
- **Read-only verification:** core/max/next STT không đổi; workflow tăng hai.
- **Evidence cần lưu:** sanitized rejected state/reason class và counters.
- **PASS/FAIL:** `NOT_RUN`.
- **Stop condition:** core write, missing/duplicate terminal event, reason leak
  ngoài owner hoặc submission còn pending.

### UAT-07 — Resubmit rejected submission → approve

- **Mục tiêu:** xác minh rejected draft được resubmit bằng submission mới, giữ
  lineage/record UID và có thể approve.
- **Actor:** resubmit `LEC-04`; approve `LEAD-01`.
- **Precondition:** UAT-06 `PASS`; rejected parent locator ở secure evidence.
- **Thao tác UI:** LEC-04 mở rejected detail, resubmit approved edit; LEAD-01 xem
  queue/diff và approve.
- **Expected result:** parent vẫn immutable `REJECTED`; child có opaque ID mới,
  parent link đúng, kết thúc `APPROVED`.
- **Expected core delta:** `+1`.
- **Expected workflow event delta:** `+2` cho child (`SUBMITTED`, `APPROVED`).
- **Read-only verification:** core và STT tăng một; workflow tăng hai; parent
  events không đổi.
- **Evidence cần lưu:** sanitized lineage/status evidence và aggregate deltas.
- **PASS/FAIL:** `NOT_RUN`.
- **Stop condition:** reuse submission ID, mất lineage, sửa parent, duplicate
  core result hoặc terminal conflict.

### UAT-08 — Leader KTPT queue và diff

- **Mục tiêu:** xác minh leader chỉ thấy pending KTPT queue và full permitted
  nineteen-field review diff.
- **Actor:** `LEAD-01`.
- **Precondition:** dùng pending checkpoint của UAT-03 hoặc UAT-04 trước decision.
- **Thao tác UI:** mở leader submissions, lọc/mở pending item, kiểm tra before/
  proposed diff; không quyết định trong checkpoint này.
- **Expected result:** đúng KTPT item xuất hiện; diff/payload checksum không lộ
  internal IDs; action controls đúng scope.
- **Expected core delta:** `0`.
- **Expected workflow event delta:** `0` tại checkpoint.
- **Read-only verification:** reconciler counts không đổi giữa mở queue/detail.
- **Evidence cần lưu:** sanitized queue/diff structure và opaque submission ref.
- **PASS/FAIL:** `NOT_RUN`.
- **Stop condition:** non-KTPT item xuất hiện, diff thiếu/sai field, data leak
  hoặc read action tạo write.

### UAT-09 — Leader cross-unit isolation

- **Mục tiêu:** chứng minh KTPT leader không list/open/act trên non-KTPT
  submission.
- **Actor:** `LEAD-01`.
- **Precondition:** UAT owner cung cấp opaque non-KTPT fixture locator đã được
  phê duyệt, không chứa real-user PII; không đổi role/scope để tạo fixture.
- **Thao tác UI:** kiểm tra queue và direct-navigation tới opaque cross-unit
  locator; thử action chỉ đến bước server denial, không brute-force locator.
- **Expected result:** item không có trong queue; detail/action deny an toàn,
  không lộ unit owner, payload hoặc existence-sensitive metadata.
- **Expected core delta:** `0`.
- **Expected workflow event delta:** `0`.
- **Read-only verification:** aggregate before/after không đổi; LEAD-01 active
  scope vẫn chỉ KTPT.
- **Evidence cần lưu:** sanitized denial result và fixture approval reference.
- **PASS/FAIL:** `NOT_RUN`; nếu fixture chưa được duyệt thì `BLOCKED`, không giả
  lập bằng cách nới scope.
- **Stop condition:** cross-unit visibility/action hoặc scope drift.

### UAT-10 — Lecturer IDOR denial

- **Mục tiêu:** chứng minh lecturer không đọc hoặc mutate submission của lecturer
  khác bằng direct object reference.
- **Actor:** `LEC-01`; target opaque submission của `LEC-02` từ UAT-04.
- **Precondition:** target locator truyền ngoài Git; LEC-01 và LEC-02 vẫn active
  với distinct mappings.
- **Thao tác UI:** LEC-01 direct-navigation tới detail/edit/resubmit routes của
  target; không thử hàng loạt ID.
- **Expected result:** mọi route deny/not-found an toàn; không lộ target state,
  payload, owner hoặc action.
- **Expected core delta:** `0`.
- **Expected workflow event delta:** `0`.
- **Read-only verification:** reconciler before/after không đổi; role/mapping
  reconciliation vẫn `PASS`.
- **Evidence cần lưu:** sanitized HTTP/UI denial classes và aggregate counts.
- **PASS/FAIL:** `NOT_RUN`.
- **Stop condition:** bất kỳ target metadata/action nào truy cập được hoặc có
  database delta.

### UAT-11 — Admin visibility/access

- **Mục tiêu:** xác minh pure admin thấy administrative users/audit views nhưng
  không thể submit thay lecturer.
- **Actor:** `ADMIN-01`.
- **Precondition:** active `ADMIN`; không có lecturer mapping/LECTURER role được
  thêm ngoài approved contract.
- **Thao tác UI:** đăng nhập, mở admin users và audit views; thử điều hướng lecturer
  submission UI mà không impersonate.
- **Expected result:** admin aggregate/access management hiển thị đúng; raw
  credential/token không xuất hiện; lecturer submit action bị từ chối/không có.
- **Expected core delta:** `0`.
- **Expected workflow event delta:** `0`.
- **Read-only verification:** reconciler counts không đổi; audit view action chỉ
  đọc và không tạo role/mapping.
- **Evidence cần lưu:** sanitized admin-view structure và denied submit result.
- **PASS/FAIL:** `NOT_RUN`.
- **Stop condition:** admin có thể submit thay lecturer, secret/PII leak hoặc
  read-only navigation ghi database.

### UAT-12 — RLS default deny

- **Mục tiêu:** chứng minh runtime không có transaction-local user context nhìn
  thấy `0` core/workflow rows.
- **Actor:** `ADMIN-01` làm witness; guarded technical verifier thực thi command.
- **Precondition:** runtime role non-owner, non-superuser, `NOBYPASSRLS`; không
  đặt `app.current_user_id`.
- **Thao tác UI:** không có UI mutation; đóng authenticated browser sessions,
  sau đó chạy guarded read-only reconciler.
- **Expected result:** `RLS_DEFAULT_DENY=PASS`; no-context visibility bằng `0`;
  normal role-context UI scenarios trước đó vẫn hoạt động đúng.
- **Expected core delta:** `0`.
- **Expected workflow event delta:** `0`.
- **Read-only verification:** command output có `DATABASE_WRITES=0` và RLS pass.
- **Evidence cần lưu:** sanitized command output checksum, commit/image reference.
- **PASS/FAIL:** `NOT_RUN`.
- **Stop condition:** visibility khác `0`, runtime privilege drift hoặc verifier
  không chạy read-only.

## 5. Nominal final reconciliation

Nếu mỗi mutation scenario chạy đúng một lần và đều `PASS`, tổng nominal so với
pre-UAT baseline là:

```text
CORE_ROW_DELTA=+4
WORKFLOW_EVENT_DELTA=+10
MAX_STT=2573
NEXT_STT=2574
IDENTITY_DRIFT=0
RLS_DEFAULT_DENY=PASS
DATABASE_WRITES_BY_RECONCILER=0
```

Không ép các số nominal nếu scenario bị dừng hoặc rerun; evidence phải ghi actual
before/after và defect decision. Không rollback apply hoặc cleanup UAT nếu chưa
có explicit incident authorization. UAT `PASS` không authorize production.
