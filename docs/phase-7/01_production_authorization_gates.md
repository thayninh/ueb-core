# Phase 7 production authorization gates

## 1. Authorization rule

Production go-live may begin only after the deployment owner supplies an
explicit, current approval for the exact release, target and change window.
Phase 6 acceptance, this plan and a successful rehearsal do not imply
production authorization.

```text
PRODUCTION_AUTHORIZATION=REQUIRED
PRODUCTION_CHANGE_WINDOW=REQUIRED
PRODUCTION_DEPLOYMENT=NOT_PERFORMED
```

## 2. Mandatory authorization matrix

| Gate | Required evidence | Stop condition |
| --- | --- | --- |
| Deployment owner | named accountable owner and external approval reference | owner or reference missing |
| Change window | future ISO-8601 start/end with timezone and rollback allowance | invalid, expired or insufficient window |
| Release | exact Git SHA, immutable app/operator image IDs and checksums | mutable tag or mismatch |
| Production host | exact host fingerprint, capacity and service-health evidence | target uncertain or unhealthy |
| Production database | approved dedicated target and separate owner/runtime/provisioner identities | staging/UAT reuse or role collapse |
| Canonical data | approved artifact checksum and exact `2,497` core-row manifest | checksum/count mismatch |
| Identity source | approved lecturer UID/VNU-email mapping and operator leader inputs | duplicate, missing or ambiguous mapping |
| Initial password | secure-environment reference and rotation owner | secret absent or exposed |
| Forced change | implementation and negative-path tests pass | initial-password user can access another route |
| Backup/recovery | pre-change backup, off-host copy, restore rehearsal and rollback owner | any recovery gate unproven |
| Email transport | approved transport and redacted delivery test | transport remains unconfigured |
| Production smoke | operator, expected counts and rollback decision points | scope or acceptance owner missing |

Approvals are stored outside Git. The repository records only an opaque change
reference and PASS/FAIL status.

## 3. Mandatory domain topology decision

`https://ueb-core.cargis.vn` currently serves staging. Before any production
route or stack change, the operator must explicitly authorize exactly one of:

1. promote this domain to production and replace the staging stack under an
   approved cutover/rollback plan; or
2. move staging to a separately approved subdomain before assigning a distinct
   production endpoint.

This plan does not select either option. DNS, certificate, Caddy route, staging
retention and rollback details must match the chosen authorization. An absent or
ambiguous decision is a hard stop.

## 4. Identity and data authorization gates

- Lecturer emails come only from VNU email values in the canonical source and
  map exactly one-to-one to `lecturer_uid`.
- Emails/passwords for the six faculty leaders are supplied explicitly by the
  operator; no value or unit scope is inferred.
- Test identities are separately approved and never substitute for real users.
- The production database is dedicated and starts from the canonical baseline
  of exactly `2,497` core rows.
- Staging admin/session data and all UAT/staging credentials are forbidden.
- Append-only, RLS and database-role separation contracts must remain intact.

## 5. External operational gate: email delivery

Phase 6 recorded `EMAIL_ALERT_DELIVERY=BLOCKED_TRANSPORT_NOT_CONFIGURED`.
Production authorization remains blocked until an approved transport is
configured outside Git and a single controlled, redacted alert-delivery test
passes without generating an alert storm. Local monitoring checks alone do not
satisfy this gate.

## 6. Final authorization decision

The future operator decision must be explicit and fail closed:

```text
PRODUCTION_AUTHORIZATION=<APPROVED|REJECTED>
AUTHORIZATION_REFERENCE=<OPAQUE_EXTERNAL_REFERENCE>
AUTHORIZED_GIT_SHA=<FULL_SHA>
AUTHORIZED_IMAGE_CHECKSUM=<SHA256>
DOMAIN_TOPOLOGY=<PROMOTE_CURRENT_DOMAIN|MOVE_STAGING_FIRST>
CHANGE_WINDOW_VALID=<YES|NO>
ROLLBACK_OWNER_CONFIRMED=<YES|NO>
EMAIL_ALERT_DELIVERY=<PASS|BLOCKED>
```

Any placeholder, missing value or `NO`/`BLOCKED` result prevents go-live.
