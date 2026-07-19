#!/usr/bin/env bash
# Stop, disable, and remove the Label Maker systemd user service.
# (Leaves lingering alone — disable it yourself with `loginctl disable-linger`
#  if no other user service needs it.)
set -euo pipefail

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/label-maker.service"

systemctl --user disable --now label-maker.service 2>/dev/null || true
rm -f "$UNIT"
systemctl --user daemon-reload
echo "==> Removed $UNIT and disabled the service."
