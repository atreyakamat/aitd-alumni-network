# Documentation

Start with the row that matches what you are doing. **Current** documents are kept in step with the code (several are checked
by tests); **historical** ones are kept for context only.

## I want to...

| ...so read | It covers |
|---|---|
| Run the app on my machine | [GETTING_STARTED.md](GETTING_STARTED.md): install, embedded PostgreSQL (no Docker), seed, first sign-in |
| Understand how it fits together | [ARCHITECTURE.md](ARCHITECTURE.md): request pipeline, auth, data model, search, real-time, payments, maps, lifecycle |
| Understand sign-in, sessions, e-mail verification and the administrator's approval of registrations | [AUTHENTICATION.md](AUTHENTICATION.md): flows, token lifetimes, error codes, settings |
| Run or debug notifications (Kafka, the e-mails to the college administrator) | [KAFKA.md](KAFKA.md): events, settings, what happens when the broker or the mail server fails |
| Call or change the API | [API_REFERENCE.md](API_REFERENCE.md) (generated from the router: `npm run docs:api`) and [SOCIAL_API.md](SOCIAL_API.md) for the social layer |
| Write or run tests | [TESTING.md](TESTING.md): the test layers, TDD loop, how to add an endpoint |
| Put it on a server | **[PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) first**, then [DOCKER.md](DOCKER.md) |
| See how it behaves when things go wrong, and what is still open | [ROBUSTNESS.md](ROBUSTNESS.md): timeouts, retries, logging and request ids, error boundaries, the backlog |
| See what was audited and fixed | [SECURITY_AUDIT.md](SECURITY_AUDIT.md): every finding, the fix and its test; two rounds; the decisions taken |
| See what is built | [FEATURE_STATUS.md](FEATURE_STATUS.md) and the overview in [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) |

## Current

| Document | Status | Notes |
|---|---|---|
| [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) | current | Every setting that must change for production, decisions taken, launch gates |
| [AUTHENTICATION.md](AUTHENTICATION.md) | current | |
| [ROBUSTNESS.md](ROBUSTNESS.md) | current | What was hardened for reliability, how to operate it, the open backlog |
| [KAFKA.md](KAFKA.md) | current | Notification events through Kafka, the registration e-mails, failure handling |
| [ARCHITECTURE.md](ARCHITECTURE.md) | current | |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | current | Round 1, round 2, decisions implemented, test results |
| [DOCKER.md](DOCKER.md) | current | Compose services, configuration, backups, upgrades, migrating old MySQL data |
| [TESTING.md](TESTING.md) | current | |
| [API_REFERENCE.md](API_REFERENCE.md) | generated | `tests/docs/api-reference.test.ts` fails when it is stale |
| [SOCIAL_API.md](SOCIAL_API.md) | current | Contract of the social layer (posts, reactions, comments, reposts, follows, reports) |
| [FEATURE_STATUS.md](FEATURE_STATUS.md) | current | What is implemented, deploy notes, known follow-ups |
| [GETTING_STARTED.md](GETTING_STARTED.md) | current | |
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | current | Overview; the architecture and security details are in the documents above |

## Historical (kept for context, do not follow for configuration)

| Document | Why |
|---|---|
| [API_TEST_REPORT.md](API_TEST_REPORT.md), [SYSTEM_AUDIT_REPORT.md](SYSTEM_AUDIT_REPORT.md), [FALLBACK_DNS_FIX_REPORT.md](FALLBACK_DNS_FIX_REPORT.md) | Point-in-time reports from April 2026, before the PostgreSQL migration and the security audits |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | April 2026 troubleshooting note about an `ERR_NAME_NOT_RESOLVED` error in production |
| `../DEPLOYMENT*.md`, `../EXTENSIVE_DEPLOYMENT_GUIDE.md`, `../PRODUCTION_READY.md`, `../FINAL_DEPLOYMENT_READINESS.md` | The old MySQL shared-host deployment. Each carries a "superseded" banner pointing here |
| `../AlumniConnect_PRD_v1.0.md`, `../Design.md`, `../Alumni Connect Tech Stack.md` | Product requirements and the original design and stack documents (April 2026): the intent, not the current configuration |
| `../API_TESTING_AND_IMPROVEMENTS.md`, `../FEATURE_DEVELOPMENT_TEMPLATE.md`, `../ACCESS_GUIDE.md` | May and earlier working notes |

## Keeping the documentation true

* Adding an endpoint: add it to the RBAC matrix, then run `npm run docs:api -w server`; tests fail while either is stale.
* Changing a setting: update the table in [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) and `.env.docker.example`; if the
  start-up guard should enforce it, add the rule to `server/src/config/productionChecks.ts` with a test.
* Fixing a security problem: add a regression test under `server/tests/security/` and a row in [SECURITY_AUDIT.md](SECURITY_AUDIT.md).
* What changed between releases: [../CHANGELOG.md](../CHANGELOG.md).
