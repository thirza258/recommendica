#!/usr/bin/env bash
#
# Recommendica — deploy the Docker Compose stack (backend, db, frontend).
#
# Wraps `docker compose up --build -d` with the checks that turn a deploy from
# "the command exited 0" into "the app is actually serving": environment
# validation up front, then health gating on the published ports afterwards.
#
# Usage:
#   ./deploy.sh                        # build + deploy + verify
#   ./deploy.sh --env-file .env.staging
#   ./deploy.sh --no-build             # restart from existing images
#   ./deploy.sh --service backend      # rebuild/restart one service
#   ./deploy.sh --logs                 # follow logs for the running stack
#   ./deploy.sh --down                 # stop the stack (keeps volumes)
#   ./deploy.sh --status               # show what is running
#
# Exit codes: 0 ok · 1 usage/preflight failure · 2 deploy failed · 3 unhealthy

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Defaults ────────────────────────────────────────────────────────────────
ENV_FILE=".env.production"
DO_BUILD=1
SERVICE=""
ACTION="deploy"
HEALTH_TIMEOUT=180   # seconds to wait for backend liveness
# Migrations + collectstatic run before gunicorn binds, so first boot is slow.

# ── Output helpers ──────────────────────────────────────────────────────────
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

step() { printf '\n%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '\n%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit "${2:-1}"; }
dim()  { printf '    %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }

# Print the header comment block verbatim, stopping at the first code line, so
# the help text can never drift out of sync with the documentation above.
usage() {
  awk 'NR==1 && /^#!/ {next} /^#$/ {print ""; next} /^#/ {sub(/^# /,""); print; next} {exit}' \
    "${BASH_SOURCE[0]}"
}

# ── Arguments ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?--env-file needs a path}"; shift 2 ;;
    --no-build) DO_BUILD=0; shift ;;
    --service)  SERVICE="${2:?--service needs a name}"; shift 2 ;;
    --logs)     ACTION="logs"; shift ;;
    --down)     ACTION="down"; shift ;;
    --status)   ACTION="status"; shift ;;
    -h|--help)  usage; exit 0 ;;
    *)          die "unknown option: $1 (try --help)" ;;
  esac
done

# Optional service filter held in an array so an empty value expands to no
# argument at all. Written for bash 3.2 (the macOS system bash), which errors
# on "${ARR[@]}" when ARR is empty under `set -u` — hence the +expansion guard.
TARGET=()
if [[ -n "$SERVICE" ]]; then TARGET=("$SERVICE"); fi

# ── Compose wrapper ─────────────────────────────────────────────────────────
# `--env-file` is a top-level flag and must precede the subcommand.
compose() {
  if [[ -f "$ENV_FILE" ]]; then
    docker compose --env-file "$ENV_FILE" "$@"
  else
    docker compose "$@"
  fi
}

# ── Preflight ───────────────────────────────────────────────────────────────
preflight() {
  step "Preflight"

  command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH"
  docker compose version >/dev/null 2>&1 \
    || die "docker compose v2 is unavailable (this script does not use docker-compose v1)"
  docker info >/dev/null 2>&1 \
    || die "the Docker daemon is not running — start Docker Desktop and retry"
  ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') is running"

  [[ -f docker-compose.yml ]] || die "docker-compose.yml not found in $SCRIPT_DIR"

  if [[ ! -f "$ENV_FILE" ]]; then
    warn "$ENV_FILE not found — compose will fall back to the defaults baked"
    warn "into docker-compose.yml. Those defaults are for local use only."
    if [[ -f .env.example ]]; then
      dim "start from the template:  cp .env.example $ENV_FILE"
    fi
    # Not fatal: the compose file supplies a default for every variable.
  else
    ok "environment: $ENV_FILE"

    # An env file committed to git leaks every secret in it.
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
       && git ls-files --error-unmatch "$ENV_FILE" >/dev/null 2>&1; then
      warn "$ENV_FILE is tracked by git — secrets in it are in your history"
    fi

    # Read values without sourcing the file (no arbitrary code execution).
    env_value() {
      sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" \
        | tail -n1 | sed 's/^["'\'']//; s/["'\'']$//'
    }

    local secret debug
    secret="$(env_value SECRET_KEY)"
    if [[ -z "$secret" || "$secret" == "your-secret-key" ]]; then
      warn "SECRET_KEY is unset or still the placeholder — set a real one before"
      warn "exposing this deployment to anything but localhost"
    fi

    # `tr` rather than ${var,,} — the latter needs bash 4, macOS ships 3.2.
    debug="$(env_value DEBUG | tr '[:upper:]' '[:lower:]')"
    if [[ "$debug" == "true" || "$debug" == "1" ]]; then
      warn "DEBUG is enabled — Django will serve tracebacks to clients"
    fi

    # The pipeline needs a model provider; without one every query 5xx's.
    if [[ -z "$(env_value OPENROUTER_API_KEY)" && -z "$(env_value OPENAI_API_KEY)" ]]; then
      warn "neither OPENROUTER_API_KEY nor OPENAI_API_KEY is set — generation will fail"
    fi

    if [[ -z "$(env_value DJANGO_ALLOWED_HOSTS)" ]]; then
      dim "DJANGO_ALLOWED_HOSTS unset; using the compose default (localhost only)"
    fi
  fi
}

# ── Health gating ───────────────────────────────────────────────────────────

# Resolve the host:port a service's container port is published on, so the
# checks keep working if the port mappings in docker-compose.yml change.
published() { # published <service> <container-port>
  compose port "$1" "$2" 2>/dev/null | tail -n1 | sed 's/0\.0\.0\.0/127.0.0.1/'
}

http_code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || echo "000"; }

wait_for_backend() {
  local addr url deadline code
  addr="$(published backend 8000)"
  [[ -n "$addr" ]] || { warn "backend port is not published; skipping health check"; return 0; }
  url="http://${addr}/api/v1/health/"

  step "Waiting for backend liveness"
  dim "$url"
  deadline=$(( SECONDS + HEALTH_TIMEOUT ))

  while (( SECONDS < deadline )); do
    # A container that has already exited will never become healthy.
    if [[ "$(compose ps -q backend | xargs -r docker inspect -f '{{.State.Running}}' 2>/dev/null)" == "false" ]]; then
      warn "the backend container exited during startup"
      compose logs --tail 60 backend || true
      return 1
    fi

    code="$(http_code "$url")"
    if [[ "$code" == "200" ]]; then
      ok "backend is live (${SECONDS}s)"
      return 0
    fi
    sleep 3
  done

  warn "backend did not pass liveness within ${HEALTH_TIMEOUT}s (last status: ${code:-none})"
  compose logs --tail 60 backend || true
  return 1
}

check_readiness() {
  local addr code
  addr="$(published backend 8000)" || return 0
  [[ -n "$addr" ]] || return 0

  step "Checking readiness"
  code="$(http_code "http://${addr}/api/v1/health/ready/")"
  case "$code" in
    200) ok "dependencies reachable (Chroma, embeddings, model provider)" ;;
    503)
      # Deliberately not fatal: the app is up and will report the reason
      # itself. Chroma lives outside this compose file, so a cold vector
      # store is a configuration issue, not a failed deploy.
      warn "readiness returned 503 — a dependency is unreachable"
      dim "detail: curl -s http://${addr}/api/v1/health/ready/"
      ;;
    *) warn "readiness returned ${code}" ;;
  esac
}

check_frontend() {
  local addr code
  addr="$(published frontend 80)"
  [[ -n "$addr" ]] || { warn "frontend port is not published; skipping check"; return 0; }

  step "Checking frontend"
  code="$(http_code "http://${addr}/")"
  if [[ "$code" == "200" ]]; then
    ok "frontend is serving at http://${addr}/"
  else
    warn "frontend returned ${code} at http://${addr}/"
    compose logs --tail 30 frontend || true
    return 1
  fi
}

summary() {
  local backend_addr frontend_addr
  backend_addr="$(published backend 8000)"
  frontend_addr="$(published frontend 80)"

  step "Deployed"
  compose ps
  echo
  [[ -n "$frontend_addr" ]] && printf '  app  %shttp://%s/%s\n' "$C_GREEN" "$frontend_addr" "$C_RESET"
  [[ -n "$backend_addr" ]]  && printf '  api  %shttp://%s/api/v1/%s\n' "$C_GREEN" "$backend_addr" "$C_RESET"
  echo
  dim "logs:    ./deploy.sh --logs"
  dim "stop:    ./deploy.sh --down"
  dim "status:  ./deploy.sh --status"
}

# ── Actions ─────────────────────────────────────────────────────────────────
case "$ACTION" in
  logs)
    compose logs -f --tail 100 ${TARGET[@]+"${TARGET[@]}"}
    ;;

  status)
    compose ps
    exit 0
    ;;

  down)
    step "Stopping the stack"
    # `down` without -v: named volumes (postgres_data, backend_static) survive,
    # so this never silently destroys the database.
    compose down
    ok "stopped — volumes preserved (remove them with: docker compose down -v)"
    exit 0
    ;;

  deploy)
    preflight

    if (( DO_BUILD )); then
      step "Building images${SERVICE:+ ($SERVICE)}"
      compose build ${TARGET[@]+"${TARGET[@]}"} || die "image build failed" 2
      ok "build complete"
    else
      dim "skipping build (--no-build)"
    fi

    step "Starting containers${SERVICE:+ ($SERVICE)}"
    # --remove-orphans clears containers from services deleted since last deploy.
    compose up -d --remove-orphans ${TARGET[@]+"${TARGET[@]}"} || die "docker compose up failed" 2
    ok "containers started"

    failed=0
    if [[ -z "$SERVICE" || "$SERVICE" == "backend" ]]; then
      wait_for_backend || failed=1
      (( failed )) || check_readiness
    fi
    if [[ -z "$SERVICE" || "$SERVICE" == "frontend" ]]; then
      check_frontend || failed=1
    fi

    if (( failed )); then
      printf '\n%sDeploy finished, but the stack is not healthy.%s\n' "$C_RED" "$C_RESET" >&2
      dim "the containers are left running so you can inspect them:"
      dim "  ./deploy.sh --logs"
      exit 3
    fi

    summary
    ;;
esac
