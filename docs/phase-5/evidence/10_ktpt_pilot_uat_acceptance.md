# KTPT pilot UAT acceptance

## Decision

```text
EVIDENCE_ID=PHASE5-KTPT-UAT-20260717-01
APPLICATION_COMMIT=8487f9a
DOCKER_IMAGE_IDENTIFIER=sha256:de19507879482c4bf2db8b2e71debec51d979b74a9ca2703cdec8ff467887aac
TARGET_ENVIRONMENT=DEDICATED_UAT
TARGET_DATABASE=ueb_core_uat_phase5
PILOT_UNIT=KTPT
SCENARIOS_PASSED=12/12
BLOCKER_DEFECT_COUNT=0
HIGH_DEFECT_COUNT=0
PILOT_UAT_STATUS=PASS
```

All mutations were executed through the real application UI and HTTP/server
actions. No direct workflow-service invocation, raw business-data mutation,
schema change, migration or canonical database write was used.

## Scenario acceptance

| Scenario | Expected core/workflow delta | Actual delta | Key acceptance result | Status |
| --- | --- | --- | --- | --- |
| `UAT-01` | `0/0` | `0/0` | Login and latest profile | `PASS` |
| `UAT-02` | `0/0` | `0/0` | Cross-lecturer resource returns safe 404 | `PASS` |
| `UAT-03` | `+1/+2` | `+1/+2` | Confirm unchanged approved at STT 2570 | `PASS` |
| `UAT-04` | `+1/+2` | `+1/+2` | Exactly one editable field changed; STT 2571 | `PASS` |
| `UAT-05` | `+1/+2` | `+1/+2` | New version-one record at STT 2572 | `PASS` |
| `UAT-06` | `0/+2` | `0/+2` | Exact approved rejection reason recorded | `PASS` |
| `UAT-07` | `+1/+2` | `+1/+2` | New child ID, correct parent and record; STT 2573 | `PASS` |
| `UAT-08` | `0/0` | `0/0` | KTPT queue empty, 19-field diff, no terminal controls | `PASS` |
| `UAT-09` | `0/0` | `0/0` | Non-KTPT unit route returns safe 404 | `PASS` |
| `UAT-10` | `0/0` | `0/0` | Foreign history, edit and submission routes return 404 | `PASS` |
| `UAT-11` | `0/0` | `0/0` | Admin pages pass; 2,498 latest records; 20 fields | `PASS` |
| `UAT-12` | `0/0` | `0/0` | No-context runtime visibility is core 0/workflow 0 | `PASS` |

Authentication session and audit writes caused by actual logins are permitted
operational evidence and are deliberately excluded from core/workflow deltas.

## Final integrity

```text
FINAL_CORE_ROW_COUNT=2501
FINAL_WORKFLOW_EVENT_COUNT=10
FINAL_MAX_STT=2573
FINAL_NEXT_STT=2574
SUBMITTED_EVENT_COUNT=5
APPROVED_EVENT_COUNT=4
REJECTED_EVENT_COUNT=1
APPROVED_UAT_CORE_VERSION_COUNT=4
UNEXPLAINED_CORE_ROWS=0
UNEXPLAINED_WORKFLOW_EVENTS=0
DUPLICATE_TERMINAL_COUNT=0
SOURCE_SUBMISSION_ANOMALY_COUNT=0
PARENT_SUBMISSION_LINK_ANOMALY_COUNT=0
USERS_WITHOUT_ROLE=0
LECTURERS_WITHOUT_MAPPING=0
LEADERS_WITHOUT_SCOPE=0
DUPLICATE_ACTIVE_ROLE_GROUPS=0
DUPLICATE_ACTIVE_SCOPE_GROUPS=0
ROLE_SCOPE_ISOLATION=PASS
LECTURER_IDOR=PASS
RLS_DEFAULT_DENY=PASS
RUNTIME_IS_OWNER=NO
RUNTIME_IS_SUPERUSER=NO
RUNTIME_BYPASSRLS=NO
FINAL_RECONCILIATION=PASS
```

## Canonical protection and evidence policy

The canonical fingerprint before and after UAT was identical:

```text
CANONICAL_DATABASE=ueb_core
CANONICAL_FINGERPRINT=f511d37dd252a8ef653f87c98a6df470e1875c14e883c53042de3de94fdcfb27
CANONICAL_DATABASE_MUTATIONS=0
```

Credential files and participant-to-identity mappings remain outside the
repository with restrictive permissions. This document contains only opaque
participant/submission references and aggregate results. No production or
staging deployment was performed or authorized by this acceptance.

## Gate conclusion

```text
PILOT_UAT_STATUS=PASS
HARD_GATE=PASS
FORMAL_EXTERNAL_SIGN_OFF_REFERENCE=PHASE5-KTPT-UAT-20260717-01
STAGING_DEPLOYMENT=NOT_PERFORMED
PRODUCTION_DEPLOYMENT=NOT_PERFORMED
```
