# Build Vite frontend
FROM oven/bun:1 AS build
WORKDIR /app
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY VERSION CHANGELOG.md ../
COPY web/ .
RUN bun run build

# Runtime: Caddy serving static files, proxying /api to Go backend
FROM caddy:2-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 3000
