# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app


FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile


FROM base AS builder

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

RUN pnpm build


FROM base AS runner

WORKDIR /app

ARG UEB_CORE_SOURCE_GIT_SHA
ARG UEB_CORE_MIGRATION_LEDGER_FINGERPRINT
ARG UEB_CORE_MIGRATION_COUNT

LABEL org.opencontainers.image.revision="${UEB_CORE_SOURCE_GIT_SHA}" \
  io.ueb-core.migration-ledger-fingerprint="${UEB_CORE_MIGRATION_LEDGER_FINGERPRINT}" \
  io.ueb-core.migration-count="${UEB_CORE_MIGRATION_COUNT}"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

RUN case "${UEB_CORE_SOURCE_GIT_SHA}" in \
      [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;; \
      *) echo "UEB_CORE_SOURCE_GIT_SHA must be an exact lowercase 40-character Git SHA" >&2; exit 2 ;; \
    esac \
  && case "${UEB_CORE_MIGRATION_LEDGER_FINGERPRINT}" in \
      [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;; \
      *) echo "UEB_CORE_MIGRATION_LEDGER_FINGERPRINT must be an exact lowercase SHA-256" >&2; exit 2 ;; \
    esac \
  && case "${UEB_CORE_MIGRATION_COUNT}" in \
      ''|*[!0-9]*) echo "UEB_CORE_MIGRATION_COUNT must be a non-negative integer" >&2; exit 2 ;; \
    esac

USER node

EXPOSE 3000

HEALTHCHECK \
  --interval=30s \
  --timeout=5s \
  --start-period=20s \
  --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "server.js"]
