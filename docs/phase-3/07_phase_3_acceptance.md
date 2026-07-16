# Phase 3 local acceptance

## 1. Kết luận

```text
PHASE 3 TECHNICAL ACCEPTANCE: PASS
LOCAL AUTH/RBAC ACCEPTANCE: COMPLETED
PRODUCTION SSO: NOT CONFIGURED
PRODUCTION ACCOUNT PROVISIONING: NOT PERFORMED
PHASE 0 OPEN CONDITIONS: UNCHANGED
```

Ngày nghiệm thu: 2026-07-16. Phạm vi: local-only.

## 2. Acceptance checklist

- [x] Auth migrations up to date.
- [x] Phase 2 data verify PASS, 0 anomaly.
- [x] Core rows vẫn 2497.
- [x] Import runs vẫn 1.
- [x] Workflow events vẫn 0.
- [x] Public signup bị tắt.
- [x] Local acceptance ADMIN login PASS.
- [x] Lecturer login PASS trên isolated E2E.
- [x] Leader login PASS trên isolated E2E.
- [x] Disabled login bị chặn.
- [x] Logout và session revoke PASS; acceptance còn 0 active session sau test.
- [x] Lecturer chỉ thấy dữ liệu của mình.
- [x] Leader chỉ thấy assigned unit; multiple units trả đúng union.
- [x] Admin thấy toàn bộ 2497 dòng.
- [x] 20 cột nghiệp vụ được hiển thị.
- [x] RLS negative tests PASS.
- [x] IDOR tests PASS.
- [x] Role/unit/session/account changes có audit.
- [x] Audit append-only PASS.
- [x] Runtime role khác migration owner và có `NOBYPASSRLS`.
- [x] Không in email/password/secret/token thực trong log nghiệm thu.
- [x] Không có production connection.

## 3. Quality gates

| Gate | Kết quả |
| --- | --- |
| Node.js | `v24.18.0` |
| Frozen lockfile install | PASS |
| Prettier | PASS |
| ESLint | PASS |
| TypeScript | PASS |
| Unit tests | 136 PASS |
| Isolated integration | 13 PASS |
| Playwright Phase 3 | 6 PASS |
| Next.js production build | PASS |
| Prisma format/validate/generate | PASS |
| Prisma migrate status | Up to date, 4 migrations |
| Phase 2 data verify | PASS, 0 anomaly |
| Docker Compose config | PASS |
| Docker image build | PASS |
| Git diff check | PASS |

## 4. Acceptance database snapshot

| Chỉ số | Giá trị |
| --- | ---: |
| Core rows | 2497 |
| Import runs | 1 |
| Workflow events | 0 |
| Auth users | 1 |
| Active ADMIN roles | 1 |
| Active sessions sau nghiệm thu | 0 |
| Organization units | 6 |
| Assigned leaders | 0 |

Tài khoản local acceptance duy nhất là bootstrap `ADMIN`, không có lecturer mapping và không có unit scope. Tài liệu không ghi danh tính hoặc credential thật.

## 5. Không thuộc acceptance

- Production SSO/Google Workspace/VNU OAuth.
- Production account provisioning hoặc mass provisioning.
- Public signup, email reset, MFA và impersonation.
- Submit, approve/reject và business versioning.
- Ghi hoặc sửa dữ liệu legacy.
- Production deployment.

Sáu đơn vị chưa có lãnh đạo tiếp tục unassigned. Phase 0 open conditions và formal decisions kế thừa không bị Phase 3 tự động đóng.
