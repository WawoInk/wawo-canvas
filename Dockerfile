# Build Vite frontend
FROM oven/bun:1 AS build
WORKDIR /app
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY VERSION CHANGELOG.md ../
COPY web/ .
RUN bun run build

# ponytail: Caddyfile mounted at runtime via compose volume, not baked in
FROM caddy:2-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 3000
