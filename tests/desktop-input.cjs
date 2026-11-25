const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},locale:'ko-KR'});
 await page.addInitScript(()=>{
  const rows=Array.from({length:300},(_,i)=>({id:'steam:'+i,source:'steam',bucket:'steam',name:'Game '+i}));
  localStorage.setItem('polar.desktop.v1',JSON.stringify({rows}));
  window.pad={mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};
  Object.defineProperty(navigator,'getGamepads',{value:()=>window.pad?[window.pad]:[]});
  window.__TAURI__={core:{invoke:async(cmd)=>{
   if(cmd==='discover')return new Promise(()=>{});
   if(cmd==='get_options')return {fullscreen:true,login:false};
   if(cmd==='launch_game')window.started=true;
   if(cmd==='get_session')return {phase:'unknown'};
   return null;
  }}};
  window.captureKeys=performance.now();
 });
 const times=[];
 for(let i=0;i<10;i++){
  await page.goto(process.env.POLAR_TEST_URL);
  await page.waitForFunction(()=>document.querySelector('.tile.sel'));
  times.push(await page.evaluate(()=>performance.now()-window.captureKeys));
 }
 await page.bringToFront();await page.locator('.tile.sel').focus();
 async function press(index){
  await page.evaluate(n=>window.pad.buttons[n].pressed=true,index);await page.waitForTimeout(120);
  await page.evaluate(n=>window.pad.buttons[n].pressed=false,index);await page.waitForTimeout(75);
 }
 await press(15);assert.notEqual(await page.locator('h1').innerText(),'Game 0');
 await press(0);assert(await page.evaluate(()=>window.started));await press(1);assert(!await page.locator('dialog').isVisible());
 await page.evaluate(()=>window.pad=null);await page.waitForTimeout(150);
 assert((await page.locator('.footkeys').innerText()).includes('Enter'));
 assert(times.filter(n=>n<3000).length>=9);
 console.log('Cached 300-game home, navigation to first usable rail over 10 browser loads (ms):',times.map(Math.round).join(', '),'; simulated gamepad selection, launch, back and disconnect passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
