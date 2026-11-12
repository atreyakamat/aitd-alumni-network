# Staging: a rehearsal stack before production

A staging stack is the same Docker Compose stack as production, on its own host (or its own Compose project), with its own
secrets and its own data. Everything risky is tried there first: a new release, a schema migration, a settings change, a
restore of a backup. **Nothing on staging is real:** no real members, no live payment keys, no mail to real addresses.

## 1. What must be different from production

| Thing | Staging | Why |
|---|---|---|
| Host / domain | its own, e.g. `staging.alumni.example.edu` (a label such as `staging` makes the stack recognisable) | A mistake never touches production traffic or cookies |
| `.env` | its own file with **new** secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`, `SEED_ADMIN_PASSWORD`, `METRICS_TOKEN`) | A leaked staging secret must not open production |
| Database | its own PostgreSQL volume, **never** a connection to the production database | Tests create and delete data |
| Payments | Razorpay **test** keys (`rzp_test_...`) | No real money moves; the production check refuses live keys only when you ask for the trial waiver, so keep them test keys by habit |
| Mail | a mail catcher (Mailpit) or an SMTP account that only delivers to a short allow-list | No test mail reaches real alumni |
| Settings | the **same security settings as production** (`REQUIRE_EMAIL_VERIFICATION`, `REQUIRE_ADMIN_2FA`, https origins, `TRUST_PROXY`) | A staging stack that is more relaxed proves nothing |
| Data | seeded demo data or a **scrubbed** copy of production (names, e-mail addresses and messages replaced), never a raw copy | Member data stays private ([PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md), privacy) |
| Access | behind a basic-auth or IP allow-list in front of nginx | Search engines and strangers do not need it |

## 2. Bring it up

```bash
git clone <repository> aiem-staging && cd aiem-staging
cp .env.docker.example .env        # then fill in the staging values from the table above
npm run preflight -w server -- --env-file ../.env     # the same start-up guard production uses
docker compose -p aiem-staging up -d --build
docker compose -p aiem-staging ps                      # wait until api and web are healthy
```

`-p aiem-staging` keeps its containers, network and volumes apart from any other stack on the same machine. To remove it
completely (including its data): `docker compose -p aiem-staging down -v`.

## 3. The release rehearsal (every release, in this order)

1. **Merge to `main` only after CI is green** ([GITHUB_SETUP.md](GITHUB_SETUP.md)): unit, integration, security, contract, client, scripts, end-to-end.
2. **Deploy the release candidate to staging** (`git pull`, `docker compose -p aiem-staging up -d --build`). The API container runs
   `prisma migrate deploy` itself, so this also rehearses the migration against staging data.
3. **Prove the stack:** `npm run docker:verify` on the staging host builds its own throw-away stack (Compose project `aiem-verify`, with a mail catcher, so it proves
   this commit rather than the running staging containers) and runs every gate (stack, Kafka, mail, drills, admin, web), writing the evidence bundle ([DOCKER_TEST_GUIDE.md](DOCKER_TEST_GUIDE.md)). To test an already-running staging stack from your own machine
   instead, use attach mode (HTTP gates only): `npm run docker:verify -- --attach <api url> ...`.
4. **Run the browser tests against it:** `E2E_BASE_URL=https://staging... E2E_API_URL=https://staging.../api npm run e2e`
   ([TESTING.md](TESTING.md#end-to-end-tests-browser)). The member journey registers one throw-away member: that is fine on staging, never on production.
5. **Rehearse the backup:** `./backup-db.sh`, restore the dump into a scratch database and compare row counts. The verification suite
   does this automatically (gate D08); do it by hand after every schema change.
6. **Look at the monitoring** ([PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md), "Monitoring"): `GET /metrics` with the staging token, and
   `docker compose -p aiem-staging exec api node dist/scripts/dlq.js list` for dead letters.
7. **Only then deploy to production**, the same commit, the same way. Keep the previous image tag so you can go back.

## 4. Rolling back

* **Code:** deploy the previous image/commit. Migrations in this repository only add tables and columns, so the older code runs on the newer schema.
* **Data:** restore the last verified dump ([DOCKER.md](DOCKER.md), backups). Restoring loses everything written since that dump, so decide quickly and tell members.

## 5. What staging does not prove

* Real mail deliverability (SPF/DKIM) and real card payments: test those once with a tiny live transaction on production under supervision.
* Real traffic: run `npm run load:test -- --help` against staging for a rough idea, never against production without `--allow-remote` and a reason.
