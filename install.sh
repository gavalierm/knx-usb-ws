#!/bin/bash
#
# One-shot installer. Takes a fresh Debian-family machine to a working KNX
# bridge, and is safe to run again on a machine that already has one.
#
# The point of this file is recovery: when the SD card dies or the bridge moves
# to another machine, this is the single thing an operator runs.
#
#   git clone https://github.com/gavalierm/knx-usb-ws.git ~/Projects/knx-usb-ws
#   sudo ~/Projects/knx-usb-ws/install.sh
#
# What it sets up:
#   - packages: git, nodejs, npm, and what knxd needs to build
#   - knxd, from knxd/install_knxd_systemd.sh, if not already installed
#   - /etc/default/knxd with the USB backend
#   - the udev rule for the MEAN WELL KNX-USB interface
#   - knxd.service drop-ins: restart on failure, no internet gate
#   - knx-usb-ws.service: the bridge, supervised, logging to journald
#   - one cron entry: deploy.sh at 01:00
#
# Deliberately NOT set up: anything that pulls code at boot. A power cut must
# bring lighting control back immediately, not deploy. See CLAUDE.md.
#
set -euo pipefail

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '\033[33m   ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m   x %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "must run as root:  sudo $0"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_USER="${SUDO_USER:-pi}"
id "$APP_USER" >/dev/null 2>&1 || die "user '$APP_USER' does not exist - set SUDO_USER or edit APP_USER"

command -v systemctl >/dev/null || die "this installer needs systemd"
command -v apt-get   >/dev/null || die "this installer needs a Debian-family distribution"

say "Installing as user '$APP_USER' from $APP_DIR"

# ---------------------------------------------------------------- packages
say "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git nodejs npm cron usbutils >/dev/null
info "git, nodejs, npm, cron, usbutils"

NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || echo 0)"
info "node $(node -v 2>/dev/null || echo 'not found')"
if [ "$NODE_MAJOR" -lt 18 ]; then
    warn "Node $NODE_MAJOR is past end of life and gets no security fixes."
    warn "The bridge runs on it, but plan an upgrade - 'apt install nodejs'"
    warn "installs whatever the distribution ships, which is how this machine"
    warn "ended up on Node 12. Use nodesource or nvm for a supported release."
fi

# -------------------------------------------------------------------- knxd
say "knxd"
if command -v knxd >/dev/null; then
    info "already installed: $(knxd --version 2>&1 | head -1)"
else
    info "building from knxd/install_knxd_systemd.sh (third party, ~10 min)"
    ( cd "$APP_DIR/knxd" && sh install_knxd_systemd.sh )
fi

say "knxd configuration"
install -m 644 "$APP_DIR/knxd/90-meanwell-usb-knx.rules" /etc/udev/rules.d/
udevadm control --reload-rules 2>/dev/null || true
info "udev rule installed"

cat > /etc/default/knxd <<'CONF'
# Command line parameters for knxd. USB backend (MEAN WELL KNX-USB interface).
# eibaddr is knxd's own address; client-addrs is the pool it hands to clients,
# which is why telegrams from the bridge show source addresses 1.1.129-1.1.136.
KNXD_OPTIONS="--eibaddr=1.1.128 --client-addrs=1.1.129:8 -d -D -T -R -S -i --listen-local=/tmp/knx -b usb:"
CONF
chown knxd:knxd /etc/default/knxd 2>/dev/null || true
chmod 644 /etc/default/knxd
info "/etc/default/knxd written (USB backend)"

if ! lsusb 2>/dev/null | grep -qi '28c2:0013'; then
    warn "MEAN WELL KNX-USB interface (28c2:0013) not detected on the USB bus."
    warn "knxd will keep retrying until it is plugged in."
fi

# --------------------------------------------------------------- services
say "systemd units"
install -d /etc/systemd/system/knxd.service.d
install -m 644 "$APP_DIR/systemd/knxd.service.d/"*.conf /etc/systemd/system/knxd.service.d/
info "knxd drop-ins: restart on failure, no internet gate"

sed -e "s|/home/pi/Projects/knx-usb-ws|$APP_DIR|g" \
    -e "s|^User=pi$|User=$APP_USER|" \
    -e "s|^Group=pi$|Group=$APP_USER|" \
    "$APP_DIR/systemd/knx-usb-ws.service" > /etc/systemd/system/knx-usb-ws.service
chmod 644 /etc/systemd/system/knx-usb-ws.service
info "knx-usb-ws.service installed for $APP_DIR"

systemctl daemon-reload
systemctl enable -q knxd.service knx-usb-ws.service
systemctl restart knxd.service
systemctl restart knx-usb-ws.service

# ------------------------------------------------------------------- cron
say "Deployment schedule"
# Idempotent: strip any previous entry for this project before adding ours, so
# running the installer twice does not leave duplicates behind. The old
# auto_tmuxer.sh entries are removed here too - the bridge is supervised by
# systemd now and nothing pulls code at boot.
( crontab -u "$APP_USER" -l 2>/dev/null | grep -v 'knx-usb-ws/\(deploy\|auto_tmuxer\)\.sh' || true
  echo "0 1 * * * $APP_DIR/deploy.sh" ) | crontab -u "$APP_USER" -
info "deploy.sh runs daily at 01:00"

chmod +x "$APP_DIR/deploy.sh" "$APP_DIR/status.sh" 2>/dev/null || true

# ----------------------------------------------------------------- verify
say "Verifying"
sleep 5
ok=0
for check in "knxd" "knx-usb-ws"; do
    if systemctl is-active --quiet "$check"; then
        info "$check: active"
    else
        warn "$check: $(systemctl is-active "$check")"
        ok=1
    fi
done

if ss -tln 2>/dev/null | grep -q ':9240'; then
    info "WebSocket listening on 9240"
else
    warn "nothing listening on 9240"
    ok=1
fi

if [ "$ok" = "0" ]; then
    say "Done"
    info "Watch it:   journalctl -u knx-usb-ws -f"
    info "Status:     $APP_DIR/status.sh"
    info "Deploy:     $APP_DIR/deploy.sh"
else
    say "Finished with warnings"
    warn "Check: journalctl -u knxd -u knx-usb-ws -n 50"
    exit 1
fi
