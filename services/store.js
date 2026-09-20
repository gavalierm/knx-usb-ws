'use strict';
//
// The bus state, kept across restarts.
//
// It lives in the process otherwise, so a deploy or the nightly reboot wiped
// it and the bridge stayed blind until somebody happened to change a light -
// on a quiet day, hours. The bus cannot be asked for its state on this
// installation (no Read flag in ETS, see MAINTENANCE.md), so remembering is
// the only way a client that has just opened sees anything at all.
//
// Every entry keeps when it was last confirmed. Nothing here pretends a value
// from last night is current; the age is reported and the client says so.
//
const fs = require('fs');
const os = require('os');
const path = require('path');

// STATE_DIRECTORY is set by systemd (StateDirectory=knx-usb-ws -> /var/lib).
// Falling back to the user's state directory keeps it working when the bridge
// is run by hand. Deliberately not inside the repository: deploy.sh stashes
// local changes, and not /tmp either, which is cleared at every boot - both
// would throw the file away exactly when it is needed.
const DIR = process.env.STATE_DIRECTORY || path.join(os.homedir(), '.local', 'state', 'knx-usb-ws');
const FILE = path.join(DIR, 'bus-state.json');

// A value older than this is not worth restoring. A week-old picture of the
// lights is not information, it is a guess wearing a timestamp.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let write_timer = null;

function load() {
    let raw;
    try {
        raw = fs.readFileSync(FILE, 'utf8');
    } catch (e) {
        console.log('STORE: no saved bus state (' + FILE + ')');
        return {};
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        console.error('STORE: saved bus state is not readable, starting empty', e.message);
        return {};
    }

    const now = Date.now();
    const state = {};
    let dropped = 0;
    for (const address of Object.keys(parsed)) {
        const entry = parsed[address];
        if (!entry || typeof entry.message !== 'string' || typeof entry.at !== 'number') {
            dropped++;
            continue;
        }
        if (now - entry.at > MAX_AGE_MS) {
            dropped++;
            continue;
        }
        state[address] = entry;
    }

    const kept = Object.keys(state).length;
    console.log('STORE: restored ' + kept + ' addresses' + (dropped ? ', dropped ' + dropped + ' stale or malformed' : ''));
    return state;
}

// Debounced: a scene recall lands several telegrams at once and there is no
// reason to write the file for each of them.
function save(state) {
    clearTimeout(write_timer);
    write_timer = setTimeout(function() {
        write_timer = null;
        try {
            fs.mkdirSync(DIR, { recursive: true });
            // Write and rename, so a restart in the middle never leaves a
            // half-written file to be parsed on the way back up.
            const tmp = FILE + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(state));
            fs.renameSync(tmp, FILE);
        } catch (e) {
            console.error('STORE: could not save bus state', e.message);
        }
    }, 1000);
}

// When the freshest thing we know was last confirmed, or null if we know
// nothing. This is what tells a client whether it is looking at a live picture
// or at something restored from disk.
function newest(state) {
    let newest_at = null;
    for (const address of Object.keys(state)) {
        const at = state[address].at;
        if (newest_at === null || at > newest_at) {
            newest_at = at;
        }
    }
    return newest_at;
}

exports.STORE_load = load;
exports.STORE_save = save;
exports.STORE_newest = newest;
exports.STORE_file = FILE;
