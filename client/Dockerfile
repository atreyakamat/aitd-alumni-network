# Client Dockerfile — build from the repository root (npm workspaces):
#   docker build -f client/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api -t aitd-web .
FROM node:20-alpine AS base

# Install workspace dependencies from the root lockfile
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN npm ci --workspace=client --include-workspace-root=false

# Build
FROM base AS builder
WORKDIR /app
COPY client ./client
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/client/node_modules ./client/node_modules
WORKDIR /app/client

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MAP_TILE_URL=""
ARG NEXT_PUBLIC_MAP_TILE_ATTRIBUTION=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_MAP_TILE_URL=${NEXT_PUBLIC_MAP_TILE_URL}
ENV NEXT_PUBLIC_MAP_TILE_ATTRIBUTION=${NEXT_PUBLIC_MAP_TILE_ATTRIBUTION}
ENV NEXT_OUTPUT=standalone
ENV NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p public && npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Standalone output mirrors the monorepo layout (client/server.js)
COPY --from=builder --chown=nextjs:nodejs /app/client/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/client/.next/static ./client/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/client/public ./client/public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "client/server.js"]
