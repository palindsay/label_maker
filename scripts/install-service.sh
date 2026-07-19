#!/usr/bin/env bash
# Install & enable the Peptide Label Maker as a systemd *user* service so it
# builds and serves on 0.0.0.0:4173 automatically at boot.
#
# Why a user service (not a root/system unit)? Node is nvm-managed under your
# home directory, so running as your user keeps the toolchain reachable. Boot
# start is provided by lingering (enabled below), the Ubuntu-idiomatic way to
# run a user service without an active login session.
#
# Re-run this after upgrading Node via nvm (it re-resolves the Node bin dir).
#
# Usage:
#   scripts/install-service.sh            # install, enable, start
#   PORT=8088 scripts/install-service.sh  # (build-time only) — set PORT in the
#                                         #   unit by editing it afterwards
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$REPO_DIR/deploy/label-maker.service.in"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/label-maker.service"

[ -f "$TEMPLATE" ] || {
  echo "Template not found: $TEMPLATE" >&2
  exit 1
}

# Resolve the real Node bin dir (nvm installs outside the default PATH).
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "node not found on PATH. Run this from a shell where 'node -v' works (nvm loaded)." >&2
  exit 1
fi
NODE_BIN_DIR="$(cd "$(dirname "$(readlink -f "$NODE")")" && pwd)"

mkdir -p "$UNIT_DIR"
sed -e "s#@REPO_DIR@#${REPO_DIR}#g" -e "s#@NODE_BIN_DIR@#${NODE_BIN_DIR}#g" "$TEMPLATE" >"$UNIT"
echo "==> Wrote $UNIT"
echo "    repo: $REPO_DIR"
echo "    node: $NODE_BIN_DIR"

# Start user services at boot without an active login session (idempotent).
loginctl enable-linger "$USER" 2>/dev/null || true

systemctl --user daemon-reload
systemctl --user enable --now label-maker.service

echo
systemctl --user --no-pager --full status label-maker.service | sed -n '1,10p' || true

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "==> Serving on http://${LAN_IP:-<this-host-ip>}:4173  (also http://localhost:4173)"
echo "    Manage:  systemctl --user {status|restart|stop|disable} label-maker"
echo "    Logs:    journalctl --user -u label-maker -f"
echo "    Remove:  scripts/uninstall-service.sh"
