# syntax=docker/dockerfile:1
# Build context: repository root.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @osooli/shared --workspace @osooli/api --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# prisma generate never connects, but prisma.config.ts requires DATABASE_URL.
# The placeholder exists only in this build stage, not in the runtime image.
RUN npm run build -w @osooli/shared \
 && DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build -w @osooli/api
RUN npm prune --omit=dev --workspace @osooli/shared --workspace @osooli/api

FROM node:24-alpine AS runtime
# Chromium renders Arabic PDFs (labels, official documents).
ENV NODE_ENV=production TZ=Asia/Hebron CHROMIUM_PATH=/usr/bin/chromium-browser
WORKDIR /app
RUN apk add --no-cache tzdata chromium
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/apps/api/package.json apps/api/
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma apps/api/prisma
COPY --from=build --chown=node:node /app/apps/api/prisma.config.ts apps/api/
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/v1/health || exit 1
# Apply pending migrations, then start. Seed data is never loaded here.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
