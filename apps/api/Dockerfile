# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /repo

RUN corepack enable pnpm

# Copy workspace manifests first — Docker caches this layer until they change
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json                            apps/api/
COPY packages/db/package.json                         packages/db/
COPY packages/shared/package.json                     packages/shared/

# Install production deps only (skips devDependencies)
RUN pnpm install --frozen-lockfile --prod

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /repo

RUN corepack enable pnpm

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy installed node_modules from deps stage
COPY --from=deps /repo/node_modules       ./node_modules

# Copy source — workspace packages need their full src trees
COPY apps/api/src        ./apps/api/src
COPY apps/api/package.json ./apps/api/package.json
COPY packages/db/src     ./packages/db/src
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/package.json ./packages/shared/package.json
COPY package.json        ./package.json
COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY tsconfig.json       ./tsconfig.json

# Re-link workspace packages so Node resolves them correctly
RUN pnpm install --frozen-lockfile --prod --offline 2>/dev/null || true

WORKDIR /repo/apps/api

USER appuser

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["/repo/node_modules/.bin/tsx", "src/index.ts"]
