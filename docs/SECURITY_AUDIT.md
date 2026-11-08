# Security audit and hardening log

White-box audit of the AITD Alumni Network (server, client, Docker/CI), run as: **audit → attack with tests →
root-cause → fix (test-first) → re-test**. Every confirmed finding is a regression test that asserts the *secure*
behaviour, so the suites below are the proof that a fix holds and the guard against it coming back.

| Suite | Where | Run |
|---|---|---|
| Authorization (IDOR, privilege, races, visibility, mass assignment, JWT) | `server/tests/security/authz/` | `npm run test:security -w server` |
| Input handling (sanitizer, URL schemes, email HTML, uploads, secrets) | `server/tests/security/input/` | same |
| Auth, 2FA, passwords, payments, realtime, invites, GDPR | `server/tests/security/auth/` | same |
| Round 2: variants and incomplete fixes (sanitizer ReDoS, counter and quota races, limiter and path bypasses, upload limits, mail addresses, account lifecycle) | `server/tests/security/round2/`, `client/src/__security__/round2/` | same |
| Client (safe links, headers, route gating, token hygiene) | `client/src/__security__/`, `client/src/**/__tests__` | `npm test -w client` |

Severity is the practical impact in this app: **Critical** = takeover or data theft by anyone, **High** = serious
abuse by a signed-in member or a latent takeover, **Medium** = integrity/availability issues, **Low** = hardening.

## Round 1 findings

### Authorization and integrity

| ID | Sev | Finding | Root cause | Fix | Status |
|---|---|---|---|---|---|
| AZ-03 | High | Posts created with `visibility: "CONNECTIONS"` were stored as **PUBLIC**; reels (`videoUrl`, `isReel`), thumbnails and `mentionIds` were silently dropped on create | `createPostSchema` listed 4 fields and zod strips unknown keys, so the safer request was discarded without an error | Schema lists every field the service supports; media/link fields validated; regression tests for the whole class | Fixed |
| AZ-01 | Medium | Event capacity could be exceeded (6 concurrent RSVPs on a 1-seat event all succeeded) | Capacity read, then RSVP written in a later transaction (check-then-act) | One row-locked conditional `UPDATE ... WHERE rsvpCount < capacity` inside the RSVP transaction; duplicate/double-cancel safe | Fixed |
| AZ-02 | Medium | Mentor `maxMentees` exceeded by concurrent accepts (6 accepts for 1 seat) | Same check-then-act on a stale snapshot | Request claimed by conditional update, seat taken by guarded `UPDATE`; rolls back if full | Fixed |
| AZ-04 | Low | One connection request could be accepted several times concurrently, repeating notifications | Status read before an unconditional update | Conditional `updateMany(status: PENDING)`; only the winner notifies | Fixed |

Verified correct (attacks that were blocked and are now regression tests): role escalation and hierarchy,
cross-user IDOR on posts/comments/messages/notifications/connections/mentorship/marketplace/transactions/receipts,
JWT `alg:none`/wrong secret/expired/refresh-as-access, token revocation on password change and deactivation,
role read from the database (not the token), mass assignment on register/profile/events/jobs/chapters, `__proto__`
keys, CONNECTIONS-post visibility on every secondary path, chapter-admin scope.

### Input handling

| ID | Sev | Finding | Root cause | Fix | Status |
|---|---|---|---|---|---|
| IN-01 | High | Stored XSS: `java<TAB>script:alert(1)` accepted as a job `applicationLink` / post `linkUrl` and rendered as a link | Blocklist regex needed a contiguous `javascript`; browsers and `new URL` ignore tabs/newlines in URLs; no scheme allowlist on most URL fields; client rendered `href` unchecked | Allowlist helper (`utils/safeUrl.ts`: absolute http(s) only, no control chars, no credentials; media = own `/uploads/...` or http(s)) on **every** URL write path (create *and* PATCH: posts, jobs, events, news, chapters, messages); sanitizer normalises control characters; client `safeHref`/`safeMediaSrc` on every rendered link and image | Fixed |
| IN-02 | High | `Hi <img src=x onerror=alert(1)` (no closing `>`) survived the sanitizer byte for byte | Tag regex required a closing bracket | Unclosed tags carrying attributes are stripped (ordinary text with `<` is untouched) | Fixed |
| IN-03 | High | HTML injection in verification, welcome and invite emails (name interpolated raw; also in the `Subject` header) | `escapeEmailHtml` applied to 1 of 4 templates | Every interpolated value escaped; subject sanitised (no CR/LF/angle brackets); tokens URL-encoded | Fixed |
| IN-04 | High (latent) | Signing secrets fell back to published defaults (`default-secret-change-me`) outside production, so a forged admin token verifies offline on any box missing `.env` | `process.env.X \|\| 'literal'` | No default: random per-process secret outside production (with a warning), hard failure in production | Fixed |
| IN-05 | Medium | A `.gif` containing HTML/script was stored as-is; photos kept EXIF/GPS (members' locations leak) | Image check compared two attacker-controlled strings; GIFs skipped re-encoding | Every image is decoded and re-encoded with the real format taken from the bytes: proves it is an image, strips metadata, kills polyglots, 40-megapixel cap against pixel floods | Fixed |
| IN-06 | Low | Sanitizer skipped any field whose name ended in `code`/`token`/`secret`... | Suffix regex | Explicit allowlist of credential fields | Fixed |
| IN-07 | Low | Disallowed CORS origin returned HTTP 500 | Plain `Error` thrown from the CORS callback | Clean 403 `FORBIDDEN_ORIGIN` | Fixed |

Verified correct: parameterised raw SQL in nearby search, Prisma operator injection via nested query objects, CSV
formula injection, path traversal on `/uploads` (plain, encoded, double-encoded), helmet headers on the API
(CSP, HSTS, nosniff, frame-ancestors), video magic-byte checks, cursor limits, malformed JSON handling.

### Broken endpoints (client/server contract sweep)

A contract suite (`npm run test:contract -w server`, 779 tests) now reads every call the client makes, checks it
against the router (method, path, order, schema field survival) and drives all 197 routes with valid, invalid and
fuzzed input. It found functional breakage, not just security gaps:

| ID | Sev | What members saw | Root cause | Status |
|---|---|---|---|---|
| QA-02 | High | **The directory search box did nothing** (everyone returned) | Controller read `name`; the client sends `search` | Fixed |
| QA-10 | High | **Directory and Yearbook always showed "No alumni found"**; **the Network page's Requests tab was always empty, so connection requests could not be accepted** | Pages read `data.items` / `requester` / `avatarUrl`; the API returns `{data, pagination}`, a flattened user and `profilePhotoUrl` | Fixed (typed adapters in `client/src/lib/people.ts`, tested) |
| QA-01 | Medium | Editing a comment silently dropped its @mentions | `updateCommentSchema` lacked `mentionIds` (same class as AZ-03) | Fixed |
| QA-04 | High (data) | `PATCH /chapters/:id {name: ''}` stored a blank chapter name; wrong types gave 500 | Whitelist loops copied raw values | Fixed |
| QA-03, 05–09 | Medium/Low | NUL bytes in any `:id` (77 routes), foreign-key errors, wrong-typed fields on gallery/news/events, non-string payment fields, array/object query params, malformed `%` escapes all answered **500** | No input guards; no mapping for Prisma `P2003`/`P2000`; Express 4xx statuses ignored | Fixed: clean 400s (`INVALID_PATH`, `INVALID_REFERENCE`, ...) |
| QA-11 | Low | "You:" prefix never showed on sent messages | Client read a field the API does not send | Fixed |

### Authentication, payments, realtime, account lifecycle

| ID | Sev | Finding | Fix | Status |
|---|---|---|---|---|
| AU-01 | High | **Account pre-hijacking:** login does not need a verified e-mail, so an attacker could register a victim's address with their own password; when the victim later signed in with Google/LinkedIn the provider was linked to that row and the attacker's password and sessions survived | Linking to an account whose e-mail was never verified now marks it verified, **clears the password hash, bumps `tokenVersion`, deletes refresh/verification tokens and disconnects sockets** | Fixed |
| AU-05 | Medium | 2FA code attempt limit was count-then-check, so a burst of 40 parallel guesses was all evaluated | The attempt is reserved (a row is written) *before* the code is compared: at most 5 guesses are ever evaluated | Fixed |
| AU-03 | Medium | An invalid checkout signature marked any non-successful donation/membership as FAILED; a refunded payment could be re-completed by replaying its original valid signature | Only a PENDING transaction can be failed; refunded ones answer 400 / 409 | Fixed |
| AU-04 | Medium | `POST /auth/2fa/disable` needed only a bearer token: a stolen access token could remove the second factor | Account password required (400 `PASSWORD_REQUIRED` / 401 `INVALID_PASSWORD`) | Fixed |
| AU-12 | Medium | Re-entering the password (change password, delete account, disable 2FA) was throttled per IP only | Shared per-account budget: 5 wrong guesses per 15 minutes, then 429 even for the right password | Fixed |
| AU-02 | Medium | Google/LinkedIn OAuth sent no `state`: login CSRF (victim's browser signed into the attacker's account) | Random per-flow `state`, pinned in an HttpOnly SameSite cookie, compared in constant time, single-use | Fixed |
| AU-07 | Medium | Blocked users could still message; unlimited message requests to strangers | Block honoured in both directions (403); 20 new message requests per day | Fixed |
| AU-09 | Medium | Invite endpoints were a spam relay from the platform's sender address (no quota, no length caps) | 100 invites/day, name and message length caps, bulk refused up front if over quota | Fixed |
| AU-08 | Low | Typing events went to any user id; unlimited room joins | Relayed only between non-blocked, connected users; 20 events / 10 s per socket; max 50 rooms | Fixed |
| AU-06 | Low | bcrypt silently ignores bytes past 72; no common-password check; unbounded login attempt length | Reject over 72 bytes; breached-password and "password equals e-mail" checks; 1,024-character cap on attempts | Fixed |
| AU-10 / AU-11 | Low | Account deletion left follows, saved posts, sent invites (third-party e-mails); data export lacked them and included a gateway signature | Deleted in the same transaction; export completed, signature stripped | Fixed |
| SR-01 | **High** | **Search ignored post visibility:** CONNECTIONS-only posts were findable by anyone | Post search uses the same visibility rules as the feed; regression test on real Postgres | Fixed |
| SR-02 | Medium | Search required an account but expired tokens silently fell back to anonymous elsewhere | New `authenticateIfPresent`: no header = visitor, but a presented token must be valid (401 so the client refreshes) | Fixed |
| OP-04 | Medium | No limits on guest donation orders, invites, 2FA, uploads, search beyond one global budget | Per-endpoint budgets (20 / 30 / 10 / 30 / 100 per 15 min) | Fixed |
| OP-05 | Medium | Rate limits trusted `X-Forwarded-For` blindly (`trust proxy` hard-coded to 1) and the Docker API port was public: limits dodged by rotating a header | `TRUST_PROXY` setting (0, N hops, or subnets; refuses `true`/`*`); API container bound to `127.0.0.1` by default | Fixed |
| OP-06 | Medium | Donation receipts (donor name and amount) were publicly fetchable under `/uploads/receipts/` (and `public-read` on S3) | Not served statically (404 in any spelling); private ACL in S3; the authenticated endpoint is the only way | Fixed |
| OP-07 | High | The Next.js image optimizer was an **open proxy** (`remotePatterns: **`) and a large share of Next's CVE surface | Optimizer disabled (uploads are already re-encoded and capped by the API) | Fixed |

Verified correct: constant-time login (dummy hash for unknown e-mails), pinned JWT algorithm and separate secrets per
token type, hashed/rotating/family-revoked refresh tokens, 256-bit single-use hashed verification and reset tokens,
OTP via `crypto.randomInt`, server-side payment amounts, HMAC webhook over the raw body with `timingSafeEqual`, order
ownership, receipt access control, socket handshake and room authorization, escaped invite HTML.

### Web app (client)

| ID | Sev | Finding | Fix | Status |
|---|---|---|---|---|
| CL-01 | Medium | **Member pages were served to anyone** (HTTP 200 shell and JS chunks for `/dashboard` etc.); the only guard was a client-side redirect after load | `middleware.ts` redirects anonymous requests for any member-only path (fail-closed: everything not explicitly public, all of `/admin/**`) to `/login?next=`; a test scans the app directory so a new page cannot be forgotten; admin pages additionally render nothing for non-admins. *The API remains the authority; the session cookie is a non-secret hint.* | Fixed |
| CL-02 | Medium | No CSP, `X-Frame-Options`, `Referrer-Policy` or `Permissions-Policy` on the web app (clickjacking, no XSS backstop) | Headers in `next.config.js` (CSP derived from env, frame-ancestors none, nosniff, referrer policy, permissions policy, HSTS in production); OAuth hand-off page gets `no-referrer` and strips its one-time code from the URL immediately | Fixed |
| CL-03 | Low | Landing page linked anonymous visitors straight to members-only pages | Links now go through explicit sign-in with a "Members" label | Fixed |
| CL-04 | Low | Left-side "Shortcuts" duplicated the header navigation | Removed; two-column feed layout | Fixed |
| CL-05 | Medium | Access and refresh tokens live in `localStorage` (readable by any XSS) | Mitigated: strict CSP, URL allowlists, output encoding, token-hygiene guard test. **Open (design change):** move to httpOnly cookies with CSRF protection | Mitigated |

### Supply chain and operations

| ID | Sev | Finding | Status |
|---|---|---|---|
| OP-01 | High | **A production database password was committed** in `DEPLOYMENT_CHECKLIST.md` / `DEPLOYMENT_VERIFICATION.md` (visible in git history) | Removed from files; **you must rotate that password and treat the old one as public** |
| OP-02 | High | 28 known dependency vulnerabilities in each of server and client, including reachable ones: `sharp`/libvips (every image decode), `socket.io`/`engine.io`/`ws` DoS, `body-parser` DoS, `proxy-addr` IP spoofing, `nodemailer`, `axios`, and **Next.js 14.2.10, which had a critical middleware authorization bypass** | **Server 28 → 10, none critical** (what remains is lint tooling that never ships, plus `zod`, mitigated by array/body bounds). Upgraded `next` → 14.2.35 (closes the middleware bypass and the 14.x DoS/SSRF issues), `sharp` → 0.35.5, `nodemailer` → 10.4, plus every non-breaking transitive fix. **Open:** newer Next advisories need the major upgrade to 15.5.x/16 (see below) |
| OP-03 | Info | No secrets matching common key formats in tracked files | Verified |

## Needs a decision or a planned change

> **Update 2026-11-08: decided and, where possible, done.** The product owner delegated these decisions; each was taken in
> favour of the safer option that still behaves like a normal website. The outcome of each item is marked **[DONE]**,
> **[GATE]** (engineering work that must finish before a public launch) or **[KEPT]**. The full reasoning, costs and revisit
> triggers are in [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md#6-security-decisions-taken-and-what-they-cost).

1. **[GATE]** **Upgrade Next.js 14 → 15.5.x or 16** (React 19, App Router changes). The remaining critical/high advisories on the client are fixed only there. Interim mitigations already in place: image optimizer off, no Server Actions in the app, strict CSP, the API (not Next) holds all data and authorization. Plan this as its own change with a staging soak.
2. **[GATE]** **Move tokens out of `localStorage`** into httpOnly cookies with CSRF protection (CL-05). Today any XSS could read them; the CSP, URL allowlists and output encoding are the compensating controls.
3. **[DONE]** **Rate limiter store:** shared through Redis when `REDIS_URL` is set (`utils/redisRateLimitStore.ts`, tested with two app instances; falls back to per-process counting if Redis is down). limits are per process and the PM2 config runs one process per CPU, so effective limits are multiplied by the core count. Use a Redis store (the stack already runs Redis).
4. **[DONE, no lockout]** **Login lockout / enumeration:** decided against an account lockout (it would let anyone lock out any alumnus); layered limits instead: nginx 5 req/s per address on `/api/auth/*`, 10 sign-in attempts per 15 minutes per address (shared through Redis), per-account budgets on every other password check. CAPTCHA/WAF is a go-live item. Original note: no per-account throttle on login (a hard lockout would let anyone lock out any alumnus); registration answers "e-mail exists". Options: CAPTCHA or progressive delay; generic message plus an e-mailed notice. Both change user experience, so this is your call.
5. **[DONE]** **E-mail verification policy:** required in production (`REQUIRE_EMAIL_VERIFICATION`), the link needs the registration password, an unverified registration is replaced by the next one for that address, resend is rate-limited and enumeration-free; also fixes the missing `/verify-email` page. Original note: login works before the e-mail is verified (AU-01 closes the takeover this enabled). Decide whether to require verification for a session.
6. **[DONE]** **OAuth bypassed the app's e-mail OTP** for accounts with 2FA on. Now fixed: the exchange returns the same 2FA challenge as a password sign-in.
7. **[KEPT]** **Account deletion keeps** messages sent, reactions, chapter/event memberships and anonymised audit entries; stored files (photos) are not purged from storage.
8. **[DONE]** **Smaller items:** access tokens now last 15 minutes in production (were 24 h), which bounds the two items that remain true: single-device logout does not revoke the access token, and open sockets outlive token expiry. Also still open: `getConversations` loads all messages into memory; the password schema allows 128 characters while bcrypt uses 72 bytes (the service rejects the excess with a clear code).

### Decisions implemented (after round 1, before round 2)

| Item | Change | Where | Tests |
|---|---|---|---|
| E-mail verification before a session | `login` answers `403 EMAIL_NOT_VERIFIED` once the password is proven; OAuth accounts (`emailVerifiedAt`) pass | `authService.login`, `config.auth.requireEmailVerification` | `authService.verification.test.ts`, `email-verification.sec.test.ts` |
| Pre-hijacking through the verify link | the link needs the registration password (`PASSWORD_REQUIRED`, `VERIFY_PASSWORD_INVALID`, counted by the per-account budget); a registration over an unverified account that was never signed in to replaces it (old password, sessions and links die); an unverified account that has been used is never replaced, so a stranger cannot lock out a member who predates the policy | `authService.verifyEmail`, `register` | same, incl. the legacy-member case against the real database |
| Missing verification page | `/verify-email` (the e-mail linked to a page that did not exist), resend flow, login notice, open in the edge gate | `client/src/app/(auth)/verify-email`, `login/page.tsx`, `public-paths.ts` | `verify-email.test.tsx`, `login-verification.test.tsx`, `route-access.test.ts` |
| Resend verification | `POST /auth/resend-verification`: identical answer for every address, one mail per account per minute, limited per address | `authService.resendVerification`, `app.ts` | unit + security + RBAC matrix + contract |
| OAuth skipped 2FA | exchange returns the 2FA challenge (and the e-mailed code) for members with 2FA on; the login page handles the challenge | `authService.exchangeOAuthCode`, `authController` | unit + security + `login-verification.test.tsx` |
| Shared rate limits | Redis-backed store, one key prefix per limiter, per-process fallback | `utils/redisRateLimitStore.ts`, `app.ts` | `redisRateLimitStore.test.ts`, `tests/app/rateLimitRedis.test.ts` |
| Short access tokens | `15m` default in production | `config/index.ts` | `configDefaults.test.ts` |
| Unsafe production configuration | the API refuses to start (weak/leaked secrets, empty or default DB password, rate limiting off, http/localhost origins, no mail server while verification is required, sample data on) | `config/productionChecks.ts`, `index.ts` | `productionChecks.test.ts` |
| Defaults left in the database | `npm run preflight` finds demo accounts, privileged accounts with published passwords and a missing super admin | `config/databaseChecks.ts`, `scripts/preflight.ts` | `databaseChecks.test.ts` |
| Backups | `backup-db.sh` was still the MySQL script with a hardcoded host address; now PostgreSQL, atomic, verified | `backup-db.sh` | run against PostgreSQL (success and failure paths) |
| Proxy | request-rate limit on `/api/auth/*`, slow-client timeouts, no dotfiles | `nginx/nginx.conf` | not run through `nginx -t` here (no nginx/Docker on the development machine) |
| Post-deploy check | `npm run verify:deploy`: read-only checks of headers, gating, CORS, receipts, rate-limit headers | `scripts/verify-deployment.mjs` | run against the local stack |

Round 2 re-ran every suite above against the fixed code, then looked for *incomplete fixes*: variants of each payload
(other control characters, encodings, other fields and routes that take the same input), other places with the same
root cause (every schema vs. service field mismatch; every check-then-act capacity), and the new surface the fixes
add (middleware gating, public search, proxy settings).

**Verdict:** the round 1 fixes held for every payload class they targeted, but 27 further defects turned up, most of
them *in or next to the round 1 fixes themselves*. Two were High. The pattern is worth remembering: a fix that adds a
new regex, a new limiter or a new matcher adds new attack surface, and each of those three was bypassed or abused.

### What round 2 found and fixed

| ID | Sev | Where | Variant / payload | Impact | Fix |
|---|---|---|---|---|---|
| R2-01 | **High** | `sanitizeInput.ts`, `app.ts` body limit | `'<script '` x 60,000 took 25 s; `'<img <b>' + '='.repeat(32000) + '>'` took 2 s (round 1's new unclosed-tag regex) | `sanitizeInput` runs on every request before auth, so one anonymous request could block the event loop (ReDoS). A 10 MB body: hours | Block elements are stripped by a linear scanner; the unclosed-tag rule matches a run once and decides in a callback; JSON/urlencoded body limit 10 MB to 1 MB. Adversarial 10 MB strings now sanitise in at most 350 ms |
| R2-02 | Medium | `sanitizeInput.ts` | `JavaScript Developer` became `Developer`; `VBScript to Python` became `to Python` (the colon was optional) | Job titles and posts starting with those words were silently cut | The `:` is part of the scheme; stacked schemes are stripped in a capped loop (a repeated regex group overflowed V8's stack on a megabyte of `javascript:`) |
| R2-03 | Low | `sanitizeInput.ts` | `<div onmouseover=alert(1)`, `<x/onclick=`: the unclosed-tag allow-list knew only 36 element names | Event handler survived storage (inert today: React and e-mails escape output) | An `on*=` attribute is stripped on any element; `a<b and c=d` is untouched |
| R2-04 | Low | `sanitizeInput.ts` | `<scr<b></b>ipt>alert(1)</scr<b></b>ipt>` stored as `<script>`; `on<b></b>error=` reassembled | Single-pass stripping rebuilt the tags it had just removed | Stripping repeats until stable (8 passes); if still nested, any `<` before a letter is dropped |
| R2-05 | Medium | `messageService.ts` | 30 parallel message requests to 30 strangers: all 30 stored (cap 20); 6 parallel to one stranger: 6 pending requests | Message-request cap and one-pending rule were check-then-act | Per-sender advisory lock around count, check and insert |
| R2-06 | Medium | `inviteService.ts` | 3 parallel bulk invites of 50: 102 created (cap 100); 8 parallel invites to one address: 8 rows and 8 e-mails | Daily quota and the 7-day "already invited" rule were not atomic; the platform could be made to mail-bomb one address | Per-inviter advisory lock; bulk reports leftover rows as failed if the quota runs out meanwhile |
| R2-07 | Medium | `inviteService.ts` | `a@b.com,c.d`, `Victim<v@x.com>.a`, `a(x)@b.com`, `evil@x.com;bcc.d` passed `EMAIL_RE` | nodemailer read them as two recipients or as `v@x.com`; the "already registered/invited" checks looked at the odd string and were bypassed | WHATWG e-mail grammar (ASCII); `acceptInvite` no longer treats `null === null` as an e-mail match |
| R2-08 | Medium | `socialShared.ts` (`lockPostRow`, `lockCommentRow`), reaction/post/repost services | 8 users react at once: `likeCount` = 1. Same for `commentCount`, `repostCount`, comment `likeCount` | Counters recounted in a READ COMMITTED transaction overwrite each other; visible numbers and feed ranking were wrong | `FOR UPDATE` on the post/comment row as the first statement of each such transaction (taking it after the insert deadlocks) |
| R2-09 | Low | `networkService.ts` | A to B and B to A at the same moment created two PENDING rows (unique index is on the ordered pair) | Duplicate connection requests | Advisory lock on the unordered pair |
| R2-10 | Low | `membershipService.ts` | 3 different paid orders completing at once left 3 ACTIVE memberships | Supersede-then-insert race | `User` row `FOR UPDATE` first in the transaction |
| R2-11 | Low | `utils/helpers.ts` (`ilike`) | `q=%%`, `__`, `%_%` matched every row; `snake_case` matched `snakeXcase` | Prisma `contains` does not escape LIKE wildcards (raw SQL in `userService` already did) | `escapeLikePattern` applied in `ilike` |
| R2-12 | Medium | `marketplaceService.ts`, `validators.ts` | Marketplace `website`: `https://paypal.com@evil.example/login`, control characters, 2 KB URLs | The only URL field not using `safeUrl` | Service and schema use `isSafeHttpUrl` |
| R2-13 | Medium | `routes/index.ts` (5 upload routes) | Gallery caption sent as a multipart field stored raw (`<script>`, `<img onerror>`); a NUL byte gave a 500 and orphaned the photo | Multer parses text fields after the global `sanitizeInput` ran | `sanitizeInput` re-run after multer on all 5 upload routes |
| R2-14 | **High** | `app.ts` | After the login limit (10 per 15 min) was spent, `POST /api//auth/login` still reached the handler | `app.use('/api', router)` also matches `/api//...`, but per-endpoint limiters are mounted on exact paths. Login, register, forgot/reset password, verify-2fa, donations/order, invites, uploads and search budgets were all bypassable (ran at the general 300 per 15 min) | `//` collapsed in `req.url` and `req.originalUrl` before anything else |
| R2-15 | Medium | `app.ts` (`isReceiptsPath`) | `/uploads/x/../receipts/<file>`, `/uploads/x/%2e%2e/receipts/<file>`; on Windows `/uploads/%5Creceipts%5C<file>` | OP-06's block only checked the first segment but the static handler normalises `..` afterwards (file names are unguessable UUIDs, so a known URL was needed) | Normalise like `send` does (decode, `\` to `/`, `posix.normalize`), then deny any segment equal to `receipts` (ignoring case, trailing dots/spaces, `:stream`). 22 spellings tested |
| R2-16 | Medium | `app.ts` | `/api/payments/webhook/` is exempt from every limiter, unauthenticated until the HMAC is checked, and accepted 10 MB bodies that were parsed and sanitised | An unlimited large-body channel | Own budget (1,500 per 15 min per IP) and a 256 KB body limit |
| R2-17 | Medium | `utils/storage.ts` | Multipart bodies with 300 text fields or one 200 KB field were accepted | Any member could pin memory (multer buffers every text field) | `MULTIPART_TEXT_LIMITS = { fields: 10, fieldSize: 16 KB, parts: 30 }` on both uploaders |
| R2-18 | Low | `privacyService.ts` | After "delete my account" the audit log still held the IP and user agent | Round 1 called these entries "anonymised"; they were not | IP and user agent nulled on earlier entries; the DELETE entry carries no request metadata |
| R2-19 | Low | `privacyService.ts` | Data export omitted reactions, comment reactions, reports filed, gallery uploads, events created and the member's audit entries | Incomplete GDPR export | Added as new keys (existing keys unchanged) |
| R2-20 | Low | `config/passport.ts` | Google/LinkedIn `displayName` of `<img src=x onerror=...>Mallory` (or 5,000 chars) stored as `fullName`; provider photo URL unchecked | OAuth data never passes the request sanitiser | `sanitizeValue` plus a 100-character cap; photo must pass `isSafeHttpUrl` |
| R2-21 | Low | `utils/trustProxy.ts` | `TRUST_PROXY=0.0.0.0/00`, `::0/0`, `0.0.0.0/1,128.0.0.0/1` (trust-everything ranges) passed round 1's guard | Operator-config footgun that re-enables `X-Forwarded-For` spoofing of every limit | Prefix must be at least /8 (IPv4) or /7 (IPv6) and within the family maximum |
| R2-22 | Medium | `client/src/middleware.ts` | `/profile/x.png`, `/jobs/42.xml`, `/admin/users/x.png`: the matcher skipped any path ending in a file extension | Dynamic member pages accept any last segment, so the CL-01 gate was bypassed (anonymous visitors got the app shell) | Skip only root-level files plus `/.well-known/`, `/_next/`, `api/`; verified by compiling the matcher with Next's own `path-to-regexp` |
| R2-23 | Low | `client/src/lib/public-paths.ts` (`getSafeNextPath`) | `?next=/.//evil.example/x`, `/a/..//evil.example`, `/%2e//evil.example` accepted | The URL parser collapses dot segments into `//evil.example`, which `router.push` hands to `pushState` as a cross-origin URL (it throws and breaks post-login navigation rather than redirecting off-site) | Resolve against a dummy origin; reject if the origin changes or the path starts with `//` |
| R2-24 | Low | `client/src/lib/safe-url.ts` | `safeMediaSrc('/uploads/%2e%2e/api/auth/me')`, `safeInternalPath('/.//evil.example')` allowed | Encoded dot segments reach arbitrary same-origin GETs via `<img>` | Same URL-resolution check; `%2e`, `%2f`, `%5c` rejected in media paths |
| R2-25 | Low | `client/src/app/(main)/profile/[id]/page.tsx` | Server-side `fetch(`${API}/users/${id}`)` with the decoded segment: `..%2F..%2Fadmin%2Fexport`, `x?role=ADMIN` | Path/query injection on the API origin (anonymous call, so only public endpoints reachable) | `encodeURIComponent(id)` |
| R2-26 | Low | `server/src/utils/safeUrl.ts` | `http://good.com\@evil.com`, `https://good.com/a\b` accepted | WHATWG parsers read `\` as `/`, others do not: a parser-confusion URL | Backslash rejected anywhere in an http(s) URL |
| R2-27 | Medium | `app.ts` (slash collapse, found while re-verifying R2-14) | Absolute-form request target: `POST http://host/api//auth/login HTTP/1.1` after the login budget was spent returned 401 (handler reached) instead of 429 | Node passes an absolute-form target to Express unchanged, so `req.url` does not start with `/` and R2-14's collapse skipped it: the same limiter bypass, one request-line spelling later | The `scheme://authority` prefix is kept as is and only the path behind it is collapsed. (Removing the prefix instead breaks Express: the router measures it once and slices `req.url` by that length, so every mounted path 404s.) Test: `request-target.sec.test.ts`, which talks to a real listener over a raw socket because supertest cannot send this request line |

Every row has a regression test (`server/tests/security/round2/*.sec.test.ts`, `client/src/__security__/round2/`).
The tests for the defect classes (connection race, bulk invites, same-address invites and the other race/limit tests)
were confirmed to **fail without their fix**. The single-invite burst test passes even with the lock removed
(supertest does not make those requests truly concurrent); it stays as regression coverage.

### Round 1 fixes that held up when re-attacked

* **URL writes:** all 17 hostile link values and 23 media values were refused on create and update of events, jobs,
  news, chapters, gallery covers and photos, posts, messages and profile links (fullwidth and percent-encoded schemes,
  HTML entities, BOM, control characters, `https:\\evil`, userinfo, 2,049-character URLs, mixed-case `/UPLOADS/`).
  Notification links are built from `clientLinks` with encoded ids.
* **Sanitizer:** query and params handling, `[x](javascript:...)` text and `&#x6A;` entities (the client never renders
  markdown or raw HTML, so they are inert). The NUL-path guard returns 400; unicode, emoji and encoded slugs still
  get a clean 404. Socket handlers only relay ids.
* **Races:** exactly one winner under a `Promise.all` burst for e-mail verification, password reset, refresh-token
  rotation (the family is not revoked on a lost race), 2FA code, direct invite accept and a shared invite link used by
  several members, the double webhook plus verify path, the refunded-then-replayed webhook, the amount-mismatch
  webhook and a single membership order. Chapter join/leave, follows, post views and the view counters were already atomic.
* **Public search and limits:** visitors only see public events, published news and active chapters (draft,
  cancelled, past, members-only and inactive items are all hidden). Members never see unverified or deactivated
  people, hidden posts or non-approved jobs. Expired, forged, `alg:none`, ghost-user, deactivated and revoked tokens
  all give 401 and never fall back quietly to the visitor view. Limiters cannot be dodged by case, trailing slash,
  query string, `%6f`, `%2f`, `;x=1`, `/./`, `/../`, `%00` or method-override headers (the doubled slash in R2-14 was
  the one gap). Rotating `X-Forwarded-For` does not help when `TRUST_PROXY=0`. Static `/uploads` serves no dotfiles
  or directory indexes.
* **Auth:** the password-attempt budget is per authenticated account and 2FA guesses do not spend it; the 72-byte
  boundary holds; OAuth e-mail matching is case-insensitive but never merges across plus-tags or dots; unverified
  provider e-mails are refused; a deactivated account's exchange code is refused and a code works once. A schema scan
  forces a decision for every model that references a user on account deletion.
* **Client:** hostile search data (`javascript:` slugs, `../`, avatar URLs) creates no script-capable link or image;
  a stale search cannot overwrite a newer one; every other spelling of a member path is redirected (uppercase, `//`,
  `..`, `%2e%2e`, backslash, `;`); a malformed hint cookie does not open the gate. The CSP has no `*` and no extra origins.
* **E-mail:** registration, forgot-password and guest-donation addresses are strict (58 injection cases refused).
  Only the invite validator was loose (R2-07).

### Open items round 2 did not change

| Item | Why it is open |
|---|---|
| **Pre-hijack via the verify-email link:** an attacker registers the victim's address with their own password; if the victim clicks the verification mail, the account becomes verified and the attacker's password and sessions survive | AU-01 only covers OAuth linking. Closing it means requiring verification before a session (decision 5 above) |
| Notification spam: follow/unfollow and react/unreact loops notify each time `isNew` is true | Only the global rate limit applies; a per-pair notification cooldown is a product decision |
| Tag stripping removes content such as `List<String>` or `if (a<b && c>d)` in any text field | Round 1 design (strip rather than encode); encoding on output would fix it but touches every renderer |
| 56 `api.*` calls in `client/src/lib/api.ts` interpolate ids without `encodeURIComponent` | Each mutating call appends a fixed suffix (`/follow`, `/rsvp`), so no escalation found; worth a lint rule |
| Password policy: about 50 deny-listed entries, no NFKC normalisation | Policy decision |
| `userAddPhoto` stores the file before validating the caption | A late validation failure leaves an orphan file |
| CSP: `script-src 'unsafe-inline'` and `img-src https:` remain; `media-src` blocks external video URLs even though the server allows them | Needs nonce support (part of the Next upgrade) |
| LinkedIn OAuth scopes (`openid profile email`) look incompatible with `passport-linkedin-oauth2` v2, which only reads e-mail with `r_emailaddress` | Could not be tested live |
| `sharp` is listed in both `client/package.json` and `server/package.json` | The client sets `images.unoptimized: true`, so it probably does not need it |

### Behaviour changes to be aware of

* JSON and urlencoded request bodies are capped at **1 MB** (was 10 MB). Uploads are unaffected.
* Upload routes accept at most **10 text fields** (16 KB each).
* `/api//...` now routes as `/api/...`.
* The payments webhook accepts at most 256 KB.

## Test results (after round 2 and the production decisions)

| Suite | Command | Result |
|---|---|---|
| Server unit | `npm test -w server` | 90 suites, 3,334 tests |
| Server security (real PostgreSQL) | `npm run test:security -w server` | 31 suites, 394 tests (89 from round 1, 297 in `tests/security/round2/`, 8 for e-mail verification and OAuth 2FA) |
| Server integration (real PostgreSQL) | `npm run test:integration -w server` | 5 suites, 36 tests |
| Client/server contract | `npm run test:contract -w server` | 5 suites, 782 tests |
| Client (vitest) | `npm test -w client` | 85 files, 968 tests (151 in `src/__security__/`) |
| Type checks | server `tsc -p tsconfig.test.json`, client `tsc --noEmit` | clean |
| Lint | server eslint, client `next lint` | 0 errors |

The suites are the regression guard: every finding above has at least one test that fails without its fix.
