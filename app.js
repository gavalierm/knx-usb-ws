//KNX USB WS
//https://github.com/MarkPinches/knx
console.log('==================');
console.log('   KNX USB WS     ');
console.log('==================');
//
var cron = require('./services/cron'); //run sheduled crons
cron.CRON_init();
//
var knx = require('./services/knx_eibd');
knx.KNX_init();
//
var ws = require('./services/ws');
ws.WS_init();
//
var parser = require('./services/parser');
var health = require('./services/health');
var store = require('./services/store');
//
// Last line of defence. Nothing supervises this process: tmux does not restart
// it and cron only runs at 01:00, so an uncaught exception means the hall loses
// lighting control for the rest of the day. Log loudly and stay up.
// A systemd unit with Restart=always would be the proper fix - see CLAUDE.md.
process.on('uncaughtException', function(err) {
    console.error('APP: Uncaught exception - staying alive', err);
});
process.on('unhandledRejection', function(err) {
    console.error('APP: Unhandled rejection - staying alive', err);
});
//
//
var translator = [
    //switch
    {
        // Central has no status address, and that is not an omission. It is not
        // a circuit but a group command: pressing it makes every channel below
        // report its own status, which is what was observed on 2026-09-20.
        // Nothing reports for central itself, so its cached value is the last
        // command sent rather than a confirmed state.
        name: "central",
        dst_addr: '0/0/1',
        dpt_type: 'DPT1'
    },
    {
        name: "schody",
        dst_addr: '0/1/0',
        status_addr: '0/1/1',
        dpt_type: 'DPT1'
    },
    {
        name: "zvukari",
        dst_addr: '0/2/0',
        // Actuator 1.1.1 writes the status address by itself about 100 ms
        // after every change - its own confirmation of what it did, as opposed
        // to what somebody asked for on dst_addr. All four were confirmed on
        // the bus on 2026-09-20 by switching each circuit and watching which
        // address answered; none of them is assumed from the convention.
        status_addr: '0/2/1',
        dpt_type: 'DPT1'
    },
    {
        name: "sala",
        dst_addr: '0/3/0',
        status_addr: '0/3/1',
        dpt_type: 'DPT1'
    },
    {
        name: "podium",
        dst_addr: '0/4/0',
        status_addr: '0/4/1',
        dpt_type: 'DPT1'
    },
    //scene    
    {
        name: "scene",
        dst_addr: '1/0/0',
        dpt_type: 'DPT5'
    },
    {
        name: "uvod",
        dst_addr: '1/0/0',
        dpt_type: 'DPT5',
        value: 0 //address is zero based, in KNX ETS sw is scene ID 1
    },
    {
        name: "chvaly",
        dst_addr: '1/1/0',
        dpt_type: 'DPT5',
        value: 1
    },
    {
        name: "kazen",
        dst_addr: '1/2/0',
        dpt_type: 'DPT5',
        value: 2
    },
];
//
//
// CRON WORKER
//
//
function action_central_off(callback) {
    //KNX data is like ['0/1/5', 'DPT1', 0] so i need some translations
    var data = {
        'dst_addr': '0/0/1',
        'dpt_type': 'DPT1',
        'value': 0
    };
    knx.KNX_send(data, callback);
}
// Central off every day at 00:00
cron.CRON_schedule('0 0 * * *', "Central OFF", action_central_off);
//
//
// BRIDGE WORKER
//
//
ws.WS_event.on("message", function(data, client) {
    // Parsing lives in services/parser.js so it can be tested without sockets.
    // Anything it rejects used to reach the bus layer and terminate the process.
    var result = parser.PARSER_parse(data, translator);
    if (result.rejected) {
        console.warn("APP: Rejected frame from WS -", result.rejected, "|", String(data));
        return;
    }
    if (result.query === 'HEALTH') {
        // Answer the client that asked, not everyone. Nothing reaches the bus.
        var lines = health.HEALTH_report({
            knxd_connected: knx.KNX_status().connected,
            listening: knx.KNX_status().listening,
            clients: ws.WS_clients(),
            addresses: Object.keys(distinctAddresses()).length,
            known: Object.keys(last_state).length,
            state_newest_at: store.STORE_newest(last_state),
            last_bus_at: last_bus_at
        });
        console.log("APP: HEALTH asked by a client");
        for (var i = 0; i < lines.length; i++) {
            ws.WS_sendTo(client, lines[i]);
        }
        return;
    }
    console.log("APP: Brdiging to KNX", result.message);
    knx.KNX_send(result.message);
});
//
//
// Last known state of the bus, keyed by group address, holding the exact line
// that was broadcast for it. A client that connects gets this replayed, so it
// shows the truth immediately instead of waiting for someone to press
// something. Before this, every bridge restart left Companion and the phone
// app displaying stale buttons with no sign anything was wrong.
//
// Loaded from disk at startup. Without this the bridge forgets everything it
// knew on every restart - a deploy, the nightly reboot - and stays blind until
// somebody happens to change a light, which on a quiet day is hours. The bus
// cannot be asked (no Read flag in ETS), so remembering is the only way a
// client sees anything when it opens.
//
// Each entry keeps when it was last confirmed, so nothing has to pretend that
// a value from last night is current. See HEALTH STATEAGE.
var last_state = store.STORE_load();
// Counts telegrams that arrived as a reply to a read request, so the bridge can
// report whether asking the bus achieved anything.
var responses_seen = 0;
// When the bridge last saw anything at all on the bus. Age of this is a better
// health signal than "is the socket open": the socket can be fine while the
// bus is dead.
var last_bus_at = null;

// The table lists nine entries but only eight addresses - 1/0/0 appears twice.
function distinctAddresses() {
    var seen = {};
    for (var i = 0; i < translator.length; i++) {
        seen[translator[i].dst_addr] = true;
    }
    return seen;
}

knx.KNX_event.on("message", function(data) {
    if (!data) {
        console.log("APP: No valid JSON data from KNX event", data);
        return;
    }
    if (data.kind === 'response') {
        responses_seen++;
    }
    last_bus_at = Date.now();
    //translator
    var message = null;
    var key = null;
    for (var i = 0; i < translator.length; i++) {
        var trs = translator[i];
        // A circuit answers to two addresses: the one it is commanded on, and
        // the one the actuator reports back on. Both mean the same light.
        var is_command = (trs.dst_addr == data.dst_addr);
        var is_status = (trs.status_addr && trs.status_addr == data.dst_addr);
        if (!is_command && !is_status) {
            continue;
        }
        var human = knx.KNX_humanType(data.dpt_type);
        if (!human) {
            return;
        }
        message = (human + " " + trs.name + " " + data.value).toUpperCase(); //scene name on
        // Cache under the command address either way, so one circuit is one
        // entry. A status telegram overwrites the command it confirms, which
        // is the point: the command is what was asked for, the status is what
        // the actuator did, and when a breaker is out those differ.
        key = trs.dst_addr;
        break;
    }
    if (message === null) {
        // Address is not in the table. Preserved behaviour: the raw object goes
        // out and clients receive the literal string "[object Object]". Ugly,
        // documented in PROTOCOL.md, and left alone because a client may key on
        // it. Not cached - it carries no usable state.
        //
        // Logged by name as well, because this is how a status address gets
        // discovered: switch a circuit and see which unknown address reports
        // itself a tenth of a second later.
        console.warn("APP: Unknown bus address " + data.dst_addr + " value " + data.value + " from " + data.src_addr + " - not in the table");
        ws.WS_send(data);
        return;
    }
    last_state[key] = { message: message, at: Date.now() };
    store.STORE_save(last_state);
    console.log("APP: Brdiging to WS", message);
    ws.WS_send(message);
});
//
// Ask the bus what everything currently is, rather than waiting for somebody
// to change it. Without this the cache only fills from traffic, so after a
// restart a client sees "unknown" for every circuit nobody has touched yet -
// which in practice meant blank buttons for the five switches while the
// scenes, which do get pressed, showed correctly.
//
// A read cannot move a light. Sequenced anyway: knxd hands out client
// addresses from a pool of eight (--client-addrs=1.1.129:8) and each send
// takes a fresh connection, so firing all of them at once would crowd it.
//
// Runs again after every reconnect, because a listener that was detached has
// missed whatever happened while it was away.
function refreshBusState() {
    var addresses = Object.keys(distinctAddresses());
    console.log("APP: Asking the bus about " + addresses.length + " addresses");
    var before = responses_seen;
    addresses.forEach(function(addr, index) {
        setTimeout(function() {
            knx.KNX_read(addr);
        }, index * 400);
    });
    // Say out loud whether anyone answered. Verified on this installation
    // 2026-09-20: the read requests reach the bus - a bus monitor shows
    // "Read from 1.1.130 to 0/0/1" - and nothing replies, because the group
    // objects do not have the Read flag set in the ETS project. Until that
    // changes, state can only be learned by watching traffic, and a circuit
    // nobody has touched since startup is genuinely unknown rather than off.
    // Without this line the feature looks like it works and quietly does not.
    setTimeout(function() {
        var answered = responses_seen - before;
        if (answered === 0) {
            console.warn("APP: Asked the bus about " + addresses.length +
                " addresses, nothing answered. Expected on this installation: " +
                "the group objects have no Read flag set in ETS. State will be " +
                "learned from traffic instead.");
        } else {
            console.log("APP: " + answered + " of " + addresses.length + " addresses answered");
        }
    }, addresses.length * 400 + 3000);
}

knx.KNX_event.on("listening", refreshBusState);
//
// Bring a newly connected client up to date, using the ordinary outbound
// format. Nothing new to learn on the client side: Companion already
// understands these lines and simply updates its buttons.
ws.WS_event.on("connection", function(client) {
    var addresses = Object.keys(last_state);
    if (!addresses.length) {
        console.log("APP: New client, no cached bus state to send yet");
        return;
    }
    console.log("APP: Replaying " + addresses.length + " cached states to new client");
    for (var i = 0; i < addresses.length; i++) {
        ws.WS_sendTo(client, last_state[addresses[i]].message);
    }
});
//
//