const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},locale:'en-US'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   let manual=[];let phase='unknown';window.calls=[];window.steam=[];
   window.__TAURI__={core:{invoke:async(cmd,a={})=>{
     window.calls.push({cmd,a});
     if(cmd==='discover'){
       if(window.slow)await new Promise(r=>setTimeout(r,120));
       const items=a.source==='steam'?window.steam:a.source==='manual'?manual:[];
       return {complete:!window.fail,items:window.fail?[]:items,warnings:window.fail?['offline']:[]};
     }
     if(cmd==='registered_apps')return [{id:'test!Game',name:'Registered test'}];
     if(cmd==='save_manual'){manual=[{id:'xbox:'+a.id,name:a.name,source:a.source}];return}
     if(cmd==='remove_manual'){manual=[];return}
     if(cmd==='artwork')return null;
     if(cmd==='get_options')return {fullscreen:true,login:false};
     if(cmd==='launch_game'){if(window.errorLaunch)throw new Error('missing');phase='waiting';return}
     if(cmd==='get_session'){if(window.finished)window.endObserved=true;return {phase:window.finished?'ended':phase,id:'steam:1'}}
   }}};
 });
 const url=process.env.POLAR_TEST_URL;
 await page.goto(url);const btn=(name)=>page.getByRole('button',{name,exact:true});
 await btn('Add game').click();await btn('Registered Windows apps').click();await btn('Registered test').click();
 await page.getByLabel('Game title').fill('Manual game');await btn('Save').click();await page.waitForFunction(()=>document.querySelector('h1').textContent==='Manual game');
 await btn('Library').first().click();await btn('Favorites').click();await btn('Edit list').click();await page.locator('.card').click();await btn('Done editing').click();assert.equal(await page.locator('.card').count(),1);
 await page.locator('.card').click({button:'right'});await btn('Remove from list').click();await btn('Remove from list').click();
 await page.waitForFunction(()=>!document.querySelector('dialog').open);assert.equal(await page.locator('.card').count(),0);
 await page.evaluate(()=>{window.steam=Array.from({length:300},(_,i)=>({id:'steam:'+i,name:'Game '+String(i).padStart(3,'0'),source:'steam'}))});
 await btn('Games').click();await btn('Scan again').click();await page.locator('.tile').first().waitFor();
 const timings=[];
 for(let i=0;i<24;i++){
  const elapsed=await page.evaluate(async i=>{
   const t=performance.now();document.dispatchEvent(new KeyboardEvent('keydown',{key:i%2?'ArrowLeft':'ArrowRight',bubbles:true}));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-t;
  },i);timings.push(elapsed)
 }
 await page.locator('.tile').nth(1).focus();await page.locator('.tile').nth(1).click();
 await page.keyboard.press('Enter');await page.waitForFunction(()=>window.calls.some(v=>v.cmd==='launch_game'));
 await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.calls.filter(v=>v.cmd==='launch_game').length),1);
 await page.evaluate(()=>window.finished=true);await page.waitForFunction(()=>window.endObserved&&document.querySelector('#play').textContent==='Play');
 assert.match(await page.locator('h1').innerText(),/Game 001/);
 await page.evaluate(()=>{window.errorLaunch=true;window.fail=true;window.slow=true});
 await page.locator('#play').click();await btn('Try again').waitFor();await page.keyboard.press('Escape');
 await btn('Settings').click();await page.locator('.categories').getByText('Game library',{exact:true}).click();await btn('Scan again').click();await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelector('.genre').textContent.includes('unconfirmed'));assert.match(await page.locator('h1').innerText(),/Game 001/);
 await page.setViewportSize({width:3840,height:2160});assert(await page.evaluate(()=>document.body.scrollWidth===innerWidth));
 await btn('Settings').click();await page.locator('.categories').getByText('Display & language',{exact:true}).click();
 await btn('한국어').click();await page.keyboard.press('Escape');await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'ko');
 assert.deepEqual(errors,[]);
 console.log('Registered app, favorites, removal, failed scan, launch/return, duplicate submit, 4K and persisted locale passed. 1080p Chromium input-to-second-frame p95:',timings.sort((a,b)=>a-b)[Math.floor(timings.length*.95)].toFixed(1),'ms');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
