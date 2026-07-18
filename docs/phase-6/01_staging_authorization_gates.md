# Phase 6 staging authorization gates

## 1. Authorization rule

Không có thao tác staging nào được phép chỉ dựa trên việc Phase 5 đã merge hoặc
Phase 6 plan đã commit. Deployment cần external authorization reference rõ
ràng, có approver role, scope, target, change window, expiry/review date và
rollback owner. Thiếu một mandatory gate là `STOP`.

Authorization chỉ áp dụng staging. Nó không mở rộng sang production, production
SSO hoặc production provisioning.

## 2. Mandatory gate matrix

| Gate | Yêu cầu | Evidence tối thiểu | Trạng thái ban đầu |
| --- | --- | --- | --- |
| `AUTH-01` | Phase 6 plan được application, infrastructure và security owner phê duyệt | Opaque approval reference | `PENDING` |
| `AUTH-02` | Staging host/project/database target và data classification được chốt | Target inventory đã khử nhạy cảm | `PENDING` |
| `AUTH-03` | Change window, observation window và rollback owner được chốt | Change reference + UTC window | `PENDING` |
| `AUTH-04` | DNS/TLS cho `ueb-core.cargis.vn` được hạ tầng phê duyệt | DNS/TLS ownership reference | `PENDING` |
| `AUTH-05` | Immutable image digest, source commit và rollback image được phê duyệt | Digests + compatibility review | `PENDING` |
| `AUTH-06` | Owner/runtime/provisioning role names và separation được security/DB owner duyệt | Role metadata, không có secret | `PENDING` |
| `AUTH-07` | Secret store, access list và rotation owner được duyệt | Secret references + access review | `PENDING` |
| `AUTH-08` | Pre-deploy backup destination, retention và off-host copy owner được duyệt | Backup policy reference | `PENDING` |
| `AUTH-09` | Staging-safe backup/restore/security/fingerprint guards có negative tests | Test/runbook evidence | `PENDING` |
| `AUTH-10` | RPO/RTO, monitoring destination, alert routing và support roster được duyệt | Operations approval reference | `PENDING` |
| `AUTH-11` | Staging-only smoke identities, role/scope và data minimization được business/security duyệt | Redacted aggregate plan | `PENDING` |
| `AUTH-12` | Rollback/forward-fix/new-target restore decision tree được duyệt | Rehearsal plan reference | `PENDING` |
| `AUTH-13` | UAT database/credential reuse bị cấm và được kiểm tra | Isolation checklist | `PENDING` |
| `AUTH-14` | Production exclusions được xác nhận | Explicit non-production statement | `PENDING` |

## 3. Required authorization record

External change system phải chứa tối thiểu:

```text
ENVIRONMENT=STAGING
TARGET_REFERENCE=<OPAQUE_TARGET_REFERENCE>
SOURCE_COMMIT=<APPROVED_COMMIT_SHA>
IMAGE_DIGEST=<APPROVED_IMMUTABLE_DIGEST>
CHANGE_WINDOW_UTC=<START/END>
OBSERVATION_WINDOW=<APPROVED_DURATION>
APPLICATION_OWNER_APPROVAL=<REFERENCE>
INFRASTRUCTURE_OWNER_APPROVAL=<REFERENCE>
DATABASE_OWNER_APPROVAL=<REFERENCE>
SECURITY_APPROVAL=<REFERENCE>
BUSINESS_SMOKE_SCOPE_APPROVAL=<REFERENCE>
ROLLBACK_OWNER=<ROLE_REFERENCE>
RPO_RTO_APPROVAL=<REFERENCE>
```

Không đưa tên người, email, secret hoặc connection URL vào repository để thay
thế external record.

## 4. Separation-of-duties gates

- Migration owner có quyền schema/migration nhưng không được dùng làm app
  runtime hoặc provisioning connection.
- App runtime chỉ có exact runtime ACL, non-owner/non-superuser/`NOBYPASSRLS`.
- Provisioning role chỉ dùng trong operator job được duyệt, không nằm trong app
  container và không được dùng để migrate.
- Người phê duyệt business identity/scope không được thay thế technical database
  authorization; hai gate cần evidence độc lập.
- Application startup không tự chạy migration hoặc provisioning.

## 5. Data and identity gates

- Staging database phải có identity riêng, không phải `ueb_core_uat_phase5` và
  không dùng UAT named volume.
- Không copy UAT credential, session, token hoặc generated credential artifact.
- Không mass-provision real users. Smoke roster phải nhỏ, staging-only và được
  phê duyệt chính xác; không suy luận email, role, lecturer mapping hoặc scope.
- Nếu staging dùng dữ liệu, data source/minimization/retention phải được data
  owner phê duyệt và không mặc định lấy UAT database làm nguồn.
- `ueb_core_uat_phase5` chưa được cleanup cho đến khi plan này được phê duyệt và
  có cleanup authorization riêng.

## 6. Go/no-go decision

Go chỉ khi `AUTH-01` đến `AUTH-14` đều `PASS`, không có blocker/high defect và
preflight xác nhận working tree/image/target/secret boundaries đúng. Mọi waiver
phải là external written approval với expiry; không có oral waiver hoặc
technical self-approval.

```text
STAGING_AUTHORIZATION=NOT_GRANTED_BY_THIS_DOCUMENT
MANDATORY_GATE_COUNT=14
GO_DECISION=PENDING
PRODUCTION_AUTHORIZATION=NO
```
