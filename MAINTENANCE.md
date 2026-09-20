# Maintenance log

One entry per maintenance pass, newest first. Each entry records what was checked and what was found, **including passes where nothing changed** — that record is what stops the next pass from starting over. See `../CLAUDE.md` for the cadence and for what is allowed during a programme.

---

## 2026-09-20 — first pass

Read-only inspection of the production Pi during a Sunday programme (09:00–12:00). No writes, no restarts, no bus traffic. Plus local hardening of the bridge parser, not yet deployed.

### Machine

| | |
|---|---|
| Host | `knxrpi.local` → 10.77.8.208 (`knxrpi` alone does not resolve; use the `.local` suffix, user `pi`) |
| OS | Raspbian GNU/Linux 11 (bullseye), kernel 5.15.84-v7+, armv7l |
| Node.js | **v12.22.12** |
| knxd | 0.14.56, `active` |
| OpenSSH | 8.4p1 (2022) |
| USB | `28c2:0013 MEAN WELL KNX-USB Inteface`, present |
| Disk | 17% of 29 GB used |
| Temperature | 46.2 °C, `throttled=0x0` — power and thermals healthy |
| Clock | NTP active and synchronized; **no RTC** (`/dev/rtc*` absent) |
| Journal | persistent, retained since 2026-06-22 |

The bridge was running normally and observed handling live traffic (`SCENE KAZEN` from a client, telegram to the bus, `SCENE KAZEN 2` echoed back). **The return channel works** — this disproves the standing hypothesis that the group-socket listener dies after the first send.

### Root cause of "it stops responding" — identified

`knxd.service` is configured **`Restart=no`**. When knxd exits, nothing restarts it, and the hall loses lighting control until something reboots the machine.

Evidence, Wednesday 2026-09-16 (a programme day, 18:00 start):

```
16:22:58  knxd: E00000101: [22:C.usb] No connection
16:23:21  knxd: F00000105: [19:C.usb] Link down, terminating
16:23:21  kernel: hid-generic 0003:28C2:0013.0002 ... MEAN WELL KNX-USB Inteface
16:23:21  systemd: knxd.service: Main process exited, code=exited, status=1/FAILURE
16:23:21  systemd: knxd.service: Failed with result 'exit-code'
          journal ends here with no shutdown sequence -> unclean power loss
16:55:14  machine back up (NTP resync)
```

32 minutes of downtime, 95 minutes before a programme. The power to the rack was interrupted; knxd died with it and had no restart policy to bring it back.

This is the mechanism behind "reboot is the only fix": a reboot re-triggers `@reboot` → `auto_tmuxer.sh` and restarts knxd through systemd. Nobody ever needed the reboot itself.

Note this is a *second*, independent fault from the parser crash fixed the same day. Both end in the same symptom.

### Undocumented workaround found

`/etc/crontab` line 23 — not in this repository, not in `install.sh`:

```
0  2     * * *   root    reboot
```

A blanket nightly reboot of the whole machine, confirmed in the journal as a clean daily cycle at 02:00:0x on every single day including non-programme days. It is a band-aid over the missing restart policies, and it works well enough that failures are only visible when they happen during the day.

It has a cost: the tmux session is recreated at every boot, so **the bridge's entire log history is destroyed every night**. There is no persistent log for `app.js` at all — no file, nothing in journald. That is why no crash history exists to examine.

Do not remove the nightly reboot before the restart policies below are in place. It is currently the only safety net.

### knxd cannot start without reaching Google

```
ExecStartPre=/bin/sh -c 'until ping -c1 google.com; do sleep 1; done;'
```

From `knxd/install.sh`. A LAN-only system that controls a building will not start its bus daemon until it can reach a third party on the public internet — and it loops forever, so an internet outage with a healthy LAN means no lighting control at all.

Presumably a workaround for a startup ordering problem. The correct mechanism is `After=network-online.target` with `Wants=network-online.target`, or a check against the local gateway.

### Security

| Finding | Status |
|---|---|
| **Node.js v12.22.12** | end of life since April 2022 — over four years without security patches |
| **Raspbian 11 (bullseye)** | at or past end of support; needs verification against the Debian release calendar |
| **405 upgradable packages, 0 from a security suite** | either the security suite is missing from `sources.list` or bullseye security has stopped publishing — determine which |
| **`unattended-upgrades` not installed** | nothing applies updates automatically |
| OpenSSH 8.4p1 | old; the client warns about "store now, decrypt later" |
| No authentication or TLS on port 9240 | accepted, mitigated only by VLAN segmentation — see `../CLAUDE.md` |

### Smaller observations

- `systemd[1]: Failed to set timeout to 600s: Invalid argument` for the BCM2835 hardware watchdog at each shutdown — the watchdog is misconfigured and is not protecting anything.
- `Wi-Fi is currently blocked by rfkill` on every boot. Harmless on a wired machine, but noise.
- The `@reboot` cron starts `app.js` at 02:00:11; NTP synchronizes at 02:00:58. The bridge therefore runs for ~47 s on an unsynchronized clock. **Unverified risk:** `node-schedule` holds the `0 0 * * *` "Central OFF" job, and its behaviour across a large forward clock jump has not been checked. If it can misfire, it would turn the hall's lights off at an arbitrary moment — the one outcome that is absolutely forbidden. Verify before trusting it.
- `daily knxd libusb do_close` errors at 02:00:0x are knxd being stopped by the nightly reboot. Benign. knxd is otherwise stable: 181 start/stop events across ~90 days of journal is the daily cycle, not instability. Only one genuine failure in that period (2026-09-16).

### A second fault, found by experiment

With the operator supervising and a physical wall panel as fallback, knxd was killed deliberately to test the new restart policy. It recovered — and the test exposed a fault nobody knew about.

```
11:17:20  SIGKILL to knxd (PID 759)
11:17:25  systemd: Scheduled restart job, restart counter is at 1
11:17:26  knxd active again as PID 2651   -> 5.83 s
```

The bridge logged **nothing at all**. The operator then pressed the wall panel: the telegram reached the bus, but never reached the bridge or any WebSocket client. **The bridge had gone deaf and did not know it.** It still accepted commands and forwarded them to the bus, so from the outside it looked healthy. Only a manual restart of the process brought the listener back.

Cause: `openListener()` ran once at startup, on the connection also used for sending, and nothing ever checked it was alive. Every knxd restart — including the one at every nightly reboot — silently cost the feedback channel until something restarted the bridge.

This is the second cause behind "it stops responding", and it explains the half of the symptom the parser crash does not: commands keep working while Companion shows stale state.

### Done in this pass

Local, then deployed:

- Extracted WebSocket parsing into `services/parser.js`; every malformed frame is rejected instead of terminating the process. Verified locally: 8 previously fatal frames rejected, process survives, a valid frame afterwards still handled.
- Added `process.on('uncaughtException')` / `('unhandledRejection')` handlers to `app.js`.
- Wrapped the eibd send path in `try/catch`, including the `str2addr` Error return value.
- **Gave the bus listener its own connection and made it re-attach on close**, retrying every 5 s.
- Added `test/parser.test.js` — 16 contract tests, no dependencies, `npm test`.
- Added `scripts.start` / `scripts.test`; added `systemd/` units and `deploy.sh` (written, **not yet installed**).

Applied to the production machine:

| Change | Verification |
|---|---|
| `knxd.service.d/10-restart.conf` — `Restart=always`, `RestartSec=5s`, `StartLimitIntervalSec=0` | killed knxd twice; recovered in 5.83 s both times |
| `knxd.service.d/20-no-internet-gate.conf` — cleared the `ping google.com` `ExecStartPre` | knxd restarts cleanly without it |
| Code deployed to `52f3ce0`, bridge restarted | `EIBD: Listening for KNX events` in the log |
| Listener recovery | killed knxd again: `listener connection closed → reattaching → Listening for KNX events`, same bridge PID throughout |
| Full round trip after recovery | `SCENE kazen` out, `SCENE KAZEN 2` back, under a second |

No lights changed at any point. Every telegram sent was a recall of the scene that was already active.

### Disproven — do not re-investigate

- **knxd instability.** 181 start/stop events across 90 days of journal are the nightly reboot, not failures. One genuine failure in that period (2026-09-16).
- **Connection leak to knxd.** `sendToBus()` does reconnect on every send, and each connection takes a fresh address from the `--client-addrs=1.1.129:8` pool, but addresses are recycled: two entries on port 6720 and four socket FDs on the bridge. The pool does not exhaust. Wasteful, not harmful.

### Recommended next, in order

1. **Run `app.js` as a systemd unit** instead of a tmux session from cron — `systemd/knx-usb-ws.service` is written and waiting. It is the last piece with no supervisor: if the node process dies now, nothing restarts it until 01:00. It also gives the project its first persistent log. Needs the cron entries changed in the same step, and an empty hall.
2. **Install `deploy.sh`** on the 01:00 cron in place of `auto_tmuxer.sh`, and drop the `@reboot` pull.
3. **Dependency vulnerabilities** — GitHub reports 3 on the default branch (2 high, 1 moderate). Check what they are; every dependency here is pure JavaScript, so updating is cheap.
4. **Node.js** off v12 (EOL April 2022).
5. **Decide the OS path** — bullseye is out of support. Upgrade or rebuild; a rebuild is the moment to put all of this in configuration management instead of hand-edited files.
6. Once 1 and 2 hold, **remove `0 2 * * * root reboot`** and confirm the machine stays healthy without it.
7. **Protocol UX** — additive only, see the note in `PROTOCOL.md`. The gap worth closing first: a client that connects has no way to learn current state and shows stale buttons until the next bus event.
