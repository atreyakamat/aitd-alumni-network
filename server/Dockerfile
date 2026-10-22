# Server Dockerfile — build from the repository root (npm workspaces):
#   docker build -f server/Dockerfile -t aitd-api .
FROM node:20-alpine AS base
RUN apk add --no-cache openssl

# Install workspace dependencies from the root lockfile
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --workspace=server --include-workspace-root=false

# Build stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
WORKDIR /app/server
RUN npx prisma generate && npm run build
# The embedded PostgreSQL binaries are only for local dev/tests (docker-compose runs real Postgres)
RUN rm -rf /app/node_modules/embedded-postgres /app/node_modules/@embedded-postgres

# Production stage
FROM base AS runner
WORKDIR /app/server
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 expressjs

# prisma + tsx stay in node_modules: the entrypoint runs `prisma migrate deploy` and the optional seed
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/package.json ./package.json
COPY --from=builder /app/server/prisma ./prisma
COPY --chmod=755 server/docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p uploads && chown expressjs:nodejs uploads
USER expressjs

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-5000}/health > /dev/null || exit 1

# Waits for the database, applies pending migrations, optionally seeds, then starts the API
ENTRYPOINT ["./docker-entrypoint.sh"]
