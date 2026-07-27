#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$root"

env_file=${ENV_FILE:-.env}
state_dir=${STATE_DIR:-state}
state_file="$state_dir/deployment.env"
caddy_dir="$state_dir/caddy"
compose_file=${COMPOSE_FILE:-docker-compose.prod.yml}
mkdir -p "$caddy_dir"

lock_dir="$state_dir/deploy.lock"
mkdir "$lock_dir" 2>/dev/null || {
    echo "[lock] another production deployment is running" >&2
    exit 1
}
# ponytail: SIGKILL can leave this global lock behind; remove it manually if that ever occurs.
TARGET_SLOT=
TARGET_STARTED=0
TARGET_STOP_SAFE=1
CUTOVER_ATTEMPTED=0
STATE_COMMITTED=0
OLD_SLOT=
OLD_SHA=
LEGACY_API_ID=
LEGACY_WEB_ID=
LEGACY_WEB_STOPPED=0
on_exit() {
    local status=$?
    set +e
    if ((status != 0 && CUTOVER_ATTEMPTED && !STATE_COMMITTED)) && [[ -n "$OLD_SLOT" && -f "$caddy_dir/rollback.Caddyfile" ]]; then
        stage rollback "restore $OLD_SLOT after failed public verification"
        if cp "$caddy_dir/rollback.Caddyfile" "$caddy_dir/active.Caddyfile" \
            && compose exec -T edge caddy reload --config /etc/caddy/deploy/active.Caddyfile --adapter caddyfile \
            && verify_public "$OLD_SHA"; then
            TARGET_STOP_SAFE=1
        else
            echo "failed to restore $OLD_SLOT; keeping $TARGET_SLOT running" >&2
        fi
    fi
    if ((status != 0 && LEGACY_WEB_STOPPED && !STATE_COMMITTED)); then
        stage rollback "restore the legacy public Web container"
        compose stop edge >/dev/null 2>&1 || true
        compose rm -f edge >/dev/null 2>&1 || true
        docker start "$LEGACY_WEB_ID" >/dev/null
        if verify_public_auth; then
            TARGET_STOP_SAFE=1
        else
            echo "failed to verify restored legacy Web; keeping $TARGET_SLOT running" >&2
        fi
    fi
    if ((status != 0 && TARGET_STARTED && TARGET_STOP_SAFE)) && [[ "$TARGET_SLOT" != "${ACTIVE_SLOT:-}" ]]; then
        stage failure "stop rejected $TARGET_SLOT slot and print recent logs"
        compose logs --tail=80 "api-$TARGET_SLOT" "web-$TARGET_SLOT" >&2 || true
        compose stop "web-$TARGET_SLOT" "api-$TARGET_SLOT" >/dev/null 2>&1 || true
    elif ((status != 0 && TARGET_STARTED && !TARGET_STOP_SAFE)); then
        stage failure "leave $TARGET_SLOT running because the previous route was not verified"
    fi
    rmdir "$lock_dir" 2>/dev/null || true
    return "$status"
}
trap on_exit EXIT

stage() {
    printf '\n[%s] %s\n' "$1" "$2"
}

fail() {
    echo "$*" >&2
    exit 1
}

env_value() {
    local value
    value=$(sed -n "s/^$1=//p" "$env_file" | tail -n 1 | tr -d '\r')
    if [[ ${#value} -ge 2 && "$value" == \'*\' ]]; then
        value=${value:1:${#value}-2}
        value=${value//\\\'/\'}
    fi
    printf '%s' "$value"
}

write_state() {
    local tmp="$state_file.tmp"
    {
        printf 'ACTIVE_SLOT=%s\n' "${ACTIVE_SLOT:-}"
        printf 'CURRENT_SHA=%s\n' "${CURRENT_SHA:-}"
        printf 'PREVIOUS_SHA=%s\n' "${PREVIOUS_SHA:-}"
        printf 'BLUE_SHA=%s\n' "${BLUE_SHA:-}"
        printf 'GREEN_SHA=%s\n' "${GREEN_SHA:-}"
        printf 'LAST_SUCCESS_SHA=%s\n' "${LAST_SUCCESS_SHA:-}"
    } > "$tmp"
    mv "$tmp" "$state_file"
}

load_state() {
    ACTIVE_SLOT=
    CURRENT_SHA=
    PREVIOUS_SHA=
    BLUE_SHA=
    GREEN_SHA=
    LAST_SUCCESS_SHA=
    if [[ -f "$state_file" ]]; then
        # shellcheck disable=SC1090
        source "$state_file"
    fi
}

load_auth_context() {
    AUTH_TOKEN=
    EXPECTED_USER_ID=
    if [[ -s "$state_dir/deploy.jwt" && -s "$state_dir/deploy-user-id" ]]; then
        AUTH_TOKEN=$(< "$state_dir/deploy.jwt")
        EXPECTED_USER_ID=$(< "$state_dir/deploy-user-id")
    elif [[ -n "$CURRENT_SHA" && "${ALLOW_MISSING_AUTH:-0}" != 1 ]]; then
        fail "authentication continuity files are required for an existing deployment"
    fi
}

compose() {
    docker compose --env-file "$env_file" --env-file "$state_file" -f "$compose_file" "$@"
}

other_slot() {
    [[ "$1" == blue ]] && printf green || printf blue
}

set_slot_sha() {
    if [[ "$1" == blue ]]; then
        BLUE_SHA=$2
    else
        GREEN_SHA=$2
    fi
}

image_ref() {
    local kind=$1 sha=$2 repo
    repo=$(env_value "${kind}_IMAGE_REPO")
    if [[ -z "$repo" ]]; then
        if [[ "$kind" == API ]]; then
            repo=ghcr.io/eldenpdx/infinite-canvas-api
        else
            repo=ghcr.io/eldenpdx/infinite-canvas
        fi
    fi
    printf '%s:%s' "$repo" "$sha"
}

check_image() {
    local image=$1
    if [[ "$(env_value PULL_IMAGES)" != "0" ]]; then
        docker pull "$image" >/dev/null
    else
        docker image inspect "$image" >/dev/null
    fi
}

wait_healthy() {
    local service=$1 id status
    for _ in $(seq 1 60); do
        id=$(compose ps -q "$service")
        if [[ -n "$id" ]]; then
            status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
            [[ "$status" == healthy ]] && return
            [[ "$status" == unhealthy || "$status" == exited ]] && break
        fi
        sleep 1
    done
    compose logs --tail=80 "$service" >&2 || true
    fail "$service did not become healthy"
}

duration_ms() {
    local value=$1 number unit
    [[ "$value" =~ ^([0-9]+)(ms|s|m|h)$ ]] || return 1
    number=${BASH_REMATCH[1]}
    unit=${BASH_REMATCH[2]}
    case "$unit" in
        ms) printf '%d' "$number" ;;
        s) printf '%d' "$((number * 1000))" ;;
        m) printf '%d' "$((number * 60000))" ;;
        h) printf '%d' "$((number * 3600000))" ;;
    esac
}

slot_get() {
    local slot=$1 path=$2
    if [[ -n "$AUTH_TOKEN" && "$path" == /api/auth/me ]]; then
        compose exec -T "web-$slot" wget -qO- --header "Authorization: Bearer $AUTH_TOKEN" "http://127.0.0.1:3000$path"
    else
        compose exec -T "web-$slot" wget -qO- "http://127.0.0.1:3000$path"
    fi
}

verify_internal() {
    local slot=$1 sha=$2 version html health settings user
    version=$(slot_get "$slot" /build-version.txt)
    html=$(slot_get "$slot" /)
    health=$(slot_get "$slot" /api/health)
    settings=$(slot_get "$slot" /api/settings)
    [[ "$version" == "$sha" ]] || fail "$slot version mismatch: got '$version', want '$sha'"
    grep -Fq "content=\"$sha\"" <<< "$html" || fail "$slot HTML does not contain target SHA"
    [[ "$health" == ok ]] || fail "$slot API health failed"
    grep -Fq '"code":0' <<< "$settings" || fail "$slot database-backed readiness failed"
    if [[ -n "$AUTH_TOKEN" ]]; then
        user=$(slot_get "$slot" /api/auth/me)
        grep -Fq "\"id\":\"$EXPECTED_USER_ID\"" <<< "$user" || fail "$slot rejected the existing JWT"
    fi
}

render_edge_config() {
    local slot=$1 site_address
    site_address=$(env_value CADDY_SITE_ADDRESS)
    [[ -n "$site_address" ]] || site_address=:80
    cat > "$caddy_dir/candidate.Caddyfile" <<EOF
{
    admin 0.0.0.0:2019
}

$site_address {
    encode zstd gzip
    reverse_proxy web-$slot:3000
}
EOF
}

public_get() {
    local base=$1 path=$2
    if [[ -n "$AUTH_TOKEN" && "$path" == /api/auth/me ]]; then
        curl -L --connect-timeout 2 --max-time 5 -fsS -H 'Cache-Control: no-cache' -H "Authorization: Bearer $AUTH_TOKEN" "$base$path"
    else
        curl -L --connect-timeout 2 --max-time 5 -fsS -H 'Cache-Control: no-cache' "$base$path"
    fi
}

public_base() {
    local base
    base=$(env_value PUBLIC_BASE_URL)
    [[ -n "$base" ]] || return 1
    case "$base" in
        http://* | https://*) ;;
        *) base="https://$base" ;;
    esac
    printf '%s' "${base%/}"
}

verify_public_auth() {
    local base health user attempts interval
    base=$(public_base) || return 1
    attempts=${AUTH_VERIFY_ATTEMPTS:-$(env_value AUTH_VERIFY_ATTEMPTS)}
    interval=${AUTH_VERIFY_INTERVAL:-$(env_value AUTH_VERIFY_INTERVAL)}
    [[ -n "$attempts" ]] || attempts=30
    [[ -n "$interval" ]] || interval=1
    for _ in $(seq 1 "$attempts"); do
        health=$(public_get "$base" /api/health 2>/dev/null || true)
        user=
        [[ -z "$AUTH_TOKEN" ]] || user=$(public_get "$base" /api/auth/me 2>/dev/null || true)
        if [[ "$health" == ok ]] && { [[ -z "$AUTH_TOKEN" ]] || grep -Fq "\"id\":\"$EXPECTED_USER_ID\"" <<< "$user"; }; then
            return
        fi
        sleep "$interval"
    done
    return 1
}

verify_public() {
    local sha=$1 base version html health settings user attempts interval
    base=$(public_base) || return 1
    attempts=${VERIFY_ATTEMPTS:-$(env_value VERIFY_ATTEMPTS)}
    interval=${VERIFY_INTERVAL:-$(env_value VERIFY_INTERVAL)}
    [[ -n "$attempts" ]] || attempts=30
    [[ -n "$interval" ]] || interval=1
    for _ in $(seq 1 "$attempts"); do
        version=$(public_get "$base" /build-version.txt 2>/dev/null || true)
        html=$(public_get "$base" / 2>/dev/null || true)
        health=$(public_get "$base" /api/health 2>/dev/null || true)
        settings=$(public_get "$base" /api/settings 2>/dev/null || true)
        user=
        [[ -z "$AUTH_TOKEN" ]] || user=$(public_get "$base" /api/auth/me 2>/dev/null || true)
        if [[ "$version" == "$sha" && "$health" == ok ]] \
            && grep -Fq "content=\"$sha\"" <<< "$html" \
            && grep -Fq '"code":0' <<< "$settings" \
            && { [[ -z "$AUTH_TOKEN" ]] || grep -Fq "\"id\":\"$EXPECTED_USER_ID\"" <<< "$user"; }; then
            return
        fi
        sleep "$interval"
    done
    echo "public verification failed for $sha" >&2
    return 1
}

edge_running() {
    [[ -n "$(compose ps -q edge)" ]]
}

validate_edge_candidate() {
    if edge_running; then
        compose exec -T edge caddy validate --config /etc/caddy/deploy/candidate.Caddyfile --adapter caddyfile
    else
        compose run --rm --no-deps edge caddy validate --config /etc/caddy/deploy/candidate.Caddyfile --adapter caddyfile
    fi
}

activate_edge_candidate() {
    if edge_running; then
        cp "$caddy_dir/active.Caddyfile" "$caddy_dir/rollback.Caddyfile"
        CUTOVER_ATTEMPTED=1
        TARGET_STOP_SAFE=0
        mv "$caddy_dir/candidate.Caddyfile" "$caddy_dir/active.Caddyfile"
        compose exec -T edge caddy reload --config /etc/caddy/deploy/active.Caddyfile --adapter caddyfile
    else
        if [[ -n "$LEGACY_WEB_ID" ]]; then
            stage migration "stop the legacy Web container immediately before edge takeover"
            docker stop "$LEGACY_WEB_ID" >/dev/null
            LEGACY_WEB_STOPPED=1
        fi
        TARGET_STOP_SAFE=0
        mv "$caddy_dir/candidate.Caddyfile" "$caddy_dir/active.Caddyfile"
        compose up -d edge
        wait_healthy edge
    fi
}

prewarm_slot() {
    local slot=$1 sha=$2
    stage image-check "verify exact API and Web images for $sha"
    check_image "$(image_ref API "$sha")"
    check_image "$(image_ref WEB "$sha")"

    set_slot_sha "$slot" "$sha"
    write_state

    stage containers "start the stable database and $slot slot"
    compose up -d --no-recreate postgres
    wait_healthy postgres
    TARGET_SLOT=$slot
    TARGET_STARTED=1
    compose --profile "$slot" up -d --no-deps "api-$slot"
    wait_healthy "api-$slot"
    compose --profile "$slot" up -d --no-deps "web-$slot"
    wait_healthy "web-$slot"

    stage internal-readiness "verify $slot version, API, database access, and existing JWT"
    verify_internal "$slot" "$sha"
}

cleanup_images() {
    local repo tag keep
    for repo in "$(image_ref API "$CURRENT_SHA" | sed "s/:$CURRENT_SHA$//")" "$(image_ref WEB "$CURRENT_SHA" | sed "s/:$CURRENT_SHA$//")"; do
        while IFS= read -r tag; do
            [[ "$tag" =~ ^[0-9a-f]{40}$ ]] || continue
            keep=0
            [[ "$tag" == "$CURRENT_SHA" || -n "$PREVIOUS_SHA" && "$tag" == "$PREVIOUS_SHA" ]] && keep=1
            if ((keep == 0)); then
                echo "[cleanup] remove unused image $repo:$tag"
                docker image rm --force "$repo:$tag" >/dev/null || true
            fi
        done < <(docker image ls "$repo" --format '{{.Tag}}')
    done
    docker image prune -f >/dev/null || true
}

cleanup_inactive_slot() {
    local inactive drain_seconds
    [[ -n "$ACTIVE_SLOT" ]] || return
    inactive=$(other_slot "$ACTIVE_SLOT")
    if [[ -n "$(compose ps -q "api-$inactive")$(compose ps -q "web-$inactive")" ]]; then
        drain_seconds=${DRAIN_SECONDS:-$(env_value DRAIN_SECONDS)}
        [[ -n "$drain_seconds" ]] || drain_seconds=30
        stage drain "resume cleanup and wait ${drain_seconds}s for $inactive"
        sleep "$drain_seconds"
        stage shutdown "stop leftover inactive $inactive API and Web"
        compose stop "api-$inactive" "web-$inactive"
    fi
}

action=${1:-}
sha=${2:-}
[[ "$action" == deploy || "$action" == prewarm || "$action" == rollback ]] || fail "usage: $0 deploy|prewarm <git-sha> | rollback"
[[ -f "$env_file" ]] || fail "$env_file is missing"

stage configuration "validate production configuration"
jwt_secret=$(env_value JWT_SECRET)
trimmed_secret=$(tr -d '[:space:]' <<< "$jwt_secret")
[[ -n "$trimmed_secret" && "$trimmed_secret" != infinite-canvas ]] || fail "JWT_SECRET must be explicit, non-empty, and non-default"
shutdown_timeout=$(env_value SHUTDOWN_TIMEOUT)
stop_grace=$(env_value API_STOP_GRACE_PERIOD)
[[ -n "$shutdown_timeout" ]] || shutdown_timeout=30s
[[ -n "$stop_grace" ]] || stop_grace=40s
shutdown_ms=$(duration_ms "$shutdown_timeout") || fail "SHUTDOWN_TIMEOUT must use ms, s, m, or h"
stop_grace_ms=$(duration_ms "$stop_grace") || fail "API_STOP_GRACE_PERIOD must use ms, s, m, or h"
((stop_grace_ms > shutdown_ms)) || fail "API_STOP_GRACE_PERIOD must be greater than SHUTDOWN_TIMEOUT"

load_state
stage state "active=${ACTIVE_SLOT:-none} current=${CURRENT_SHA:-none} previous=${PREVIOUS_SHA:-none}"
project_name=$(env_value COMPOSE_PROJECT_NAME)
[[ -n "$project_name" ]] || project_name=infinite-canvas
if [[ -z "$ACTIVE_SLOT" ]]; then
    LEGACY_API_ID=$(docker ps -q --filter "label=com.docker.compose.project=$project_name" --filter "label=com.docker.compose.service=api" | head -n 1)
    LEGACY_WEB_ID=$(docker ps -q --filter "label=com.docker.compose.project=$project_name" --filter "label=com.docker.compose.service=web" | head -n 1)
fi
if [[ "$action" == rollback ]]; then
    [[ -n "$ACTIVE_SLOT" && -n "$PREVIOUS_SHA" ]] || fail "no previous successful Git SHA is available"
    sha=$PREVIOUS_SHA
    stage rollback-target "prepare exact previous Git SHA $sha"
fi
[[ "$sha" =~ ^[A-Za-z0-9._-]+$ ]] || fail "invalid Git SHA"
load_auth_context

if [[ -n "$CURRENT_SHA" && -n "$AUTH_TOKEN" ]]; then
    stage authentication "verify the existing JWT through the stable edge"
    verify_public "$CURRENT_SHA" || fail "existing stable edge verification failed"
elif [[ -n "$LEGACY_WEB_ID" && -n "$AUTH_TOKEN" ]]; then
    stage authentication "verify the existing JWT through the legacy public entry"
    verify_public_auth || fail "legacy public authentication verification failed"
fi

if [[ "$action" == prewarm ]]; then
    [[ -n "$ACTIVE_SLOT" ]] || fail "prewarm requires an active slot"
    target=$(other_slot "$ACTIVE_SLOT")
    prewarm_slot "$target" "$sha"
    stage ready "$target is ready while public traffic remains on $ACTIVE_SLOT"
    exit 0
fi

if [[ "$CURRENT_SHA" == "$sha" && -n "$ACTIVE_SLOT" ]]; then
    stage verification "deployment is already active; verify the stable edge"
    verify_public "$sha" || fail "current deployment verification failed"
    cleanup_inactive_slot
    cleanup_images
    exit 0
fi
OLD_SLOT=$ACTIVE_SLOT
OLD_SHA=$CURRENT_SHA
if [[ -n "$ACTIVE_SLOT" ]]; then
    target=$(other_slot "$ACTIVE_SLOT")
else
    target=blue
fi
prewarm_slot "$target" "$sha"

stage caddy-validation "render and validate the stable edge configuration"
render_edge_config "$target"
validate_edge_candidate

stage caddy-reload "atomically route Web and API to $target"
activate_edge_candidate

stage public-verification "verify the complete public path"
verify_public "$sha" || fail "public verification failed after cutover"

ACTIVE_SLOT=$target
CURRENT_SHA=$sha
PREVIOUS_SHA=$OLD_SHA
LAST_SUCCESS_SHA=$sha
write_state
STATE_COMMITTED=1

if [[ -n "$OLD_SLOT" && "$OLD_SLOT" != "$target" ]]; then
    drain_seconds=${DRAIN_SECONDS:-$(env_value DRAIN_SECONDS)}
    [[ -n "$drain_seconds" ]] || drain_seconds=30
    stage drain "wait ${drain_seconds}s for existing $OLD_SLOT requests"
    sleep "$drain_seconds"
    stage shutdown "gracefully stop old $OLD_SLOT API, then Web"
    compose stop "api-$OLD_SLOT"
    compose stop "web-$OLD_SLOT"
elif [[ -n "$LEGACY_API_ID" ]]; then
    drain_seconds=${DRAIN_SECONDS:-$(env_value DRAIN_SECONDS)}
    [[ -n "$drain_seconds" ]] || drain_seconds=30
    stage drain "wait ${drain_seconds}s before stopping the legacy API"
    sleep "$drain_seconds"
    stage shutdown "stop and remove legacy application containers"
    docker stop "$LEGACY_API_ID" >/dev/null
    docker rm "$LEGACY_API_ID" "$LEGACY_WEB_ID" >/dev/null
fi

stage cleanup "deployment succeeded"
cleanup_images
