#!/usr/bin/env bash
#
# deploy.sh — deploys pushed commits to a server set up by bootstrap.sh.
#
#   ./deploy.sh                      # asks what to do and which environment
#   ./deploy.sh <action> <env> [-y]  # non-interactive, e.g. ./deploy.sh restart prod
#
# Actions:
#   pull      git pull + update ?v= cache versions. For static changes (html, css, js, md):
#             they're served from disk, so no restart is needed.
#   restart   git pull + migrations + restart workers one by one (zero downtime).
#             For changes in anything worker.js uses (api, utils, routes...).
#   rerun     git pull + rebuild image + restart the whole app (short downtime).
#             For changes in main.js, primary.js, jobs, package.json, Dockerfile.
#   env       upload web-app/env/<env>.json, then rerun (config is read on start).
#   logs      follow app logs (output.log).
#   status    containers and /health.
#   stop      stop the app.
#
# Server, SSH user and key come from deploy/<env>.conf (written by bootstrap.sh).

set -euo pipefail

# shellcheck source=scripts/lib/deploy-common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib/deploy-common.sh"
cd "$ROOT"

ACTIONS=(pull restart rerun env logs status stop)
ACTION="${1:-}"
ENV_NAME="${2:-}"
ASSUME_YES=false
if [ "${3:-}" = "-y" ] || [ "${3:-}" = "--yes" ]; then ASSUME_YES=true; fi

case "$ACTION" in -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; esac

# ── What to do ────────────────────────────────────────────────────
if [ -z "$ACTION" ]; then
  echo "What do you want to do?"
  echo "  1) pull     static changes, no restart"
  echo "  2) restart  restart workers one by one (zero downtime)"
  echo "  3) rerun    rebuild and restart the whole app"
  echo "  4) env      upload env config and rerun"
  echo "  5) logs     follow logs"
  echo "  6) status   containers and health"
  echo "  7) stop     stop the app"
  read -r -p "Choose [1-7]: " choice
  case "$choice" in
    1|pull) ACTION=pull ;; 2|restart) ACTION=restart ;; 3|rerun) ACTION=rerun ;;
    4|env) ACTION=env ;; 5|logs) ACTION=logs ;; 6|status) ACTION=status ;; 7|stop) ACTION=stop ;;
    *) die "Unknown choice: $choice" ;;
  esac
fi
[[ " ${ACTIONS[*]} " =~ \ $ACTION\  ]] || die "Unknown action '$ACTION'. Actions: ${ACTIONS[*]}"

# ── Which environment ─────────────────────────────────────────────
ENVS=()
while IFS= read -r e; do ENVS+=("$e"); done < <(list_envs)
[ "${#ENVS[@]}" -gt 0 ] || die "No deploy/*.conf found. Set up a server first: ./bootstrap.sh"

if [ -z "$ENV_NAME" ]; then
  if [ "${#ENVS[@]}" -eq 1 ]; then
    ENV_NAME="${ENVS[0]}"
    info "Environment: $ENV_NAME"
  else
    echo "Which environment?"
    for i in "${!ENVS[@]}"; do echo "  $((i + 1))) ${ENVS[$i]}"; done
    read -r -p "Choose [1-${#ENVS[@]}]: " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "${#ENVS[@]}" ]; then
      ENV_NAME="${ENVS[$((choice - 1))]}"
    else
      ENV_NAME="$choice"
    fi
  fi
fi
load_conf "$ENV_NAME" || die "No deploy/$ENV_NAME.conf. Available: ${ENVS[*]}"
APP_USER="${APP_USER:-$SSH_USER}"
APP_PORT="$( [ -f "$(env_json "$ENV_NAME")" ] && env_json_value "$ENV_NAME" port || true)"
APP_PORT="${APP_PORT:-443}"

# ── Helpers ───────────────────────────────────────────────────────
confirm_production() {
  $ASSUME_YES && return 0
  if [[ "$ENV_NAME" == prod* ]]; then
    local typed
    read -r -p "${C_YELLOW}This is $ENV_NAME.${C_RESET} Type \"$ENV_NAME\" to continue: " typed
    [ "$typed" = "$ENV_NAME" ] || die "Cancelled"
  fi
}

check_local_branch() {
  local branch ahead
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
  git fetch -q origin "$BRANCH" 2>/dev/null || { warn "Couldn't fetch origin/$BRANCH locally"; return; }
  if [ "$branch" = "$BRANCH" ]; then
    ahead="$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 0)"
    [ "$ahead" -eq 0 ] || warn "$ahead local commit(s) on $BRANCH are not pushed, they won't be deployed."
  fi
  [ -z "$(git status --porcelain 2>/dev/null)" ] || warn "You have uncommitted changes, they won't be deployed."
}

# Shows commits that will be deployed, then updates the code on the server
git_pull() {
  info "Commits to deploy on $ENV_NAME ($HOST):"
  remote_app "
    cd '$APP_DIR'
    git fetch -q origin '$BRANCH'
    commits=\$(git log --oneline HEAD..'origin/$BRANCH')
    if [ -n \"\$commits\" ]; then echo \"\$commits\" | sed 's/^/    /'; else echo '    (none, server is up to date)'; fi
  "
  confirm_production
  # reset --hard: the server has no own changes except ?v= cache versions,
  # which are regenerated right after
  remote_app "
    cd '$APP_DIR'
    git reset -q --hard 'origin/$BRANCH'
    echo \"✓ Server is at \$(git log -1 --format='%h %s')\"
  "
}

compose_exec() {
  remote_app "cd '$APP_DIR' && docker compose exec -T app $*"
}

# ── Actions ───────────────────────────────────────────────────────
case "$ACTION" in
  pull)
    check_local_branch
    git_pull
    compose_exec node web-app/pull.js
    ok "Static changes are live"
    ;;

  restart)
    check_local_branch
    git_pull
    compose_exec node web-app/restart.js
    info "Workers restart one by one (about 12s each)."
    wait_for_health "$APP_PORT" 60 && ok "Restart started, app is responding"
    ;;

  rerun)
    check_local_branch
    git_pull
    remote_app "cd '$APP_DIR' && docker compose up -d --build --renew-anon-volumes --remove-orphans"
    wait_for_health "$APP_PORT" 150 || die "App doesn't respond, see: ./deploy.sh logs $ENV_NAME"
    ok "App is rerun"
    ;;

  env)
    ENV_FILE="$(env_json "$ENV_NAME")"
    [ -f "$ENV_FILE" ] || die "Missing $ENV_FILE"
    confirm_production
    scp_to "$ENV_FILE" "$APP_DIR/web-app/env/$ENV_NAME.json"
    remote_app "chmod 600 '$APP_DIR/web-app/env/$ENV_NAME.json'"
    ok "Uploaded web-app/env/$ENV_NAME.json"
    remote_app "cd '$APP_DIR' && docker compose up -d --force-recreate"
    wait_for_health "$APP_PORT" 150 || die "App doesn't respond, see: ./deploy.sh logs $ENV_NAME"
    ok "App is rerun with the new config"
    ;;

  logs)
    info "Following $APP_DIR/output.log (Ctrl+C to stop). Container logs: docker compose logs -f"
    # shellcheck disable=SC2046
    ssh -t $(ssh_opts) "$APP_USER@$HOST" "cd '$APP_DIR' && (docker compose logs --tail 30 app; tail -n 200 -F output.log)"
    ;;

  status)
    remote_app "
      cd '$APP_DIR'
      echo \"Commit: \$(git log -1 --format='%h %s (%cr)')\"
      docker compose ps
    "
    wait_for_health "$APP_PORT" 9 || warn "App doesn't respond on port $APP_PORT"
    ;;

  stop)
    $ASSUME_YES || confirm "Stop the app on $ENV_NAME ($HOST)?" n || die "Cancelled"
    confirm_production
    remote_app "cd '$APP_DIR' && docker compose stop"
    ok "Stopped. Start again with: ./deploy.sh rerun $ENV_NAME"
    ;;
esac
