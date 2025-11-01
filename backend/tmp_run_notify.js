(async ()=>{
  try{
    const ns = require('./src/services/notifierService');
    await ns.notify('test','manual test from assistant');
    console.log('NOTIFY_PROMISE_RESOLVED');
    process.exit(0);
  } catch(e){
    console.error('NOTIFY_ERROR', e && e.message ? e.message : e);
    process.exit(1);
  }
})();