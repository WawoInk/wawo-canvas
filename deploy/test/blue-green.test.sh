#!/usr/bin/env bash
set -Eeuo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
workspace=$(mktemp -d)
project="infinite-canvas-deploy-test-$$"
http_port=$((20000 + $$ % 10000))
https_port=$((30000 + $$ % 10000))

cleanup() {
    if [[ -f "$workspace/docker-compose.prod.yml" ]]; then
        (
            cd "$workspace"
            docker compose --profile blue --profile green --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml down -v --remove-orphans >/dev/null 2>&1 || true
        )
    fi
    rm -rf "$workspace"
}
trap cleanup EXIT

for file in deploy/docker-compose.prod.yml deploy/slot.Caddyfile deploy/blue-green.sh deploy/test/docker-compose.legacy.yml deploy/test/legacy.Caddyfile; do
    [[ -f "$root/$file" ]] || {
        echo "missing deployment asset: $file" >&2
        exit 1
    }
done

cp "$root/deploy/docker-compose.prod.yml" "$root/deploy/slot.Caddyfile" "$root/deploy/blue-green.sh" "$root/deploy/test/docker-compose.legacy.yml" "$root/deploy/test/legacy.Caddyfile" "$workspace/"
mkdir -p "$workspace/data" "$workspace/state"
: > "$workspace/state/deployment.env"
printf 'durable-file\n' > "$workspace/data/deploy-probe.txt"

arch=$(docker info --format '{{.Architecture}}')
case "$arch" in
    aarch64 | arm64) goarch=arm64 ;;
    x86_64 | amd64) goarch=amd64 ;;
    *) echo "unsupported Docker architecture: $arch" >&2; exit 1 ;;
esac
CGO_ENABLED=0 GOOS=linux GOARCH=$goarch go build -o "$root/deploy/test/fixture-api/server" "$root/deploy/test/fixture-api/main.go"
trap 'rm -f "$root/deploy/test/fixture-api/server"; cleanup' EXIT

docker build -q -f "$root/deploy/test/Dockerfile.api" -t infinite-canvas-deploy-test-api:a "$root" >/dev/null
for sha in legacy a b health-fail database-fail jwt-fail public-fail; do
    [[ "$sha" == a ]] || docker tag infinite-canvas-deploy-test-api:a "infinite-canvas-deploy-test-api:$sha"
    docker build -q -f "$root/deploy/test/Dockerfile.web" --build-arg BUILD_SHA="$sha" -t "infinite-canvas-deploy-test-web:$sha" "$root" >/dev/null
done
stale_sha=1111111111111111111111111111111111111111
docker tag infinite-canvas-deploy-test-api:a "infinite-canvas-deploy-test-api:$stale_sha"
docker tag infinite-canvas-deploy-test-web:a "infinite-canvas-deploy-test-web:$stale_sha"

cat > "$workspace/.env" <<EOF
COMPOSE_PROJECT_NAME=$project
POSTGRES_USER=deploy_test
POSTGRES_PASSWORD=deploy_test
POSTGRES_DB=deploy_test
DATABASE_DSN=postgres://deploy_test:deploy_test@postgres:5432/deploy_test?sslmode=disable
JWT_SECRET=deploy-test-shared-secret
PUBLIC_BASE_URL=http://127.0.0.1:$http_port
CADDY_SITE_ADDRESS=:80
HTTP_PORT=$http_port
HTTPS_PORT=$https_port
API_IMAGE_REPO=infinite-canvas-deploy-test-api
WEB_IMAGE_REPO=infinite-canvas-deploy-test-web
DRAIN_SECONDS=0
PULL_IMAGES=0
HEALTH_INTERVAL=1s
HEALTH_RETRIES=3
VERIFY_ATTEMPTS=3
VERIFY_INTERVAL=0.1
AUTH_VERIFY_ATTEMPTS=20
AUTH_VERIFY_INTERVAL=0.2
SHUTDOWN_TIMEOUT=2s
API_STOP_GRACE_PERIOD=5s
EOF

(
    cd "$workspace"
    docker compose --env-file .env -f docker-compose.legacy.yml up -d
    docker compose --env-file .env -f docker-compose.legacy.yml exec -T postgres psql -U deploy_test -d deploy_test -v ON_ERROR_STOP=1 -c \
        "CREATE TABLE deploy_probe (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO deploy_probe VALUES (1, 'durable-database');"
)
base_url="http://127.0.0.1:$http_port"
for _ in $(seq 1 20); do
    [[ "$(curl -fsS "$base_url/api/health" 2>/dev/null || true)" == ok ]] && break
    sleep 0.5
done
[[ "$(curl -fsS "$base_url/build-version.txt")" == legacy ]]
login=$(curl -fsS -X POST "$base_url/api/auth/login")
token=$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' <<< "$login")
user_id=$(sed -n 's/.*"user":{"id":"\([^"]*\)".*/\1/p' <<< "$login")
[[ -n "$token" && -n "$user_id" ]]
printf '%s' "$token" > "$workspace/state/deploy.jwt"
printf '%s' "$user_id" > "$workspace/state/deploy-user-id"
legacy_postgres=$(cd "$workspace" && docker compose --env-file .env -f docker-compose.legacy.yml ps -q postgres)
legacy_api=$(cd "$workspace" && docker compose --env-file .env -f docker-compose.legacy.yml ps -q api)
legacy_web=$(cd "$workspace" && docker compose --env-file .env -f docker-compose.legacy.yml ps -q web)

if (cd "$workspace" && ./blue-green.sh deploy public-fail); then
    echo "failed first migration unexpectedly succeeded" >&2
    exit 1
fi
[[ "$(curl -fsS "$base_url/build-version.txt")" == legacy ]]
curl -fsS -H "Authorization: Bearer $token" "$base_url/api/auth/me" | grep -Fq "\"id\":\"$user_id\""
[[ "$(docker inspect -f '{{.State.Running}}' "$legacy_api")" == true ]]
[[ "$(docker inspect -f '{{.State.Running}}' "$legacy_web")" == true ]]
[[ "$(cd "$workspace" && docker compose --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q postgres)" == "$legacy_postgres" ]]

(
    cd "$workspace"
    ./blue-green.sh deploy a
)

[[ "$(curl -fsS "$base_url/build-version.txt")" == "a" ]]
[[ "$(curl -fsS "$base_url/api/health")" == "ok" ]]
curl -fsS "$base_url/" | grep -Fq 'content="a"'
curl -fsS "$base_url/api/settings" | grep -Fq '"database":"durable-database"'
curl -fsS "$base_url/api/settings" | grep -Fq '"file":"durable-file"'
curl -fsS -H "Authorization: Bearer $token" "$base_url/api/auth/me" | grep -Fq "\"id\":\"$user_id\""
[[ -z "$(docker ps -q --filter "id=$legacy_api")" ]]
[[ -z "$(docker ps -q --filter "id=$legacy_web")" ]]
[[ "$(cd "$workspace" && docker compose --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q postgres)" == "$legacy_postgres" ]]
edge_id=$(cd "$workspace" && docker compose --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q edge)
edge_env=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$edge_id")
if grep -Eq 'JWT_SECRET|DATABASE_DSN|ADMIN_PASSWORD|AMAZON_S3_SECRET_KEY' <<< "$edge_env"; then
    echo "edge received production application secrets" >&2
    exit 1
fi
edge_mounts=$(docker inspect -f '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}' "$edge_id")
grep -Fq "$workspace/state/caddy -> /etc/caddy/deploy" <<< "$edge_mounts"
if grep -Fq "$workspace/state -> /etc/caddy/deploy" <<< "$edge_mounts"; then
    echo "edge can read deployment JWT or state files" >&2
    exit 1
fi

printf "POSTGRES_PASSWORD='changed-compose-metadata'\n" >> "$workspace/.env"

web_blue_id=$(cd "$workspace" && docker compose --profile blue --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q web-blue)
[[ -z "$(docker port "$web_blue_id" 3000/tcp 2>/dev/null || true)" ]]
[[ -n "$(docker port "$edge_id" 80/tcp)" ]]

(
    cd "$workspace"
    ./blue-green.sh prewarm b
)

[[ "$(curl -fsS "$base_url/build-version.txt")" == "a" ]]
(
    cd "$workspace"
    [[ "$(docker compose --profile green --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml exec -T web-green wget -qO- http://127.0.0.1:3000/build-version.txt)" == "b" ]]
    docker compose --profile green --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml exec -T web-green wget -qO- --header "Authorization: Bearer $token" http://127.0.0.1:3000/api/auth/me | grep -Fq "\"id\":\"$user_id\""
    [[ "$(docker compose --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q postgres)" == "$legacy_postgres" ]]
)

postgres_before=$legacy_postgres
edge_before=$edge_id
probe_log="$workspace/probe.log"
stop_probe="$workspace/stop-probe"
(
    while [[ ! -f "$stop_probe" ]]; do
        version=$(curl --connect-timeout 1 --max-time 2 -fsS "$base_url/build-version.txt" 2>/dev/null || true)
        health=$(curl --connect-timeout 1 --max-time 2 -fsS "$base_url/api/health" 2>/dev/null || true)
        if [[ "$health" != ok || "$version" != a && "$version" != b ]]; then
            printf 'version=%q health=%q\n' "$version" "$health" >> "$probe_log"
        fi
        sleep 0.05
    done
) &
probe_pid=$!
curl -fsS "$base_url/api/slow?delay=2s" > "$workspace/slow-response.json" &
slow_pid=$!

(
    cd "$workspace"
    DRAIN_SECONDS=1 ./blue-green.sh deploy b
)

touch "$stop_probe"
wait "$probe_pid"
wait "$slow_pid"
[[ ! -s "$probe_log" ]]
grep -Fq '"sha":"a"' "$workspace/slow-response.json"
[[ "$(curl -fsS "$base_url/build-version.txt")" == "b" ]]
curl -fsS -H "Authorization: Bearer $token" "$base_url/api/auth/me" | grep -Fq "\"id\":\"$user_id\""
for image in "infinite-canvas-deploy-test-api:$stale_sha" "infinite-canvas-deploy-test-web:$stale_sha"; do
    if docker image inspect "$image" >/dev/null 2>&1; then
        echo "unused SHA image was not cleaned after cutover: $image" >&2
        exit 1
    fi
done

(
    cd "$workspace"
    source state/deployment.env
    [[ "$ACTIVE_SLOT" == green && "$CURRENT_SHA" == b && "$PREVIOUS_SHA" == a ]]
    [[ -z "$(docker compose --profile blue --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q api-blue)" ]]
    [[ -z "$(docker compose --profile blue --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q web-blue)" ]]
    [[ "$(docker compose --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q postgres)" == "$postgres_before" ]]
    [[ "$(docker compose --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q edge)" == "$edge_before" ]]
)

(
    cd "$workspace"
    DRAIN_SECONDS=0 ./blue-green.sh rollback
)

[[ "$(curl -fsS "$base_url/build-version.txt")" == "a" ]]
curl -fsS -H "Authorization: Bearer $token" "$base_url/api/auth/me" | grep -Fq "\"id\":\"$user_id\""
(
    cd "$workspace"
    source state/deployment.env
    [[ "$ACTIVE_SLOT" == blue && "$CURRENT_SHA" == a && "$PREVIOUS_SHA" == b ]]
    [[ -z "$(docker compose --profile green --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q api-green)" ]]
    [[ -z "$(docker compose --profile green --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q web-green)" ]]
    [[ "$(docker compose --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q postgres)" == "$postgres_before" ]]
    [[ "$(docker compose --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q edge)" == "$edge_before" ]]
)

assert_public_a() {
    [[ "$(curl -fsS "$base_url/build-version.txt")" == a ]]
    [[ "$(curl -fsS "$base_url/api/health")" == ok ]]
    curl -fsS -H "Authorization: Bearer $token" "$base_url/api/auth/me" | grep -Fq "\"id\":\"$user_id\""
    (
        cd "$workspace"
        source state/deployment.env
        [[ "$ACTIVE_SLOT" == blue && "$CURRENT_SHA" == a ]]
        [[ -z "$(docker compose --profile green --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q api-green)" ]]
        [[ -z "$(docker compose --profile green --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q web-green)" ]]
    )
}

if (cd "$workspace" && ./blue-green.sh prewarm missing); then
    echo "missing images unexpectedly passed readiness" >&2
    exit 1
fi
assert_public_a

for scenario in health-fail database-fail jwt-fail; do
    if (cd "$workspace" && ./blue-green.sh prewarm "$scenario"); then
        echo "$scenario unexpectedly passed readiness" >&2
        exit 1
    fi
    assert_public_a
done

printf "SHUTDOWN_TIMEOUT='6s'\nAPI_STOP_GRACE_PERIOD='5s'\n" >> "$workspace/.env"
if output=$(cd "$workspace" && ./blue-green.sh prewarm missing 2>&1); then
    echo "invalid shutdown grace configuration unexpectedly passed" >&2
    exit 1
fi
grep -Fq "API_STOP_GRACE_PERIOD must be greater than SHUTDOWN_TIMEOUT" <<< "$output"
sed '$d' "$workspace/.env" | sed '$d' > "$workspace/.env.tmp"
mv "$workspace/.env.tmp" "$workspace/.env"

printf 'CADDY_SITE_ADDRESS={\n' >> "$workspace/.env"
if (cd "$workspace" && DRAIN_SECONDS=0 ./blue-green.sh deploy b); then
    echo "invalid Caddy configuration unexpectedly deployed" >&2
    exit 1
fi
sed '$d' "$workspace/.env" > "$workspace/.env.tmp"
mv "$workspace/.env.tmp" "$workspace/.env"
assert_public_a

if (cd "$workspace" && DRAIN_SECONDS=0 ./blue-green.sh deploy public-fail); then
    echo "public verification failure unexpectedly deployed" >&2
    exit 1
fi
assert_public_a
[[ "$(cd "$workspace" && docker compose --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q postgres)" == "$postgres_before" ]]
[[ "$(cd "$workspace" && docker compose --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q edge)" == "$edge_before" ]]

blue_api_before=$(cd "$workspace" && docker compose --profile blue --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q api-blue)
blue_web_before=$(cd "$workspace" && docker compose --profile blue --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q web-blue)
state_before=$(cat "$workspace/state/deployment.env")
(
    cd "$workspace"
    green_api=$(docker compose --profile green --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -a -q api-green)
    green_web=$(docker compose --profile green --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -a -q web-green)
    docker start "$green_api" "$green_web" >/dev/null
)
(
    cd "$workspace"
    ./blue-green.sh deploy a
)
[[ "$(cat "$workspace/state/deployment.env")" == "$state_before" ]]
[[ "$(cd "$workspace" && docker compose --profile blue --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q api-blue)" == "$blue_api_before" ]]
[[ "$(cd "$workspace" && docker compose --profile blue --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q web-blue)" == "$blue_web_before" ]]
[[ -z "$(cd "$workspace" && docker compose --profile green --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q api-green)" ]]
[[ -z "$(cd "$workspace" && docker compose --profile green --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q web-green)" ]]
[[ "$(cd "$workspace" && docker compose --env-file .env --env-file state/deployment.env -f docker-compose.prod.yml ps -q postgres)" == "$legacy_postgres" ]]

mkdir "$workspace/state/deploy.lock"
if (cd "$workspace" && ./blue-green.sh deploy a); then
    echo "concurrent deployment unexpectedly acquired the production lock" >&2
    exit 1
fi
rmdir "$workspace/state/deploy.lock"
assert_public_a
