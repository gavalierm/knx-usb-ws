# WebSocket protocol

This document describes the message contract of the `knx_usb_ws` bridge, as implemented. It was written by reading `app.js`, `services/ws.js` and `services/knx_eibd.js` — it is a description of existing behaviour, not a redesign.

**This protocol has at least one external consumer** (a Bitfocus Companion instance, configured and maintained by a different operator). Treat the message formats below as frozen. They can be changed, but only after that operator has been contacted and agrees — not as part of a refactor.

## Transport

- **Endpoint:** `ws://<pi-host>:9240`
- **No authentication, no TLS.** Any host that can reach the port can control the lighting. This is accepted because the Pi is on a segmented production VLAN.
- **Text frames.** Incoming payloads are `toString()`-ed and trimmed before anything else.
- **Liveness:** the server pings every 15 s and terminates clients that did not pong since the previous round. Clients must answer WebSocket pings — most libraries do this automatically.
- Commands are **not fire-and-forget**: the server also emits bus state, see *Server → client*.

## Client → server

The server tries to parse each frame as JSON first, and falls back to the text form.

### 1. JSON form (undocumented until now, but supported)

A JSON object is passed straight through to the bus with no validation:

```json
{ "dst_addr": "0/0/1", "dpt_type": "DPT1", "value": 1 }
```

All three fields are required; `value` is parsed with `parseFloat`. Nothing checks the address or the type. Prefer the text form.

### 2. `ADDR <group_address> <value>`

Writes directly to a group address.

```
ADDR 0/0/1 1
ADDR 0/3/0 0
```

- **The type is always `DPT1`** (1-bit switch). There is no way to send another type with `ADDR`.
- Both arguments are required; if either is missing or the literal string `undefined`, the frame is dropped.
- The address is not validated against the address table.

### 3. `SCENE <name> [value]`

Looks `<name>` up in the address table in `app.js` (case-insensitive) and writes the entry's address and type.

```
SCENE chvaly
SCENE chvaly 1
```

- Without `value`, the entry's stored value is used. The entry `scene` has no stored value, so `SCENE scene` sends `undefined`.
- **With `value`, the stored value of that entry is overwritten permanently** — as a string — for the rest of the process lifetime. `SCENE chvaly 5` makes every later bare `SCENE chvaly` send `5`, until the nightly restart. This is a defect, kept here because a client may depend on it.
- An unknown name is rejected: the bridge logs the reason and sends nothing. Until 2026-09-20 it terminated the process instead — see the hazard note below.

### Verbs are matched case-insensitively

`ADDR`, `addr` and `Addr` are equivalent. The same applies to scene names.

### 4. `HEALTH`

Asks the bridge about itself. **Nothing reaches the bus** — this is a question, not a telegram, and it is safe to send at any time, including during a programme.

The answer goes only to the client that asked, one line per fact, in the same three-token shape as everything else:

```
HEALTH KNXD 1          there is a live link to knxd
HEALTH LISTENER 1      the bus listener is attached
HEALTH USB 1           the MEAN WELL interface is on the USB bus
HEALTH CLIENTS 2       WebSocket clients connected right now
HEALTH UPTIME 3600     seconds since the bridge started
HEALTH ADDRESSES 8     distinct group addresses the bridge knows of
HEALTH KNOWN 3         of those, how many it has current state for
HEALTH LASTBUS 42      seconds since the last telegram it saw
HEALTH STATEAGE 900    how long ago the freshest state it reports was confirmed
```

`LASTBUS` and `STATEAGE` together tell a client whether it is looking at a live picture or a remembered one. `LASTBUS -1` with `KNOWN` above zero means the bridge has seen nothing since it started and is reporting state **restored from disk**, and `STATEAGE` says how old that is. A client should say so rather than present it as current.

`KNXD` reflects the listener's persistent connection. The sending side opens a socket per telegram and closes it in between, so its state says nothing about health — reporting that instead produced a self-contradictory `KNXD 0` next to `LISTENER 1`.

**`-1` means "cannot determine", and is not the same as `0`.** `USB -1` is returned where the check is impossible — on a host without `/sys/bus/usb`, for instance — and `LASTBUS -1` means no telegram has been seen yet, which after a restart is normal rather than alarming.

Why it matters: a client can otherwise only tell whether *its own socket* is open. The socket stays up perfectly well while knxd is dead or the bus is unreachable, which is exactly the "it says connected but nothing works" experience.

Added 2026-09-20. Purely additive — a client that never sends `HEALTH` sees nothing new.

### Malformed frames are rejected

Anything that does not match the forms above is logged with a reason and dropped. The bridge stays up, and a valid frame sent afterwards still works.

**This was not true until 2026-09-20.** Invalid input reached the bus layer and ended the process, with nothing to restart it until the next reboot — so the hall lost lighting control for the rest of the event. Three frames did it, and the first was reproduced deliberately:

| Frame | Mechanism |
|---|---|
| `SCENE` (no second token) | `data_[1].trim()` on `undefined` |
| `SCENE <unknown name>` | fell through as a raw array → `str2addr(undefined)` threw |
| any unrecognised verb | same path |

A mistyped or half-filled button in a control surface was enough to take the system down, and the person configuring that button had no way to know. Sending only the documented forms is still the right thing to do — but it is no longer load-bearing.

## Server → client

### Bus events

The bridge listens to **all** `write` telegrams on the bus, not only ones it sent, and forwards the ones it can name:

```
<TYPE> <NAME> <VALUE>
```

Uppercase, space-separated. Examples:

```
SWITCH CENTRAL 1
SWITCH SALA 0
SCENE SCENE 2
```

- `<TYPE>` is derived from the DPT: `DPT1` → `SWITCH`, `DPT5` → `SCENE`. **Any other DPT is dropped silently.**
- `<NAME>` is the address table entry. `1/0/0` is listed twice (`scene` and `uvod`) and the first match wins, so that address always reports as `SCENE SCENE <value>` — never `UVOD`.
- Sent to **all** connected clients, including the one whose command caused the event.
- Both `write` telegrams and `response` telegrams (a device answering a read request) are forwarded; they are indistinguishable to a client, because both carry current state. Before 2026-09-20 only `write` was handled.

### Hazard: unknown addresses

A bus event on an address that is not in the table is still forwarded — but unconverted, so clients receive the literal string:

```
[object Object]
```

Clients must tolerate this. It means a light exists on the bus that `app.js` does not know about.

### State replay on connect

Since 2026-09-20, a client receives the bridge's last known state for every group address **immediately after connecting**, before anything else happens on the bus.

The lines are ordinary bus-event lines — identical in form to the ones above — so a client needs no special handling and no new code. Companion simply updates its buttons.

```
SWITCH CENTRAL 1
SWITCH SALA 0
SCENE KAZEN 2
```

Why it exists: until then, a client that connected knew nothing until someone pressed something, so every bridge restart left the Streamdeck and the phone showing stale state with no indication anything was wrong.

Two limits worth knowing:

- **The bridge only knows what it has seen** — but it no longer forgets it. Since 2026-09-20 the cache is written to disk and restored at startup, so a client that connects after a deploy or the nightly reboot still gets a picture instead of nothing. Entries older than a week are dropped rather than restored: a week-old picture of the lights is not information, it is a guess wearing a timestamp. Ask `HEALTH` for `STATEAGE` to find out how current it is.

  Since 2026-09-20 the bridge sends a `GroupValueRead` for every address in the table once its listener attaches, to close that gap. **On this installation nothing answers** — the group objects have no Read flag set in the ETS project — so in practice state is still learned only from traffic, and a circuit nobody has touched since startup is genuinely *unknown* rather than off. Clients must show that as unknown, not as zero. The reads cost nothing and will start working by themselves the day those flags are set.
- **An address that is not in the table is never cached**, because the line carries no usable state — see the hazard below.

A client that connects and receives nothing is therefore not necessarily talking to a broken bridge; it may be talking to one that has just started.

### Command echo

Every inbound frame is **multicast to all other connected clients verbatim**, before it is parsed, and regardless of whether it was valid. A client that sends `ADDR 0/0/1 1` will not see its own echo; every other client will.

**`HEALTH` is the exception and is never echoed.** It is a private question whose answer goes only to the asker, so repeating it to everyone is noise — with a status panel open it meant every other client receiving the word `HEALTH` every five seconds. Excluded safely because the verb did not exist before 2026-09-20.

So two clients controlling the same light see each other's activity twice, in two different shapes: once as the raw command (echo) and once as `SWITCH CENTRAL 1` (bus event).

## Address table

Source of truth: the `translator` array in `app.js`. Mirrored in `CLAUDE.md`. Adding entries here does not add lights — that requires rework in the ETS project.

| Name | Group address | DPT | Stored value |
|---|---|---|---|
| `central` | 0/0/1 | DPT1 | — |
| `schody` | 0/1/0 | DPT1 | — |
| `zvukari` | 0/2/0 | DPT1 | — |
| `sala` | 0/3/0 | DPT1 | — |
| `podium` | 0/4/0 | DPT1 | — |
| `scene` | 1/0/0 | DPT5 | — |
| `uvod` | 1/0/0 | DPT5 | 0 |
| `chvaly` | 1/1/0 | DPT5 | 1 |
| `kazen` | 1/2/0 | DPT5 | 2 |

Scene values are zero-based here; in ETS the same scene is numbered one higher.

DPT reference: <https://www.promotic.eu/en/pmdoc/Subsystems/Comm/PmDrivers/KNXDTypes.htm>

## Parser limits

These follow from `split(" ")` and are worth knowing before adding anything:

- **Names and addresses cannot contain a space.** There is no quoting.
- Multiple spaces between arguments produce empty fields and will not match.
- Arguments beyond the third are ignored.
- There are **no error responses**. A rejected frame produces a server-side log line and nothing else; the client cannot tell success from silence.
- There is no protocol version and no handshake.

## Why it is plain text, and why it stays that way

The people who configure the client side are not programmers — a Companion button holds `SCENE chvaly 1` in a plain text field. JSON would add quoting and escaping to that workflow for no benefit at this scale: nine addresses, two verbs. The simplicity is the feature.

If the protocol is ever revised, the case for it has to be made on transport efficiency or reliability, not on tidiness — and it has to start with a conversation with the Companion operator, because the current format is the only thing holding the two systems together.
