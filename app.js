//KNX USB WS
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
//
// CRON WORKER
//
//
function action_central_off(callback) {
    //KNX data is like ['0/1/5', 'DPT1', 0] so i need some translations
    var data = {
        'dst_addr': '0/1/5',
        'dpt_type': 'DPT1',
        'value': 0
    };
    knx.KNX_send(data, callback);
}
//
cron.CRON_schedule('* * * * *', "Central OFF", action_central_off);
//
//
// BRIDGE WORKER
//
//
ws.WS_event.on("message", function(data) {
    knx.KNX_send(data);
});
//
knx.KNX_event.on("message", function(data) {
    ws.WS_send(data);
});
//
//