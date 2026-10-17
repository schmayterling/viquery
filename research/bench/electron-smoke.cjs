const {app,utilityProcess}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
app.setPath('userData',path.resolve(__dirname,'../raw/electron-user-data'));
app.whenReady().then(()=>{
  const child=utilityProcess.fork(path.join(__dirname,'electron-worker.cjs'),[],{stdio:'pipe',serviceName:'viquery inference smoke'});
  child.stdout.on('data',x=>process.stdout.write(x));
  child.stderr.on('data',x=>process.stderr.write(x));
  child.on('message',message=>{
    fs.writeFileSync(path.resolve(__dirname,'../raw/electron-smoke.json'),JSON.stringify(message,null,2));
    console.log(JSON.stringify(message));
    child.kill();app.exit(message.error?1:0);
  });
  child.on('exit',code=>{if(code)app.exit(code);});
});
setTimeout(()=>{console.error('utility process timed out');app.exit(2);},45000).unref();
