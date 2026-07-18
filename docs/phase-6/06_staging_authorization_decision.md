# Phase 6 staging authorization decision pack

## 1. Status and purpose

Tài liệu này tổng hợp read-only discovery ngày 2026-07-17 và ghi nhận các quyết
định staging được operator phê duyệt. Approval xác định target/architecture và
cho phép chuẩn bị change plan; execution vẫn phải dừng tại guarded-tooling,
change-window và acceptance gates. Không production deployment nào được phép.

```text
DECISION_PACK_STATUS=STAGING_DECISIONS_APPROVED_EXECUTION_BLOCKED
STAGING_DEPLOYMENT=NOT_PERFORMED
PRODUCTION_DEPLOYMENT=OUT_OF_SCOPE
UNRESOLVED_DISCOVERY_FIELD_COUNT=1
STAGING_HOST_DIAGNOSTICS=READ_ONLY_COMPLETE
STAGING_AUTHORIZATION=APPROVED
RESOURCE_PROFILE_ACCEPTED=YES_CONDITIONAL_WITH_RESOURCE_LIMITS
STAGING_GUARDED_TOOLING_READY=NO
EXECUTION_HARD_GATE=BLOCKED
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
| Domain ownership | DNS/TLS owner được operator xác nhận là `thayninh` | Contact route cụ thể vẫn nằm ngoài repository |

Không private key, password, secret, connection URL, environment variable hoặc
database URL được đọc/in/ghi vào tài liệu. Host/user/port đến từ operator input
và read-only verification; discovery không được hiểu là deployment approval.

## 3. Decision matrix

| Decision | Proposed value | Evidence | Approval status | Blocking impact |
| --- | --- | --- | --- | --- |
| Staging scope | Staging only; no production | Explicit operator decision | `OPERATOR_APPROVED` | Execution still requires guarded tooling and change window |
| Staging domain | `ueb-core.cargis.vn` | DNS owner and TLS owner: `thayninh`; Caddy automatic HTTPS approved | `OPERATOR_APPROVED` | TLS remains technically blocked until add-only Caddy change succeeds |
| Deployment directory | `/opt/ueb-core` | Explicit operator decision; isolated from `/opt/khtc-ueb` | `OPERATOR_APPROVED` | Directory creation belongs to the future approved change |
| Staging database | `ueb_core_staging` | Explicit dedicated staging target; UAT/canonical reuse forbidden | `OPERATOR_APPROVED` | Creation blocked until staging-safe bootstrap guard exists |
| Migration owner role | `ueb_core_staging_owner` | Explicit role-separation decision | `OPERATOR_APPROVED` | Creation blocked until staging-safe owner/bootstrap guard exists |
| Application runtime role | `ueb_core_staging_app` | Explicit least-privilege decision | `OPERATOR_APPROVED` | Guarded bootstrap/ACL verification still required |
| Provisioning role | `ueb_core_staging_provisioner` | Explicit isolated provisioning-role decision | `OPERATOR_APPROVED` | Current provisioning tooling is UAT-only |
| Runtime non-owner | `YES` | Mandatory security contract | `REQUIRED_NOT_VERIFIED` | App start blocked until role metadata proves it |
| Runtime `NOBYPASSRLS` | `YES` | Mandatory RLS contract | `REQUIRED_NOT_VERIFIED` | App start blocked until guarded verifier passes |
| Database public port | `NO` | Compose contract has zero published DB ports; staging-host `ss` evidence has no listener on 5432 | `STATIC_AND_HOST_DISCOVERY_PASS` | Runtime deployment must preserve this result |
| UAT credential reuse | `NO` | Explicit operator decision | `OPERATOR_APPROVED_NOT_YET_VERIFIED` | Any reuse is an immediate stop condition |
| Image delivery | `DOCKER_SAVE_SHA256_SCP_DOCKER_LOAD`; tag `ueb-core:<GIT_COMMIT_SHA>`; never `latest` | Explicit operator decision | `OPERATOR_APPROVED` | Execution requires immutable ID/checksum reconciliation |
| Secret storage | Root- or deploy-owned files outside Git under `/opt/ueb-core/secrets/`; directory `0700`, files `0600` | Explicit operator decision | `OPERATOR_APPROVED` | Secret creation/distribution remains a controlled execution step |
| Local backup directory | `/var/backups/ueb-core/staging` | Explicit operator decision | `OPERATOR_APPROVED` | Staging-safe backup guard still missing |
| Backup retention | 14 daily backups and 8 weekly backups | Explicit operator decision | `OPERATOR_APPROVED` | Cleanup requires exact-target/minimum-age negative-tested guard |
| RPO | 24 hours | Explicit operator decision | `OPERATOR_APPROVED` | Must be demonstrated by backup/restore evidence |
| RTO | 4 hours | Explicit operator decision | `OPERATOR_APPROVED` | Must be demonstrated by rollback/restore rehearsal |
| Deployment owner | `thayninh` | Explicit operator decision | `OPERATOR_APPROVED` | Change/observation window still required |
| DNS owner | `thayninh` | Explicit operator decision | `OPERATOR_APPROVED` | DNS must remain matched during TLS issuance |
| TLS owner | `thayninh` | Explicit operator decision | `OPERATOR_APPROVED` | Certificate acceptance evidence still required |
| Monitoring owner | `thayninh` | Explicit operator decision | `OPERATOR_APPROVED` | Email destination must be filled before deployment |
| Incident contact | `thayninh` | Explicit operator decision | `OPERATOR_APPROVED` | External contact route must be tested |
| Staging host | `103.200.25.54` | Operator-provided target; SSH identity and public-IP verification match | `OPERATOR_APPROVED` | Mutation requires the ordered change plan |
| Staging SSH user | `deploy` | Key-authenticated read-only session returned `deploy`; docker group and interactive sudo verified | `OPERATOR_APPROVED` | Privileged commands require interactive operator control |
| Staging SSH port | `22` | SSH connection and privileged listener evidence both confirm port 22 | `OPERATOR_APPROVED` | No SSH configuration change approved |
| Host resource profile | `4_GIB_NOMINAL_CONDITIONAL`; app 512m/0.75 CPU; DB 768m/0.75 CPU | Combined limit 1280 MiB; 2.2 GiB available and 3.8 GiB swap | `OPERATOR_APPROVED_CONDITIONAL` | Limits must not increase; monitoring/observation required |
| Staging proxy topology | Reuse existing Caddy; dedicated external `ueb-core-proxy` | Existing healthy Caddy owns 80/443; Compose supports an external proxy network | `OPERATOR_APPROVED` | Add-only config, validate, reload and rollback evidence required |
| Staging app exposure | Docker-internal `ueb-core-staging-app:3000`; no host-published app port | Compose alias matches reviewed Caddy example | `OPERATOR_APPROVED` | Runtime verification must show zero published ports |
| Target TLS readiness | `BLOCKED_NOT_CONFIGURED` | Exact domain absent from valid Caddyfile; local and loopback SNI handshake return TLS alert internal error | `DISCOVERY_BLOCKED` | Site block, certificate issuance and TLS verification are required before staging acceptance |
| Image transfer method | `DOCKER_SAVE_SHA256_SCP_DOCKER_LOAD` | Explicit operator decision | `OPERATOR_APPROVED` | Exact image ID and archive checksum must match local/remote |
| Off-host backup destination | `/Users/thayninh/Secure/ueb-core-phase6/off-host-backups` | Explicit operator decision; outside repository and staging host | `OPERATOR_APPROVED` | Encryption/access/retrieval evidence required before acceptance |
| Monitoring method | Docker healthcheck + host cron curl + email alert | Explicit operator decision | `METHOD_APPROVED_DESTINATION_PENDING` | Blank email destination blocks deployment |

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
HOST_RESOURCE_STATUS=APPROVED_CONDITIONAL_WITH_FIXED_LIMITS
STAGING_PROXY_OPTION=OPTION_A
RESOURCE_PROFILE_ACCEPTED=YES_CONDITIONAL_WITH_RESOURCE_LIMITS
STAGING_APP_MEMORY_LIMIT=512M
STAGING_APP_CPU_LIMIT=0.75
STAGING_DATABASE_MEMORY_LIMIT=768M
STAGING_DATABASE_CPU_LIMIT=0.75
COMBINED_APP_DATABASE_MEMORY_LIMIT_MIB=1280
EXTERNAL_PROXY_NETWORK=ueb-core-proxy
STAGING_APP_BINDING=ueb-core-staging-app:3000_DOCKER_INTERNAL_ONLY
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
IMAGE_DELIVERY_METHOD=DOCKER_SAVE_SHA256_SCP_DOCKER_LOAD
IMAGE_TAG_FORMAT=ueb-core:<GIT_COMMIT_SHA>
LATEST_TAG_ALLOWED=NO
SECRET_STORAGE=ROOT_OR_DEPLOY_OWNED_FILES_OUTSIDE_REPOSITORY
SECRET_DIRECTORY_MODE=0700
SECRET_FILE_MODE=0600
LOCAL_BACKUP_DIRECTORY=/var/backups/ueb-core/staging
OFF_HOST_BACKUP_DESTINATION=/Users/thayninh/Secure/ueb-core-phase6/off-host-backups
BACKUP_RETENTION=14_DAILY_8_WEEKLY
RPO=24_HOURS
RTO=4_HOURS
MONITORING_METHOD=DOCKER_HEALTHCHECK_PLUS_HOST_CRON_CURL_AND_EMAIL_ALERT
MONITORING_EMAIL_DESTINATION=REQUIRED_BEFORE_DEPLOYMENT
DEPLOYMENT_OWNER=thayninh
DNS_OWNER=thayninh
TLS_OWNER=thayninh
MONITORING_OWNER=thayninh
INCIDENT_CONTACT=thayninh
STAGING_GUARDED_TOOLING_READY=NO
```

## 5. Approved decisions and remaining execution gates

```text
STAGING_AUTHORIZATION=APPROVED
STAGING_HOST_APPROVAL=APPROVED
STAGING_SSH_USER_APPROVAL=APPROVED
STAGING_SSH_PORT_APPROVAL=APPROVED
EXISTING_CADDY_CHANGE_APPROVAL=YES_ADD_ONLY_UEB_CORE_SITE
CADDY_RELOAD_APPROVAL=YES_AFTER_VALIDATE
EXTERNAL_PROXY_NETWORK_APPROVAL=APPROVED
HOST_RESOURCE_ACCEPTANCE=YES_CONDITIONAL_WITH_RESOURCE_LIMITS
TARGET_TLS_METHOD=CADDY_AUTOMATIC_HTTPS
IMAGE_TRANSFER_METHOD_APPROVAL=APPROVED
OFF_HOST_BACKUP_DESTINATION_APPROVAL=APPROVED
RPO_APPROVAL=APPROVED_24_HOURS
RTO_APPROVAL=APPROVED_4_HOURS
MONITORING_METHOD_APPROVAL=APPROVED
STAGING_GUARDED_TOOLING_READY=NO
MONITORING_EMAIL_DESTINATION=REQUIRED_BEFORE_DEPLOYMENT
CHANGE_AND_OBSERVATION_WINDOW=REQUIRED_BEFORE_DEPLOYMENT
ROLLBACK_IMAGE_COMPATIBILITY=REQUIRED_BEFORE_DEPLOYMENT
```

Operator approvals authorize the stated staging decisions, not immediate
execution. Database/bootstrap/provisioning/backup/restore/security/fingerprint
wrappers remain missing for staging; Phase 5 UAT guards must not be bypassed.
The exact ordered change and rollback contract is recorded in
`docs/phase-6/07_staging_change_and_rollback_plan.md`.

## 6. Approved staging topology, resource and TLS decision

```text
RESOURCE_PROFILE=2_CPU_4_GIB_NOMINAL_34_GIB_ROOT_FREE
RAM_CLASS=4_GIB_NOMINAL
MEMORY_AVAILABLE_GIB=2.2
SWAP_TOTAL_GIB=3.8
CURRENT_CONTAINER_MEMORY_USAGE=APPROX_610_MIB
RESOURCE_READINESS=APPROVED_CONDITIONAL_WITH_FIXED_LIMITS
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
STAGING_PROXY_OPTION=OPTION_A_APPROVED
EXTERNAL_PROXY_NETWORK=ueb-core-proxy
STAGING_APP_BINDING=ueb-core-staging-app:3000_DOCKER_INTERNAL_ONLY
```

Chọn `OPTION_A`: reuse existing Caddy container, thêm target site block và nối
Caddy cùng staging app vào dedicated external network `ueb-core-proxy` trong
ordered change đã validate. Không attach staging app trực tiếp vào project-owned
`khtc-ueb-prod_public`; network này đang chứa production Caddy, web và API.
Staging app không publish port ra host, và PostgreSQL tiếp tục chỉ nằm trên
private staging network với zero published database ports.

Không chọn `OPTION_B`: loopback của Caddy container không phải loopback của host,
nên proposal này cần thêm host-gateway routing và làm tăng coupling không cần
thiết. Không chọn `OPTION_C`: CPU, disk, swap và current usage chưa chứng minh
bắt buộc phải có host/IP riêng, nhưng VPS 4 GiB nominal chỉ còn 2.2 GiB available
nên capacity được chấp nhận có điều kiện với app 512m/0.75 CPU và database
768m/0.75 CPU. Limits không được tự tăng; observation/rollback thresholds phải
được ghi và kiểm thử trước acceptance.

TLS failure xảy ra cả qua public address và server loopback với cùng TLS alert
internal error. DNS A record khớp, không có AAAA record, Caddy config validate
PASS nhưng exact target domain không có. Vì vậy root cause là missing target site
and certificate policy trong existing Caddy, không phải DNS/IPv6 routing. Add-only
Caddy change và reload-after-validate đã được duyệt; execution vẫn chờ change
window, config backup, exact validation và rollback evidence.

## 7. Approved image and secret decisions

### Image delivery

Build local trong approved Node 24 operator environment, tag
`ueb-core:<GIT_COMMIT_SHA>`, record immutable image ID, `docker save`, SHA-256,
SCP qua alias và `docker load` sau remote checksum verification. Không dùng
`latest`, không build trên staging host và không coi mutable tag là evidence.

### Secret storage

Approved `/opt/ueb-core/secrets/` là directory root- hoặc deploy-owned mode
`0700`; mỗi secret file mode `0600`. Application chỉ đọc runtime/auth/audit
secrets cần thiết.
Migration owner và provisioning credentials chỉ được inject vào operator jobs,
không mount/pass vào app container. Secret creation, distribution, backup,
rotation và deletion vẫn là controlled operator steps.

## 8. Approved backup and operations decisions

- Local staging backup directory: `/var/backups/ueb-core/staging`.
- Retention: 14 daily + 8 weekly.
- Off-host destination:
  `/Users/thayninh/Secure/ueb-core-phase6/off-host-backups`.
- Approved RPO: 24 hours; approved RTO: 4 hours.
- Monitoring method: Docker healthcheck + host cron curl + email alert.
- Monitoring owner and incident contact: `thayninh`.
- Email destination, install/test evidence, backup retrieval and staging-safe
  backup/restore guards remain mandatory execution gates.

## 9. Authorization conclusion

```text
STAGING_AUTHORIZATION=APPROVED
GO_DECISION=BLOCKED
READ_ONLY_STAGING_DIAGNOSTICS=COMPLETE
RESOURCE_PROFILE_ACCEPTED=YES_CONDITIONAL_WITH_RESOURCE_LIMITS
TLS_READINESS=BLOCKED_TARGET_SITE_NOT_CONFIGURED
PROXY_TOPOLOGY=OPTION_A_APPROVED_NOT_EXECUTED
STAGING_GUARDED_TOOLING_READY=NO
DATABASE_MUTATIONS=0
SERVER_MUTATIONS=0
SSH_CONNECTIONS=READ_ONLY_ONLY
CONTAINERS_DEPLOYED=0
SECRETS_CREATED=0
```

Staging decisions are approved, but deployment remains blocked until the
staging-safe guarded tooling gap is implemented/tested and the execution-only
gates in Section 5 pass. No production Caddy change, external network creation,
database/role/secret creation, certificate issuance or deployment occurred while
updating this decision pack.
