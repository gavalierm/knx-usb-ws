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
        name: "central",
        dst_addr: '0/0/1',
        dpt_type: 'DPT1'
    },
    {
        name: "schody",
        dst_addr: '0/1/0',
        dpt_type: 'DPT1'
    },
    {
        name: "zvukari",
        dst_addr: '0/2/0',
        dpt_type: 'DPT1'
    },
    {
        name: "sala",
        dst_addr: '0/3/0',
        dpt_type: 'DPT1'
    },
    {
        name: "podium",
        dst_addr: '0/4/0',
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
ws.WS_event.on("message", function(data) {
    // Parsing lives in services/parser.js so it can be tested without sockets.
    // Anything it rejects used to reach the bus layer and terminate the process.
    var result = parser.PARSER_parse(data, translator);
    if (result.rejected) {
        console.warn("APP: Rejected frame from WS -", result.rejected, "|", String(data));
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
var last_state = {};

knx.KNX_event.on("message", function(data) {
    if (!data) {
        console.log("APP: No valid JSON data from KNX event", data);
        return;
    }
    //translator
    var message = null;
    for (var i = 0; i < translator.length; i++) {
        var trs = translator[i];
        if (trs.dst_addr != data.dst_addr) {
            continue;
        }
        var human = knx.KNX_humanType(data.dpt_type);
        if (!human) {
            return;
        }
        message = (human + " " + trs.name + " " + data.value).toUpperCase(); //scene name on
        break;
    }
    if (message === null) {
        // Address is not in the table. Preserved behaviour: the raw object goes
        // out and clients receive the literal string "[object Object]". Ugly,
        // documented in PROTOCOL.md, and left alone because a client may key on
        // it. Not cached - it carries no usable state.
        console.log("APP: Brdiging to WS", data);
        ws.WS_send(data);
        return;
    }
    last_state[data.dst_addr] = message;
    console.log("APP: Brdiging to WS", message);
    ws.WS_send(message);
});
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
        ws.WS_sendTo(client, last_state[addresses[i]]);
    }
});
//
//