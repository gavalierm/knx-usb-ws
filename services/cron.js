const schedule = require('node-schedule');

const job = schedule.scheduleJob('42 * * * *', function(){
  console.log('Turning off the light!');
  
});