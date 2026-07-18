# Phase 7 first-login password change contract

## 1. Purpose and hard gate

Every lecturer or approved test account created with the shared initial
lecturer password must change that password on first login. This behavior must
be implemented and pass tests before any mass provisioning or production
deployment.

The shared initial password is loaded only from a secure environment at
execution time. It is never hard-coded, logged, rendered into Compose, stored in
tracked fixtures or copied into evidence.

## 2. Account state contract

Provisioning must atomically create an active identity with a server-enforced
`must_change_password` state. The state is not controlled by a client-only flag,
cookie claim or UI convention.

While the state is active, the authenticated user may access only:

- the password-change page and its narrowly scoped server action/API; and
- logout.

Every other page, API, server action and direct URL must deny or redirect to the
password-change flow. This includes lecturer, leader, admin and workflow routes.
Authorization middleware and server-side handlers must enforce the restriction;
hiding navigation is insufficient.

## 3. Successful change transaction

A successful change must occur in one guarded transaction or equivalent atomic
workflow:

1. verify the authenticated identity and active forced-change state;
2. validate the new password against the approved policy and reject reuse of the
   shared initial password;
3. store only the supported password hash;
4. clear the forced-change state;
5. revoke every session issued before the change, including the session used to
   submit it;
6. write an append-only audit event without password material; and
7. require fresh authentication before normal application access.

Failure must leave the account forced-change state active. No partial password,
session or audit state may be reported as success.

## 4. Audit contract

Audit records contain the event type, actor reference, timestamp, outcome and
approved non-sensitive reason code. They must not contain old/new passwords,
hashes, reset tokens, cookies, full request bodies or internal IDs in exported
evidence.

Required event classes include provisioning-with-forced-change,
password-change-success, password-change-failure and pre-change-session-revoked.

## 5. Required tests

- Initial-password login reaches only the change page or logout.
- Direct GET/POST/API access to every other role route is denied server-side.
- Incorrect current credential and invalid/reused new passwords fail closed.
- Successful change revokes all old sessions and creates an audit record.
- An old session cannot access any protected route after the change.
- Fresh login with the new password reaches only routes allowed by role/scope.
- The shared initial password no longer authenticates that account.
- Lecturer and leader isolation remain enforced after the change.
- Concurrent change attempts produce one consistent final state.
- Passwords, hashes and tokens are absent from logs and tracked evidence.

## 6. Provisioning dependency

The production provisioning dry-run may validate identities before this feature
passes, but batch apply and mass provisioning are forbidden until all required
tests pass on the authorized release.

```text
FORCED_PASSWORD_CHANGE_IMPLEMENTED=<YES|NO>
FORCED_PASSWORD_CHANGE_TESTS=<PASS|FAIL>
OLD_SESSIONS_REVOKED=<YES|NO>
PASSWORD_AUDIT_REDACTED=<YES|NO>
MASS_PROVISIONING_ALLOWED=<YES|NO>
```
