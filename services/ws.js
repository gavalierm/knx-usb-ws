//ws service
const PORT = 9240;

const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: PORT });

var EventEmitter = require('events').EventEmitter;
var ws_emitter = new EventEmitter();


console.log("WS: Service started as: ", PORT);


function heartbeat() {
    console.log("heartbeat for", this.ip);
    this.isAlive = true;
}

function toJson(str) {
    try {
        var json = JSON.parse(str.toString('utf8'));
    } catch (e) {
        var json = str.toString('utf8');
    }
    return json;
}

function asString(json) {
    if (!json) {
        return 'BAD MESSAGE';
    }
    return json;
}


// accepting KNX message like "0/0/2"
wss.on('open', function message(data) {
    console.log('WS: Received: %s', data);
});

wss.on('connection', function connection(ws, req) {
    //
    ws.isAlive = true;
    ws.on('pong', heartbeat);
    //
    ws.ip = req.socket.remoteAddress;

    ws.client_uuid = req.headers['sec-websocket-key'];

    ws.on('message', function message(data) {

        data = data.toString().trim();

        return multicast(ws, data);
    });
});

async function broadcast(data) {
    console.log('WS: Broadcasting: ', data);
    wss.clients.forEach(function each(client) {
        if (client.readyState === 1) {
            client.send(asString(data), false);
        }
    });
}

async function multicast(ws, data) {
    console.log('WS: Multicasting: ', data);
    wss.clients.forEach(function each(client) {
        if (client !== ws && client.readyState === 1) {
            client.send(asString(data), false);
        }
    });
}

const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 15000);

wss.on('close', function close() {
    clearInterval(interval);
});


exports.WS_send = broadcast;
exports.WS_event = ws_emitter
