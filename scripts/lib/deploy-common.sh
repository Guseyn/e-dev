#!/usr/bin/env bash
# Shared helpers for bootstrap.sh and deploy.sh (sourced, not executed).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$ROOT/deploy"

# ── Output ────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''
fi

info()    { echo "${C_CYAN}→${C_RESET} $*"; }
ok()      { echo "${C_GREEN}✓${C_RESET} $*"; }
warn()    { echo "${C_YELLOW}⚠${C_RESET} $*" >&2; }
die()     { echo "${C_RED}✖${C_RESET} $*" >&2; exit 1; }
section() { echo; echo "${C_BOLD}── $* ──${C_RESET}"; }

# ask VAR "Question" "default" [validator]
# Keeps the current value of VAR (e.g. from deploy/<env>.conf) as the default.
ask() {
  local var="$1" question="$2" default="${3:-}" validator="${4:-}"
  local current="${!var:-$default}" answer
  while true; do
    if [ -n "$current" ]; then
      read -r -p "$question ${C_DIM}[$current]${C_RESET}: " answer || true
      answer="${answer:-$current}"
    else
      read -r -p "$question: " answer || true
    fi
    if [ -z "$answer" ]; then
      warn "A value is required."
      continue
    fi
    if [ -n "$validator" ] && ! "$validator" "$answer"; then
      continue
    fi
    printf -v "$var" '%s' "$answer"
    return 0
  done
}

# ask_optional VAR "Question" "default" — empty answer is allowed
ask_optional() {
  local var="$1" question="$2" default="${3:-}" answer
  local current="${!var:-$default}"
  read -r -p "$question ${C_DIM}[${current:-none}]${C_RESET}: " answer || true
  printf -v "$var" '%s' "${answer:-$current}"
}

# confirm "Question" [default y|n]
confirm() {
  local question="$1" default="${2:-n}" answer hint
  [ "$default" = y ] && hint="Y/n" || hint="y/N"
  read -r -p "$question [$hint]: " answer || true
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

# ── Validators ────────────────────────────────────────────────────
is_file() { [ -f "${1/#\~/$HOME}" ] || { warn "File not found: $1"; return 1; }; }
is_host() { [[ "$1" =~ ^[A-Za-z0-9.:-]+$ ]] || { warn "Not a valid host/IP: $1"; return 1; }; }
is_user() { [[ "$1" =~ ^[a-z_][a-z0-9_-]*$ ]] || { warn "Not a valid user name: $1"; return 1; }; }
is_env_name() { [[ "$1" =~ ^[a-z][a-z0-9-]*$ ]] || { warn "Use lowercase letters, digits and dashes (e.g. prod, preprod)"; return 1; }; }
is_port() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ] || { warn "Not a valid port: $1"; return 1; }; }
is_email() { [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { warn "Not a valid email: $1"; return 1; }; }
is_abs_path() { [[ "$1" == /* ]] || { warn "Use an absolute path"; return 1; }; }

# ── deploy/<env>.conf ─────────────────────────────────────────────
# Plain KEY="value" lines. Parsed (not sourced), so the file can't run code.
CONF_KEYS=(HOST SSH_PORT SSH_USER SSH_KEY APP_USER APP_DIR APP_NAME DOMAINS LE_EMAIL REPO_URL BRANCH EXTRA_PORTS)

conf_file() { echo "$DEPLOY_DIR/$1.conf"; }

load_conf() {
  local file; file="$(conf_file "$1")"
  [ -f "$file" ] || return 1
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    if [[ "$line" =~ ^([A-Z_]+)=\"(.*)\"$ ]] || [[ "$line" =~ ^([A-Z_]+)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
      for k in "${CONF_KEYS[@]}"; do
        if [ "$k" = "$key" ]; then printf -v "$key" '%s' "$value"; fi
      done
    fi
  done < "$file"
  return 0
}

save_conf() {
  local env="$1" file; file="$(conf_file "$env")"
  mkdir -p "$DEPLOY_DIR"
  {
    echo "# Written by bootstrap.sh for environment \"$env\". Used by deploy.sh."
    echo "# Not committed (see .gitignore): it has local paths and server addresses."
    for k in "${CONF_KEYS[@]}"; do
      printf '%s="%s"\n' "$k" "${!k:-}"
    done
  } > "$file"
  chmod 600 "$file"
}

list_envs() {
  local f
  for f in "$DEPLOY_DIR"/*.conf; do
    [ -e "$f" ] || continue
    basename "$f" .conf
  done
}

# ── SSH ───────────────────────────────────────────────────────────
ssh_key_path() { echo "${SSH_KEY/#\~/$HOME}"; }

ssh_opts() {
  echo "-i $(ssh_key_path) -p ${SSH_PORT:-22} -o IdentitiesOnly=yes -o ServerAliveInterval=30 -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
}

# The script is passed base64-encoded as an argument (not via stdin),
# so remote commands that read stdin (apt, docker, ...) can't swallow the rest of it.
run_remote_script() {
  local user="$1" prefix="$2" script="$3" encoded
  encoded="$(printf '%s' "set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
$script" | base64 | tr -d '\n')"
  # shellcheck disable=SC2046
  ssh -n $(ssh_opts) "$user@$HOST" "${prefix}bash -c \"\$(echo $encoded | base64 -d)\""
}

# remote_as USER 'script' — runs a bash script on the server as USER
remote_as() {
  local user="$1"; shift
  run_remote_script "$user" '' "$*"
}

# Runs as SSH_USER, with root rights through sudo when SSH_USER is not root
remote_root() {
  local prefix=''
  [ "$SSH_USER" = root ] || prefix='sudo -n '
  run_remote_script "$SSH_USER" "$prefix" "$*"
}

# Runs as the user that owns the app (APP_USER)
remote_app() { remote_as "${APP_USER:-$SSH_USER}" "$@"; }

scp_to() {
  local src="$1" dst="$2" user="${3:-${APP_USER:-$SSH_USER}}"
  scp -q -i "$(ssh_key_path)" -P "${SSH_PORT:-22}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "$src" "$user@$HOST:$dst"
}

# ── App config (web-app/env/<env>.json) ───────────────────────────
env_json() { echo "$ROOT/web-app/env/$1.json"; }

# env_json_value <env> <key>  e.g. port
env_json_value() {
  node -e '
    const cfg = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    const v = process.argv[2].split(".").reduce((o, k) => (o == null ? o : o[k]), cfg)
    if (v !== undefined && v !== null) console.log(v)
  ' "$(env_json "$1")" "$2"
}

# Waits until https://127.0.0.1:<port>/health responds on the server
wait_for_health() {
  local port="$1" timeout="${2:-120}"
  info "Waiting for the app to respond on port $port (up to ${timeout}s)..."
  remote_app "
    for i in \$(seq 1 $((timeout / 3))); do
      if curl -skf -m 3 https://127.0.0.1:$port/health >/dev/null; then
        curl -sk https://127.0.0.1:$port/health; echo
        exit 0
      fi
      sleep 3
    done
    exit 1
  " && return 0
  return 1
}
