//
const schedule = require('node-schedule');
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
  console.log("CRON:", msg);
});