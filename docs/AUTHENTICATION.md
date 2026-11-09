# Authentication, sessions and account security

How a person proves who they are in AITD Connection, what the server refuses, and which settings change that. The code
lives in `server/src/services/authService.ts` (rules), `controllers/authController.ts` (HTTP), `middleware/auth.ts`
(guards) and `config/passport.ts` (Google/LinkedIn); the client side is `client/src/context/auth-context.tsx`,
`src/lib/api.ts` and `src/middleware.ts`.

## At a glance

| Question | Answer |
|---|---|
| Ways to sign in | E-mail + password, or Google / LinkedIn (when configured) |
| Second factor | Optional, an e-mailed 6-digit code; applies to password **and** OAuth sign-ins |
| Session | Short-lived access token (JWT) + rotating refresh token |
| Verified e-mail required? | Yes in production (`REQUIRE_EMAIL_VERIFICATION`), off in development and tests |
| Who is admitted? | Only people an **administrator has approved** after checking that they are alumni of the college (see [Alumni approval](#alumni-approval)). No session by any route before that |
| Anonymous access | Sign-in/registration, the landing page and its two data feeds. Everything else answers 401 |
| Account lockout? | No, deliberately (it would let anyone lock out any alumnus). Rate limits and per-account budgets instead |
| Where tokens live in the browser | `localStorage` (a known limitation: see [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) section 7) |

## Sign-up and e-mail verification

```
register ──► account created (unverified) ──► e-mail with link /verify-email?token=…
                                                       │
            confirm with the REGISTRATION PASSWORD ◄───┘
                         │
                         ▼
              verified ──► sign in
```

1. `POST /api/auth/register` creates the account and mails a single-use link (valid 24 hours; only its hash is stored).
2. The link opens **`/verify-email`**. The page asks for the password chosen at registration and sends it with the token to
   `POST /api/auth/verify-email`. Without it nothing is verified. This is what stops *account pre-hijacking*: a stranger who
   registers **your** address with **their** password gets a verification mail sent to **you**; you do not know their
   password, so you cannot complete it, and the account never becomes usable.
3. While `REQUIRE_EMAIL_VERIFICATION` is on, `POST /api/auth/login` answers `403 EMAIL_NOT_VERIFIED` for an unverified
   account, but only after the password has been proven (so it tells a stranger nothing).
4. **Registering an address that already has an unverified account replaces it** (new password; old password, sessions and
   links die), so the real owner is never locked out of their own address. This applies only to accounts nobody has ever signed
   in to; a member who was already using an unverified account (it predates the policy) is never replaced and verifies through
   "resend".
5. `POST /api/auth/resend-verification` sends a new link. It answers identically for every address (unknown, verified,
   deactivated), sends at most one mail per account per minute, and is rate limited per address.

Provider sign-ups (Google/LinkedIn) are verified by the provider: their `emailVerifiedAt` is set and the policy lets them in
as far as the **e-mail** goes. They still wait for approval (below).

## Alumni approval

The platform is for alumni of the college only, and anybody can type a name into a registration form, so a registration is only
a **claim**. An administrator checks it before the person is admitted.

```
register -> PENDING -> (verify e-mail) -> administrator reviews -+-> APPROVED -> e-mail "you can sign in" -> sign in
                                                                 +-> REJECTED -> e-mail with the reason
```

* **State** lives on the user: `approvalStatus` (`PENDING` | `APPROVED` | `REJECTED`), who decided (`approvalReviewedById`),
  when, and the note or reason (`approvalNote`). New registrations are `PENDING` by the database default; nothing in the
  registration or OAuth code can set anything else (the register validator drops unknown fields, tests assert it).
* **What the applicant gives the reviewer:** the existing batch year, department and degree, plus two optional fields on the
  form: an enrolment / roll number (`enrollmentNumber`) and a free note (`verificationNote`). Both are personal data: only
  administrators see them, they are part of the member's data export, and account deletion wipes them. A Google/LinkedIn
  sign-up has no form, so the reviewer works from the name, the e-mail and the LinkedIn address, and contacts the person.
* **No session until approved, by any route.** `login`, the 2FA step, the OAuth code exchange and the refresh-token call all
  answer `403 ACCOUNT_PENDING_APPROVAL` (or `403 ACCOUNT_REJECTED`) and issue nothing. The check sits in one helper
  (`src/utils/approval.ts`) used by `issueSession`, those routes, the `authenticate` middleware and the socket handshake, and it
  **fails closed**: a row without a status counts as not approved. Because `authenticate` checks it on every request, rejecting
  somebody who is already signed in takes effect on their next call, not when the token expires.
* **Said only after the password is proven**, like the e-mail check, so the response tells a stranger nothing.
* **Invisible until approved.** Approving sets `approvalStatus = APPROVED` **and** `isVerified = true`; `isVerified` is what the
  directory, search, digests and follow suggestions already filter on, so an applicant appears in no list. Lookups by id
  (profile, message, connection request, follow, referral) also treat an unapproved account as nonexistent.
  *(`isVerified` used to mean "e-mail verified"; it now means "approved member". The e-mail is tracked by `emailVerifiedAt`.)*
* **The review queue** (ADMIN and above): `GET /admin/approvals?status=&search=&page=`, `GET /admin/approvals/summary`,
  `POST /admin/approvals/:id/approve {note?}`, `POST /admin/approvals/:id/reject {reason}`. The queue is worked oldest first.
  Approval is refused (`409 EMAIL_NOT_VERIFIED`) for an address nobody has proven to own while `REQUIRE_EMAIL_VERIFICATION` is
  on; a second administrator acting at the same moment gets `409`; a member who is already approved is deactivated, not
  "rejected". A rejection needs a reason (3 to 500 characters) because the person is told. A rejected registration can still be
  approved later. Every decision is written to the audit log (`APPROVE` / `REJECT`).
* **E-mails:** after the address is verified, "we received your registration"; on approval, "you can sign in"; on rejection, the
  reason (escaped). A failing mail server never blocks a decision.
* **Existing members are not locked out.** The migration (`20261108020000_alumni_approval`) marks every account that exists as
  `APPROVED` and `isVerified` (including Google/LinkedIn members who were invisible before), except an account that never verified,
  never signed in and holds no role: that goes to the queue.
* **The first administrator** (`SEED_ADMIN_*`) is created `APPROVED`; everybody after is approved by an administrator.

## Signing in

```
login ─► password ok? ─► active? ─► verified? ─► 2FA on? ─┬─ no ──► session (access + refresh token)
                                                          └─ yes ─► challenge token + e-mailed code
                                                                      └─► POST /auth/verify-2fa ─► session
```

* Unknown e-mail and wrong password give the same error after the same amount of bcrypt work (no account enumeration).
* A deactivated account gets `401 ACCOUNT_DEACTIVATED`, again only after the password is proven.
* **Two-factor:** a signed challenge token (10 minutes) is bound to the user. The 6-digit code expires after 10 minutes, allows
  5 wrong guesses and then locks for 15 minutes, and can be re-sent every 30 seconds.
* **OAuth:** the provider redirects the browser to the API callback, which redirects to `/login?code=…` with a
  **one-time code** (5 minutes, single use), never with tokens. The login page scrubs the code from the address bar and
  exchanges it at `POST /api/auth/oauth/exchange`. If the member has 2FA on, the exchange returns the same challenge as a
  password sign-in instead of a session. Linking by e-mail only happens for provider-verified addresses, and a link drops the
  password and sessions of an account that was never verified (a second pre-hijacking defence).

## Sessions

| Token | Lifetime | Notes |
|---|---|---|
| Access token (JWT) | `JWT_EXPIRES_IN`: **15 minutes in production**, 24 h in development | Carries `tv` (the user's `tokenVersion`). Bumping it revokes every outstanding access token |
| Refresh token | 7 days (`JWT_REFRESH_EXPIRES_IN`) | Stored hashed, rotated on every use, grouped in a *family* per sign-in |
| E-mail verification link | 24 hours | Single use, hashed at rest |
| Password reset link | 1 hour | Single use; only the newest link works |
| OAuth exchange code | 5 minutes | Single use |
| 2FA challenge / code | 10 minutes / 10 minutes | See above |

* Replaying an already-rotated refresh token revokes the whole family (`REFRESH_TOKEN_REUSED`) and writes a `SECURITY_ALERT`
  audit entry; a 15-second grace window absorbs two browser tabs refreshing at once.
* `tokenVersion` is bumped on password change/reset, "sign out everywhere", deactivation and account deletion, which also
  drops live sockets.
* The client refreshes automatically on a 401 and the socket re-reads the current token on every reconnect.
* The role is re-read from the database on every request, so promotions, demotions and deactivations apply at once.

## Passwords

* 8–128 characters with an upper-case letter, a lower-case letter and a digit; at most 72 **bytes** (bcrypt ignores the rest,
  so longer input is refused with `PASSWORD_TOO_LONG` rather than silently truncated); not in a list of common passwords.
* Hashed with bcrypt (cost 12). Reset and change both revoke every session.
* Guessing is limited per address (10 sign-in attempts per 15 minutes, shared across API processes through Redis) and, for
  everything that re-checks a password (change, 2FA management, account deletion, e-mail confirmation), per account.

## Endpoints

| Endpoint | Purpose | Limit |
|---|---|---|
| `POST /auth/register` | create a **pending** account (+ optional `enrollmentNumber`, `verificationNote`), mail the verification link | 10 / 15 min / address |
| `POST /auth/verify-email` | `{ token, password }` confirm the address | 10 / 15 min |
| `POST /auth/resend-verification` | new link, identical answer for every address | 10 / 15 min + 1 mail / minute / account |
| `POST /auth/login` | `{ email, password }` → session or 2FA challenge | 10 / 15 min |
| `POST /auth/verify-2fa`, `/resend-2fa` | finish / repeat the second factor | 10 / 15 min |
| `POST /auth/refresh-token` | rotate the refresh token | 60 / 15 min |
| `POST /auth/logout` | revoke this device's refresh token | |
| `GET /auth/me` | the signed-in member | |
| `GET /admin/approvals`, `/admin/approvals/summary`, `POST /admin/approvals/:id/approve`, `/reject` | the review queue (admin) | |
| `POST /auth/forgot-password`, `/reset-password` | reset by e-mail (identical answer for every address) | 10 / 15 min |
| `POST /auth/change-password` | signed in; revokes the other sessions | 10 / 15 min |
| `POST /auth/2fa/enable`, `/2fa/disable` | manage the second factor | 10 / 15 min |
| `GET /auth/google`, `/auth/linkedin` (+ `/callback`) | start / finish OAuth | |
| `POST /auth/oauth/exchange` | one-time code → session or 2FA challenge | 10 / 15 min |

Full request/response shapes: [API_REFERENCE.md](API_REFERENCE.md).

## Error codes the client handles

| Code | Status | Meaning |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | wrong e-mail or password (deliberately indistinguishable) |
| `EMAIL_NOT_VERIFIED` | 403 | right password, address not verified: show the "resend" notice |
| `ACCOUNT_DEACTIVATED` | 401 | the account was deactivated |
| `EMAIL_EXISTS` | 409 | the address is registered and verified or in use |
| `PASSWORD_REQUIRED`, `VERIFY_PASSWORD_INVALID` | 400 | the verification link needs the registration password |
| `INVALID_TOKEN` | 400 | verification/reset link invalid, used or expired: offer a new one |
| `PASSWORD_ATTEMPTS_EXCEEDED` | 429 | too many wrong passwords for this account; wait 15 minutes |
| `INVALID_OTP`, `INVALID_2FA_SESSION` | 400 / 401 | wrong or expired second-factor code / challenge: restart the sign-in |
| `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_REUSED` | 401 | the session ended: sign in again |
| `ACCOUNT_PENDING_APPROVAL` | 403 | the registration is waiting for an administrator; nothing to do but wait for the e-mail |
| `ACCOUNT_REJECTED` | 403 | the registration was not approved; the reason was e-mailed |
| `RATE_LIMITED` | 429 | too many requests from this address |

## The browser side

* `src/middleware.ts` redirects visitors without the `aitd_session` hint cookie away from member pages
  (`/dashboard`, `/admin/*`, `/directory`, ...) to `/login?next=…`. The cookie is only a hint; **the API is the authority** and
  the member layout re-checks the session. Open pages are listed in `src/lib/public-paths.ts` (`/`, `/login`, `/register`,
  `/verify-email`, `/forgot-password`, `/reset-password` and the legal pages). **There are no public sections any more:** events, news,
  gallery, chapters, donations, search and shared post links all send a visitor to `/login?next=...`.
* After a registration there is **no redirect and no session**: the page shows "What happens next" (verify the e-mail, an
  administrator checks, you are told by e-mail). A sign-in refused with `ACCOUNT_PENDING_APPROVAL` / `ACCOUNT_REJECTED` shows a calm
  notice instead of an error (`/login?approval=pending|rejected` shows the same notice). If one of those codes comes back on a call of an
  existing session, the client ends the session and announces it through the `api:account_not_approved` event.
* `?next=` is honoured only for same-origin relative paths.
* Tokens are kept in `localStorage` by `auth-context`/`api.ts`. A strict CSP, URL allowlists and output encoding are the
  compensating controls until they move to httpOnly cookies.

## Settings

| Variable | Effect |
|---|---|
| `REQUIRE_EMAIL_VERIFICATION` | `true` / `false`; unset means **on in production, off elsewhere** |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | signing secrets; production refuses weak, short or identical ones |
| `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | token lifetimes |
| `SENDGRID_API_KEY` or `SMTP_*`, `EMAIL_FROM` | outbound mail (required in production while verification is on) |
| `GOOGLE_*`, `LINKEDIN_*` | OAuth clients and callback URLs |
| `TRUST_PROXY` | proxies in front of the API, so limits key on the real client address |
| `REDIS_URL` | shares the rate-limit counters between API processes |

Every other production setting is in [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md); the reasoning behind each rule and the
attacks it answers are in [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## Tests

`server/src/__tests__/services/authService*.test.ts` (rules), `server/tests/security/auth/` (the attacks, against a real
PostgreSQL: pre-hijacking, OAuth linking, token races, 2FA, password budgets), `server/tests/integration/auth-lifecycle.int.test.ts`
(end-to-end happy path), `client/src/app/(auth)/**/__tests__` (pages) and `client/src/__security__/` (gate and links).
