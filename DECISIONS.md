# Decisions

Every decision, constraint or correction the operator gives is written here, **in the turn it is accepted**. Not "later", not "I'll note that" — a decision acknowledged only in conversation is a decision lost, because the conversation does not survive and the next agent starts from the files.

This log covers both repositories in the workspace. Newest last, so it reads as a history. When a decision supersedes an earlier one, say so on the old entry rather than deleting it: knowing that something changed, and when, is usually the useful part.

**If you are an agent reading this: adding to this file is part of doing the work, exactly like adding to `MAINTENANCE.md` when one of your own claims turns out wrong. See `../CLAUDE.md`.**

---

## 2026-09-20 — first session

### Scope and ownership

**The agent owns the project.** Code, technical decisions, writes, commits, refactors, and full rights on the production Raspberry Pi including restarting services. Ordinary maintenance is not to be asked about; doing it is the job.

**The operator supervises and tests.** He does not review code or read the documentation. He verifies against the real world and gives direction. His words: *"ja len sledujem a konzultujem som tvoj supervisor a dávam ti noty... tvoja úloha je to dostať do zdravého stavu."*

**Superseded:** an earlier arrangement in this same session had the operator approving every deployment and every SSH login. That was replaced twice, in the direction of more autonomy. What stands is below.

### What the agent must do

- **Announce each SSH login to the Pi beforehand.** Notification, not a request.
- **Record your own wrong claims** in `MAINTENANCE.md`, with what the check would have been, and change the workflow so the class of error cannot recur.
- **Record every operator decision here, in the same turn it is accepted.**

### What must never happen

**The application must never make the hall's lights change — go off, flash, anything — during a programme.** Wednesday 18:00–20:00, Sunday 09:00–12:00. That is the entire prohibition.

Production time is **not** otherwise a blocker. Logging in, reading, debugging, and restarting services during a programme are all permitted if the agent judges they will not disturb the show. A brief loss of control is survivable; an unexpected light change is not.

Two fallbacks exist if control is lost: the **physical wall panel** in the hall, and the operator can **physically disconnect the KNX bus cable**. Note they do different things — disconnecting the bus stops further changes but restores nothing; the wall panel is what brings lights back.

### The goal

Keep the project **consistent, current and healthy. It must not age and it must not be forgotten.** Measured by the absence of lock-ups, production outages, security defects and drift.

Neglect is the risk, so maintain in small, frequent, verified steps. *"Je to produkcia"* is not a reason to let it rot.

Innovation means proposing better ways — for example questioning whether WebSocket is the right transport — not rewriting business logic. The current functionality is adequate and is anyway bounded by the ETS project.

### Technical decisions

- **The protocol stays plain text.** Its simplicity is a feature: the person configuring Companion is not a programmer, and `SCENE chvaly 1` goes straight into a form field where JSON would mean escaping quotes. Specified in `PROTOCOL.md`; changes require contacting the Companion operator, for whom a working contact exists.
- **`knx_web_remote_` is to be ignored.** An abandoned SvelteKit rewrite. It still points at the live frontend's git remote, so nothing may be pushed from it.
- **Committed `node_modules` stays** until a fresh install has been built from the lockfile and verified end to end on the bus. Only then may it be removed and `npm ci` added to deployment.
- **A full rewrite from scratch is permitted** if the agent judges it would produce something better. Assessed on 2026-09-20 as premature: the verification loop runs through a human at the hall twice a week, so a rewrite cannot be verified piece by piece, and fixing the known faults first preserves the evidence about what actually causes them. The prerequisite is a test suite that pins the protocol.
- **There must be a one-command fresh install.** The SD card can die and the bridge may move to another machine; the operator runs one file and the machine works. This is why the original design used tmux and an installer. `install.sh` at the repository root does this now.
- **There must be a README that lets a stranger debug it immediately** — how to reach the state, read the logs, and go from symptom to cause.
- **Frontend work is verified with the dev server**, from a machine on the hall network, with the operator checking from his phone. Publishing to FTP is only the last step and its absence blocks nothing before that.

### Network

**The Pi is reached as `knxrpi.lan` at a static 10.77.8.208.** The operator added the router record and the reservation on 2026-09-20, after it was measured that `knxrpi.local` — served by avahi on the Pi — costs 5.03 s per lookup because `.local` is reserved for mDNS and goes to multicast, which is slow or filtered on this network.

```
knxrpi.lan     0.04 s resolve · 17 ms connect
knxrpi.local   5.04 s resolve · 5027 ms connect
```

Use `knxrpi.lan` everywhere: SSH, the phone app, anything new. `knxrpi.local` still resolves and avahi stays running as a fallback for a network without the DNS record — but nothing should depend on it.

### Recording, after it was broken twice

The rule to write decisions and mistakes down as they happen was written on 2026-09-20 and broken twice within the hour, both times caught by the operator. Intention was therefore replaced by a mechanism: **the two questions are answered before every commit**, and the record ships in the same commit. See `../CLAUDE.md`.
