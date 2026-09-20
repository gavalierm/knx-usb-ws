# knx-usb-ws

Lighting control for a conference hall. A Raspberry Pi in the rack bridges a WebSocket server to the KNX bus, so a Streamdeck running Bitfocus Companion — and a phone app — can switch the hall's lights and recall scenes.

**This is live production.** The hall runs a programme **Wednesday 18:00–20:00** and **Sunday 09:00–12:00**. Outside those hours you can do anything. During them, never send anything to the bus and never restart a service: the lights must not change, and the crew must not lose control mid-event. If control is lost, there is a **physical wall panel** in the hall as a fallback.

```
Streamdeck + Companion ──┐
                         │  ws://knxrpi.lan:9240
Phone PWA ───────────────┤  plain text, both directions
                         ▼
                   knx-usb-ws.service   (node, this repository)
                         │  eibd protocol, localhost:6720
                         ▼
                   knxd.service
                         │
                   MEAN WELL KNX-USB interface
                         │
                  ══════ KNX bus ══════
```

---

## Is it working?

```bash
ssh pi@knxrpi.lan
~/Projects/knx-usb-ws/status.sh
```

One screen: both services, the running code, whether port 9240 is listening, how many clients are connected, whether the KNX interface is on the USB bus, the last bus event seen, and warnings about anything unhealthy.

## Watch it live

```bash
~/Projects/knx-usb-ws/status.sh -f          # or: journalctl -u knx-usb-ws -f
```

This is what `tmux a` used to show. Unlike tmux, the history survives restarts and reboots:

```bash
journalctl -u knx-usb-ws --since "2 hours ago"
journalctl -u knx-usb-ws --since "2026-09-16 16:00" --until "2026-09-16 17:00"
journalctl -u knxd -u knx-usb-ws --since yesterday   # both, interleaved
```

A healthy startup looks like this:

```
==================
   KNX USB WS
==================
CRON: Service started
WS: Service started as:  9240
EIBD: Successfully connected to KNXD daemon localhost:6720
EIBD: Listening for KNX events        <- the bus listener is attached
WS: Wellcome <id> ::ffff:10.77.8.205  <- Companion connected
```

A command from a client, all the way to the bus and back, looks like this:

```
WS: Multicasting:  SCENE KAZEN                       client sent this
APP: Brdiging to KNX { name: 'kazen', dst_addr: '1/2/0', ... }
KNX: Sending data ...
KNX: Received { src_addr: '1.1.130', dst_addr: '1/2/0', value: 2, ... }   bus echo
APP: Brdiging to WS SCENE KAZEN 2
WS: Broadcasting:  SCENE KAZEN 2                     sent to every client
```

`src_addr` tells you who acted: **1.1.129–1.1.136** is the bridge itself (knxd hands it one of those per connection), anything else is a real device on the bus — the wall panel is **1.1.4**.

---

## Something is wrong — what to check

| Symptom | Check | Likely cause |
|---|---|---|
| Nothing responds at all | `systemctl status knx-usb-ws` | bridge down. systemd restarts it in 5 s, so if it is down it is failing to start — read the log |
| Buttons work, but Companion shows the wrong state | `journalctl -u knx-usb-ws \| grep "Listening for KNX events"` | the bus listener detached. It re-attaches itself within 5 s; if it does not, knxd is down |
| Commands do nothing, no bus echo | `systemctl status knxd` and `lsusb \| grep 28c2` | knxd down, or the USB interface is unplugged or lost power |
| Only one client is broken | `ss -tn \| grep 9240` | that client's connection, not the bridge. The phone app only works on the hall network |
| `Rejected frame` in the log | the log line names the reason and echoes the frame | a client is sending something malformed — usually a mistyped Companion button |
| `[object Object]` reaching clients | `grep dst_addr` in the log | a bus address that is not in the table in `app.js` |

Both services restart themselves on failure. **Rebooting the Pi is almost never the right answer** — it used to be the only one, because nothing restarted anything.

## Restart something

```bash
sudo systemctl restart knx-usb-ws     # the bridge; clients reconnect on their own
sudo systemctl restart knxd           # the bus daemon; the bridge re-attaches in ~5 s
```

Both interrupt control for a few seconds. Never during a programme.

## Deploy a change

```bash
~/Projects/knx-usb-ws/deploy.sh
```

Pulls `main`, restarts the bridge, verifies it came up, and rolls back automatically if it did not. It **refuses to run during a programme** — `--force` overrides that, for an outage.

It also runs by itself at 01:00 daily, so anything merged to `main` reaches the hall that night. Nothing is pulled at boot: a power cut must restore control immediately, not deploy unverified code.

## Rebuild the machine from scratch

If the SD card dies or the bridge moves to another machine:

```bash
git clone https://github.com/gavalierm/knx-usb-ws.git ~/Projects/knx-usb-ws
sudo ~/Projects/knx-usb-ws/install.sh
```

Packages, knxd, the udev rule, both systemd units, the deploy schedule. It is safe to run again on a machine that already has all of it. It ends by verifying and telling you what is wrong if anything is.

---

## The protocol

Clients speak plain text over the WebSocket:

```
ADDR 0/0/1 1        write to a group address (always DPT1)
SCENE chvaly        recall a scene by name
SCENE chvaly 1      ... with an explicit value
```

and receive, for every telegram on the bus:

```
SWITCH SALA 1
SCENE KAZEN 2
```

**This is a contract with a system nobody here maintains** — the Companion instance is configured by a different operator, and its buttons read that return channel. Message formats do not change without talking to them first. The full specification, including what is rejected and why, is in **[PROTOCOL.md](PROTOCOL.md)**.

## What is in here

| Path | |
|---|---|
| `app.js` | the bridge: address table, both directions, the midnight "Central OFF" job |
| `services/` | `ws.js` WebSocket server · `knx_eibd.js` bus connection · `parser.js` message parsing · `cron.js` scheduling |
| `test/` | contract tests for the parser — `npm test` |
| `systemd/` | the unit files, installed by `install.sh` |
| `knxd/` | knxd provisioning: the third-party build script, the udev rule, the operator's original setup notes |
| `deploy.sh` `status.sh` `install.sh` | the three things you actually run |
| `PROTOCOL.md` | the client contract |
| `DECISIONS.md` | what the operator has decided: authority, constraints, the goal |
| `MAINTENANCE.md` | what was checked and found, per maintenance pass |
| `CLAUDE.md` | guidance for AI agents working in this repository |

## Things that will surprise you

- **`node_modules/` is committed.** On purpose: the machine only ever runs `git pull`, never `npm install`, so vendored dependencies are what makes deployment work without a network round trip. Do not "clean this up" — see `CLAUDE.md`.
- **The phone app is a separate repository** ([knx-web-remote](https://github.com/gavalierm/knx-web-remote)) and is deployed by hand to an HTTP host. It must stay on `http://`, because browsers block `ws://` from an `https://` page.
- **The address table in `app.js` is the only record of how the hall is wired.** Adding a light needs work in the ETS project first; changing the table alone does nothing.
- **The bridge turns the hall's lights off every night at midnight**, from a scheduled job inside `app.js`.
- **The machine reboots itself at 02:00** — `0 2 * * * root reboot` in `/etc/crontab`. That is a leftover workaround from when nothing restarted anything; it can go once the current setup has proven itself.
