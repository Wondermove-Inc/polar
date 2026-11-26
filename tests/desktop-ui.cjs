// Run with Playwright installed; serve desktop/ui and set POLAR_TEST_URL.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({locale:'ko-KR'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.calls=[];
  window.__TAURI__={core:{invoke:async(cmd,args={})=>{
   window.calls.push({cmd,args});
   if(cmd==='discover')return {complete:true,warnings:[],items:args.source==='steam'?Array.from({length:300},(_,i)=>({id:'steam:'+i,name:'Game '+i,source:'steam'})):[]};
   if(cmd==='get_options')return {fullscreen:true,login:false};
   if(cmd==='artwork')return null;
   if(cmd==='launch_game')return;
   if(cmd==='get_session')return {phase:'unknown'};
   return [];
  }}};
 });
 await page.goto(process.env.POLAR_TEST_URL);await page.locator('.tile').first().waitFor();
 const logo=page.locator('.brand img');
 assert.equal(await logo.count(),1,'home should display the Polar mark');
 assert(await logo.evaluate(img=>img.complete && img.naturalWidth>0 && img.alt==='' && img.currentSrc.endsWith('/polar.svg')));
 assert.equal((await page.locator('.brand').innerText()).trim(),'POLAR');
 await page.locator('.tile').first().focus();await page.keyboard.press('ArrowRight');
 const selected=await page.locator('h1').innerText();
 await page.keyboard.press('Enter');await page.waitForFunction(()=>window.calls.some(x=>x.cmd==='launch_game'));
 await page.keyboard.press('Escape');assert.equal(await page.locator('h1').innerText(),selected);
 await page.getByRole('button',{name:'설정',exact:true}).click();
 await page.getByRole('button',{name:'English',exact:true}).click();await page.keyboard.press('Escape');
 assert.equal(await page.locator('html').getAttribute('lang'),'en');
 await page.getByRole('button',{name:'Library',exact:true}).first().click();assert.equal(await page.locator('.card').count(),300);
 assert.deepEqual(errors,[]);
 }finally{await browser.close()}
})().catch(err=>{console.error(err);process.exit(1)});
