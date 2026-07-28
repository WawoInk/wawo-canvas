#!/bin/sh

set -u
umask 077

STATE_ROOT="${TMPDIR:-/tmp}/codex-knowledge-hooks"
WORK_DIR=""

log() {
  printf '[codex-after-task] %s\n' "$*" >&2
}

finish() {
  [ -z "$WORK_DIR" ] || rm -rf "$WORK_DIR"
  printf '{"continue":true}\n'
  exit 0
}

json_field() {
  printf '%s' "$HOOK_INPUT" | python3 -c '
import json
import sys

try:
    value = json.load(sys.stdin).get(sys.argv[1], "")
    print(value if isinstance(value, str) else "")
except Exception:
    pass
' "$1" 2>/dev/null
}

safe_id() {
  printf '%s' "$1" | tr -cd 'A-Za-z0-9._-'
}

snapshot_tree() {
  root=$1
  index="$STATE_ROOT/.index.$$"
  rm -f "$index" "$index.lock"

  if git -C "$root" rev-parse --verify HEAD >/dev/null 2>&1; then
    GIT_INDEX_FILE="$index" git -C "$root" read-tree HEAD >/dev/null 2>&1 || return 1
  else
    GIT_INDEX_FILE="$index" git -C "$root" read-tree --empty >/dev/null 2>&1 || return 1
  fi

  if ! GIT_INDEX_FILE="$index" git -C "$root" add -A -- . \
    ':(exclude).knowledge' ':(exclude).knowledge/**' \
    ':(exclude).playwright-cli' ':(exclude).playwright-cli/**' \
    ':(exclude)auto-test' ':(exclude)auto-test/**' >/dev/null 2>&1; then
    rm -f "$index" "$index.lock"
    return 1
  fi

  tree=$(GIT_INDEX_FILE="$index" git -C "$root" write-tree 2>/dev/null)
  status=$?
  rm -f "$index" "$index.lock"
  [ "$status" -eq 0 ] || return 1
  printf '%s\n' "$tree"
}

is_candidate_path() {
  case "$1" in
    src/domain/*|src/service/*|src/api/*|src/database/*|\
    service/*|handler/*|repository/*|model/*|router/*|middleware/*|config/*|\
    web/src/services/*|web/src/stores/*|canvas-agent/src/*|infra/*|deploy/*|\
    main.go|Dockerfile|Dockerfile.*|docker-compose*.yml|docker-compose*.yaml|Caddyfile|nginx.conf)
      return 0
      ;;
  esac
  return 1
}

is_ignored_path() {
  case "$1" in
    *.md|*.mdx|*_test.go|*.test.*|*.spec.*|*/test/*|*/tests/*|*/__tests__/*)
      return 0
      ;;
  esac
  return 1
}

trap 'log "interrupted; continuing without knowledge maintenance"; finish' HUP INT TERM

HOOK_INPUT=$(cat 2>/dev/null)
cwd=$(json_field cwd)
session_id=$(safe_id "$(json_field session_id)")
turn_id=$(safe_id "$(json_field turn_id)")

[ -n "$cwd" ] || cwd=$PWD
[ -n "$session_id" ] || session_id=session
[ -n "$turn_id" ] || turn_id=turn

root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)
if [ -z "$root" ] || [ ! -d "$root/.knowledge" ]; then
  log "skip: Git repository or .knowledge directory not found"
  finish
fi

baseline_file="$STATE_ROOT/$session_id/$turn_id.tree"
if [ ! -s "$baseline_file" ]; then
  log "skip: no before-task baseline for turn $turn_id"
  finish
fi

baseline_tree=$(cat "$baseline_file")
if ! git -C "$root" cat-file -e "$baseline_tree^{tree}" 2>/dev/null; then
  log "skip: saved baseline is no longer available"
  rm -f "$baseline_file"
  finish
fi

current_tree=$(snapshot_tree "$root")
if [ -z "$current_tree" ]; then
  log "warning: failed to snapshot the completed turn"
  finish
fi

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/codex-memory-agent.XXXXXX")
if [ -z "$WORK_DIR" ]; then
  log "warning: failed to create temporary directory"
  finish
fi

changed_file="$WORK_DIR/changed-files"
candidate_file="$WORK_DIR/candidate-files"
status_file="$WORK_DIR/name-status"
patch_file="$WORK_DIR/changes.diff"
semantic_file="$WORK_DIR/semantic-lines"

if ! git -C "$root" diff --name-only "$baseline_tree" "$current_tree" -- > "$changed_file"; then
  log "warning: git diff --name-only failed"
  finish
fi
rm -f "$baseline_file"

while IFS= read -r path; do
  is_candidate_path "$path" || continue
  is_ignored_path "$path" && continue
  printf '%s\n' "$path" >> "$candidate_file"
done < "$changed_file"

if [ ! -s "$candidate_file" ]; then
  log "skip: this turn did not change knowledge-sensitive code"
  finish
fi

set --
while IFS= read -r path; do
  set -- "$@" "$path"
done < "$candidate_file"

if ! git -C "$root" diff --name-status --find-renames "$baseline_tree" "$current_tree" -- "$@" > "$status_file" ||
   ! git -C "$root" diff --no-ext-diff --unified=3 "$baseline_tree" "$current_tree" -- "$@" > "$patch_file"; then
  log "warning: failed to collect the turn diff"
  finish
fi

grep -E '^[+-]' "$patch_file" |
  grep -Ev '^(\+\+\+|---)' |
  sed 's/^[+-][[:space:]]*//' |
  grep -Ev '^[[:space:]]*($|//|#|/\*|\*|\*/)' > "$semantic_file" || :

if [ ! -s "$semantic_file" ]; then
  log "skip: only whitespace or comments changed"
  finish
fi

reason=""
if grep -Eq '^(A|D|R[0-9]+|C[0-9]+)[[:space:]]' "$status_file"; then
  reason="新增、删除或移动核心文件"
elif grep -Eq '^(src/api/|router/|handler/|web/src/services/api/)' "$candidate_file" &&
     grep -Eqi '(\.(GET|POST|PUT|PATCH|DELETE)\(|(GET|POST|PUT|PATCH|DELETE)[[:space:]]+/|router\.(Group|Use)\(|json:"[^"]+"|binding:"|type[[:space:]]+[A-Za-z0-9_]*(Request|Response)[[:space:]]+struct)' "$semantic_file"; then
  reason="API 路由或请求响应合同变化"
elif grep -Eq '^(src/database/|model/|repository/)' "$candidate_file" &&
     grep -Eqi '(gorm:"|AutoMigrate|CREATE[[:space:]]+TABLE|ALTER[[:space:]]+TABLE|DROP[[:space:]]+(TABLE|COLUMN)|ADD[[:space:]]+COLUMN|TableName\(|primaryKey|uniqueIndex|foreignKey|CHECK[[:space:]]*\(|^[[:space:]]*[A-Z][A-Za-z0-9_]*[[:space:]]+\*?(string|bool|int|uint|float|time\.Time))' "$semantic_file"; then
  reason="数据库结构或持久化模型变化"
elif grep -Eq '^(infra/|deploy/|canvas-agent/src/|config/|main\.go$|Dockerfile|docker-compose|Caddyfile|nginx\.conf)' "$candidate_file" &&
     grep -Eqi '(provider|adapter|service|container|healthcheck|volume|network|route|entrypoint|depends_on|worker|scheduler|startup|shutdown)' "$semantic_file"; then
  reason="运行拓扑或架构组成变化"
elif grep -Eq '^(src/domain/|src/service/|service/)' "$candidate_file" &&
     grep -Eqi '(type[[:space:]]+[A-Za-z0-9_]*(Service|Provider|Adapter|Orchestrator|Worker|Scheduler)|type[[:space:]]+[A-Za-z0-9_]+[[:space:]]+interface|func[[:space:]]+New[A-Z]|provider|adapter|channel|register|registry)' "$semantic_file"; then
  reason="核心模块或服务边界变化"
fi

if [ -z "$reason" ]; then
  log "skip: no structural change; likely a refactor, formatting change, or simple bug fix"
  finish
fi

codex_bin=$(command -v codex 2>/dev/null)
if [ -z "$codex_bin" ]; then
  log "warning: codex executable not found; Memory Update Agent was not started"
  finish
fi

schema_file="$WORK_DIR/output-schema.json"
prompt_file="$WORK_DIR/prompt.txt"
result_file="$WORK_DIR/result.json"
agent_log="$WORK_DIR/agent.log"

cat > "$schema_file" <<'EOF'
{
  "type": "object",
  "additionalProperties": false,
  "required": ["summary", "updates"],
  "properties": {
    "summary": {
      "type": "string"
    },
    "updates": {
      "type": "array",
      "maxItems": 5,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["path", "content"],
        "properties": {
          "path": {
            "type": "string"
          },
          "content": {
            "type": "string"
          }
        }
      }
    }
  }
}
EOF

{
  cat <<EOF
You are the independent Memory Update Agent for this repository.

Your only responsibility is deciding whether the completed code diff changes durable project knowledge, then returning complete Markdown replacements for the affected files under .knowledge/.

Rules:
- Read .knowledge/index.md first, then only the relevant existing knowledge files.
- Treat current code, database constraints, and tests as the source of truth.
- Update knowledge only for a new module, architecture or module-boundary change, API contract change, or database/schema change.
- Return no updates for variable renames, formatting, comments, tests, routine refactors, or simple bug fixes.
- Preserve the existing .knowledge structure. Prefer updating an existing indexed document; do not create new directories.
- Do not modify any file or run build/test commands. Your sandbox is intentionally read-only.
- Each update path must stay under .knowledge/ and end in .md.
- Each content value must be the complete replacement Markdown for that file.
- If no durable knowledge update is justified, return an empty updates array.

Heuristic trigger: $reason

Changed knowledge-sensitive paths:
EOF
  cat "$candidate_file"
  printf '\nGit diff for this turn:\n\n'
  cat "$patch_file"
} > "$prompt_file"

log "trigger: $reason; starting isolated Memory Update Agent"
if ! "$codex_bin" exec \
  --ephemeral \
  --disable hooks \
  --sandbox read-only \
  -C "$root" \
  --output-schema "$schema_file" \
  -o "$result_file" \
  - < "$prompt_file" > "$agent_log" 2>&1; then
  log "warning: Memory Update Agent failed; normal development continues"
  tail -n 20 "$agent_log" >&2
  finish
fi

if [ ! -s "$result_file" ]; then
  log "warning: Memory Update Agent returned no structured result"
  finish
fi

applied=$(python3 - "$root" "$result_file" <<'PY'
import json
import os
import sys
import tempfile
from pathlib import Path

root = Path(sys.argv[1]).resolve()
knowledge = (root / ".knowledge").resolve()
data = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
updates = data.get("updates", [])

if not isinstance(updates, list) or len(updates) > 5:
    raise ValueError("invalid updates list")

validated = []
for update in updates:
    if not isinstance(update, dict):
        raise ValueError("invalid update")
    raw_path = update.get("path")
    content = update.get("content")
    if not isinstance(raw_path, str) or not isinstance(content, str):
        raise ValueError("invalid update fields")

    relative = Path(raw_path)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"unsafe path: {raw_path}")
    if len(relative.parts) < 2 or relative.parts[0] != ".knowledge" or relative.suffix != ".md":
        raise ValueError(f"path must be a .knowledge Markdown file: {raw_path}")

    target = (root / relative).resolve()
    if knowledge != target.parent and knowledge not in target.parents:
        raise ValueError(f"path escaped .knowledge: {raw_path}")
    if not target.parent.is_dir():
        raise ValueError(f"new knowledge directories are not allowed: {raw_path}")
    if not content.lstrip().startswith("#"):
        raise ValueError(f"Markdown must start with a heading: {raw_path}")

    validated.append((target, content))

for target, content in validated:
    current = target.read_text(encoding="utf-8") if target.exists() else None
    if current == content:
        continue

    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
        os.chmod(temporary, (target.stat().st_mode & 0o777) if target.exists() else 0o644)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(target.relative_to(root))
PY
)
apply_status=$?

if [ "$apply_status" -ne 0 ]; then
  log "warning: rejected unsafe or invalid Memory Update Agent output"
  finish
fi

if [ -n "$applied" ]; then
  log "updated knowledge files: $(printf '%s' "$applied" | tr '\n' ' ')"
else
  log "Memory Update Agent found no durable knowledge change"
fi

finish
