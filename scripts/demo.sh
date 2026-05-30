#!/usr/bin/env bash
# nerve 90-second demo
set -euo pipefail

DB="${NERVE_DB:-/tmp/nerve-demo.db}"
PORT="${NERVE_PORT:-7777}"
URL="http://127.0.0.1:${PORT}"
export NERVE_DB="$DB"
export NERVE_PORT="$PORT"

CLI="npx tsx --tsconfig tsconfig.json apps/cli/src/index.ts"
SERVER="npx tsx --tsconfig tsconfig.json apps/server/src/index.ts"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
grn()   { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()   { printf '\033[33m%s\033[0m\n' "$*"; }
cyn()   { printf '\033[36m%s\033[0m\n' "$*"; }
hdr()   { echo; cyn "── $* ─────────────────────────────────────────────"; }

rm -f "$DB"
hdr "1/6  init"
$CLI init >/dev/null
grn "✓ initialized at $DB"

hdr "2/6  import 50 traces"
$CLI import examples/openai-traces/*.jsonl

hdr "3/6  learn (teachings + patch candidates)"
$CLI learn

hdr "4/6  generate evals"
$CLI evals gen

hdr "5/6  replay (before/after delta)"
$CLI replay --patch all --sample 50

hdr "6/6  approve patches & compile a fresh task via API"
$SERVER &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT
sleep 1.5

PATCH_IDS=$($CLI patches list --status proposed | awk '{print $1}' | grep -v '^$' | grep '^pat_' || true)
for pid in $PATCH_IDS; do $CLI patches approve "$pid" >/dev/null; done
grn "✓ approved $(echo "$PATCH_IDS" | wc -w | tr -d ' ') patches"

echo
ylw "POST $URL/v1/compile-task  -d @examples/sdk-demo/task.json"
curl -sS -X POST "$URL/v1/compile-task" \
  -H 'content-type: application/json' \
  --data "$(jq -c --arg id "tsk_$(date +%s)" --arg ts "$(date -u +%FT%TZ)" \
    '{ task: (. + {schema_version:"0.1", task_id:$id, created_at:$ts}) }' \
    examples/sdk-demo/task.json)" \
  | jq '{plan_id: .plan.plan_id, model: .plan.model.primary, teachings: (.teaching_program.teachings // []) | length, verifiers: [.plan.verifiers[].kind], rationale: .plan.rationale, receipt: .receipt_id}'

echo
grn "✓ demo complete — agent received a ComputePlan with $(curl -sS $URL/v1/patches?status=live | jq '.patches | length') live patches."
