# Testing & TDD Workflow

AITD Connection is developed test-first. Every behaviour change starts with a failing test.

## Test layers

| Layer | Location | Runs against | Command (from `server/`) |
|---|---|---|---|
| Unit (services, controllers, utils, middleware) | `server/src/__tests__/**` | Deep-mocked Prisma (`tests/setup.ts`) | `npm test` |
| Route-level RBAC matrix | `server/tests/routes/rbac-matrix.test.ts` | Real Express app, mocked Prisma | `npm test` |
| Contracts (API reference freshness, notification links resolve to client pages) | `server/tests/docs/`, `server/src/__tests__/utils/clientLinks.test.ts` | Live router, client `app/` tree | `npm test` |
| Integration (end-to-end HTTP + DB) | `server/tests/integration/*.int.test.ts` | Real PostgreSQL 17 (embedded, auto-started, no Docker) | `npm run test:integration` |
| Frontend unit/component | `client/src/**/*.test.ts(x)` | Vitest + Testing Library (jsdom) | `npm test` (in `client/`) |

Other useful commands:

```bash
npm run typecheck        # server: src + tests
npm run test:coverage    # server unit coverage report (server/coverage)
npm run test:all         # unit + integration
```

## The TDD loop

1. **Red** – write the test for the behaviour the PRD requires (including the role/ownership rule and every error branch).
2. **Green** – make the smallest change that passes.
3. **Refactor** – clean up with the suite green.

### Adding an API endpoint

1. Add the route to the `MATRIX` in `server/tests/routes/rbac-matrix.test.ts` with its access level
   (`public`, `optional`, `auth`, `chapterAdmin`, `admin`, `superAdmin`). The suite **fails if any registered
   route is unclassified**, so access control is always an explicit decision.
2. Write service tests (`src/__tests__/services/<name>.test.ts`) using `prismaMock` from `tests/helpers`.
3. Implement the service, controller and route.
4. For multi-step flows, or anything that relies on raw SQL or database semantics (case-insensitive search,
   the map's distance query), add an integration test in `tests/integration/`.
5. Run `npm run docs:api` to regenerate `docs/API_REFERENCE.md`. `tests/docs/api-reference.test.ts` fails while it is stale.

## Role-based access control

* Hierarchy: `MEMBER < CHAPTER_ADMIN < ADMIN < SUPER_ADMIN` – defined once in `server/src/config/permissions.ts`.
* Route guards: `authenticate`, then `isChapterAdmin` / `isAdmin` / `isSuperAdmin` (`requireRole`) in `src/middleware/auth.ts`.
* The role is re-read from the database on every request, so promotions, demotions and deactivations apply immediately.
* Ownership rules (e.g. "owner or admin may edit") are enforced in services and covered by service tests.
* User management rules: admins manage only users below them; super admins manage anyone; nobody changes their own role or status.
* Chapter admins may edit only their own chapter and create events only for it.

## Test helpers (`server/tests/helpers`)

```ts
import { api, authAs, prismaMock, mockReqRes } from '../../tests/helpers';

const { header } = authAs('ADMIN');          // arranges the authenticated user
prismaMock.user.findMany.mockResolvedValue([]);
const res = await api().get('/api/admin/users').set('Authorization', header);
```

## Integration database

`tests/integration/globalSetup.ts` starts a throwaway PostgreSQL 17 from the `embedded-postgres` npm package
(binaries ship with the package; no download at runtime) on a free port with a temporary data directory, then runs
`prisma migrate reset`. `admin-rbac.int.test.ts` also checks that the migrations match `schema.prisma` (no drift).
To use an existing server instead, set `TEST_DATABASE_URL`, e.g.
`postgresql://postgres:testpassword@127.0.0.1:5432/alumni_test` (CI uses a `postgres:17-alpine` service container).

Suites: `auth-lifecycle`, `admin-rbac`, `payments`, and `geo-search` (haversine + bounding-box nearby query,
antimeridian handling, ~1 km location rounding, case-insensitive directory and skill matching).

## Local development without Docker

```bash
npm run db:local -w server        # embedded PostgreSQL 17 on 127.0.0.1:5433; data kept in server/.local-pg (--fresh wipes it)
# in server/.env: DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/alumni_connect"
npm run db:deploy && npm run db:seed   # from repo root
npm run dev                            # API :5000 + web :3000
```

Redis is optional; without `REDIS_URL` the response cache is disabled.

## PostgreSQL notes for tests

* String filters are case-sensitive in PostgreSQL. Services use the `ilike()` helper (`src/utils/helpers.ts`), which
  produces `{ contains, mode: 'insensitive' }`; unit tests assert that shape.
* `Prisma.Sql#sql` renders placeholders as `?` regardless of the database, so raw-SQL assertions match `\?`.
