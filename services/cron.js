// 'use strict' this is a header that forces the javascript engine to apply a stricter 
// interpretation of your code. For more details take a look at
// https://stackoverflow.com/questions/1335851/what-does-use-strict-do-in-javascript-and-what-is-the-reasoning-behind-it
'use strict';
//
const schedule = require('node-schedule');
var KNX_send = require('./knx_eibd').KNX_send;
//
console.log('CRON: Service started');
//
function sheduleCron(cron_time, message, callback) {
  //'42 * * * *'
  console.log("CRON: Schedule action [ " + message + " ] at " + cron_time);
  const job = schedule.scheduleJob(cron_time, function() {
    callback(message);
  });
}
//
function action_central_off(message) {
  //KNX data is like ['0/1/5', 'DPT1', 0] so i need some translations
  var data = {
    'dst_addr': '0/1/5',
    'dpt_type': 'DPT1',
    'value': 0
  };
  KNX_send(data, function() {
    console.log("CRON:", message);
  });
}
//
sheduleCron('* * * * *', "Central OFF", action_central_off);
//