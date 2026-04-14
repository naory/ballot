FROM node:20-alpine AS base
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/
COPY indexer/package.json ./indexer/
RUN pnpm install --frozen-lockfile --filter @ballot/indexer... --filter @ballot/core

# ── build core (indexer depends on it) ────────────────────────────────────────
FROM deps AS build
COPY packages/core/ ./packages/core/
COPY indexer/ ./indexer/
RUN pnpm --filter @ballot/core build
RUN pnpm --filter @ballot/indexer build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/
COPY indexer/package.json ./indexer/
RUN pnpm install --frozen-lockfile --prod --filter @ballot/indexer... --filter @ballot/core

COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/indexer/dist       ./indexer/dist

# Bundle the ZK verification keys — required for proof verification at runtime.
# Build circuits locally first: cd circuits && npm run compile && npm run setup
# Then copy the outputs into circuits/build/ before building the Docker image.
COPY circuits/build/vote.vkey.json                  ./vote.vkey.json
COPY circuits/build/vote_with_credential.vkey.json  ./vote_with_credential.vkey.json

ENV NODE_ENV=production
ENV PORT=4000
ENV DB_PATH=/data/ballot.sqlite
ENV VKEY_PATH=/app/vote.vkey.json
ENV CREDENTIAL_VKEY_PATH=/app/vote_with_credential.vkey.json

EXPOSE 4000

CMD ["node", "indexer/dist/index.js"]
