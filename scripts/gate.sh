#!/usr/bin/env bash
# 提交门禁的机器部分（G0 的门 1/2/4/6）。
# 门 3（/review）与门 5（effective-testing）是 skill 动作，由执行 agent 显式完成，脚本不覆盖。
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-full}"

# pnpm 可能不在钩子/子进程的 PATH 上（nvm 惰性函数场景）——找不到时扫 nvm
# 版本目录，并把 pnpm 所在目录注入 PATH（pnpm 内部子进程也要能再找到它）。
if ! command -v pnpm >/dev/null 2>&1; then
  for d in "$HOME"/.nvm/versions/node/*/bin; do
    if [ -x "$d/pnpm" ]; then export PATH="$d:$PATH"; break; fi
  done
fi
command -v pnpm >/dev/null 2>&1 || { echo "_GATE_FAIL pnpm 不可用（PATH 无且 nvm 目录未找到）"; exit 1; }

require_env() {
  [[ -f .env ]] || { echo "_GATE_FAIL .env 不存在（cp .env.example .env 并填值）"; exit 1; }
  grep -q '^ENABLE_INTEGRATION_TESTS=true' .env \
    || { echo "_GATE_FAIL ENABLE_INTEGRATION_TESTS!=true：集成测试会静默跳过（假绿）"; exit 1; }
  local key
  key="$(grep '^OPENAI_API_KEY=' .env | head -1 | cut -d= -f2-)"
  [[ -n "$key" && "$key" != "your_api_key_here" ]] \
    || { echo "_GATE_FAIL OPENAI_API_KEY 缺失或为占位符"; exit 1; }
}

assert_no_skipped() {
  local log="$1"
  # 已知例外：llm-client 03-multi-key-switching 的 2 个用例在 apiKey2 未配置时
  # itif 跳过（可选能力，需第二把真实 key）。允许恰好 2 个 skip，超出即失败。
  # 只数 vitest 的 Tests 汇总行——文件行 "✓ xxx (3 tests | 2 skipped)" 描述的是
  # 同一批 skip，一起求和会把已知的 2 个数成 4 而误判假绿；"Test Files" 行不含
  # "Tests +数字" 结构，天然排除。锚定 "(^|:) *Tests"：pnpm -r 日志带
  # "pkg test:intg:" 前缀（行首非 Tests），裸跑则行首空白——两种形态都覆盖，
  # 同时兼容 "N passed | M skipped" 与全 skip 包的 "M skipped (M)"。
  local n
  n="$(grep -E '(^|:) *Tests +[0-9]+' "$log" | grep -oE '[0-9]+ skipped' | grep -oE '[0-9]+' | paste -sd+ - | bc 2>/dev/null || echo 0)"
  if [ "${n:-0}" -gt 2 ]; then
    echo "_GATE_FAIL 存在 ${n} 个 skipped 集成用例（已知例外上限 2：multi-key apiKey2 未配）——疑似假绿，禁止提交"
    exit 1
  fi
  [ "${n:-0}" -eq 0 ] || echo "_GATE_WARN ${n} 个已知 skip（multi-key apiKey2 未配置；配置后自动启用）"
}

case "$MODE" in
  static)
    pnpm build || { echo "_GATE_FAIL build"; exit 1; }
    pnpm lint || { echo "_GATE_FAIL lint"; exit 1; }
    ;;
  unit)   pnpm test:unit ;;
  intg)
    require_env
    log="$(mktemp)"
    pnpm test:intg 2>&1 | tee "$log"
    assert_no_skipped "$log"
    ;;
  full)
    # 注意：case 分支内 set -e 对 AND-list 失败不生效（bash 陷阱：a && b && c 失败
    # 不会退出，后续 intg 照跑）——必须逐行显式退出。
    pnpm build || { echo "_GATE_FAIL build"; exit 1; }
    pnpm lint || { echo "_GATE_FAIL lint"; exit 1; }
    pnpm test:unit || { echo "_GATE_FAIL unit"; exit 1; }
    log="$(mktemp)"
    pnpm test:intg 2>&1 | tee "$log" || { echo "_GATE_FAIL intg"; exit 1; }
    assert_no_skipped "$log"
    echo "_GATE_OK 门1/2/4/6 通过；门3(/review) 与门5(effective-testing) 由 agent 显式完成后方可提交"
    ;;
  *) echo "用法: bash scripts/gate.sh [static|unit|intg|full]"; exit 2 ;;
esac
