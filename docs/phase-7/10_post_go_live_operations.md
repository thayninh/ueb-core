# Phase 7 post-go-live operations

## 1. Operating principles

- Treat production and staging as separate environments. Never substitute a
  staging/UAT database, backup directory or credential for production.
- Use the dedicated owner, runtime and provisioning roles only for their
  approved purposes. Application runtime must remain non-owner,
  non-superuser and `NOBYPASSRLS`.
- Keep secrets, database URLs, credentials, backup files and roster PII outside
  Git and restricted to approved `0700` directories and `0600` files.
- Require an explicit authorization reference and active change window for
  mutations. Prefer guarded commands and retain redacted evidence.

## 2. Daily checklist

- Confirm production and staging `/api/health` and `/api/ready` return 200.
- Confirm Caddy, PostgreSQL and both application containers are healthy with
  stable restart counts.
- Confirm HTTP redirects to HTTPS and both TLS certificates remain valid.
- Review the five-minute monitoring log and ensure no unresolved alert latch or
  repeated incident notification exists.
- Confirm the latest production backup is no more than 24 hours old, has a
  matching SHA-256 sidecar and has a checksum-matching off-host copy.
- Confirm the production monitor uses `MONITOR_ENVIRONMENT=production` and the
  approved production backup directory. Do not point it at the staging backup
  directory.
- Review disk and memory. Disk usage from 70% through 84% is `WARNING`; at 85%
  or above it is `HIGH` and a failing operational gate.
- Check for unexpected authentication, database or Caddy errors without
  recording tokens, cookies, password hashes or database URLs.

## 3. Disk and artifact retention

- At `WARNING`, inventory Docker build cache, stopped one-off operator
  containers, dangling layers, old server-side archives, logs and journal
  usage. Plan cleanup before the 85% threshold.
- Use only the approved cleanup allowlist. Never run `docker system prune -a`,
  remove Docker volumes, delete database backups, or delete images referenced
  by running/rollback services.
- Retain 14 daily and 8 weekly checksum-verified backups unless a newer approved
  policy supersedes this handover.
- Keep the current production image, staging image, approved rollback image and
  their manifests/checksums. Remove an older unused artifact only after proving
  it is not referenced and has a verified retained copy.
- Preserve at least seven days of operational logs and all active incident or
  acceptance evidence.

## 4. Weekly recovery review

- Review backup catalog continuity, checksum results and off-host availability.
- Review the latest restore-rehearsal evidence and verify the source production
  fingerprint was unchanged, the restored fingerprint matched, and the
  disposable target and lock were removed.
- Schedule a new guarded restore rehearsal when evidence exceeds the approved
  review interval or after a material database/tooling change.
- Never drop `ueb_core_prod` or delete its retained backups during a rehearsal
  or incident review.

## 5. Account, password and session support

- Verify identity, active profile, role and unit scope before account support.
- Password reset or forced-change support must use the official guarded auth
  service, revoke existing sessions, preserve `mustChangePassword` as required,
  and emit a redacted audit event.
- Never request passwords in chat or logs. Use hidden terminal/browser input
  and temporary restricted files that are removed immediately after use.
- Session revocation must target only the approved user/session set. Verify
  active sessions are zero after controlled test-user logout.
- Escalate duplicate roles/scopes, missing mappings, unexpected ADMIN access or
  RLS visibility as security incidents.

## 6. Monitoring and email validation

- Keep the production monitoring script and configuration mode-restricted and
  retain the every-five-minute `flock` cron schedule.
- Validate email delivery with a non-sensitive message after transport changes
  and periodically during operations reviews. Evidence must be redacted and
  mode `0600`.
- Use the incident latch to suppress duplicate notifications for one active
  incident. Clear it only after all local monitoring checks pass.
- A stale, missing, malformed or checksum-invalid production backup is a hard
  failure even when application health endpoints pass.

## 7. Incident and rollback procedure

1. Stop new mutations and capture server time, health, restart counts and safe
   error classification.
2. Preserve database, backup, application and Caddy evidence. Do not print
   secrets or full environment values.
3. If public routing or smoke fails, route the primary domain back to the last
   approved healthy service using the backed-up Caddy configuration, validate,
   and reload without restarting Caddy.
4. Do not drop the production database, delete identities, or remove backups as
   part of an application/domain rollback.
5. Send one monitoring email alert, verify staging remains healthy, and open an
   incident record with ownership and recovery criteria.
6. Resume only under a new authorization reference and valid change window.

## 8. Staging retention

- Retain staging as the isolated verification environment at
  `ueb-core-staging.cargis.vn` until a separately approved retirement plan is
  accepted.
- Continue staging backup and health checks against the staging-specific
  directory and service. Do not copy production credentials into staging.
- Test deployment, migration, rollback and monitoring changes in staging before
  the next production change where practical.

## 9. Review checkpoints

### 24-hour review

- Re-run production/staging health, readiness, TLS, Caddy route and restart
  checks.
- Verify a fresh production backup and off-host checksum match.
- Review disk trend from the 82% go-live observation and perform approved
  cleanup if the trend threatens the 85% threshold.
- Review monitoring/email evidence and authentication/database errors.
- Confirm no unexplained core/workflow or identity changes occurred.

### Seven-day review

- Review daily backup continuity and weekly restore evidence.
- Review account support events, session revocations, roles/scopes and audit
  coverage.
- Review disk/image/log retention and confirm protected artifacts remain.
- Confirm production and staging ownership, incident contacts and rollback
  artifacts remain current.
- Close remaining Phase 7 operational observations or carry them into the next
  approved phase with an explicit owner and due date.
