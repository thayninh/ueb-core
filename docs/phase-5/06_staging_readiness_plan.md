# Phase 5 staging readiness plan

## 1. Phạm vi

Tài liệu này đánh giá readiness để xin phép triển khai staging trong một nhiệm vụ riêng. Nó không thực hiện staging deployment và tuyệt đối không cho phép production deployment.

## 2. Entry criteria

- Phase 5 pilot UAT `PASS` và issue disposition được duyệt.
- Submit/reject/approve transaction contract khớp implementation.
- Quality gates, `test:phase4`, Prisma validate/migrate status và build `PASS` trên commit candidate.
- Backup exclusion và UEB Core restore rehearsal `PASS`.
- Staging owner, change window, rollback authority và incident contacts được xác định.
- Infrastructure/business/security approvals có reference hợp lệ.

## 3. Environment isolation

- Staging có database, roles, secrets, hostname và storage riêng.
- Không dùng canonical local acceptance `ueb_core` làm staging database.
- Không dùng chung PostgreSQL cluster/database với production khi chưa có quyết định được phê duyệt.
- Staging không được route nhầm production domain/SSO/client credentials.
- Mọi target-changing command có expected-environment/database guard.
- PII chỉ được dùng khi có data authorization riêng; mặc định dùng synthetic hoặc approved minimal pilot data.

## 4. Infrastructure review

Theo quyết định hạ tầng Phase 0, staging design cần xác minh:

- reverse proxy/network topology được phê duyệt;
- app chỉ expose qua intended proxy path;
- PostgreSQL ở private network và không publish `5432` công khai;
- image PostgreSQL/app được pin bằng version/digest phù hợp;
- app/runtime và migration owner role tách biệt;
- resource limits, disk capacity và monitoring được đặt;
- health/readiness endpoints được probe;
- TLS/origin/cookie configuration phù hợp staging;
- không sửa production Caddy/network trong Phase 5 task này.

## 5. Configuration và secrets

- Secrets đến từ approved secret store/deployment channel, không từ Git/image/log.
- `DATABASE_URL` là least-privilege runtime; `MIGRATION_DATABASE_URL` chỉ cho deploy/recovery job.
- Better Auth URL, trusted origins và cookie behavior khớp staging hostname.
- Bootstrap credential không tồn tại trong steady state.
- Audit HMAC secret riêng theo environment.
- Config review chỉ ghi variable name và sanitized presence/status.

## 6. Database deployment readiness

Runbook staging phải có thứ tự:

1. Xác minh exact target và authorization.
2. Tạo/kiểm tra backup; dùng backup policy đã rehearsal.
3. `prisma migrate deploy` bằng owner connection.
4. Chạy runtime ACL reconciliation bằng expected database guard.
5. Xác minh migration status, object inventory, ACL và RLS default-deny.
6. Chạy verifier read-only bằng owner connection.
7. Chạy app readiness/smoke checks bằng runtime connection.

Không dùng `migrate dev`, `migrate reset`, `db push`, SQL GRANT thủ công hoặc owner URL cho app.

## 7. Identity và UAT data

- Không mass-provision staging users.
- Chỉ provision identity có manifest/approval dành riêng cho staging.
- Không suy luận email hoặc unit scope.
- Không copy raw canonical acceptance/UAT database sang staging nếu chưa có data approval.
- Không commit PII roster hoặc credential delivery evidence.
- Account disable/session revoke và rollback plan phải được rehearsal hoặc walkthrough.

## 8. Observability và operations

- Structured logs không chứa full workflow payload, email/name, password, token, cookie hoặc connection string.
- Có metrics/alert cho health, readiness, error rate, database connectivity, disk, backup freshness và restore schedule.
- Audit events được bảo vệ và có retention/access policy.
- Log rotation/retention được xác minh; open risk R-38 không bị bỏ qua.
- Có incident severity, escalation, maintenance window và rollback decision record.

## 9. Backup, restore và rollback

- Backup schedule/retention và off-host copy có owner.
- Restore rehearsal staging/UEB Core `PASS`, không chỉ archive-readable.
- Rollback runbook phân biệt application rollback, logical provisioning rollback và database restore.
- Database restore không được dùng để che migration/data drift mà chưa điều tra.
- Rollback point gắn với commit/image digest, migration state và backup checksum.

## 10. Readiness checklist

| Area | Required result |
| --- | --- |
| Repository quality gates | `PASS` |
| Pilot UAT | `PASS` |
| Environment isolation | `PASS` |
| Network/private database | `PASS` |
| Secrets/config hygiene | `PASS` |
| Migration/ACL/RLS runbook | `PASS` |
| Backup exclusion | `PASS` |
| Restore rehearsal | `PASS` |
| Health/readiness | `PASS` |
| Monitoring/log rotation | `PASS` |
| Rollback walkthrough | `PASS` |
| Required approvals | `PASS` |

`STAGING_READINESS=PASS` chỉ cho phép xin authorization triển khai staging. Giá trị này không đồng nghĩa production readiness và không cho phép production deployment.
