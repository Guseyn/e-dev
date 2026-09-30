#!/usr/bin/env bash
#
# Shadow-copies vendored libraries (nodes, ehtml, eui, e-dev) into this project.
#
#   scripts/vendor.sh <lib> remote [ref]          # download from GitHub (default ref: HEAD = default branch)
#   scripts/vendor.sh <lib> local  [path]         # copy from a local checkout
#   scripts/vendor.sh <lib> reverse [path]        # copy this project's copy back to a local checkout
#
# Local checkout paths default to ../<repo> and can be overridden with
# NODES_PATH, EHTML_PATH, EUI_PATH, E_DEV_PATH.
#
# Every successful remote/local update is recorded in vendor.lock.json.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LIB="${1:-}"
MODE="${2:-remote}"
ARG="${3:-}"

die() { echo "✖ $*" >&2; exit 1; }
info() { echo "→ $*"; }

# ── Library definitions ──────────────────────────────────────────
# Each mapping is "<path in library repo>:<path in this project>".
# A trailing slash means directory (synced with --delete), otherwise single file.
case "$LIB" in
  nodes)
    REPO="Guseyn/nodes.js"
    LOCAL_DEFAULT="${NODES_PATH:-../nodes.js}"
    MAPPINGS=("nodes/:nodes/")
    ;;
  ehtml)
    REPO="Guseyn/EHTML"
    LOCAL_DEFAULT="${EHTML_PATH:-../EHTML}"
    MAPPINGS=("src/:web-app/static/js/ehtml/")
    ;;
  eui)
    REPO="Guseyn/e-ui"
    LOCAL_DEFAULT="${EUI_PATH:-../e-ui}"
    MAPPINGS=(
      "static/js/e-ui/:web-app/static/js/e-ui/"
      "static/css/e-ui.css:web-app/static/css/e-ui.css"
    )
    ;;
  e-dev)
    REPO="Guseyn/e-dev"
    LOCAL_DEFAULT="${E_DEV_PATH:-../e-dev}"
    MAPPINGS=(
      "web-app/static/js/e-dev/:web-app/static/js/e-dev/"
      "web-app/api/e-dev/:web-app/api/e-dev/"
    )
    ;;
  *)
    die "Unknown library '$LIB'. Use one of: nodes, ehtml, eui, e-dev"
    ;;
esac

command -v rsync >/dev/null || die "rsync is required"

# Removes ?v=<hash> cache-busting suffixes that a library copy may carry
# from the project it was last served by.
strip_cache_versions() {
  local target="$1"
  [ -e "$target" ] || return 0
  find "$target" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \) -print0 |
    xargs -0 -r perl -pi -e 's/\?v=[0-9a-f]{8}//g'
}

copy_mapping() {
  local from_root="$1" mapping="$2" reverse="${3:-false}"
  local src="${mapping%%:*}" dst="${mapping#*:}"
  local from to
  if [ "$reverse" = true ]; then
    from="$ROOT/$dst"; to="$from_root/$src"
  else
    from="$from_root/$src"; to="$ROOT/$dst"
  fi
  [ -e "$from" ] || die "Missing source: $from"
  if [[ "$src" == */ ]]; then
    mkdir -p "$to"
    rsync -a --delete --exclude '.DS_Store' "$from" "$to"
  else
    mkdir -p "$(dirname "$to")"
    cp -f "$from" "$to"
  fi
  [ "$reverse" = true ] || strip_cache_versions "$to"
  info "$from → $to"
}

record_lock() {
  local source="$1" ref="$2" sha="$3"
  node -e '
    const fs = require("fs")
    const [lib, source, ref, sha] = process.argv.slice(1)
    const file = "vendor.lock.json"
    const lock = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
    lock[lib] = { source, ref, sha: sha || null, updatedAt: new Date().toISOString() }
    fs.writeFileSync(file, JSON.stringify(lock, null, 2) + "\n")
  ' "$LIB" "$source" "$ref" "$sha"
}

case "$MODE" in
  remote)
    command -v curl >/dev/null || die "curl is required"
    REF="${ARG:-HEAD}"
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    info "Downloading $REPO@$REF"
    curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$TMP/lib.tgz" ||
      die "Could not download $REPO@$REF"
    tar -xzf "$TMP/lib.tgz" -C "$TMP"
    EXTRACTED="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n1)"
    SHA="$(curl -fsSL "https://api.github.com/repos/$REPO/commits/$REF" 2>/dev/null |
      node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).sha||"")}catch{console.log("")}})' || true)"
    for m in "${MAPPINGS[@]}"; do copy_mapping "$EXTRACTED" "$m"; done
    record_lock "github:$REPO" "$REF" "$SHA"
    ;;
  local)
    FROM="${ARG:-$LOCAL_DEFAULT}"
    [ -d "$FROM" ] || die "Local checkout not found: $FROM (set the *_PATH env var or pass a path)"
    FROM="$(cd "$FROM" && pwd)"
    SHA="$(git -C "$FROM" rev-parse HEAD 2>/dev/null || true)"
    # Uncommitted changes are copied too, mark them so the lock doesn't pretend it's that commit
    if [ -n "$SHA" ] && [ -n "$(git -C "$FROM" status --porcelain 2>/dev/null)" ]; then SHA="$SHA+uncommitted"; fi
    for m in "${MAPPINGS[@]}"; do copy_mapping "$FROM" "$m"; done
    record_lock "local:$FROM" "$(git -C "$FROM" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '-')" "$SHA"
    ;;
  reverse)
    TO="${ARG:-$LOCAL_DEFAULT}"
    [ -d "$TO" ] || die "Local checkout not found: $TO"
    TO="$(cd "$TO" && pwd)"
    for m in "${MAPPINGS[@]}"; do copy_mapping "$TO" "$m" true; done
    info "Copied back into $TO. Review with: git -C \"$TO\" diff"
    ;;
  *)
    die "Unknown mode '$MODE'. Use: remote | local | reverse"
    ;;
esac

info "Done: $LIB ($MODE)"
