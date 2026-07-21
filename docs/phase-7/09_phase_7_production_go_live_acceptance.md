# Phase 7 production go-live acceptance

## 1. Acceptance statement

Phase 7 production go-live is accepted as **PASS**. The production service is
public at `https://ueb-core.cargis.vn`; the retained staging service is public
at `https://ueb-core-staging.cargis.vn`. Production, staging, PostgreSQL and
Caddy were healthy at the final reconciliation on 2026-07-21. No rollback was
required.

The remaining operational observation is root-disk usage at 82%. This is a
`WARNING`, below the unchanged `HIGH` threshold of 85%, and is tracked by the
post-go-live operations checklist.

## 2. Deployed architecture and provenance

- Caddy terminates TLS and routes the production and staging hostnames to
  separate application services on the private Docker network.
- PostgreSQL is not published publicly. Production uses the dedicated
  `ueb_core_prod` database with separated owner, runtime and provisioning
  roles. Runtime remains non-owner, non-superuser and `NOBYPASSRLS`.
- The accepted application source is main Git SHA
  `6c6eae35e46f4724d0ffb1af0715d40af8bf70aa`.
- The deployed application image ID is
  `sha256:ba5fac5b9572694a5511155ba56dfc3aa3bfc80468991c5b8b849b7cec3e56f1`.
- The accepted operator image ID is
  `sha256:af1e8148d405e9a77d8e608646c3d849f7830dabaad0c43db7460a68f63bf686`.
- The production monitoring correction was merged after go-live at main Git
  SHA `1215c9b38f69891475fb59df7ff02d82a89b0253`; it did not rebuild or restart
  either application.

## 3. Database and workflow reconciliation

| Check | Accepted result |
| --- | --- |
| Applied migrations | 8 applied, 0 pending |
| Canonical baseline import | PASS |
| Core rows after smoke | 2,498 |
| Workflow events after smoke | 4 |
| Maximum STT | 2,570 |
| Workflow smoke organization unit | KTPT |
| Core RLS enabled | PASS |
| Workflow RLS enabled | PASS |
| Runtime no-context core visibility | 0 |
| Runtime no-context workflow visibility | 0 |

The controlled production smoke created one approved core row and four
workflow events through create, reject, resubmit and approve. No cleanup by
`UPDATE`, `DELETE` or `TRUNCATE` was performed.

## 4. Identity and authorization acceptance

| Check | Accepted result |
| --- | --- |
| Auth users | 254 |
| Access profiles | 254 |
| Organization units | 6 active units |
| Accounts still requiring first password change | 252 |
| Active sessions at reconciliation | 0 |
| Test lecturer isolation | PASS |
| Test faculty-leader KTPT scope | PASS |
| Test identities with ADMIN role | 0 |

Provisioning was transactional and the two controlled test identities
completed forced password change successfully. Old credentials were rejected,
new credentials were accepted, session revocation passed, and no credential or
roster PII is included in this report.

## 5. Backup, recovery and rollback

- The latest checksum-verified production backup is stored under
  `/opt/ueb-core/backups/phase7-go-live-7dcdcf66571fd6fc335db1fb32dd7aa32ef63745/post-provision`.
- Its approved off-host copy has the same SHA-256 checksum.
- The production restore rehearsal, fingerprint comparison and disposable
  restore cleanup all passed before go-live.
- Baseline and post-provision backups were retained.
- Rollback was not required. The rollback route and prior healthy artifacts
  remain available under the approved retention policy.

## 6. Caddy, TLS and public smoke

- `ueb-core.cargis.vn` routes to the production application service.
- `ueb-core-staging.cargis.vn` routes to the staging application service.
- Caddy configuration validation passed and reload completed without a Caddy
  restart.
- Both domains redirect HTTP to HTTPS with status 308.
- TLS, public health, readiness, authentication, authorization isolation and
  logout/protected-route denial checks passed.
- Production application, staging application, PostgreSQL and Caddy restart
  counts were zero at final reconciliation.

## 7. Monitoring observation

The production monitor now receives an explicit environment and backup
directory. It rejects missing, relative, traversing or symlinked paths and
verifies the latest production dump against its checksum sidecar. The staging
backup directory remains `/var/backups/ueb-core/staging` and is not consulted
by the production monitor.

The host cron runs every five minutes. A manual run and the next scheduled run
both passed for production/staging health, readiness, container health,
production backup freshness and email transport. The redacted email alert test
evidence is mode `0600`, and the incident latch was clear, preventing duplicate
alerts for the resolved incident.

At final observation, root-disk usage was 82% (`WARNING`), memory availability
was within limits, and the `HIGH`/failing disk threshold remained 85%.

## 8. Final decision

All Phase 7 data, identity, security, recovery, routing, TLS, public smoke and
monitoring acceptance gates passed. Phase 7 is **COMPLETE / PASS**, subject to
the routine 24-hour and seven-day reviews in the operations handover.
