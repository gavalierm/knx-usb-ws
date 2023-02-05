#!/bin/bash

cd /home/pi/knx-usb-ws/

tmux new-session -d -s atem;
tmux send -t atem 'node /home/pi/knx-usb-ws/app.js' ENTER;

#wait for tmux
sleep 2;

#open window on desktop
#lxterminal --command="tmux ls" > dev/null
#export DISPLAY=:0; nohup "lxterminal -e tmux a -t atem">/dev/null &>/dev/null &
#export DISPLAY=:0; nohup lxterminal -e "tmux a -t atem" > /dev/null 2>&1 </dev/null &

sleep 2;
echo "Autostart done";
echo -ne '\n\n' > /dev/null 2>&1 </dev/null