// 'use strict' this is a header that forces the javascript engine to apply a stricter 
// interpretation of your code. For more details take a look at
// https://stackoverflow.com/questions/1335851/what-does-use-strict-do-in-javascript-and-what-is-the-reasoning-behind-it
'use strict';
//
// https://www.promotic.eu/en/pmdoc/Subsystems/Comm/PmDrivers/KNXDTypes.htm
var eibd = require("eibd");
var opts = { host: "localhost", port: 6720 }
var EventEmitter = require('events').EventEmitter;
var knx_emitter = new EventEmitter();
//This function initialises a connection to the eibd/knx bus
var eibd_timeout = null;
var data_to_resend = null;
//
var eibdconn = new eibd.Connection();

function humanType(dpt_type) {
  switch (dpt_type) {
    case "DTP1":
      return "switch";
    case "DTP5":
      return "scene";
  }
  console.error("KNX: No valid KNX type");
  return null;
}

function isConnected() {
  if (eibdconn) {
    if (eibdconn.conn) {
      return true;
    }
  }
  return false;
}

function checkStatus() {
  clearTimeout(eibd_timeout);
  eibd_timeout = null;
  console.warn('EIBD: Reconnecting ...');
  eibdconn.socketRemote({ host: opts.host, port: opts.port }, function(err) {
    if (err) {
      console.error('EIBD: Socket error: %s', err.code);
      eibd_timeout = setTimeout(function() {
        checkStatus();
      }, 10000);
    } else {
      console.log('EIBD: successfully connected to %s:%d', opts.host, opts.port);
      if (data_to_resend) {
        sendToBus(data_to_resend);
        data_to_resend = null;
      }
    }
  });
}

function openListener() {
  eibdconn.openGroupSocket(0, function(parser) {
    console.log('EIBD: Prepare listener for KNX events');
    parser.on('write', function(src_addr, dst_addr, dpt_type, value) {
      var date = new Date().toJSON();
      var knx_json_obj = { 'src_addr': src_addr, 'dst_addr': dst_addr, 'dpt_type': dpt_type, 'value': value, 'time': date };
      //
      console.log('KNX: Received', knx_json_obj);
      //
      knx_emitter.emit('message', knx_json_obj);
    });
  });
}
// This function sends a message to the bus. An example use of WriteToBus...
// WriteToBus("0/2/40", "DPT1", 0, callback);
function sendToBus(data, callback) {
  //console.log("KNX: Send", data);
  if (!isConnected()) {
    //
    data_to_resend = data;
    //
    console.error('KNX: Not connected');
    checkStatus();
    return;
  }
  //
  if (!data) {
    console.error('KNX: No valid data');
    return;
  }
  //
  console.log('KNX: Sending data ...', data);
  eibdconn.socketRemote({ host: opts.host, port: opts.port }, function() {
    eibdconn.openTGroup(eibd.str2addr(data.dst_addr), 0, function(err) {
      if (err) {
        console.error("KNX: sendToBus failed", err);
      } else {
        eibdconn.sendAPDU(eibd.createMessage('write', data.dpt_type, parseFloat(data.value)), callback);
      }
    });
  });
}
//
//groupsocketlisten(); init on load
//
function init() {
  console.log('EIBD: Connecting to EIBD server at %s:%d', opts.host, opts.port);
  //check connectin
  checkStatus();
  //attach listener
  openListener();
  //
  //console.log(eibdconn);
}
//
exports.KNX_init = init;
exports.KNX_send = sendToBus;
exports.KNX_event = knx_emitter;
exports.KNX_humanType = humanType;