#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CHECKOUT="$(basename "$REPO" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
PROJECT="${CV_VERIFY_PROJECT:-$CHECKOUT-verify}"
MODEL="${CV_MODEL:-claude-sonnet-5-5}"
EFFORT="${CV_EFFORT:-medium}"
EVIDENCE_ROOT="${CV_VERIFY_EVIDENCE_ROOT:-/tmp/cv-builder-verify}"

if [ "$PROJECT" = "$CHECKOUT" ]; then
  echo "refusing project $PROJECT: it is the checkout's own app, not a verify instance" >&2
  exit 2
fi
case "$MODEL" in *haiku*) echo "refusing CV_MODEL=$MODEL: verify never runs on Haiku" >&2; exit 2 ;; esac

dc() { docker compose -p "$PROJECT" --project-directory "$REPO" "$@"; }

running_env() { dc exec -T app printenv "$1" 2>/dev/null || true; }

has_key() {
  [ -n "${ANTHROPIC_API_KEY:-}" ] || grep -qE '^ANTHROPIC_API_KEY=.+' "$REPO/.env" 2>/dev/null
}

published_port() {
  { dc port app 8080 2>/dev/null || true; } | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p' | head -1
}

app_url() {
  local port
  port="$(published_port)"
  [ -n "$port" ] && echo "http://$PROJECT.localhost:$port"
}

free_port() {
  local p="${1:-18080}"
  while lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; do p=$((p + 1)); done
  echo "$p"
}

wait_ready() {
  local port="$1" code
  for _ in $(seq 1 120); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/me" || true)"
    if [ "$code" = "401" ]; then echo "ready: http://$PROJECT.localhost:$port (curl and browser; 127.0.0.1:$port also answers)"; return 0; fi
    sleep 1
  done
  echo "not ready after 120 s on port $port; app logs follow" >&2
  dc logs --tail 50 app >&2
  return 1
}

cmd_up() {
  local port
  has_key || { echo "Set ANTHROPIC_API_KEY in $REPO/.env; verify runs on the real model" >&2; exit 1; }
  port="$(published_port)"
  if [ -n "$port" ]; then
    local running_model running_effort
    running_model="$(running_env CV_MODEL)"
    running_effort="$(running_env CV_EFFORT)"
    if [ "$MODEL" = "$running_model" ] && [ "$EFFORT" = "$running_effort" ]; then
      echo "already up (project $PROJECT, CV_MODEL=$running_model CV_EFFORT=$running_effort)"
      wait_ready "$port"
      return
    fi
    echo "recreating app with CV_MODEL=$MODEL CV_EFFORT=$EFFORT (was $running_model, $running_effort); data is kept"
  else
    port="${PORT:-$(free_port 18080)}"
  fi
  echo "project $PROJECT: starting on port $port with CV_MODEL=$MODEL CV_EFFORT=$EFFORT"
  CV_MODEL="$MODEL" CV_EFFORT="$EFFORT" PORT="$port" dc up -d --build db app
  wait_ready "$port"
}

cmd_doctor() {
  local port body model logs fail=0
  echo "repo:    $REPO"
  echo "project: $PROJECT"
  dc ps app db
  port="$(published_port)"
  if [ -z "$port" ]; then echo "FAIL app has no published port; run: $0 up"; exit 1; fi
  echo "url:     http://$PROJECT.localhost:$port"
  body="$(curl -s "http://$PROJECT.localhost:$port/api/me" || true)"
  if [ "$body" = '{"error":"Log in to continue."}' ]; then echo "ok   GET /api/me answers 401 JSON"; else echo "FAIL GET /api/me returned: $body"; fail=1; fi
  if grep -q 'id="root"' <<<"$(curl -s "http://$PROJECT.localhost:$port/login" || true)"; then echo "ok   SPA served at /login"; else echo "FAIL SPA not served"; fail=1; fi
  model="$(running_env CV_MODEL)"
  echo "model:   CV_MODEL=$model CV_EFFORT=$(running_env CV_EFFORT)"
  if [ "$model" != "claude-sonnet-5-5" ]; then echo "WARN CV_MODEL=$model (verify default is claude-sonnet-5-5)"; fi
  if dc exec -T app sh -c '[ -n "$ANTHROPIC_API_KEY" ]' >/dev/null 2>&1; then echo "ok   ANTHROPIC_API_KEY set"; else echo "FAIL ANTHROPIC_API_KEY missing"; fail=1; fi
  logs="$(dc logs --no-color app 2>/dev/null || true)"
  if grep -q '"migrations applied"' <<<"$logs"; then echo "ok   migrations applied"; else echo "FAIL no 'migrations applied' log line"; fail=1; fi
  echo "image:   $(docker image inspect "$PROJECT-app" --format '{{.Created}}' 2>/dev/null || echo unknown) (HEAD $(git -C "$REPO" log -1 --format='%h %cI'))"
  exit "$fail"
}

cmd_evidence() {
  local dir
  dir="$EVIDENCE_ROOT/$(date +%Y%m%d-%H%M%S)-$PROJECT"
  mkdir -p "$dir"
  echo "$dir"
}

cmd_grab() {
  local dir="$1" reported="$2" name="$3" root
  [ -n "$dir" ] && [ -n "$reported" ] && [ -n "$name" ] || { echo "usage: $0 grab <evidence-dir> <path the MCP reported> <name>" >&2; exit 2; }
  for root in "" "${PLAYWRIGHT_MCP_ROOT:-}" "$HOME" "$REPO" "$PWD"; do
    local candidate="$reported"
    [ -n "$root" ] && candidate="$root/$reported"
    if [ -f "$candidate" ]; then
      mv "$candidate" "$dir/$name"
      echo "$dir/$name"
      return
    fi
  done
  echo "cannot find $reported; set PLAYWRIGHT_MCP_ROOT to the MCP workspace root" >&2
  exit 1
}

cmd_restart() {
  dc restart app
  wait_ready "$(published_port)"
}

cmd_psql() {
  dc exec -T db psql -U cv -d cv -tA -c "$1"
}

cmd_node() {
  local script="$1"
  [ -f "$script" ] || { echo "usage: $0 node <script.mjs> [args...] < input" >&2; exit 2; }
  shift
  dc exec -T app node --input-type=module -e "$(cat "$script")" "$@"
}

cmd_down() {
  local dir="${1:-}"
  if [ -n "$dir" ]; then
    mkdir -p "$dir"
    dc logs --no-color app >"$dir/app.log" 2>&1 || true
    dc ps -a >"$dir/compose-ps.txt" 2>&1 || true
    echo "saved app.log and compose-ps.txt to $dir"
  fi
  dc down -v --remove-orphans
  echo "project $PROJECT is down; evidence under $EVIDENCE_ROOT is kept"
}

case "${1:-}" in
  up) cmd_up ;;
  doctor) cmd_doctor ;;
  port) published_port ;;
  url) app_url ;;
  evidence) cmd_evidence ;;
  grab) shift; cmd_grab "${1:-}" "${2:-}" "${3:-}" ;;
  restart) cmd_restart ;;
  logs) shift; dc logs --no-color "$@" app ;;
  psql) shift; cmd_psql "$1" ;;
  node) shift; cmd_node "$@" ;;
  down) shift; cmd_down "${1:-}" ;;
  *)
    echo "usage: $0 up|doctor|port|url|evidence|grab <dir> <mcp-path> <name>|restart|logs [--tail N]|psql '<sql>'|node <script.mjs> [args]|down [evidence-dir]" >&2
    exit 2
    ;;
esac
