// 'use strict' this is a header that forces the javascript engine to apply a stricter 
// interpretation of your code. For more details take a look at
// https://stackoverflow.com/questions/1335851/what-does-use-strict-do-in-javascript-and-what-is-the-reasoning-behind-it
'use strict';
//
const PORT = 9240;
//
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: PORT });
//
var EventEmitter = require('events').EventEmitter;
var ws_emitter = new EventEmitter();
//
console.log("WS: Service started as: ", PORT);
//
const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
        //console.log("Ping for", ws.ip);
    });
}, 15000);

function heartbeat() {
    console.log("heartbeat for", this.ip);
    this.isAlive = true;
}

function asJson(str) {
    var json = false;
    try {
        json = JSON.parse(str.toString('utf8'));
    } catch (e) {
        console.log("WS: Parsing JSON failed");
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
function init() {
    //console.log(wss);
    console.log('WS: Prepare listener for OPEN events');
    wss.on('open', function message(data) {
        console.log('WS: Opened connection: %s', data);
    });
    //
    console.log('WS: Prepare listener for CONNECTION events');
    wss.on('connection', function connection(ws, req) {
        //console.log("WS: Connection received", req.headers);
        //
        ws.on('pong', heartbeat);
        ws.ip = req.socket.remoteAddress;
        //
        ws.client_uuid = req.headers['sec-websocket-key'];
        //
        if (!ws.isAlive) {
            //not marked by me
            console.log("WS: Wellcome", ws.client_uuid, ws.ip);
            ws.isAlive = true;
        }
        //
        ws.on('message', function message(data) {
            data = data.toString().trim();
            multicast(ws, data);
            if (asJson(data)) {
                ws_emitter.emit('message', asJson(data));
            }
        });
        //
        ws.on('error', console.error);
    });
    //
    console.log('WS: Prepare listener for CLOSE events');
    wss.on('close', function close() {
        clearInterval(interval);
    });
}

function broadcast(data) {
    console.log('WS: Broadcasting: ', data);
    wss.clients.forEach(function each(client) {
        if (client.readyState === 1) {
            client.send(asString(data), false);
        }
    });
}

function multicast(ws, data) {
    console.log('WS: Multicasting: ', data);
    wss.clients.forEach(function each(client) {
        if (client !== ws && client.readyState === 1) {
            client.send(asString(data), false);
        }
    });
}
//
exports.WS_init = init;
exports.WS_send = broadcast;
exports.WS_event = ws_emitter;
exports.WS_asJson = asJson;