# KTPT pilot UAT evidence template

## 1. Evidence hygiene

Copy this template for the UAT run only after entry gates pass. Repository
evidence must remain sanitized: no email, personal name, password, token,
credential path/content, full internal user ID, raw payload or unredacted
screenshot. Store sensitive artifacts outside Git and reference only an opaque
evidence ID plus checksum.

## 2. Run metadata

```text
UAT_RUN_ID=
UAT_STARTED_AT=
UAT_FINISHED_AT=
TIMEZONE=Asia/Ho_Chi_Minh
TARGET_DATABASE=ueb_core_uat_phase5
PILOT_UNIT=KTPT
APPROVAL_BATCH_ID=phase5-pilot-ktpt-20260716
INPUT_CHECKSUM=caeba54d4d08e39e44d94f96aa4a00d4af07ee60055e912947ea954453047229
COMMIT_SHA=
DOCKER_IMAGE_IDENTIFIER=NOT_AVAILABLE
DATABASE_FINGERPRINT_BEFORE=
DATABASE_FINGERPRINT_AFTER=
AUTOMATED_PHASE4_EVIDENCE_REFERENCE=
```

Docker image identifier dùng immutable digest nếu có; nếu chưa build/publish
image thì giữ `NOT_AVAILABLE`, không tự tạo identifier giả.

## 3. Baseline metrics

```text
CORE_ROW_COUNT=2497
WORKFLOW_EVENT_COUNT=0
MAX_STT=2569
NEXT_STT=2570
MIGRATIONS_APPLIED=7
MIGRATIONS_PENDING=0
ACTIVE_PILOT_LECTURER_COUNT=5
LECTURER_MAPPING_COUNT=5
ACTIVE_PILOT_LEADER_COUNT=1
ACTIVE_KTPT_SCOPE_COUNT=1
USERS_WITHOUT_ROLE=0
LECTURERS_WITHOUT_MAPPING=0
LEADERS_WITHOUT_SCOPE=0
DUPLICATE_ACTIVE_ROLE_GROUPS=0
DUPLICATE_ACTIVE_SCOPE_GROUPS=0
RLS_DEFAULT_DENY=PASS
DATABASE_WRITES_BY_BASELINE_VERIFIER=0
BASELINE_STATUS=
```

Attach only a sanitized checksum/reference to the full command output.

## 4. Opaque participant mapping

Real identity mapping stays in the approved secure roster outside repository.

| Participant ID | Approved role | Approved unit | Credential delivery attested | Active at start | Evidence reference |
| --- | --- | --- | --- | --- | --- |
| `LEC-01` | `LECTURER` | `KTPT` |  |  |  |
| `LEC-02` | `LECTURER` | `KTPT` |  |  |  |
| `LEC-03` | `LECTURER` | `KTPT` |  |  |  |
| `LEC-04` | `LECTURER` | `KTPT` |  |  |  |
| `LEC-05` | `LECTURER` | `KTPT` |  |  |  |
| `LEAD-01` | `FACULTY_LEADER` | `KTPT` |  |  |  |
| `ADMIN-01` | `ADMIN` | `NONE` |  |  |  |

## 5. Scenario results

Allowed result: `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`. Evidence references must
be opaque and sanitized.

| Scenario | Actor(s) | Started at | Finished at | Core before/after | Workflow before/after | Result | Defect IDs | Evidence references |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `UAT-01` Login/latest profile | `LEC-01` |  |  |  |  | `NOT_RUN` |  |  |
| `UAT-02` Lecturer isolation | `LEC-01`, `LEC-02` |  |  |  |  | `NOT_RUN` |  |  |
| `UAT-03` Confirm unchanged/approve | `LEC-01`, `LEAD-01` |  |  |  |  | `NOT_RUN` |  |  |
| `UAT-04` Update existing/approve | `LEC-02`, `LEAD-01` |  |  |  |  | `NOT_RUN` |  |  |
| `UAT-05` Create new/approve | `LEC-03`, `LEAD-01` |  |  |  |  | `NOT_RUN` |  |  |
| `UAT-06` Submit/reject | `LEC-04`, `LEAD-01` |  |  |  |  | `NOT_RUN` |  |  |
| `UAT-07` Resubmit/approve | `LEC-04`, `LEAD-01` |  |  |  |  | `NOT_RUN` |  |  |
| `UAT-08` KTPT queue/diff | `LEAD-01` |  |  |  |  | `NOT_RUN` |  |  |
| `UAT-09` Cross-unit isolation | `LEAD-01` |  |  |  |  | `NOT_RUN` |  |  |
| `UAT-10` Lecturer IDOR denial | `LEC-01`, `LEC-02` |  |  |  |  | `NOT_RUN` |  |  |
| `UAT-11` Admin visibility/access | `ADMIN-01` |  |  |  |  | `NOT_RUN` |  |  |
| `UAT-12` RLS default deny | `ADMIN-01` witness |  |  |  |  | `NOT_RUN` |  |  |

## 6. Defect log

Severity: `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`. Do not paste raw request/response,
identity data or screenshot into this table.

| Defect ID | Scenario | Severity | Sanitized description | Repro evidence reference | Owner reference | Status | Retest result |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |

```text
BLOCKER_DEFECT_COUNT=
HIGH_DEFECT_COUNT=
MEDIUM_DEFECT_COUNT=
LOW_DEFECT_COUNT=
OPEN_BLOCKER_COUNT=
OPEN_HIGH_COUNT=
```

Any open blocker/high defect forces final decision `FAIL` or `BLOCKED`.

## 7. Final reconciliation

```text
CORE_ROW_COUNT_FINAL=
WORKFLOW_EVENT_COUNT_FINAL=
MAX_STT_FINAL=
NEXT_STT_FINAL=
MIGRATIONS_APPLIED_FINAL=
MIGRATIONS_PENDING_FINAL=
ACTIVE_PILOT_LECTURER_COUNT_FINAL=
LECTURER_MAPPING_COUNT_FINAL=
ACTIVE_PILOT_LEADER_COUNT_FINAL=
ACTIVE_KTPT_SCOPE_COUNT_FINAL=
USERS_WITHOUT_ROLE_FINAL=
LECTURERS_WITHOUT_MAPPING_FINAL=
LEADERS_WITHOUT_SCOPE_FINAL=
DUPLICATE_ACTIVE_ROLE_GROUPS_FINAL=
DUPLICATE_ACTIVE_SCOPE_GROUPS_FINAL=
RLS_DEFAULT_DENY_FINAL=
PILOT_IDENTITY_DRIFT_COUNT=
DATABASE_WRITES_BY_RECONCILER=0
CANONICAL_FINGERPRINT_MATCH=
FINAL_RECONCILIATION_STATUS=
```

Record actual values. Nominal deltas from the execution plan are a comparison
aid, not permission to alter evidence after a stopped/rerun scenario.

## 8. Sign-off

Use opaque approver references. Full signer identity/approval artifact remains
in the authorized external system.

| Sign-off role | Opaque approver reference | Decision | Timestamp | Evidence reference |
| --- | --- | --- | --- | --- |
| Business/UAT owner |  |  |  |  |
| Data/identity owner |  |  |  |  |
| Security representative |  |  |  |  |
| Technical/infrastructure owner |  |  |  |  |

```text
REQUIRED_SCENARIO_PASS_COUNT=12
ACTUAL_SCENARIO_PASS_COUNT=
BLOCKER_DEFECT_COUNT=
HIGH_DEFECT_COUNT=
FINAL_DECISION=NOT_RUN
DECISION_REASON=
PILOT_UAT=NOT_PERFORMED
STAGING_DEPLOYMENT=NOT_PERFORMED
PRODUCTION_DEPLOYMENT=NOT_PERFORMED
```

Final decision may become `PASS` only when all required scenarios pass, final
reconciliation passes, RLS default-deny passes, canonical fingerprint is
unchanged, and blocker/high counts are zero. Pilot UAT sign-off does not
authorize production deployment.
