#!/bin/bash

if [ "$(id -u)" != "0" ]; then
   echo "     Attention!!!"
   echo "     Start script must run as root" 1>&2
   echo "     Start a root shell with"
   echo "     sudo su"
   exit 1
fi

sudo service cron status
sudo systemctl enable cron
sudo systemctl start cron

apt install libgles-dev libegl-dev

ls /usr/lib/arm-linux-gnueabihf/libGLE*

sudo ln -s /usr/lib/arm-linux-gnueabihf/libGLESv2.so /usr/lib/libbrcmGLESv2.so

ls /usr/lib/arm-linux-gnueabihf/libEGL*

sudo ln -s /usr/lib/arm-linux-gnueabihf/libEGL.so /usr/lib/libbrcmEGL.so

apt install tmux

apt install nodejs

apt install vim

cd /home/pi/Projects/knx-usb-ws/kxnd/

echo "Install daemon of kxd";
sleep 10

sudo sh install_knxd_systemd.sh

echo "Install custom modifications"
sleep 10

cp 90-meanwell-usb-knx.rules /etc/udev/rules.d/

export EIB_ADDRESS_KNXD="1.1.128"
export EIB_START_ADDRESS_CLIENTS_KNXD="1.1.129"
export EIB_NUMBER_OF_CLIENT_KNX_CLIENT_ADDRESSES=8

cat > /etc/default/knxd <<EOF
# Command line parameters for knxd. TPUART Backend
# Serial device Raspberry
# KNXD_OPTIONS="--eibaddr=$EIB_ADDRESS_KNXD --client-addrs=$EIB_START_ADDRESS_CLIENTS_KNXD:$EIB_NUMBER_OF_CLIENT_KNX_CLIENT_ADDRESSES -d -D -T -R -S -i --listen-local=/tmp/knx -b tpuarts:/dev/ttyAMA0"
# Serial device PC
# KNXD_OPTIONS="--eibaddr=$EIB_ADDRESS_KNXD --client-addrs=$EIB_START_ADDRESS_CLIENTS_KNXD:$EIB_NUMBER_OF_CLIENT_KNX_CLIENT_ADDRESSES -d -D -T -R -S -i --listen-local=/tmp/knx -b tpuarts:/dev/ttyS0"
# Tunnel Backend
# KNXD_OPTIONS="--eibaddr=$EIB_ADDRESS_KNXD --client-addrs=$EIB_START_ADDRESS_CLIENTS_KNXD:$EIB_NUMBER_OF_CLIENT_KNX_CLIENT_ADDRESSES -d -D -T -R -S -i --listen-local=/tmp/knx -b ipt:192.168.56.1"
# USB Backend
KNXD_OPTIONS="--eibaddr=$EIB_ADDRESS_KNXD --client-addrs=$EIB_START_ADDRESS_CLIENTS_KNXD:$EIB_NUMBER_OF_CLIENT_KNX_CLIENT_ADDRESSES -d -D -T -R -S -i --listen-local=/tmp/knx -b usb:"
EOF

systemctl disable knxd.service

# Systemd knxd unit
cat >  /etc/systemd/system/knxd.service <<EOF
[Unit]
Description=KNX Daemon (G A V O)
After=network.target

[Service]
EnvironmentFile=/etc/default/knxd
# Wait for all interfaces, systemd-networkd-wait-online.service must be enabled
ExecStartPre=/bin/sh -c 'until ping -c1 google.com; do sleep 1; done;'
# Wait for a specific interface
#ExecStartPre=/lib/systemd/systemd-networkd-wait-online --timeout=60 --interface=eth0
ExecStart=/usr/local/bin/knxd -p /run/knxd/knxd.pid \$KNXD_OPTIONS
Type=forking
PIDFile=/run/knxd/knxd.pid
User=knxd
Group=knxd
#TimeoutStartSec=60

[Install]
WantedBy=multi-user.target network-online.target
EOF

chown knxd:knxd /etc/default/knxd
chmod 644 /etc/default/knxd

ldconfig

systemctl enable knxd.service
sync

cmd="@reboot /home/pi/Projects/knx-usb-ws/auto_tmuxer.sh >>/tmp/knx_cron.log 2>&1"
(crontab -u pi -l; echo "$cmd" ) | crontab -u pi -
cmd="0 1 * * * /home/pi/Projects/knx-usb-ws/auto_tmuxer.sh >>/tmp/knx_cron.log 2>&1"
(crontab -u pi -l; echo "$cmd" ) | crontab -u pi -


echo "Please reboot"
