#!/usr/bin/env bash
#
# bootstrap.sh — sets up any Linux VPS for this app, from your machine.
#
#   ./bootstrap.sh                     # interactive, asks for everything once
#   ./bootstrap.sh --env prod          # reuse/complete deploy/prod.conf
#   ./bootstrap.sh --env prod --only ssl
#   ./bootstrap.sh --env prod --from clone
#   ./bootstrap.sh --env prod --staging     # Let's Encrypt staging certificates (for testing)
#   ./bootstrap.sh --env prod --skip-ssl
#
# Steps (each one checks what's already done, so the script is safe to re-run):
#   preflight  SSH access, sudo, distro, package manager, firewall, DNS
#   system     base packages, swap on small machines, automatic security updates, logrotate
#   docker     Docker Engine + compose plugin, log rotation
#   firewall   opens SSH, 80, 443 and EXTRA_PORTS (ufw or firewalld)
#   user       optional: separate user for the app, optional: disable SSH password login
#   git        read-only deploy key for the repo (added via `gh` if you're logged in)
#   clone      clones/updates the repo, uploads web-app/env/<env>.json, writes .env
#   start      builds and starts the app with docker compose
#   ssl        Let's Encrypt certificate (webroot through the app) + daily renewal
#   check      checks https://<domain>/health
#
# Everything you answer is saved to deploy/<env>.conf, which deploy.sh uses.

set -euo pipefail

# shellcheck source=scripts/lib/deploy-common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib/deploy-common.sh"
cd "$ROOT"

STEPS=(preflight system docker firewall user git clone start ssl check)

ENV_NAME=''
ONLY=''
FROM=''
STAGING=false
SKIP_SSL=false

while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    --from) FROM="${2:-}"; shift 2 ;;
    --staging) STAGING=true; shift ;;
    --skip-ssl) SKIP_SSL=true; shift ;;
    -h|--help) sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

for step in "$ONLY" "$FROM"; do
  if [ -n "$step" ] && [[ ! " ${STEPS[*]} " =~ \ $step\  ]]; then
    die "Unknown step '$step'. Steps: ${STEPS[*]}"
  fi
done

should_run() {
  local step="$1"
  if [ -n "$ONLY" ]; then [ "$ONLY" = "$step" ]; return; fi
  if [ -n "$FROM" ]; then
    local s reached=false
    for s in "${STEPS[@]}"; do
      [ "$s" = "$FROM" ] && reached=true
      [ "$s" = "$step" ] && { $reached; return; }
    done
  fi
  return 0
}

command -v ssh >/dev/null || die "ssh is required"
command -v scp >/dev/null || die "scp is required"
command -v node >/dev/null || die "node is required (to read web-app/env/*.json)"

# ── Questions ─────────────────────────────────────────────────────
section "Configuration"

if [ -z "$ENV_NAME" ]; then
  existing="$(list_envs | tr '\n' ' ')"
  [ -n "$existing" ] && info "Existing environments: $existing"
  ask ENV_NAME "Environment name" "prod" is_env_name
fi
is_env_name "$ENV_NAME" || exit 1

if load_conf "$ENV_NAME"; then
  ok "Loaded $(conf_file "$ENV_NAME")"
fi

default_app_name="$(node -p 'require("./package.json").name' 2>/dev/null || basename "$ROOT")"
default_repo="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"

ask HOST "Server IP address or host" "" is_host
ask SSH_PORT "SSH port" "22" is_port
ask SSH_USER "SSH user (root or a user with passwordless sudo)" "root" is_user
ask SSH_KEY "Path to SSH private key for this server" "$HOME/.ssh/id_ed25519" is_file
ask APP_NAME "App name (used for folder, containers, keys)" "$default_app_name" is_user
ask APP_DIR "App directory on the server" "/opt/$APP_NAME" is_abs_path
APP_USER="${APP_USER:-$SSH_USER}"
ask DOMAINS "Domain(s), space separated (first one is the main one)" ""
ask LE_EMAIL "Email for Let's Encrypt notifications" "" is_email
ask REPO_URL "Git repository URL" "$default_repo"
ask BRANCH "Branch to deploy" "main"
ask_optional EXTRA_PORTS "Extra TCP ports to open, space separated (e.g. websockets)" ""

MAIN_DOMAIN="${DOMAINS%% *}"
ENV_FILE="$(env_json "$ENV_NAME")"

save_conf "$ENV_NAME"
ok "Saved $(conf_file "$ENV_NAME")"

[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE. Create it from web-app/env/prod.example.json (domain, cert paths, db...) and run again."

APP_PORT="$(env_json_value "$ENV_NAME" port)"
APP_PORT="${APP_PORT:-443}"
PROXY_PORT="$(env_json_value "$ENV_NAME" proxy.port)"
CONFIG_CERT="$(env_json_value "$ENV_NAME" cert)"
if [ -n "$MAIN_DOMAIN" ] && [[ "$CONFIG_CERT" != *"/live/$MAIN_DOMAIN/"* ]]; then
  warn "\"cert\" in $ENV_FILE is \"$CONFIG_CERT\", expected ./web-app/ssl/live/$MAIN_DOMAIN/fullchain.pem"
fi
[ "$(env_json_value "$ENV_NAME" host)" = "0.0.0.0" ] || warn "\"host\" in $ENV_FILE should be \"0.0.0.0\" to be reachable from outside the container"
[ -n "$PROXY_PORT" ] || warn "No \"proxy.port\" in $ENV_FILE: HTTP→HTTPS redirect and Let's Encrypt challenges won't work"

# Repo URL → ssh host alias, so the deploy key is used only for this repo
parse_repo_url() {
  local url="$1"
  if [[ "$url" =~ ^git@([^:]+):(.+)$ ]]; then
    GIT_HOST="${BASH_REMATCH[1]}"; REPO_PATH="${BASH_REMATCH[2]}"
  elif [[ "$url" =~ ^ssh://([^@]+@)?([^/:]+)(:[0-9]+)?/(.+)$ ]]; then
    GIT_HOST="${BASH_REMATCH[2]}"; REPO_PATH="${BASH_REMATCH[4]}"
  elif [[ "$url" =~ ^https?://([^/]+)/(.+)$ ]]; then
    GIT_HOST="${BASH_REMATCH[1]}"; REPO_PATH="${BASH_REMATCH[2]}"
  else
    die "Can't parse repository URL: $url"
  fi
  REPO_PATH="${REPO_PATH%.git}"
  GIT_ALIAS="$GIT_HOST-$APP_NAME"
  SERVER_REPO_URL="git@$GIT_ALIAS:$REPO_PATH.git"
}
parse_repo_url "$REPO_URL"

# ── Steps ─────────────────────────────────────────────────────────

step_preflight() {
  section "preflight"
  remote_as "$SSH_USER" 'true' || die "Can't SSH into $SSH_USER@$HOST with $SSH_KEY"
  ok "SSH works"
  if [ "$SSH_USER" != root ]; then
    remote_as "$SSH_USER" 'sudo -n true' || die "$SSH_USER needs passwordless sudo (or use root)"
    ok "sudo works"
  fi
  remote_root '
    . /etc/os-release
    echo "OS: ${PRETTY_NAME:-$ID}"
    for pm in apt-get dnf yum zypper apk; do command -v $pm >/dev/null && { echo "Package manager: $pm"; break; }; done
    if command -v ufw >/dev/null; then echo "Firewall: ufw"
    elif command -v firewall-cmd >/dev/null; then echo "Firewall: firewalld"
    else echo "Firewall: none found"; fi
    echo "Memory: $(awk "/MemTotal/ {printf \"%d MB\", \$2/1024}" /proc/meminfo)"
  '
  check_dns
}

DNS_OK=true
check_dns() {
  local server_ip domain resolved
  server_ip="$(node -e 'require("dns").promises.lookup(process.argv[1]).then(r => console.log(r.address)).catch(() => {})' "$HOST")"
  for domain in $DOMAINS; do
    resolved="$(node -e 'require("dns").promises.resolve4(process.argv[1]).then(r => console.log(r.join(" "))).catch(() => {})' "$domain")"
    if [[ " $resolved " == *" $server_ip "* ]]; then
      ok "DNS: $domain → $server_ip"
    else
      warn "DNS: $domain → ${resolved:-nothing}, expected $server_ip"
      DNS_OK=false
    fi
  done
  $DNS_OK || warn "Let's Encrypt will be skipped until DNS points to the server (failed attempts count towards rate limits)."
}

step_system() {
  section "system"
  remote_root '
    install_pkgs() {
      if command -v apt-get >/dev/null; then
        apt-get -o DPkg::Lock::Timeout=600 update -qq
        apt-get -o DPkg::Lock::Timeout=600 install -y -qq "$@" >/dev/null
      elif command -v dnf >/dev/null; then dnf install -y -q "$@"
      elif command -v yum >/dev/null; then yum install -y -q "$@"
      elif command -v zypper >/dev/null; then zypper --non-interactive install "$@"
      elif command -v apk >/dev/null; then apk add --no-cache "$@"
      else echo "No supported package manager" >&2; exit 1; fi
    }

    if command -v apt-get >/dev/null; then
      install_pkgs ca-certificates curl git openssh-client cron logrotate unattended-upgrades
      cat > /etc/apt/apt.conf.d/20auto-upgrades <<EOF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
      systemctl enable --now cron >/dev/null 2>&1 || true
      echo "✓ Automatic security updates: unattended-upgrades"
    elif command -v dnf >/dev/null || command -v yum >/dev/null; then
      install_pkgs ca-certificates curl git openssh-clients cronie logrotate dnf-automatic || install_pkgs ca-certificates curl git openssh-clients cronie logrotate
      systemctl enable --now crond >/dev/null 2>&1 || true
      if [ -f /etc/dnf/automatic.conf ]; then
        sed -i "s/^apply_updates.*/apply_updates = yes/; s/^upgrade_type.*/upgrade_type = security/" /etc/dnf/automatic.conf
        systemctl enable --now dnf-automatic.timer >/dev/null 2>&1 && echo "✓ Automatic security updates: dnf-automatic"
      fi
    elif command -v apk >/dev/null; then
      install_pkgs ca-certificates curl git openssh-client logrotate bash
      rc-update add crond >/dev/null 2>&1 || true; rc-service crond start >/dev/null 2>&1 || true
      echo "⚠ Automatic updates are not configured on Alpine"
    else
      install_pkgs ca-certificates curl git logrotate cron || true
    fi
    echo "✓ Base packages"

    # Swap: builds (npm ci) run out of memory on 1-2 GB machines
    mem_mb=$(awk "/MemTotal/ {print int(\$2/1024)}" /proc/meminfo)
    if [ "$(tail -n +2 /proc/swaps | wc -l)" -eq 0 ] && [ "$mem_mb" -lt 2048 ]; then
      size_mb=2048
      fallocate -l ${size_mb}M /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=$size_mb status=none
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
      swapon /swapfile
      grep -q "^/swapfile " /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
      echo "✓ Added ${size_mb} MB swap"
    else
      echo "✓ Swap: not needed or already there"
    fi
  '
  remote_root "
    cat > /etc/logrotate.d/$APP_NAME <<EOF
$APP_DIR/output.log $APP_DIR/certbot-renew.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
EOF
    echo '✓ logrotate for $APP_DIR/output.log'
  "
}

step_docker() {
  section "docker"
  remote_root '
    if ! command -v docker >/dev/null; then
      if command -v apk >/dev/null; then
        apk add --no-cache docker docker-cli-compose
        rc-update add docker default; rc-service docker start
      else
        curl -fsSL https://get.docker.com | sh >/dev/null
      fi
      echo "✓ Installed Docker"
    else
      echo "✓ Docker is already installed: $(docker --version)"
    fi
    command -v systemctl >/dev/null && systemctl enable --now docker >/dev/null 2>&1 || true
    docker compose version >/dev/null 2>&1 || { echo "docker compose plugin is missing" >&2; exit 1; }
    echo "✓ $(docker compose version)"

    if [ ! -f /etc/docker/daemon.json ]; then
      mkdir -p /etc/docker
      cat > /etc/docker/daemon.json <<EOF
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
EOF
      echo "✓ Docker log rotation"
      if ! (systemctl restart docker || rc-service docker restart) >/dev/null 2>&1; then
        echo "⚠ Could not restart Docker, log rotation applies after the next Docker restart"
      fi
    else
      echo "✓ /etc/docker/daemon.json exists, left as is"
    fi
  '
}

step_firewall() {
  section "firewall"
  local ports="$SSH_PORT 80 443 $EXTRA_PORTS"
  [ "$APP_PORT" != 443 ] && ports="$ports $APP_PORT"
  remote_root "
    ports='$ports'
    if command -v ufw >/dev/null; then
      for p in \$ports; do ufw allow \$p/tcp >/dev/null; done
      ufw --force enable >/dev/null
      echo \"✓ ufw allows: \$ports\"
    elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
      for p in \$ports; do firewall-cmd --permanent --add-port=\$p/tcp >/dev/null; done
      firewall-cmd --reload >/dev/null
      echo \"✓ firewalld allows: \$ports\"
    else
      echo '⚠ No ufw/firewalld: make sure your provider firewall allows' \$ports
    fi
  "
  info "Note: ports published by Docker bypass ufw rules, only open ports your app uses."
}

step_user() {
  section "user"
  if [ "$APP_USER" = "$SSH_USER" ] && confirm "Run the app under a separate user (instead of $SSH_USER)?" n; then
    ask APP_USER "User name for the app" "$APP_NAME" is_user
  fi
  if [ "$APP_USER" != "$SSH_USER" ]; then
    remote_root "
      if ! id '$APP_USER' >/dev/null 2>&1; then
        useradd --create-home --shell /bin/bash '$APP_USER' 2>/dev/null || adduser -D -s /bin/bash '$APP_USER'
        echo '✓ Created user $APP_USER'
      fi
      getent group docker >/dev/null && usermod -aG docker '$APP_USER' 2>/dev/null || addgroup '$APP_USER' docker 2>/dev/null || true
      home=\$(getent passwd '$APP_USER' | cut -d: -f6)
      mkdir -p \$home/.ssh
      src_keys=\$(getent passwd '$SSH_USER' | cut -d: -f6)/.ssh/authorized_keys
      touch \$home/.ssh/authorized_keys
      while IFS= read -r key; do
        [ -n \"\$key\" ] && ! grep -qxF \"\$key\" \$home/.ssh/authorized_keys && echo \"\$key\" >> \$home/.ssh/authorized_keys
      done < \$src_keys
      chmod 700 \$home/.ssh; chmod 600 \$home/.ssh/authorized_keys
      chown -R '$APP_USER':'$APP_USER' \$home/.ssh
      echo '✓ $APP_USER is in docker group and accepts your SSH key'
    "
    remote_as "$APP_USER" 'true' && ok "SSH as $APP_USER works"
    save_conf "$ENV_NAME"
  else
    ok "App runs as $APP_USER"
  fi

  if confirm "Disable SSH password login (key-only)? You're connected with a key, so it's safe." n; then
    remote_root "
      mkdir -p /etc/ssh/sshd_config.d
      grep -q '^Include /etc/ssh/sshd_config.d' /etc/ssh/sshd_config || sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
      cat > /etc/ssh/sshd_config.d/10-$APP_NAME-hardening.conf <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
      sshd -t
      (systemctl reload ssh || systemctl reload sshd || rc-service sshd reload) >/dev/null 2>&1
      echo '✓ SSH password login disabled'
    "
    remote_as "$SSH_USER" 'true' && ok "SSH with key still works"
  fi
}

# GitHub's published ed25519 host key fingerprint
GITHUB_ED25519_FINGERPRINT='SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU'

step_git() {
  section "git"
  local key_name="${APP_NAME}_deploy_key"
  local pubkey
  pubkey="$(remote_app "
    mkdir -p ~/.ssh && chmod 700 ~/.ssh
    [ -f ~/.ssh/$key_name ] || ssh-keygen -q -t ed25519 -N '' -C '$APP_NAME@$HOST ($ENV_NAME) deploy key' -f ~/.ssh/$key_name

    # Host alias block, replaced (not duplicated) on every run
    touch ~/.ssh/config && chmod 600 ~/.ssh/config
    awk '/^# >>> $GIT_ALIAS >>>/{skip=1} !skip{print} /^# <<< $GIT_ALIAS <<</{skip=0}' ~/.ssh/config > ~/.ssh/config.tmp
    cat >> ~/.ssh/config.tmp <<EOF
# >>> $GIT_ALIAS >>>
Host $GIT_ALIAS
  HostName $GIT_HOST
  User git
  IdentityFile ~/.ssh/$key_name
  IdentitiesOnly yes
# <<< $GIT_ALIAS <<<
EOF
    mv ~/.ssh/config.tmp ~/.ssh/config

    # Known host (added once, verified against GitHub's published fingerprint)
    touch ~/.ssh/known_hosts
    if ! ssh-keygen -F '$GIT_HOST' >/dev/null; then
      ssh-keyscan -t ed25519 '$GIT_HOST' 2>/dev/null > /tmp/$APP_NAME-host-key
      if [ '$GIT_HOST' = github.com ]; then
        fingerprint=\$(ssh-keygen -lf /tmp/$APP_NAME-host-key | awk '{print \$2}')
        [ \"\$fingerprint\" = '$GITHUB_ED25519_FINGERPRINT' ] || { echo \"github.com host key fingerprint mismatch: \$fingerprint\" >&2; exit 1; }
      fi
      cat /tmp/$APP_NAME-host-key >> ~/.ssh/known_hosts
      rm -f /tmp/$APP_NAME-host-key
    fi
    cat ~/.ssh/$key_name.pub
  " | tail -n1)"

  if remote_app "git ls-remote '$SERVER_REPO_URL' >/dev/null 2>&1"; then
    ok "Server already has read access to $REPO_PATH"
    return
  fi

  if [ "$GIT_HOST" = github.com ] && command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    info "Adding read-only deploy key to $REPO_PATH with gh..."
    if printf '%s\n' "$pubkey" | gh repo deploy-key add - --repo "$REPO_PATH" --title "$APP_NAME $ENV_NAME ($HOST)"; then
      ok "Deploy key added"
    else
      warn "gh couldn't add the key, add it manually."
    fi
  fi

  until remote_app "git ls-remote '$SERVER_REPO_URL' >/dev/null 2>&1"; do
    echo
    echo "Add this key as a read-only ${C_BOLD}deploy key${C_RESET} of the repo"
    [ "$GIT_HOST" = github.com ] && echo "(https://github.com/$REPO_PATH/settings/keys/new, don't allow write access):"
    echo
    echo "  $pubkey"
    echo
    read -r -p "Press Enter when it's added (Ctrl+C to stop)..." _
  done
  ok "Server has read access to $REPO_PATH"
}

step_clone() {
  section "clone"
  remote_root "
    mkdir -p '$APP_DIR'
    chown '$APP_USER':'$APP_USER' '$APP_DIR'
  "
  remote_app "
    cd '$APP_DIR'
    if [ -d .git ]; then
      git remote set-url origin '$SERVER_REPO_URL'
      git fetch -q origin '$BRANCH'
      git checkout -q '$BRANCH' 2>/dev/null || git checkout -q -b '$BRANCH' 'origin/$BRANCH'
      git reset -q --hard 'origin/$BRANCH'
      echo \"✓ Updated to \$(git log -1 --format='%h %s')\"
    else
      git clone -q --branch '$BRANCH' '$SERVER_REPO_URL' .
      echo \"✓ Cloned \$(git log -1 --format='%h %s')\"
    fi
  "

  scp_to "$ENV_FILE" "$APP_DIR/web-app/env/$ENV_NAME.json"
  remote_app "chmod 600 '$APP_DIR/web-app/env/$ENV_NAME.json'"
  ok "Uploaded web-app/env/$ENV_NAME.json"

  local override_ports='' p
  for p in $EXTRA_PORTS; do override_ports+="      - \"$p:$p\""$'\n'; done
  [ "$APP_PORT" != 443 ] && override_ports+="      - \"$APP_PORT:$APP_PORT\""$'\n'
  remote_app "
    cd '$APP_DIR'
    cat > .env <<EOF
COMPOSE_PROJECT_NAME=$APP_NAME-$ENV_NAME
ENV=$ENV_NAME
APP_UID=\$(id -u)
APP_GID=\$(id -g)
EOF
    if [ '$([ -n "$override_ports" ] && echo yes)' = yes ]; then
      printf 'services:\n  app:\n    ports:\n%s' '$override_ports' > docker-compose.override.yml
    else
      rm -f docker-compose.override.yml
    fi
    echo '✓ Wrote .env'
  "
}

step_start() {
  section "start"
  remote_app "
    cd '$APP_DIR'
    docker compose up -d --build --renew-anon-volumes --remove-orphans
  "
  wait_for_health "$APP_PORT" 150 || die "The app doesn't respond. Check logs: ./deploy.sh logs $ENV_NAME"
  ok "App is running"
}

step_ssl() {
  section "ssl"
  if $SKIP_SSL; then info "Skipped (--skip-ssl)"; return; fi
  [ -n "$DOMAINS" ] || { warn "No domains, skipping"; return; }
  [ -n "$PROXY_PORT" ] || { warn "No proxy.port in config, skipping"; return; }
  if ! $DNS_OK; then
    check_dns
    $DNS_OK || { warn "Skipping Let's Encrypt until DNS is ready. Run later: ./bootstrap.sh --env $ENV_NAME --only ssl"; return; }
  fi

  local domain_args='' d staging_arg=''
  for d in $DOMAINS; do domain_args+=" -d $d"; done
  $STAGING && staging_arg='--staging'

  remote_app "
    cd '$APP_DIR'
    uid=\$(id -u); gid=\$(id -g)
    compose_run() { docker compose --profile certbot run --rm -T \"\$@\"; }
    if [ -f 'web-app/ssl/live/$MAIN_DOMAIN/fullchain.pem' ] && [ -z '$staging_arg' ]; then
      echo '✓ Certificate for $MAIN_DOMAIN already exists'
    else
      compose_run certbot certonly --webroot -w /var/www/html \
        --non-interactive --agree-tos -m '$LE_EMAIL' \
        --cert-name '$MAIN_DOMAIN' $domain_args $staging_arg --keep-until-expiring
    fi
    # certbot writes files as root, the app runs as \$uid
    compose_run --entrypoint chown certbot -R \$uid:\$gid /etc/letsencrypt

    # Daily renewal (certbot renews only when < 30 days left); the app picks up
    # new certificates on the next TLS handshake, no restart needed
    marker='# $APP_NAME-$ENV_NAME certbot renew'
    job=\"17 3 * * * cd $APP_DIR && docker compose --profile certbot run --rm -T certbot renew --quiet && docker compose --profile certbot run --rm -T --entrypoint chown certbot -R \$uid:\$gid /etc/letsencrypt >> $APP_DIR/certbot-renew.log 2>&1 \$marker\"
    ( crontab -l 2>/dev/null | grep -vF \"\$marker\" || true; echo \"\$job\" ) | crontab -
    echo '✓ Daily renewal scheduled (crontab of $APP_USER)'
  "
}

step_check() {
  section "check"
  if [ -n "$MAIN_DOMAIN" ] && curl -sf -m 10 "https://$MAIN_DOMAIN/health" >/dev/null 2>&1; then
    ok "https://$MAIN_DOMAIN/health: $(curl -s -m 10 "https://$MAIN_DOMAIN/health")"
  elif [ -n "$MAIN_DOMAIN" ] && curl -skf -m 10 "https://$MAIN_DOMAIN/health" >/dev/null 2>&1; then
    warn "https://$MAIN_DOMAIN responds, but the certificate isn't trusted yet (temporary or staging certificate)"
  else
    warn "https://${MAIN_DOMAIN:-$HOST}/health doesn't respond from here (DNS, firewall or provider firewall?)"
  fi
}

CURRENT_STEP=''
trap 'echo "${C_RED}✖${C_RESET} Step \"$CURRENT_STEP\" failed. Fix the problem and continue with: ./bootstrap.sh --env $ENV_NAME --from $CURRENT_STEP" >&2' ERR

for step in "${STEPS[@]}"; do
  if should_run "$step"; then
    CURRENT_STEP="$step"
    "step_$step"
  fi
done

section "Done"
ok "Environment \"$ENV_NAME\" → $SSH_USER@$HOST:$APP_DIR"
info "Deploy changes with: ./deploy.sh (or ./deploy.sh <pull|restart|rerun> $ENV_NAME)"
