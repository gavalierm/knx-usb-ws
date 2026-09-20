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

### Done in this pass

- Extracted WebSocket parsing into `services/parser.js`; every malformed frame is now rejected instead of terminating the process.
- Added `process.on('uncaughtException')` / `('unhandledRejection')` handlers to `app.js`.
- Wrapped the eibd send path in `services/knx_eibd.js` in `try/catch`, including the `str2addr` Error return value.
- Added `test/parser.test.js` — 16 contract tests, no dependencies, `npm test`.
- Added `scripts.start` and `scripts.test` to `package.json`.
- Verified locally: 8 previously fatal frames are now rejected, the process survives, and a valid frame afterwards is still handled.

**Not deployed.** Nothing was written to the Pi in this pass.

### Recommended next, in order

1. **`Restart=always` on `knxd.service`** with a sensible `RestartSec`. Removes the confirmed cause of the outage class.
2. **Run `app.js` as a systemd unit** instead of a tmux session started from cron. Gives it the same restart policy and puts its output in journald — which solves the missing log history in the same move. `auto_tmuxer.sh` keeps the `git stash && git pull` deploy step, or that moves too.
3. **Replace the `ping google.com` gate** with `After=/Wants=network-online.target`.
4. **Deploy the parser hardening** (already built and tested, waiting for a window).
5. **Node.js** off v12. Check what the Pi's repositories offer before committing to a version; nothing in this project compiles, so the upgrade is cheaper than it looks.
6. **Decide the OS path** — bullseye is out of support. Either upgrade the distro or rebuild the machine, which is also the moment to put all of the above into configuration management rather than hand-edited files.
7. Once 1 and 2 hold, **remove `0 2 * * * root reboot`** and confirm the machine stays healthy without it.
