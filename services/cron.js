const schedule = require('node-schedule');

console.log('CRON: Service started');

const job = schedule.scheduleJob('42 * * * *', function(){
  console.log('Turning off the light!');
  
});