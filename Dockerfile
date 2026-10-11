# OpenKey: static web app served by an unprivileged nginx. No server-side code, no data store.
#   docker build -t openkey .
#   docker run --rm -p 8080:8080 openkey      -> http://localhost:8080 (WebHID works on localhost)
# Serve it over HTTPS in production (WebHID requires a secure context); terminate TLS at your proxy.

FROM node:24-alpine AS build
WORKDIR /src
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY . .
# --ignore-scripts: the web build needs no native modules (node-hid is for the CLI only).
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build:web

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
