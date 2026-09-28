# syntax=docker/dockerfile:1
# Build context: repository root.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @osooli/shared --workspace @osooli/web --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @osooli/shared && npm run build -w @osooli/web

FROM nginx:1.29-alpine AS runtime
# API_UPSTREAM: internal URL of the API service, e.g. http://api.railway.internal:3000
ENV API_UPSTREAM=http://api:3000 PORT=80
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
