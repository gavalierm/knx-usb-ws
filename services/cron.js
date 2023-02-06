// 'use strict' this is a header that forces the javascript engine to apply a stricter 
// interpretation of your code. For more details take a look at
// https://stackoverflow.com/questions/1335851/what-does-use-strict-do-in-javascript-and-what-is-the-reasoning-behind-it
'use strict';
//
const schedule = require('node-schedule');
//
console.log('CRON: Service started');
//
function scheduleCron(cron_time, message, callback) {
  //'42 * * * *'
  console.log("CRON: Schedule action [ " + message + " ] at " + cron_time);
  const job = schedule.scheduleJob(cron_time, function() {
    function message_callback() {
      var date = new Date();
      console.log("CRON: Job done [ " + message + " ]", date.toString());
    };
    if (callback) {
      callback(message_callback);
    } else {
      message_callback();
    }
  });
}
//
function init() {
  scheduleCron('*/15 * * * *', "I m working");
}
exports.CRON_init = init;
exports.CRON_schedule = scheduleCron;
//