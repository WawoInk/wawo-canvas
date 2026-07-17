# Build Vite frontend
FROM oven/bun:1 AS build
WORKDIR /app
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY VERSION CHANGELOG.md ../
COPY web/ .
ARG BUILD_SHA=dev
RUN bun run build \
    && sed -i "s#<head>#<head><meta name=\"build-version\" content=\"$BUILD_SHA\" />#" dist/index.html \
    && printf '%s\n' "$BUILD_SHA" > dist/build-version.txt

# ponytail: Caddyfile mounted at runtime via compose volume, not baked in
FROM caddy:2-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 3000
