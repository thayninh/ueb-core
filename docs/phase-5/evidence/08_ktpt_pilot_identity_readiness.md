# Step 8 evidence — KTPT pilot identity readiness

## Evidence status

```text
STEP8_STATUS=PASS
TARGET_ENVIRONMENT=LOCAL_DEDICATED_UAT
TARGET_DATABASE=ueb_core_uat_phase5
PILOT_UNIT=KTPT
APPROVAL_BATCH_ID=phase5-pilot-ktpt-20260716
INPUT_CHECKSUM=caeba54d4d08e39e44d94f96aa4a00d4af07ee60055e912947ea954453047229
PILOT_LECTURER_COUNT=5
PILOT_LEADER_COUNT=1
```

Evidence này chỉ chứa aggregate counts và opaque references. Approved roster,
identity attributes và credentials không nằm trong repository.

## Provisioning and reconciliation

```text
ROLLBACK_DRY_RUN=PASS
ROLLBACK_DATABASE_WRITES=0
PROVISIONING_MODE=APPLY
PROVISIONING_TRANSACTION_STATUS=COMMITTED_PER_SERVICE_TRANSACTION
CREATED_LECTURER_ACCOUNT_COUNT=5
PROVISIONING_ERROR_COUNT=0
BATCH_AUDIT_TARGET_COUNT=6
BATCH_AUDIT_STATUS=PASS
RECONCILIATION_STATUS=PASS
BATCH_RECORD_COUNT=6
RECONCILED_COUNT=6
DRIFT_COUNT=0
```

Apply sử dụng dedicated non-owner provisioning role. Shared application runtime
không được mở rộng quyền provisioning và database owner không được dùng làm
application provisioning connection.

## Role, mapping and scope integrity

```text
ACTIVE_LECTURER_ROLE_COUNT=5
LECTURER_MAPPING_COUNT=5
LEADER_ACCOUNT_COUNT=1
ACTIVE_FACULTY_LEADER_ROLE_COUNT=1
ACTIVE_KTPT_SCOPE_COUNT=1
LEADER_LECTURER_MAPPING_COUNT=0
USERS_WITHOUT_ROLE=0
LECTURERS_WITHOUT_MAPPING=0
LEADERS_WITHOUT_SCOPE=0
DUPLICATE_ACTIVE_ROLE_GROUPS=0
DUPLICATE_ACTIVE_SCOPE_GROUPS=0
```

Không role, lecturer mapping hoặc unit scope nào được suy luận ngoài approved
input contract.

## Isolation and canonical protection

```text
RLS_DEFAULT_DENY=PASS
RUNTIME_NO_CONTEXT_VISIBILITY=0
CANONICAL_FINGERPRINT_BEFORE=f511d37dd252a8ef653f87c98a6df470e1875c14e883c53042de3de94fdcfb27
CANONICAL_FINGERPRINT_AFTER=f511d37dd252a8ef653f87c98a6df470e1875c14e883c53042de3de94fdcfb27
CANONICAL_DATABASE_MUTATIONS=0
```

UAT write chỉ target dedicated UAT database. Canonical acceptance database
`ueb_core` chỉ được fingerprint bằng read-only verifier trước và sau apply.

## Credential and repository hygiene

- Generated credentials được lưu trong secure storage ngoài repository.
- Credential artifact là regular file mode `0600`; password, token, email và
  credential content không được log hoặc đưa vào evidence.
- Credential delivery/retention phải theo secure operational channel; không
  được đính kèm screenshot hoặc raw roster vào Git.
- Working tree tại Step 8 evidence capture: `CLEAN`.

## Commit references

- Phase 4 merge baseline: `b4f2df85f7b73485244c4c11d6c3cc232280db27`.
- Controlled provisioning implementation: `d6ad85f`.
- RLS actor-context reconciliation: `f87a1fb`.
- Dedicated provisioning role and ACL: `f33af71`.
- Commit chứa evidence này được xác định bằng repository history; không chèn
  self-referential SHA vào nội dung file.

Step 8 `PASS` chỉ mở gate chuẩn bị pilot UAT. Tài liệu này không xác nhận UAT đã
được thực hiện và không authorize staging hoặc production deployment.
