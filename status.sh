#!/bin/bash
#
# What is this thing doing right now.
#
# The bridge used to run inside a tmux session so an operator could SSH in and
# look at it. It runs under systemd now, which keeps the same visibility and
# adds history that survives a restart - the tmux scrollback did not. This
# script is the one command to remember.
#
#   ./status.sh            a snapshot
#   ./status.sh -f         follow the live log (what 'tmux a' used to give you)
#
set -uo pipefail

if [ "${1:-}" = "-f" ] || [ "${1:-}" = "--follow" ]; then
    exec journalctl -u knx-usb-ws -f --output=cat
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hd()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
row() { printf '  %-22s %s\n' "$1" "$2"; }
warn(){ printf '\033[33m  ! %s\033[0m\n' "$*"; }

hd "Services"
for unit in knxd knx-usb-ws; do
    state=$(systemctl is-active "$unit" 2>/dev/null)
    since=$(systemctl show "$unit" -p ActiveEnterTimestamp --value 2>/dev/null)
    pid=$(systemctl show "$unit" -p MainPID --value 2>/dev/null)
    restarts=$(systemctl show "$unit" -p NRestarts --value 2>/dev/null)
    row "$unit" "$state  pid=$pid  since ${since:-?}"
    [ "${restarts:-0}" != "0" ] && warn "$unit has restarted $restarts times since boot"
done

hd "Bridge"
row "code" "$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null) on $(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)"
row "node" "$(node -v 2>/dev/null)"
row "ws" "$(cd "$APP_DIR" && node -e "console.log(require('ws/package.json').version)" 2>/dev/null)"
if ss -tln 2>/dev/null | grep -q ':9240'; then
    row "websocket" "listening on 9240"
else
    warn "nothing listening on 9240 - clients cannot connect"
fi
row "clients" "$(ss -tnH 2>/dev/null | awk '$4 ~ /:9240$/' | wc -l | tr -d ' ')"
row "knxd socket" "$(ss -tnH 2>/dev/null | awk '$5 ~ /:6720$/' | wc -l | tr -d ' ')"

hd "Bus"
if lsusb 2>/dev/null | grep -qi '28c2:0013'; then
    row "interface" "MEAN WELL KNX-USB present"
else
    warn "KNX-USB interface not on the USB bus"
fi
# Read the recent log once. Do not pipe journalctl into `grep -q`: grep exits on
# the first match, journalctl takes SIGPIPE, and with pipefail the whole
# pipeline reports failure - which made this script warn that the listener was
# detached at the very moment it was working.
recent=$(journalctl -u knx-usb-ws --no-pager -n 400 --output=short-iso 2>/dev/null || true)
last=$(printf '%s\n' "$recent" | grep 'Brdiging to WS' | tail -1)
row "last bus event" "${last:-none in the last 400 log lines}"
case "$recent" in
    *"Listening for KNX events"*) ;;
    *) warn "no 'Listening for KNX events' recently - the bus listener may be detached" ;;
esac

hd "Health"
rej=$(journalctl -u knx-usb-ws --since '24 hours ago' --no-pager 2>/dev/null | grep -c 'Rejected frame')
[ "$rej" != "0" ] && warn "$rej malformed frames rejected in 24 h - a client is sending something wrong"
crash=$(journalctl -u knx-usb-ws --since '24 hours ago' --no-pager 2>/dev/null | grep -c 'Uncaught exception')
[ "$crash" != "0" ] && warn "$crash uncaught exceptions in 24 h - investigate"
nodemaj=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')
[ "${nodemaj:-99}" -lt 18 ] 2>/dev/null && warn "Node $nodemaj is past end of life - no security fixes"
upg=$(apt list --upgradable 2>/dev/null | tail -n +2 | wc -l)
[ "${upg:-0}" -gt 0 ] && warn "$upg package updates pending"

hd "Last 12 lines"
journalctl -u knx-usb-ws --no-pager -n 12 --output=cat 2>/dev/null | sed 's/^/  /'
printf '\n  follow live:  %s -f\n\n' "$0"
