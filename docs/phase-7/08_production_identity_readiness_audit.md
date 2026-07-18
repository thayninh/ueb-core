# Phase 7 production identity readiness audit

## 1. Execution boundary

This audit was performed locally and read-only on 2026-07-18. No staging or
production endpoint/database was contacted; no account was provisioned; no
migration was applied. No raw roster, email, name, lecturer UID, password, hash,
token, database URL or audit output is included here.

## 2. Canonical source inventory

The repository-defined baseline was inspected at the ignored relative location
`data/input/CSDLCore_chuan_hoa_PostgreSQL.xlsx`, sheet `csdlcore`.

The exact 20-column inventory matches
`config/phase-2/source-contract.json`: `stt`,
`don_vi_phu_trach_hoc_phan`, `bo_mon_phu_trach_hoc_phan`, `khoi_kien_thuc`,
`ma_hoc_phan`, `ten_hoc_phan`, `ten_giang_vien`, `ma_so_can_bo`,
`email_tai_khoan_vnu`, `bo_mon`, `don_vi`, `core_1_2_3`, the two TC1/TC2
columns, the TC3 aggregate and four TC3 detail columns, and the TC4 column.
The production identity mapping uses the deterministic Phase 2
`lecturerUid`, `email_tai_khoan_vnu`, `ten_giang_vien` and `don_vi`. There is no
employment/active-status source column.

| Metric | Result |
| --- | ---: |
| SHA-256 | `e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972` |
| Rows | 2,497 |
| Columns | 20 |
| Distinct lecturer UIDs | 246 |
| Distinct normalized emails | 246 |
| VNU lecturer identities | 245 |
| Non-VNU lecturer identities | 1 |
| Blank lecturer identifiers/emails/names/units | 0 |
| Email assigned to multiple UIDs | 0 |
| UID assigned to multiple emails | 0 |
| UID assigned to multiple units | 0 |
| Ambiguous display-name groups | 5 |
| Rows requiring email case/trim normalization | 15 |
| Test-like canonical emails | 0 |
| Exact duplicate business groups/rows | 7 / 14 |
| Employment/active-status column | Not present |

All six canonical unit values map exactly through the approved explicit
allowlist. No unit value is unknown. The checksum, row count, column inventory
and previously accepted duplicate metrics match the Phase 2 baseline.

The single non-VNU identity and five display-name ambiguities are blockers.
Tooling does not substitute a personal address, invent a VNU address or choose
one display-name variant. The missing employment-status field is recorded as a
warning requiring operator/business confirmation of the intended population.

## 3. Secure-input audit

The original local workbook remains inside the workspace with observed
parent/file modes `0755/0644`. A byte-identical copy is now held in the explicit
external Phase 7 secure directory. That directory is `0700`; the canonical copy
and all five operator templates are `0600`. The original was not modified.

The generated secret template contains these required variable names with no
values. Operator inputs remain:

```text
PHASE7_SHARED_LECTURER_INITIAL_PASSWORD
PHASE7_LEADER_KTPT_INITIAL_PASSWORD
PHASE7_LEADER_QTKD_INITIAL_PASSWORD
PHASE7_LEADER_KTKDQT_INITIAL_PASSWORD
PHASE7_LEADER_KTCT_INITIAL_PASSWORD
PHASE7_LEADER_TCNH_INITIAL_PASSWORD
PHASE7_LEADER_KTKT_INITIAL_PASSWORD
```

The external templates now contain six fixed leader slots and the two fixed
test identity contracts. Their operator-controlled email/name/boolean/UUID
fields remain empty. The target-state schema exists but remains
`OPERATOR_INPUT_REQUIRED` with no target data.

## 4. Identity readiness

```text
CANONICAL_BASELINE_CHECKSUM=PASS
CANONICAL_CORE_ROW_COUNT=2497
CANONICAL_COLUMN_COUNT=20
CANONICAL_LECTURER_UID_COUNT=246
CANONICAL_NORMALIZED_EMAIL_COUNT=246
CANONICAL_VNU_LECTURER_COUNT=245
CANONICAL_NON_VNU_LECTURER_COUNT=1
CANONICAL_DISPLAY_NAME_AMBIGUITY_COUNT=5
CANONICAL_UNKNOWN_UNIT_COUNT=0
CANONICAL_TEST_LIKE_EMAIL_COUNT=0
FACULTY_LEADER_REQUIRED_COUNT=6
FACULTY_LEADER_INPUT_COUNT=0
TEST_IDENTITY_REQUIRED_COUNT=2
TEST_IDENTITY_CONFIGURED_COUNT=0
IDENTITY_DRY_RUN=BLOCKED_OPERATOR_INPUTS
IDENTITY_RECONCILIATION=NOT_RUN
PRODUCTION_USER_PROVISIONING=NOT_PERFORMED
PRODUCTION_DATABASE_CONNECTIONS=0
PRODUCTION_DATABASE_WRITES=0
```

## 5. Baseline migration drift

The previously recorded Prisma diff involving the default of
`ueb_core_data.snapshot_id` remains a pre-existing baseline item outside this
identity workstream. No business-table model or migration was changed here.
The final migration-diff gate must demonstrate that this remains the only
known delta and that Phase 7 identity tooling introduces no new schema drift.
