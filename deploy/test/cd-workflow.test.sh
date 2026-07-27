#!/usr/bin/env bash
set -Eeuo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
workflow="$root/.github/workflows/cd.yml"

grep -Fq "workflow_dispatch:" "$workflow"
grep -Fq -- "- deploy" "$workflow"
grep -Fq -- "- rollback" "$workflow"
grep -Fq "reset_sessions:" "$workflow"
grep -Fq "group: production-deploy" "$workflow"
grep -Fq "cancel-in-progress: false" "$workflow"
grep -Fq "RESET_SESSIONS: \${{ inputs.reset_sessions" "$workflow"
grep -Fq 'TARGET_SHA: ${{ github.sha }}' "$workflow"
grep -Fq "./blue-green.sh deploy '\$TARGET_SHA'" "$workflow"
grep -Fq "RESET_SESSIONS=1 ./blue-green.sh deploy '\$TARGET_SHA'" "$workflow"
grep -Fq "./blue-green.sh rollback" "$workflow"
grep -Fq "ALLOW_MISSING_AUTH=1 ./blue-green.sh rollback" "$workflow"
grep -Fq "dotenv_line()" "$workflow"
grep -Fq "deploy-login.json" "$workflow"
grep -Fq "failed fresh login after JWT secret rotation" "$root/deploy/blue-green.sh"
grep -Fq "deploy/test/blue-green.test.sh" "$root/.github/workflows/ci.yml"

edge_block=$(sed -n '/^  edge:/,/^  api-blue:/p' "$root/deploy/docker-compose.prod.yml")
grep -Fq "./state/caddy:/etc/caddy/deploy" <<< "$edge_block"
if grep -Fq "env_file:" <<< "$edge_block"; then
    echo "edge must not receive the production application environment" >&2
    exit 1
fi

if grep -Eq '^[[:space:]]+push:' "$workflow"; then
    echo "production CD must remain manual" >&2
    exit 1
fi
if grep -Eq 'docker compose .* down|infinite-canvas[^[:space:]]*:(latest|rollback)|docker tag .*:(latest|rollback)' "$workflow"; then
    echo "production CD must not use whole-stack down or mutable runtime tags" >&2
    exit 1
fi
