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
//
var translator = [
    //switch
    {
        name: "schody",
        dst_addr: '0/0/4',
        dpt_type: 'DPT1'
    },
    {
        name: "zvukari",
        dst_addr: '0/0/3',
        dpt_type: 'DPT1'
    },
    {
        name: "sala",
        dst_addr: '0/0/2',
        dpt_type: 'DPT1'
    },
    {
        name: "podium",
        dst_addr: '0/0/1',
        dpt_type: 'DPT1'
    },
    {
        name: "central",
        dst_addr: '0/0/5',
        dpt_type: 'DPT1'
    },
    //scene
    {
        name: "uvod",
        dst_addr: '0/1/0',
        dpt_type: 'DPT5',
        value: 0
    },
    {
        name: "chvaly",
        dst_addr: '0/1/1',
        dpt_type: 'DPT5',
        value: 1
    },
    {
        name: "kazen",
        dst_addr: '0/1/2',
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
    //console.log("DATA MESS", data);
    var data_ = ws.WS_asJson(data);
    if (!data_) {
        data_ = ws.WS_asString(data);
        if (!data_) {
            console.warn("APP: No valid JSON data from WS event. Trying translator ...", data);
            return;
        }
        //
        //console.warn("DATA", data_);
        //
        data_ = data_.split(" ");
        if (!data_[0] && !data_[1]) {
            console.log("APP: No correct message from WS");
            return;
        }
        //
        for (var i = 0; i < translator.length; i++) {
            var trs = translator[i];
            //console.log(trs);
            if (trs.name.toUpperCase() != data_[1].toUpperCase()) {
                //console.log("skip", trs);
                continue;
            }
            console.log("DATA VALUE", data_[2]);
            if (data_[2] !== undefined || data_[2] !== '') {
                trs.value = data_[2];
            }
            data_ = trs;
            break;
        }
    }
    console.log("APP: Brdiging to KNX", data_);
    knx.KNX_send(data_);
});
//
knx.KNX_event.on("message", function(data) {
    var data_ = data;
    if (!data_) {
        console.log("APP: No valid JSON data from KNX event", data_);
        return;
    }
    //translator
    for (var i = 0; i < translator.length; i++) {
        var trs = translator[i];
        if (trs.dst_addr != data_.dst_addr) {
            continue;
        }
        if (!knx.KNX_humanType(data_.dpt_type)) {
            return;
        }
        data_ = knx.KNX_humanType(data_.dpt_type) + " " + trs.name + " " + data_.value; //scene name on
        data_ = data_.toUpperCase();
        break;
    }
    console.log("APP: Brdiging to WS", data_);
    ws.WS_send(data_);
});
//
//