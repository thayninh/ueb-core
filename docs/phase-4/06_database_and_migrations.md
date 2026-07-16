# Database, migrations và runtime permissions Phase 4

## 1. Migration inventory

Phase 4 gồm đúng ba migration append-only, được thêm sau bốn migration Phase 2–3:

1. `20260716040000_phase_4_row_workflow_contract`: tạo enum, hoàn thiện event schema, CHECK constraints và index idempotency.
2. `20260716050000_phase_4_workflow_event_rls`: bật RLS và tạo policy SELECT/SUBMITTED/terminal cho `workflow_event`.
3. `20260716060000_phase_4_approved_row_insert`: cho phép provenance approval, tạo core INSERT policy, unique version và approval validation trigger.

Hai enum database là `workflow_event_type` (`SUBMITTED`, `REJECTED`, `APPROVED`) và `workflow_submission_type` (`CONFIRM_UNCHANGED`, `UPDATE_EXISTING`, `CREATE_NEW`). Migration đổi `event_type` tại chỗ sau khi kiểm tra dữ liệu hiện hữu; không drop bảng hoặc lịch sử event.

## 2. Workflow event contract

Ngoài `event_id`, `submission_id`, `lecturer_uid`, `approval_unit`, actor và timestamp, event lưu `parent_submission_id`, `event_type`, `submission_type`, `record_uid`, `base_stt`, `base_version_no`, `payload`, `payload_checksum`, `reason`, `result_stt` và `result_version_no`.

Các lớp integrity chính:

- partial unique index chỉ cho phép một `SUBMITTED` trên mỗi `submission_id`;
- partial unique index chỉ cho phép một terminal (`APPROVED` hoặc `REJECTED`) trên mỗi `submission_id`;
- ba CHECK constraints tổng hợp bảo vệ shape theo event type, base metadata theo submission type và parent chỉ xuất hiện ở `SUBMITTED`/không tự tham chiếu;
- `SUBMITTED` cần object payload và checksum; `REJECTED` cần reason không rỗng; `APPROVED` cần result STT/version;
- global partial unique index trên `ueb_core_data(source_submission_id)` khi khác `NULL` ngăn một approval tạo nhiều core row;
- unique `(record_uid, version_no)` ngăn trùng phiên bản logical row.

Không có unique index vĩnh viễn trên riêng `record_uid`: một record được phép có nhiều submission nối tiếp sau khi submission cũ terminal.

## 3. RLS, validation và append-only

`workflow_event` bật RLS nhưng không `FORCE ROW LEVEL SECURITY`. Policy SELECT hợp quyền active `ADMIN`, lecturer đúng mapping và leader đúng active unit scope. Hai policy INSERT tách `SUBMITTED` của active lecturer khỏi terminal decision của active admin/leader có scope. Không có policy UPDATE, DELETE hoặc ALL.

`ueb_core_data_phase_4_insert_approved` chỉ cho phép core INSERT trong request context hợp lệ, có một matching `SUBMITTED`, chưa terminal, provenance approval hợp lệ và actor/scope hiện hành đúng. Trigger `ueb_core_data_validate_phase_4_approved_insert` kiểm tra checksum, submission identity/routing, stale base, version rule và đúng 19 payload fields. Trigger/policy không yêu cầu `APPROVED` event tồn tại trước core insert.

Payload submission có 19 trường nghiệp vụ; generated `stt` không nằm trong payload, checksum hoặc phép so sánh payload. Approval không truyền `stt`: PostgreSQL sequence/default cấp STT, vì vậy core row sau insert vẫn đủ 20 trường hiển thị. `INSERT ... RETURNING stt, version_no` cung cấp result metadata cho event `APPROVED` được ghi tiếp trong cùng transaction.

Core và workflow đều append-only. Runtime không có UPDATE/DELETE/TRUNCATE; trigger database tiếp tục chặn mutation kể cả khi privilege vô tình rộng hơn. Legacy rows giữ provenance import, còn approved rows dùng unique `source_submission_id`.

## 4. Local acceptance evidence

Ngày 2026-07-16, local acceptance có 7 migration applied, 0 pending; 2497 core rows, 1 import run và 0 workflow event. `MAX(stt) = 2569`, next STT quan sát từ sequence metadata là `2570`. Việc apply ba migration Phase 4 không thay đổi 2497 legacy rows và không tạo workflow event.

Trước migration có local backup được xác minh bằng SHA-256:

```text
33425317d79f69d7562440292633c068e868906cb7ed60fd53b2deee65e7005d
```

Đây chỉ là bằng chứng vận hành local; backup file không phải artifact để commit và tài liệu không chứa path credential hoặc nội dung dump.

## 5. Runbook triển khai từng môi trường

Chỉ thực hiện sau khi đã xác nhận đúng target database, có backup phù hợp và được phép triển khai:

1. Chạy `pnpm exec prisma migrate deploy` bằng migration/owner connection.
2. Chạy:

   ```bash
   pnpm phase4:grant-runtime-permissions -- \
     --confirm-runtime-grants \
     --expected-database=<database>
   ```

3. Kiểm tra ACL: core chỉ SELECT/INSERT, workflow chỉ SELECT/INSERT, STT sequence chỉ USAGE; không có UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER hoặc sequence SELECT/UPDATE.
4. Kiểm tra RLS default-deny: runtime không có `app.current_user_id` phải thấy 0 core/workflow row và không insert được.
5. Chạy verifier toàn bảng read-only bằng owner connection, đối chiếu row count, checksum/import report và sequence metadata; không gọi `nextval()`.

Migration không hard-code runtime role. Operational reconciliation script kết nối bằng `MIGRATION_DATABASE_URL`, lấy target từ `APP_DATABASE_USER`, xác minh target tồn tại, non-owner, non-superuser và `NOBYPASSRLS`, rồi thay đổi ACL trong một transaction có verification trước commit. Script idempotent và phải chạy sau migration deploy ở mỗi môi trường.

Không dùng SQL GRANT thủ công, wildcard grant hoặc owner credential cho application runtime. Owner connection chỉ dùng cho migration và verifier read-only được kiểm soát; `DATABASE_URL` của ứng dụng luôn là runtime role tối thiểu.
