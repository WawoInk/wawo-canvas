#!/usr/bin/env bash
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
PWCLI="${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/playwright_cli.sh"
SESSION="infinite-canvas-auto-test-20260723-$$"
STATUS=0
mkdir -p "$DIR/logs" "$DIR/screenshots"

{
    echo "date=2026-07-23"
    echo "base_url=$BASE_URL"
    echo "node=$(node --version)"
    echo "go=$(go version)"
    echo "bun=$(bun --version)"
} > "$DIR/environment.txt"

gh issue list --limit 100 --json number,title,state,labels,updatedAt | jq -r '.[] | select(.number >= 15 and .number <= 25) | "#\(.number)\t\(.state)\t\(.title)"' > "$DIR/issues.tsv"

(
    cd "$ROOT"
    GIN_MODE=release go test ./router -run '(Account|Enterprise)' -count=1 -v
) > "$DIR/logs/go-router.log" 2>&1 || STATUS=1

(
    cd "$ROOT"
    bun test web/test/account-access.test.ts web/test/account-storage.test.ts web/test/enterprise-assets.test.ts web/test/session-monitor.test.ts --rerun-each 3
) > "$DIR/logs/bun-frontend.log" 2>&1 || STATUS=1

(
    cd "$ROOT"
    BASE_URL="$BASE_URL" ADMIN_USERNAME="$ADMIN_USERNAME" ADMIN_PASSWORD="$ADMIN_PASSWORD" node "$DIR/live-api.mjs" "$DIR"
) > "$DIR/logs/live-api.log" 2>&1 || STATUS=1

if [[ -f "$DIR/state.json" ]] && jq -e '.ready == true' "$DIR/state.json" >/dev/null; then
    node - "$DIR" <<'NODE'
const fs = require("node:fs");
const dir = process.argv[2];
const state = JSON.parse(fs.readFileSync(`${dir}/state.json`, "utf8"));
const template = fs.readFileSync(`${dir}/ui-smoke.template.js`, "utf8");
fs.writeFileSync(`${dir}/ui-smoke.runtime.js`, template.replace("__STATE__", JSON.stringify(state)).replace("__OUTPUT_DIR__", JSON.stringify(dir)));
NODE

    PLAYWRIGHT_CLI_SESSION="$SESSION" "$PWCLI" open "$BASE_URL" > "$DIR/logs/playwright-open.log" 2>&1 || STATUS=1
    PLAYWRIGHT_CLI_SESSION="$SESSION" "$PWCLI" run-code --filename "$DIR/ui-smoke.runtime.js" > "$DIR/logs/playwright-ui.log" 2>&1 || STATUS=1
    grep -q '^### Error' "$DIR/logs/playwright-ui.log" && STATUS=1
    PLAYWRIGHT_CLI_SESSION="$SESSION" "$PWCLI" console warning > "$DIR/logs/playwright-console.log" 2>&1 || true
    PLAYWRIGHT_CLI_SESSION="$SESSION" "$PWCLI" close > "$DIR/logs/playwright-close.log" 2>&1 || true
    node "$DIR/cleanup.mjs" "$DIR" > "$DIR/logs/cleanup.log" 2>&1 || STATUS=1
else
    printf '%s\n' 'live-api 未生成完整 state.json，跳过 UI 测试。' > "$DIR/logs/playwright-ui.log"
    [[ -f "$DIR/state.json" ]] && node "$DIR/cleanup.mjs" "$DIR" > "$DIR/logs/cleanup.log" 2>&1 || true
fi

node - "$DIR" <<'NODE'
const fs = require("node:fs");
const dir = process.argv[2];
const logPath = `${dir}/logs/playwright-ui.log`;
if (fs.existsSync(logPath)) {
    const raw = fs.readFileSync(logPath, "utf8");
    const clean = raw.split("\n### Ran Playwright code")[0].trimEnd() + "\n";
    fs.writeFileSync(logPath, clean);
    const match = clean.match(/^### Result\n(\{.*\})$/m);
    if (match) fs.writeFileSync(`${dir}/ui-results.json`, `${JSON.stringify(JSON.parse(match[1]), null, 2)}\n`);
}
for (const name of ["state.json", "ui-smoke.runtime.js"]) {
    const file = `${dir}/${name}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
}
NODE

exit "$STATUS"
