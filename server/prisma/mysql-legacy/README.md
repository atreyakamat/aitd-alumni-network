# Legacy MySQL migrations (archived 2026-10-18)

The project moved from MySQL 8 to PostgreSQL 17. The live migration history now starts at
`prisma/migrations/20261018000000_postgres_baseline`.

These files are kept only so an **existing MySQL database** can be brought fully up to date
before its data is copied into PostgreSQL (see `docs/DOCKER.md`, "Migrating existing MySQL data"):

```bash
# Prisma reads migrations from the folder next to the schema, so use a temporary copy here.
# (The archived migrations end at 20261014150000_guest_transactions.)
cp prisma/schema.prisma prisma/mysql-legacy/schema.prisma
#   edit prisma/mysql-legacy/schema.prisma: provider = "mysql"
DATABASE_URL="mysql://..." npx prisma migrate deploy --schema prisma/mysql-legacy/schema.prisma
rm prisma/mysql-legacy/schema.prisma
```

`local-mysql.cjs` starts a throwaway MySQL without Docker; it needs `npm i -D mysql-memory-server`
first (no longer a project dependency).

Prisma does not read this folder; nothing here runs in development, CI or Docker.
