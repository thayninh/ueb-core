# Phase 7 production deployment and rollback plan

## 1. Execution status

This document defines a future ordered change. It does not authorize or perform
production deployment.

```text
PRODUCTION_DEPLOYMENT=NOT_PERFORMED
SERVER_MUTATIONS=0
PRODUCTION_DATABASE_MUTATIONS=0
EXECUTION_AUTHORIZATION=REQUIRED
```

## 2. Preflight hard gates

- explicit authorization covers the exact Git SHA, image IDs, target, change
  window and rollback owner;
- domain topology for the current staging endpoint is explicitly selected;
- existing production services and Caddy are healthy;
- dedicated production database/roles/secrets are verified and staging/UAT
  references are zero;
- canonical baseline checksum and `2,497` core-row manifest pass;
- identity dry-run and forced-password-change implementation pass;
- immutable app/operator archives and checksums match the authorized release;
- pre-change backup, off-host copy and restore rehearsal pass;
- email alert transport and controlled delivery test pass; and
- resource limits, observation window and stop authority are approved.

Any failed or missing gate stops the change before mutation.

## 3. Future ordered deployment

1. Freeze the approved release and record clean Git/image/archive identifiers.
2. Recheck host, production services, database target, capacity and public port
   topology read-only.
3. Back up the production target, verify checksum/catalog and confirm off-host
   copy.
4. Load immutable images without `latest` and verify their IDs/architecture.
5. Create or reconcile only the approved production directories, private
   networks, volumes and secret references.
6. Bootstrap the dedicated production database identities, run migrations, and
   verify role separation/ACL/RLS.
7. Import and reconcile the canonical `2,497`-row baseline.
8. Run identity dry-run, bounded batch apply and reconciliation only after the
   forced-change gate passes.
9. Start the application with only runtime credentials and resource limits.
10. Verify internal health/readiness and database security before public route
    change.
11. Back up the existing Caddy configuration, stage the exact authorized route,
    validate the full configuration and reload gracefully.
12. Verify Caddy and all pre-existing production services remain healthy, then
    run public TLS/health/readiness and the production smoke matrix.
13. Observe monitoring, resource and error indicators throughout the approved
    window and reconcile final counts.

Caddy validation, reload and DNS/route changes are future authorized operations;
none are performed by this planning commit.

## 4. Rollback checkpoints

| Checkpoint | Trigger | Rollback action |
| --- | --- | --- |
| Before database mutation | target/backup/role gate fails | stop with no production change |
| After database build, before route | migration/import/ACL/RLS/identity gate fails | keep public traffic on prior route; quarantine new target |
| After app start, before route | health/readiness/resource gate fails | stop new stack and retain evidence/new database for review |
| During Caddy change | config validation or existing service health fails | restore verified Caddy backup; validate and reload |
| After public cutover | TLS/smoke/isolation/monitoring fails | route back to approved prior healthy stack and invoke data reconciliation |

Rollback never edits applied migrations, uses `latest`, deletes append-only
audit evidence or blindly restores over post-cutover writes. Database rollback
after any production write requires an explicit data-owner decision.

## 5. Domain-specific rollback gate

If the authorized topology promotes `ueb-core.cargis.vn`, rollback must restore
the prior staging/production route exactly as approved without affecting other
sites. If staging is moved first, both endpoints require independent TLS,
health, Caddy-backup and rollback evidence. The operator must document the
chosen topology before composing commands.

## 6. Completion and handoff

Production acceptance is not declared until `06_production_smoke_and_acceptance.md`
passes, backups and restore remain valid, identity counts reconcile, old
sessions are absent and the observation window closes without a hard-stop
condition.
