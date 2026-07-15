#!/bin/zsh
#
# launchd entry point for the daily activity report (com.opterra.activity-report).
#
# launchd runs with a bare environment and no interactive shell, so nvm's node is
# not on PATH. We resolve the newest installed nvm node dynamically rather than
# hardcoding a version dir — that way a `nvm install` upgrade doesn't silently
# stop the daily report. Falls back to whatever `node` is already on PATH.
#
# Everything (including failures) is appended to ~/Library/Logs/activity-report.log
# so a broken run is visible instead of silently missing.

set -e

REPO="/Users/love/developer/buying-moment-engine"
LOG="$HOME/Library/Logs/activity-report.log"

NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
if [ -n "$NODE_BIN" ]; then
  export PATH="$NODE_BIN:$PATH"
fi

cd "$REPO" || { echo "[$(date)] cannot cd to $REPO" >> "$LOG"; exit 1; }

echo "[$(date)] running activity:report" >> "$LOG"
npx tsx scripts/activity-report.ts >> "$LOG" 2>&1
echo "[$(date)] done (exit $?)" >> "$LOG"
