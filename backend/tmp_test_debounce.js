(async ()=>{
  try{
    const ns = require('./src/services/notifierService');
    console.log('Sending first notify...');
    await ns.notify('test','first');
    console.log('First done, sending second immediately (should be suppressed)');
    await ns.notify('test','second');
    console.log('Second done, waiting 65s then sending third (should go through)');
    await new Promise(r=>setTimeout(r,65000));
    await ns.notify('test','third after wait');
    console.log('Third done');
    process.exit(0);
  } catch(e){
    console.error('ERROR', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
