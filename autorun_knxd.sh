#!/bin/bash
set -e

if [ "$(id -u)" != "0" ]; then
   echo "     Attention!!!"
   echo "     Start script must run as root" 1>&2
   echo "     Start a root shell with"
   echo "     sudo su -"
   exit 1
fi

/usr/local/bin/knxd -p /run/knxd/knxd.pid --eibaddr=1.1.128 --client-addrs=1.1.129:8 -d -D -T -R -S -i --listen-local=/tmp/knx -b usb: