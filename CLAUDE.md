# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `../CLAUDE.md` first for the system-wide picture, deployment paths and hard constraints. Read `PROTOCOL.md` before changing anything about messages — it is a contract with an external consumer.

**Read `MAINTENANCE.md` before forming any theory about this system**, in particular its "wrong turns" table and the "disproven" list. Both exist so the same wrong conclusions are not reached twice. Adding to that table when one of your own claims turns out wrong is required, not optional — the rule and the reasoning are in `../CLAUDE.md`.

## What this is

A Node.js bridge running on a Raspberry Pi on-site. It translates between a WebSocket server (port **9240**) and the KNX bus, reached through the `knxd` daemon on `localhost:6720` and a MEAN WELL KNX-USB interface.

Despite the name, this is not a dumb bridge. It is **the API server** for hall lighting: it owns the name↔address mapping, it is consumed by Bitfocus Companion (run by someone else), and its message format is a contract.

CommonJS, `'use strict'`, ES5 style. No build step, no transpilation, no TypeScript.

## Running and deploying

```bash
node app.js          # or: npm start
npm test             # node --test — contract tests for the parser, no dependencies
node --test test/parser.test.js     # a single file
```

`test/parser.test.js` asserts the message formats in `PROTOCOL.md`. **A failing test there means a client breaks, not that the test is stale.** There is still no linter and no typecheck.

Tests cover parsing only. They cannot tell you whether a telegram reached the bus or a light actually changed — that is verified on the Pi, against the real installation, outside the programme windows.

Production start, restart and deploy all go through one script, `auto_tmuxer.sh`, driven by cron on the Pi (`@reboot` and `0 1 * * *`):

```bash
cd /home/pi/Projects/knx-usb-ws/
git stash && git pull          # local changes on the Pi are DISCARDED nightly
pkill -u pi -9 nodejs          # no-op on current Raspberry Pi OS (binary is `node`)
tmux kill-session -t KNX_sess  # this is what actually stops the process
tmux new-session -s KNX_sess -n knx-usb-ws -d
tmux send-keys -t KNX_sess:0 'node /home/pi/Projects/knx-usb-ws/app.js' ENTER
```

Attach to the running process with `tmux a`.

**`git push` to `main` deploys to production within 24 hours.** There is no staging and no rollback beyond `git revert` and another wait.

## Architecture

`app.js` wires three services and holds all business logic:

| File | Responsibility |
|---|---|
| `app.js` | translator table, WS→KNX bridge, KNX→WS bridge, nightly "Central OFF" job |
| `services/ws.js` | `WebSocketServer` on 9240, 15 s ping/pong liveness, `broadcast()` / `multicast()` |
| `services/knx_eibd.js` | eibd connection to knxd, group-socket listener, `sendToBus()`, reconnect loop |
| `services/cron.js` | thin wrapper over `node-schedule` |

`knxd/` holds the Pi provisioning material: `install.sh` (own), `install_knxd_systemd.sh` (296-line third-party script by Michael Albert, 2020), `autorun_knxd.sh`, the udev rule for the USB interface, and `readme.txt` — a Slovak setup note written by the operator for himself, and the only real prose documentation that existed before this file.

### Address table

Defined in `app.js` as `translator`. **This is the only record of how the building is wired** — the ETS project is not readily available. Changing it does not change the installation; it only changes what names map to what.

| Name | Group address | DPT |
|---|---|---|
| `central` | 0/0/1 | DPT1 |
| `schody` | 0/1/0 | DPT1 |
| `zvukari` | 0/2/0 | DPT1 |
| `sala` | 0/3/0 | DPT1 |
| `podium` | 0/4/0 | DPT1 |
| `scene` | 1/0/0 | DPT5 |
| `uvod` | 1/0/0 | DPT5, value 0 |
| `chvaly` | 1/1/0 | DPT5, value 1 |
| `kazen` | 1/2/0 | DPT5, value 2 |

Adding a light is not a code task. It needs the ETS project reworked first so the telegrams line up; ask the operator before promising it.

### Scheduled behaviour

- `0 0 * * *` — "Central OFF": writes `0` to `0/0/1`. The hall goes dark at midnight every night, from inside this process.
- `*/15 * * * *` — default heartbeat log in `services/cron.js`.
- `0 1 * * *` — **outside** this process: cron restarts it and pulls from `main`.

## Deliberate decisions — do not "fix" these

**`node_modules/` is committed and there is no `.gitignore`.** This is intentional, not neglect. The Pi only ever runs `git pull`, never `npm install`, so vendored dependencies are what makes deployment work offline and pins the system against a package disappearing from the registry.

Note the limits of that argument, in case it comes up: `package-lock.json` *is* tracked, so version drift is already handled, and every dependency is pure JavaScript (`eibd@0.5.1` has no `binding.gyp`, no native build). Nothing compiles here.

Removal is allowed only along this path, agreed with the operator: build a fresh install from the lockfile, verify end-to-end on the actual bus, add `npm ci` to `auto_tmuxer.sh`, and only then drop `node_modules` from git. Not as a drive-by cleanup.

## Known failure: "it stops responding"

The system periodically stops reacting to Streamdeck input. The crew's only recovery is a **reboot of the Pi**, which they do because it is fast. **The root cause has never been diagnosed.** No one has checked whether a lighter action would work.

A reboot re-triggers `@reboot` → `auto_tmuxer.sh`, so "reboot fixes it" and "restarting `node` fixes it" have never been told apart.

**Next time it happens, before rebooting, run this — it costs one incident and settles the question:**

```bash
ssh <pi>
tmux a                      # is app.js still running, and what is the last log line?
# detach: Ctrl-b d
~/Projects/knx-usb-ws/auto_tmuxer.sh   # restarts node only, not knxd, not USB
```

- Recovers → the fault is in this process (see hypotheses below).
- Does not recover, reboot does → the fault is below Node: `knxd` or the USB interface.

### CONFIRMED: a malformed WebSocket frame kills the process

**Reproduced locally.** Sending the single token `SCENE` over the WebSocket terminates the bridge:

```
TypeError: Cannot read properties of undefined (reading 'trim')
exit code 1
```

`app.js` reads `data_[1].trim()` in the `SCENE` branch without checking that a second token exists. There is no `try/catch` anywhere in this repo and no `process.on('uncaughtException')`, so the process exits. Nothing restarts it until the `01:00` cron or a reboot — which is exactly the reported symptom, and why a reboot appears to be the cure.

Two further paths reach the same crash. Both were verified by reading, and both require knxd to be connected, so they occur on the Pi but cannot be reproduced on a workstation:

- **`SCENE <unknown name>`** — the lookup loop matches nothing, `data_` stays a raw array, and `eibd.str2addr(undefined)` throws inside the async `socketRemote` callback. (`str2addr(undefined)` throwing `TypeError` was verified directly.)
- **Any unrecognised verb** — same path.

Those two are the more likely real-world triggers: one mistyped or half-filled Companion button is enough, and the person configuring it has no way to know.

**Any device on the VLAN can stop the hall's lighting control with one stray string.** Hardening this is the top priority for this repo: guard the parser, reject unknown input explicitly, and add a top-level handler that logs and keeps the process alive. It does not touch the protocol and is fully revertible.

### Remaining hypotheses — unverified, do not present as findings

The crash above is confirmed but may not be the only cause. If lock-ups continue after it is fixed, that is evidence for one of these, and the fix will have narrowed the search rather than masked it:

1. **The knxd socket went half-open.** `isConnected()` tests `socket.writable`, which stays true on a half-open TCP connection. Sends would vanish silently while the process looks healthy.
2. **The bus listener died and never came back.** `openListener()` runs once at startup. `checkStatus()` reconnects the socket but never re-attaches the group socket, so after any knxd restart the inbound direction is gone until `node` restarts. Worse: `sendToBus()` calls `socketRemote()` on the *same shared* `eibd.Connection` the listener uses, so sending may tear the listener down on the first command. This degrades feedback only, not commands.

## Other things worth knowing before editing

- **Every inbound WebSocket message is multicast to all other clients** before it is parsed. Clients see each other's raw commands. That is observable behaviour and part of the contract.
- **Outbound messages go to *all* clients** (`broadcast`), including the sender.
- `SCENE <name> <value>` **permanently mutates** the in-memory translator entry for that name, as a string, for the lifetime of the process.
- `1/0/0` appears twice in the table (`scene` and `uvod`); the inbound lookup takes the first match, so bus events on `1/0/0` always report as `SCENE SCENE <value>`, never `UVOD`.
- Log strings contain long-standing typos (`Brdiging`, `Wellcome`). They are harmless; if anyone greps logs or has built alerting on them, changing them breaks that. Leave them unless asked.
- `knxd/install.sh` contains a path typo (`kxnd` instead of `knxd`) that makes that line fail, and unrelated OpenGL symlinks left over from another Pi project.
- Commit messages here are one word (`bridge` ×9, `fix`, `update`). No branches, no tags, no PRs. Write better ones; do not reformat history.
