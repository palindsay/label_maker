#!/usr/bin/env bash
# Serve the Peptide Label Maker on all interfaces (0.0.0.0) for LAN access.
#
# Usage:
#   scripts/serve.sh            # build, then serve the production bundle (recommended)
#   scripts/serve.sh --dev      # run the dev server (HMR) instead of a build
#   PORT=8088 scripts/serve.sh  # choose the port (default: 4173 preview / 5173 dev)
#
# Both modes proxy /v1 (LLM endpoint) and /coa (CoA fetch) so photo auto-fill
# and QR-linked CoA reading work without CORS. Binding 0.0.0.0 exposes the app
# AND those proxies to your LAN — only run it on a network you trust.
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="preview"
for arg in "$@"; do
  case "$arg" in
    --dev) MODE="dev" ;;
    -h | --help)
      sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

HOST="0.0.0.0"
if [ "$MODE" = "dev" ]; then
  PORT="${PORT:-5173}"
else
  PORT="${PORT:-4173}"
fi

# Best-effort LAN IP for the printed URL (Linux `hostname -I`).
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "${LAN_IP:-}" ] && LAN_IP="<this-host-ip>"

echo "==> Label Maker (${MODE}) on http://${HOST}:${PORT}"
echo "    Local:  http://localhost:${PORT}"
echo "    LAN:    http://${LAN_IP}:${PORT}"
echo "    LLM proxy target: edit LLM_TARGET in vite.config.ts if needed."
echo

if [ "$MODE" = "dev" ]; then
  exec npx vite --host "$HOST" --port "$PORT" --strictPort
else
  npm run build
  exec npx vite preview --host "$HOST" --port "$PORT" --strictPort
fi
