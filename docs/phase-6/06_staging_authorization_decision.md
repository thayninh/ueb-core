# Phase 6 staging authorization decision pack

## 1. Status and purpose

Tài liệu này tổng hợp read-only discovery ngày 2026-07-17 và đề xuất các giá
trị cần được operator/infrastructure/security owners phê duyệt trước staging
deployment. Proposal không phải approval và không authorize SSH, database
creation, secret creation, Caddy/DNS/TLS changes hoặc container deployment.

```text
DECISION_PACK_STATUS=PROPOSED_NOT_APPROVED
STAGING_DEPLOYMENT=NOT_PERFORMED
PRODUCTION_DEPLOYMENT=OUT_OF_SCOPE
UNRESOLVED_DISCOVERY_FIELD_COUNT=6
```

## 2. Read-only discovery evidence

| Discovery item | Result | Interpretation |
| --- | --- | --- |
| DNS | `ueb-core.cargis.vn` có A record; address không được ghi vào Git | DNS record tồn tại nhưng không chứng minh staging host hoặc ownership/authorization |
| Local SSH config | 1 alias, 0 alias liên quan UEB/CARGIS/staging, không có include | Không có bằng chứng staging host/user/port; không SSH trong discovery |
| Docker contexts | Chỉ có local `default` và `desktop-linux`; không có remote context | Không có approved remote Docker target |
| Server inventory | Draft; OS, host, network, proxy và capacity chưa xác định | Không được suy luận Ubuntu host hoặc deployment target |
| Existing backup evidence | Crontab user `deploy`, path của hệ thống hiện hữu, retention 14 ngày | Không phải UEB Core staging backup destination hoặc SSH-user approval |
| Existing monitoring evidence | Health/disk/backup checks của hệ thống hiện hữu | Không phải approved Phase 6 monitoring destination/owner |
| Infrastructure recommendation | Reuse Caddy, dedicated PostgreSQL/private network, no public DB port | Technical architecture only; vẫn chờ external authorization |
| Off-host backup | Chưa có bằng chứng | Deployment blocker cho đến khi destination/owner/retrieval được duyệt |
| Domain ownership | Không có owner evidence trong repository | DNS/TLS owner proposal vẫn chờ phê duyệt |

Không private key, password, secret, connection URL hoặc sensitive internal IP
được đọc/in/ghi vào tài liệu. DNS A record không được dùng để tự suy luận host.

## 3. Decision matrix

| Decision | Proposed value | Evidence | Approval status | Blocking impact |
| --- | --- | --- | --- | --- |
| Staging scope | Staging only; no production | Phase 6 plan and Phase 5 acceptance | `PROPOSED_NOT_APPROVED` | Block deployment until explicit staging authorization |
| Staging domain | `ueb-core.cargis.vn` | A record present; Caddy/env contracts use this domain | `PROPOSED_NOT_APPROVED` | DNS/TLS ownership and target mapping remain blockers |
| Deployment directory | `/opt/ueb-core` | New isolated path proposal; existing `/opt/khtc-ueb` belongs to another system | `PROPOSED_NOT_APPROVED` | Operator cannot place config/image/secrets until approved |
| Staging database | `ueb_core_staging` | Dedicated-name proposal; UAT/canonical reuse forbidden | `PROPOSED_NOT_APPROVED` | Database creation and migration remain blocked |
| Migration owner role | `ueb_core_staging_owner` | Phase 5/6 role-separation contract | `PROPOSED_NOT_APPROVED` | Migration/backup/ACL jobs remain blocked |
| Application runtime role | `ueb_core_staging_app` | Phase 5/6 least-privilege contract | `PROPOSED_NOT_APPROVED` | App start remains blocked |
| Provisioning role | `ueb_core_staging_provisioner` | Dedicated provisioning-role contract | `PROPOSED_NOT_APPROVED` | Any staging provisioning remains blocked |
| Runtime non-owner | `YES` | Mandatory security contract | `REQUIRED_NOT_VERIFIED` | App start blocked until role metadata proves it |
| Runtime `NOBYPASSRLS` | `YES` | Mandatory RLS contract | `REQUIRED_NOT_VERIFIED` | App start blocked until guarded verifier passes |
| Database public port | `NO` | Compose contract has zero published DB ports | `STATIC_CONTRACT_PASS` | Runtime deployment must preserve this result |
| UAT credential reuse | `NO` | Phase 6 isolation contract | `REQUIRED_NOT_VERIFIED` | Any reuse is an immediate stop condition |
| Image delivery | Immutable image tagged by Git commit and pinned by SHA-256 digest; never use `latest` | Phase 5 deployment runbook | `PROPOSED_NOT_APPROVED` | Deployment blocked until registry/transfer and digest are approved |
| Secret storage | Root-owned files outside repository under `/opt/ueb-core/secrets/`; directory `0700`, files `0600`; app receives runtime secrets only; migration/provisioning secrets are operator-only | Phase 5/6 secret-boundary contract | `PROPOSED_NOT_APPROVED` | Role bootstrap, migration and app start blocked |
| Local backup directory | `/var/backups/ueb-core/staging` | New UEB Core-specific path proposal | `PROPOSED_NOT_APPROVED` | Pre-deploy backup cannot start |
| Backup retention | 14 daily backups and 8 weekly backups | Phase 6 proposal; existing-system retention is not staging approval | `PROPOSED_NOT_APPROVED` | Backup/restore acceptance blocked |
| RPO | 24 hours | Phase 5/6 proposal | `PROPOSED_NOT_APPROVED` | Operational authorization blocked |
| RTO | 4 hours | Phase 5/6 proposal | `PROPOSED_NOT_APPROVED` | Rollback/restore authorization blocked |
| Deployment owner | `thayninh` | Requested owner proposal | `PROPOSED_NOT_APPROVED` | Change execution/closure owner unresolved until approval |
| DNS owner | `thayninh` | Requested owner proposal; no repository ownership evidence | `PROPOSED_NOT_APPROVED` | DNS change/verification blocked |
| TLS owner | `thayninh` | Requested owner proposal; no repository ownership evidence | `PROPOSED_NOT_APPROVED` | Certificate issuance/renewal acceptance blocked |
| Monitoring owner | `thayninh` | Requested owner proposal; no destination evidence | `PROPOSED_NOT_APPROVED` | Alert routing/observation acceptance blocked |
| Incident contact | `thayninh` | Requested contact proposal | `PROPOSED_NOT_APPROVED` | Go-live/rollback escalation blocked |
| Staging host | `REQUIRES_OPERATOR_APPROVAL` | DNS A record alone is insufficient; no SSH alias or target inventory | `UNRESOLVED` | Blocks SSH, directory, capacity and Docker-host validation |
| Staging SSH user | `REQUIRES_OPERATOR_APPROVAL` | No staging SSH alias; existing `deploy` user is for another system's cron | `UNRESOLVED` | Blocks access-control and deployment procedure |
| Staging SSH port | `REQUIRES_OPERATOR_APPROVAL` | No staging SSH config evidence | `UNRESOLVED` | Blocks SSH-access authorization |
| Image registry or transfer method | `REQUIRES_OPERATOR_APPROVAL` | No registry and no remote Docker context evidence | `UNRESOLVED` | Blocks immutable image delivery/verification |
| Off-host backup destination | `REQUIRES_OPERATOR_APPROVAL` | Repository explicitly records missing off-host evidence | `UNRESOLVED` | Blocks backup and staging acceptance |
| Monitoring destination | `REQUIRES_OPERATOR_APPROVAL` | Only monitoring requirements/current-system checks exist | `UNRESOLVED` | Blocks alert validation and observation window |

## 4. Proposed environment summary

```text
STAGING_DOMAIN=ueb-core.cargis.vn
STAGING_DEPLOYMENT_DIRECTORY=/opt/ueb-core
STAGING_DATABASE_NAME=ueb_core_staging
STAGING_MIGRATION_OWNER_ROLE=ueb_core_staging_owner
STAGING_RUNTIME_ROLE=ueb_core_staging_app
STAGING_PROVISIONING_ROLE=ueb_core_staging_provisioner
STAGING_RUNTIME_NON_OWNER=YES
STAGING_RUNTIME_NOBYPASSRLS=YES
STAGING_DATABASE_PUBLIC_PORT=NO
STAGING_UAT_CREDENTIAL_REUSE=NO
LOCAL_BACKUP_DIRECTORY_PROPOSAL=/var/backups/ueb-core/staging
BACKUP_RETENTION_PROPOSAL=14_DAILY_8_WEEKLY
RPO_PROPOSAL=24_HOURS
RTO_PROPOSAL=4_HOURS
DEPLOYMENT_OWNER_PROPOSAL=thayninh
DNS_OWNER_PROPOSAL=thayninh
TLS_OWNER_PROPOSAL=thayninh
MONITORING_OWNER_PROPOSAL=thayninh
INCIDENT_CONTACT_PROPOSAL=thayninh
```

## 5. Unresolved operator decisions

```text
STAGING_HOST=REQUIRES_OPERATOR_APPROVAL
STAGING_SSH_USER=REQUIRES_OPERATOR_APPROVAL
STAGING_SSH_PORT=REQUIRES_OPERATOR_APPROVAL
IMAGE_REGISTRY_OR_TRANSFER_METHOD=REQUIRES_OPERATOR_APPROVAL
OFF_HOST_BACKUP_DESTINATION=REQUIRES_OPERATOR_APPROVAL
MONITORING_DESTINATION=REQUIRES_OPERATOR_APPROVAL
```

Operator approval phải đi kèm target reference, scope, access owner, change
window và evidence đã khử nhạy cảm. Không điền các trường này bằng suy luận từ
DNS, current-system cron/user hoặc local Docker context.

## 6. Image and secret proposals

### Image delivery

Build trong approved CI/operator environment. Tag image bằng exact Git commit,
publish/transfer qua method đã phê duyệt, record SHA-256/OCI digest và deploy
bằng digest. Không dùng `latest`, không build trên staging host và không coi local
Docker image là delivery evidence.

### Secret storage

Đề xuất `/opt/ueb-core/secrets/` là directory root-owned mode `0700`; mỗi secret
file mode `0600`. Application chỉ đọc runtime/auth/audit secrets cần thiết.
Migration owner và provisioning credentials chỉ được inject vào operator jobs,
không mount/pass vào app container. Secret creation, distribution, backup,
rotation và deletion cần security/infrastructure approval riêng.

## 7. Backup and operations proposals

- Local staging backup directory: `/var/backups/ueb-core/staging`.
- Retention: 14 daily + 8 weekly, subject to capacity/data-owner approval.
- Off-host encrypted destination, deletion protection and retrieval test remain
  unresolved mandatory gates.
- RPO 24 hours and RTO 4 hours remain proposals, not commitments.
- Monitoring destination and alert routing remain unresolved. Existing health/
  disk/backup cron evidence belongs to another system and cannot be reused as
  Phase 6 acceptance evidence without explicit integration approval.

## 8. Authorization conclusion

```text
STAGING_AUTHORIZATION=NOT_GRANTED
GO_DECISION=BLOCKED
UNRESOLVED_DECISION_COUNT=6
DATABASE_MUTATIONS=0
SSH_CONNECTIONS=0
CONTAINERS_DEPLOYED=0
SECRETS_CREATED=0
```

Deployment remains blocked until all six unresolved discovery fields and every
`PROPOSED_NOT_APPROVED`/`REQUIRED_NOT_VERIFIED` item receive evidence-backed
approval and the Phase 6 authorization checklist passes.
