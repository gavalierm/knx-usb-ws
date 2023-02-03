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
sheduleCron('* * * * *', "Turning off the light!", function(msg) {
  KNX_send(['0/1/5', 'DPT1', 0], function() {
    console.log("CRON:", msg);
  }); //['0/2/29','DPT1',0] //0/2/3 group central, 17 scenes, 0 off
});