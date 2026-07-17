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
UNRESOLVED_DISCOVERY_FIELD_COUNT=3
STAGING_HOST_DIAGNOSTICS=READ_ONLY_COMPLETE
STAGING_AUTHORIZATION=NOT_GRANTED
```

## 2. Read-only discovery evidence

| Discovery item | Result | Interpretation |
| --- | --- | --- |
| DNS | `ueb-core.cargis.vn` có A record `103.200.25.54`; không có AAAA record | A record khớp host đã xác nhận nhưng không phải DNS/TLS deployment approval |
| SSH identity | Alias `ueb-core-staging`; key authentication PASS; remote user `deploy`; port `22` | Read-only access đã xác minh; không authorize deployment hoặc privileged mutation |
| Docker contexts | Chỉ có local `default` và `desktop-linux`; không có remote context | Không có approved remote Docker target |
| Server inventory | Ubuntu 24.04.4 LTS; 2 CPU; VPS 4 GiB nominal với 3.777 GiB usable; root disk còn 34 GiB | CPU/disk đạt baseline; resource acceptance vẫn cần operator approval |
| Runtime resources | 2.2 GiB memory available; 3.8 GiB swap gần như chưa dùng; production containers dùng khoảng 610 MiB | Có headroom hiện tại nhưng app + PostgreSQL staging cần limits và observation; không nâng/hạ ngưỡng 4 GiB |
| Docker host | Docker 29.6.1, Compose v5.2.0; service active/enabled; user thuộc group `docker` | Docker sẵn sàng cho diagnostics; deployment vẫn chưa được authorize |
| Existing reverse proxy | Healthy `khtc-ueb-prod-caddy-1` (`caddy:2.8-alpine`) publish 80/443; Caddyfile bind-mounted từ `/opt/khtc-ueb/repo/infra/caddy/Caddyfile` | Existing production Caddy phải được reuse qua change được phê duyệt; không được chạy Caddy thứ hai trên cùng ports |
| Caddy topology | Caddy, production web và API cùng dùng `khtc-ueb-prod_public`; config validate PASS; target domain chưa có trong Caddyfile | Không attach staging trực tiếp vào project-owned production network; đề xuất external proxy network riêng |
| TLS | HTTP redirect 308 hoạt động; TLS SNI cho `ueb-core.cargis.vn` fail cả từ Internet và server loopback với TLS alert internal error | Root cause là target site/certificate policy chưa được cấu hình trong Caddy, không phải DNS/IPv6 path |
| Firewall and listeners | UFW active, default deny incoming; 22/80/443 allow IPv4/IPv6; 22 do `sshd`, 80/443 do `docker-proxy`; không có host listener 5432 | HTTP/HTTPS reachability có sẵn; PostgreSQL hiện không public listen |
| Existing paths | Có `/opt/khtc-ueb`; chưa có `/opt/ueb-core`, `/opt/ueb-core/secrets` hoặc `/var/backups/ueb-core/staging` | Không có UEB Core path collision; directory creation vẫn cần authorization riêng |
| Existing backup evidence | Crontab user `deploy`, path của hệ thống hiện hữu, retention 14 ngày | Không phải UEB Core staging backup destination hoặc SSH-user approval |
| Existing monitoring evidence | Health/disk/backup checks của hệ thống hiện hữu | Không phải approved Phase 6 monitoring destination/owner |
| Infrastructure recommendation | Reuse Caddy, dedicated PostgreSQL/private network, no public DB port | Technical architecture only; vẫn chờ external authorization |
| Off-host backup | Chưa có bằng chứng | Deployment blocker cho đến khi destination/owner/retrieval được duyệt |
| Domain ownership | Không có owner evidence trong repository | DNS/TLS owner proposal vẫn chờ phê duyệt |

Không private key, password, secret, connection URL, environment variable hoặc
database URL được đọc/in/ghi vào tài liệu. Host/user/port đến từ operator input
và read-only verification; discovery không được hiểu là deployment approval.

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
| Database public port | `NO` | Compose contract has zero published DB ports; staging-host `ss` evidence has no listener on 5432 | `STATIC_AND_HOST_DISCOVERY_PASS` | Runtime deployment must preserve this result |
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
| Staging host | `103.200.25.54` | Operator-provided target; SSH identity and public-IP verification match | `DISCOVERY_CONFIRMED_NOT_APPROVED` | Explicit deployment authorization is still required |
| Staging SSH user | `deploy` | Key-authenticated read-only session returned `deploy`; account has docker group and interactive sudo only | `DISCOVERY_CONFIRMED_NOT_APPROVED` | Privileged change procedure and owner approval remain required |
| Staging SSH port | `22` | SSH connection and privileged listener evidence both confirm port 22 | `DISCOVERY_CONFIRMED_NOT_APPROVED` | Access verification does not authorize deployment |
| Host resource profile | `4_GIB_NOMINAL_CONDITIONAL` | 2 CPU, 3.777 GiB usable RAM, 2.2 GiB available, 3.8 GiB swap, 34 GiB root free | `PROPOSED_NOT_APPROVED` | Require explicit capacity acceptance, resource limits and observation plan |
| Staging proxy topology | `OPTION_A` | Existing healthy Caddy owns 80/443 and its project network also contains production web/API | `PROPOSED_NOT_APPROVED` | Caddy owner must approve a dedicated external proxy network and site block |
| Staging app exposure | Docker-internal only; no host-published app port | External proxy network proposal isolates routing from production project network | `PROPOSED_NOT_APPROVED` | Network creation/attachment and Caddy change remain blocked |
| Target TLS readiness | `BLOCKED_NOT_CONFIGURED` | Exact domain absent from valid Caddyfile; local and loopback SNI handshake return TLS alert internal error | `DISCOVERY_BLOCKED` | Site block, certificate issuance and TLS verification are required before staging acceptance |
| Image registry or transfer method | `REQUIRES_OPERATOR_APPROVAL` | No registry and no remote Docker context evidence | `UNRESOLVED` | Blocks immutable image delivery/verification |
| Off-host backup destination | `REQUIRES_OPERATOR_APPROVAL` | Repository explicitly records missing off-host evidence | `UNRESOLVED` | Blocks backup and staging acceptance |
| Monitoring destination | `REQUIRES_OPERATOR_APPROVAL` | Only monitoring requirements/current-system checks exist | `UNRESOLVED` | Blocks alert validation and observation window |

## 4. Proposed environment summary

```text
STAGING_DOMAIN=ueb-core.cargis.vn
STAGING_HOST=103.200.25.54
STAGING_SSH_USER=deploy
STAGING_SSH_PORT=22
SSH_KEY_AUTH=PASS
SUDO_ACCESS=INTERACTIVE_ONLY
DOCKER_GROUP_ACCESS=YES
DOCKER_VERSION=29.6.1
DOCKER_COMPOSE_VERSION=v5.2.0
CADDY_STATUS=EXISTING_CONTAINER_ACTIVE_HEALTHY
DNS_A_RECORD=103.200.25.54
RAM_CLASS=4_GIB_NOMINAL
MEMORY_AVAILABLE_GIB=2.2
SWAP_TOTAL_GIB=3.8
ROOT_DISK_FREE_GIB=34
HOST_RESOURCE_STATUS=CONDITIONAL_REQUIRES_APPROVAL
STAGING_PROXY_OPTION=OPTION_A
EXTERNAL_PROXY_NETWORK=DEDICATED_EXTERNAL_NETWORK_PROPOSAL
STAGING_APP_BINDING_PROPOSAL=DOCKER_INTERNAL_ONLY_NO_HOST_PUBLISHED_PORT
TARGET_TLS_STATUS=BLOCKED_TARGET_SITE_NOT_CONFIGURED
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
STAGING_HOST_APPROVAL=REQUIRES_OPERATOR_APPROVAL
STAGING_SSH_USER_APPROVAL=REQUIRES_OPERATOR_APPROVAL
STAGING_SSH_PORT_APPROVAL=REQUIRES_OPERATOR_APPROVAL
EXISTING_CADDY_CHANGE_APPROVAL=REQUIRES_OPERATOR_APPROVAL
EXTERNAL_PROXY_NETWORK_APPROVAL=REQUIRES_OPERATOR_APPROVAL
HOST_RESOURCE_ACCEPTANCE=REQUIRES_OPERATOR_APPROVAL
TARGET_TLS_CHANGE_APPROVAL=REQUIRES_OPERATOR_APPROVAL
IMAGE_REGISTRY_OR_TRANSFER_METHOD=REQUIRES_OPERATOR_APPROVAL
OFF_HOST_BACKUP_DESTINATION=REQUIRES_OPERATOR_APPROVAL
MONITORING_DESTINATION=REQUIRES_OPERATOR_APPROVAL
```

Operator approval phải đi kèm target reference, scope, access owner, change
window và evidence đã khử nhạy cảm. Host/user/port đã được discovery xác nhận
nhưng vẫn chưa được authorize cho mutation. Existing production Caddy change,
external proxy network, capacity acceptance và TLS issuance cần approval riêng.

## 6. Staging topology, resource and TLS proposal

```text
RESOURCE_PROFILE=2_CPU_4_GIB_NOMINAL_34_GIB_ROOT_FREE
RAM_CLASS=4_GIB_NOMINAL
MEMORY_AVAILABLE_GIB=2.2
SWAP_TOTAL_GIB=3.8
CURRENT_CONTAINER_MEMORY_USAGE=APPROX_610_MIB
RESOURCE_READINESS=CONDITIONAL_REQUIRES_OPERATOR_ACCEPTANCE
EXISTING_CADDY_CONTAINER=khtc-ueb-prod-caddy-1
CADDY_CONFIG_PATH=/opt/khtc-ueb/repo/infra/caddy/Caddyfile
CADDY_CONFIG_VALID=YES
TARGET_DOMAIN_PRESENT_IN_CADDY=NO
CADDY_NETWORKS=khtc-ueb-prod_public
PORT_80_OWNER=khtc-ueb-prod-caddy-1_VIA_DOCKER_PROXY
PORT_443_OWNER=khtc-ueb-prod-caddy-1_VIA_DOCKER_PROXY
POSTGRES_PUBLIC_LISTEN=NO
UFW_STATUS=ACTIVE_DEFAULT_DENY_INCOMING_ALLOW_22_80_443
TLS_ROOT_CAUSE=TARGET_SITE_AND_CERTIFICATE_POLICY_NOT_CONFIGURED_IN_CADDY
TLS_CERTIFICATE_STATUS=NOT_AVAILABLE_FOR_TARGET_DOMAIN
STAGING_PROXY_OPTION=OPTION_A
EXTERNAL_PROXY_NETWORK=DEDICATED_EXTERNAL_NETWORK_PROPOSAL
STAGING_APP_BINDING_PROPOSAL=DOCKER_INTERNAL_ONLY_NO_HOST_PUBLISHED_PORT
```

Chọn `OPTION_A`: reuse existing Caddy container, thêm target site block và nối
Caddy cùng staging app vào một dedicated external proxy network sau khi được
phê duyệt. Không attach staging app trực tiếp vào project-owned
`khtc-ueb-prod_public`; network này đang chứa production Caddy, web và API.
Staging app không publish port ra host, và PostgreSQL tiếp tục chỉ nằm trên
private staging network với zero published database ports.

Không chọn `OPTION_B`: loopback của Caddy container không phải loopback của host,
nên proposal này cần thêm host-gateway routing và làm tăng coupling không cần
thiết. Không chọn `OPTION_C`: CPU, disk, swap và current usage chưa chứng minh
bắt buộc phải có host/IP riêng, nhưng VPS 4 GiB nominal chỉ còn 2.2 GiB available
nên capacity vẫn là conditional gate. Operator phải duyệt memory/CPU limits,
PostgreSQL sizing và observation/rollback thresholds trước deployment.

TLS failure xảy ra cả qua public address và server loopback với cùng TLS alert
internal error. DNS A record khớp, không có AAAA record, Caddy config validate
PASS nhưng exact target domain không có. Vì vậy root cause là missing target site
and certificate policy trong existing Caddy, không phải DNS/IPv6 routing. Mọi
Caddyfile edit, network attachment, reload và certificate issuance vẫn bị chặn
cho đến khi production Caddy owner, DNS/TLS owner và operator phê duyệt.

## 7. Image and secret proposals

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

## 8. Backup and operations proposals

- Local staging backup directory: `/var/backups/ueb-core/staging`.
- Retention: 14 daily + 8 weekly, subject to capacity/data-owner approval.
- Off-host encrypted destination, deletion protection and retrieval test remain
  unresolved mandatory gates.
- RPO 24 hours and RTO 4 hours remain proposals, not commitments.
- Monitoring destination and alert routing remain unresolved. Existing health/
  disk/backup cron evidence belongs to another system and cannot be reused as
  Phase 6 acceptance evidence without explicit integration approval.

## 9. Authorization conclusion

```text
STAGING_AUTHORIZATION=NOT_GRANTED
GO_DECISION=BLOCKED
READ_ONLY_STAGING_DIAGNOSTICS=COMPLETE
RESOURCE_READINESS=CONDITIONAL_REQUIRES_OPERATOR_ACCEPTANCE
TLS_READINESS=BLOCKED_TARGET_SITE_NOT_CONFIGURED
PROXY_TOPOLOGY=OPTION_A_PROPOSED_NOT_APPROVED
DATABASE_MUTATIONS=0
SERVER_MUTATIONS=0
SSH_CONNECTIONS=READ_ONLY_ONLY
CONTAINERS_DEPLOYED=0
SECRETS_CREATED=0
```

Deployment remains blocked until every `PROPOSED_NOT_APPROVED`,
`REQUIRES_OPERATOR_APPROVAL`, `DISCOVERY_BLOCKED` and `REQUIRED_NOT_VERIFIED`
item receives evidence-backed approval or verification. In particular, no
existing production Caddy change, external network creation/attachment, target
certificate issuance, staging resource allocation or deployment may begin from
this discovery alone.
