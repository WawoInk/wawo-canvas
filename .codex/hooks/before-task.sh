#!/bin/sh

set -u
umask 077

STATE_ROOT="${TMPDIR:-/tmp}/codex-knowledge-hooks"

log() {
  printf '[codex-before-task] %s\n' "$*" >&2
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

HOOK_INPUT=$(cat 2>/dev/null)
cwd=$(json_field cwd)
prompt=$(json_field prompt)
session_id=$(safe_id "$(json_field session_id)")
turn_id=$(safe_id "$(json_field turn_id)")

[ -n "$cwd" ] || cwd=$PWD
[ -n "$session_id" ] || session_id=session
[ -n "$turn_id" ] || turn_id=turn

root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)
if [ -z "$root" ]; then
  log "skip: current directory is not a Git repository"
  exit 0
fi

state_dir="$STATE_ROOT/$session_id"
if mkdir -p "$state_dir"; then
  if tree=$(snapshot_tree "$root"); then
    printf '%s\n' "$tree" > "$state_dir/$turn_id.tree"
    log "saved worktree baseline for turn $turn_id"
  else
    log "warning: failed to save worktree baseline; after-task will skip this turn"
  fi
else
  log "warning: failed to create state directory; after-task will skip this turn"
fi

knowledge="$root/.knowledge"
index="$knowledge/index.md"
if [ ! -f "$index" ]; then
  log "skip: .knowledge/index.md does not exist"
  exit 0
fi

selected=$(printf '%s' "$prompt" | python3 -c '
import re
import sys

prompt = sys.stdin.read().lower()
rules = [
    ("generation.md", r"\b(generation|provider|adapter|channel|model profile|seedance|vidu|image generation|video generation)\b|生成|模型渠道|视频|生图|图片生成|音频"),
    ("canvas.md", r"\b(canvas|viewport|replica|webdav)\b|画布|节点|连线"),
    ("database.md", r"\b(database|schema|table|column|gorm|migration|transaction|postgres|sql)\b|数据库|表结构|字段|索引|事务|持久化"),
    ("api.md", r"\b(api|http|endpoint|route|router|request|response|oauth|webhook)\b|接口|路由|请求|响应|鉴权|回调"),
    ("runtime-supporting-systems.md", r"\b(deploy|docker|caddy|infra|hook|codex|plugin|mcp|environment|startup|shutdown)\b|部署|环境变量|启动|关闭|插件|钩子|生命周期自动化"),
    ("frontend-modules.md", r"\b(frontend|react|zustand|antd|tailwind|page|component|store|web/src)\b|前端|页面|组件|状态"),
    ("backend-modules.md", r"\b(backend|handler|service|repository|middleware|auth|user|enterprise|credit)\b|后端|认证|用户|企业|积分|权限"),
    ("business-flows.md", r"\b(flow|lifecycle|sync|billing|account switch|login)\b|业务流程|生命周期|同步|计费|账号切换|登录"),
    ("architecture.md", r"\b(architecture|boundary|module|service split|topology|dependency)\b|架构|边界|模块|拆分|拓扑|依赖"),
]

ranked = []
for order, (name, pattern) in enumerate(rules):
    score = len(re.findall(pattern, prompt, re.IGNORECASE))
    if score:
        ranked.append((-score, order, name))

chosen = [name for _, _, name in sorted(ranked)[:3]]
if not chosen:
    chosen = ["architecture.md", "business-flows.md"]
print("\n".join(chosen))
' 2>/dev/null)

[ -n "$selected" ] || selected="architecture.md
business-flows.md"

loaded=""
for doc in $selected; do
  [ -f "$knowledge/$doc" ] || continue
  loaded="${loaded}${loaded:+, }$doc"
done

log "loaded index.md${loaded:+, $loaded}"
printf '<project-knowledge-context>\n'
printf '以下内容由项目 Before Task hook 按当前任务自动加载。事实冲突时以当前代码、数据库约束和测试为准。\n'
printf '\n--- .knowledge/index.md ---\n'
cat "$index"

for doc in $selected; do
  [ -f "$knowledge/$doc" ] || continue
  printf '\n--- .knowledge/%s ---\n' "$doc"
  cat "$knowledge/$doc"
done

printf '\n</project-knowledge-context>\n'
exit 0
