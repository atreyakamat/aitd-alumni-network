## What and why

<!-- One or two sentences. Link the finding or issue. -->

## Checklist

- [ ] Tests first: the new behaviour has a test that failed before the change
- [ ] New or changed route: row in `server/tests/routes/rbac-matrix.test.ts` and in the contract suite; `npm run docs:api -w server` and `npm run contract:inventory -w server` run
- [ ] New model or column that references a user: export and deletion decision in `privacyService`
- [ ] Migration is additive and was applied with `prisma migrate deploy` (never `migrate dev` against shared data)
- [ ] No secret, `.env`, log or upload in the diff
- [ ] User-facing text uses the product name from `BRAND` ("AIEM Connect")
- [ ] Settings or behaviour that production must know about: `docs/PRODUCTION_CHECKLIST.md`, `CHANGELOG.md`
- [ ] CI green, including "Docker and Kafka verification" when compose, Dockerfiles, Kafka or the server's start-up changed

## Security

<!-- Anything that touches sign-in, approval, payments, uploads, or exposes data: what could go wrong, and which test pins it? -->
