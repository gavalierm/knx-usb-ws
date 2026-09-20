#!/bin/bash
#
# Deliberate deployment of the bridge.
#
# This is the ONLY thing that pulls code. It is never run at boot: a power cut
# must bring the bridge back immediately with the code already on disk, not
# ship whatever happens to be on main. On 2026-09-16 power returned 65 minutes
# before a programme - a boot-time pull would have deployed unverified code
# into that show. Restart and deploy are separate on purpose.
#
# Usage:
#   ./deploy.sh              deploy if main has moved
#   ./deploy.sh --force      deploy during a programme window (emergencies only)
#
set -euo pipefail

REPO=/home/pi/Projects/knx-usb-ws
SERVICE=knx-usb-ws

log() { logger -t knx-deploy -s -- "$*"; }

# The hall runs a programme Wednesday 18:00-20:00 and Sunday 09:00-12:00.
# Deploying into one of those means the crew loses control mid-show.
in_programme() {
    local dow hm
    dow=$(date +%u)
    hm=$(date +%H%M)
    { [ "$dow" = "3" ] && [ "$hm" -ge 1800 ] && [ "$hm" -lt 2000 ]; } ||
    { [ "$dow" = "7" ] && [ "$hm" -ge 900 ]  && [ "$hm" -lt 1200 ]; }
}

if in_programme && [ "${1:-}" != "--force" ]; then
    log "refusing to deploy: a programme is running. Use --force if this is an outage."
    exit 1
fi

cd "$REPO"

# Keep anything edited on the machine. Never discard it silently.
if ! git diff --quiet HEAD 2>/dev/null; then
    git stash push --include-untracked --message "deploy $(date -Is)" >/dev/null
    log "local changes stashed before deploy"
fi

git fetch --quiet origin main
before=$(git rev-parse HEAD)
git merge --ff-only origin/main >/dev/null
after=$(git rev-parse HEAD)

if [ "$before" = "$after" ]; then
    log "already current at ${after:0:7} - not restarting"
    exit 0
fi

log "updating ${before:0:7} -> ${after:0:7}"

if [ -f "$REPO/package-lock.json" ] && [ ! -d "$REPO/node_modules" ]; then
    log "node_modules missing, installing from lockfile"
    npm ci --omit=dev
fi

sudo systemctl restart "$SERVICE"
sleep 3

if systemctl is-active --quiet "$SERVICE"; then
    log "deploy complete, bridge active at ${after:0:7}"
else
    log "DEPLOY FAILED: $SERVICE did not come up. Rolling back to ${before:0:7}"
    git reset --hard "$before" >/dev/null
    sudo systemctl restart "$SERVICE"
    sleep 3
    systemctl is-active --quiet "$SERVICE" && log "rolled back, bridge active" || log "ROLLBACK ALSO FAILED - manual intervention required"
    exit 1
fi
