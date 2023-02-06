https://michlstechblog.info/blog/raspberry-pi-eibknx-ip-gateway-and-router-with-knxd/


Update RPI

pi@raspberry~: $ sudo su -
root@raspberry:~# apt-get update && apt-get upgrade
root@raspberry:~# rpi-update
root@raspberry:~# reboot

Seriova linka
Note: Neviem ci je to potrebne lebo mam USB zariadenie, nie TTY

raspi-config
- System, Serial, Yes (daco ohladne shell + serial)

Instalacka
Note: na tom linku je vzdy aktualny skript, upravovany tipkom podla potreby... mam ho aj v gite ale moze byt zastaraly

pi@raspberry~: $ sudo su
root@raspberry~: #
root@raspberry~: # wget http://michlstechblog.info/blog/download/electronic/install_knxd_systemd.sh

root@raspberry~: # chmod +x ./install_knxd_systemd.sh
root@raspberry~: # ./install_knxd_systemd.sh

After the script has finished. knxd, findknxusb, knxtool, findknxusb and some other tools should be installed at /usr/local/bin, the systemd service script for knxd in /lib/systemd/system/knxd.service and the link to start knxd at boottime /etc/systemd/system/multi-user.target.wants/knxd.service must exists..

Niecok ako:
root@raspberry~: # ls -l /usr/local/bin
.....
-rwxr-xr-x 1 root staff 839016 Jun 13 22:14 knxd
-rwxr-xr-x 1 root staff   7584 Jun 13 22:14 findknxusb
....
root@raspberry~: # ls -l /etc/systemd/system/multi-user.target.wants/knxd.service
lrwxrwxrwx 1 root root 14 Jun 13 22:15 ...  -> /lib/systemd/system/knxd.service


Uprava USB prav
/etc/udev/rules.d/90-knxd-MW.rules
ak neexistuje tak vytvor
# MW KNX
SUBSYSTEM=="usb", ATTR{idVendor}=="28c2", ATTR{idProduct}=="0013", ACTION=="add", GROUP="knxd", MODE="0664"

spust 
sudo udevadm control --reload-rules
REBOOT
root@raspberry:~# reboot


TEST

/usr/local/bin/knxd -p /run/knxd/knxd.pid --eibaddr=1.1.128 --client-addrs=1.1.129:8 -d -D -T -R -S -i --listen-local=/tmp/knx -b usb:



