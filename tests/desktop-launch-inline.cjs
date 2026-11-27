const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
  for(const [locale,width,height] of [['ko-KR',640,420],['en-US',3840,2160]]){
   const page=await browser.newPage({locale,viewport:{width,height},reducedMotion:'reduce'});
   await page.addInitScript(()=>{
    window.calls=[];window.phase='waiting';window.serial=0;
    window.__TAURI__={core:{invoke:async(cmd,args={})=>{
     window.calls.push([cmd,args]);
     if(cmd==='discover')return {complete:true,warnings:[],items:args.source==='steam'?[
      {id:'steam:1',name:'Alpha',source:'steam'},{id:'steam:2',name:'Beta',source:'steam'}]:[]};
     if(cmd==='get_options')return {login:false,fullscreen:false};
     if(cmd==='epic_folders')return [];
     if(cmd==='launch_game'){
      if(window.nativeBusy)throw 'busy';
      window.gameId=args.id;window.serial++;
      if(window.fail)throw 'missing';
      if(!window.approved)await new Promise(r=>window.approve=r);
     }
     if(cmd==='get_session'){
      if(window.readError){window.readError=false;throw 'interrupted'}
      if(window.delayPoll){window.delayPoll=false;await new Promise(r=>window.releasePoll=r)}
      return window.stale||{phase:window.phase,id:window.gameId,serial:window.serial};
     }
     return null;
    }}};
   });
   await page.goto(process.env.POLAR_TEST_URL);
   const play=page.locator('#play'),info=page.locator('#launchStatus');
   const ko=locale.startsWith('ko'),start=ko?'시작 중…':'Starting…',run=ko?'실행 중':'Running',idle=ko?'플레이':'Play';
   const expectPlay=value=>page.waitForFunction(s=>document.querySelector('#play').textContent===s,value,{timeout:3000});
   const calls=()=>page.evaluate(()=>window.calls.filter(([cmd])=>cmd==='launch_game').length);
   await page.locator('.tile.sel').focus();await page.keyboard.press('Enter');
   await page.waitForFunction(()=>!!window.approve);
   assert(!await page.locator('dialog').isVisible(),'launch should keep the game home visible');
   await expectPlay(start);await page.keyboard.press('Enter');assert.equal(await calls(),1);
   await page.keyboard.press('ArrowRight');await expectPlay(idle);await page.keyboard.press('Enter');
   assert.equal(await calls(),1);assert.match(await info.innerText(),/Alpha/);
   await page.evaluate(()=>{window.approved=true;window.approve()});
   await page.locator('.tile[data-id="steam:1"]').click();await expectPlay(start);
   await page.evaluate(()=>{window.phase='running';window.dispatchEvent(new Event('focus'))});
   await expectPlay(run);
   await page.evaluate(()=>{window.readError=true;window.dispatchEvent(new Event('focus'))});
   await page.waitForFunction(()=>!window.readError);
   await expectPlay(run);
   await page.evaluate(()=>{window.stale={id:window.gameId,phase:'ended',serial:window.serial-1};window.dispatchEvent(new Event('focus'))});
   await page.waitForTimeout(80);await expectPlay(run);
   await page.evaluate(()=>delete window.stale);
   await page.evaluate(()=>{window.delayPoll=true;window.dispatchEvent(new Event('focus'))});
   await page.waitForFunction(()=>!!window.releasePoll);
   const polls=await page.evaluate(()=>window.calls.filter(([cmd])=>cmd==='get_session').length);
   await page.evaluate(()=>{for(let i=0;i<8;i++)window.dispatchEvent(new Event('focus'))});
   assert.equal(await page.evaluate(()=>window.calls.filter(([cmd])=>cmd==='get_session').length),polls);
   await page.locator('#settings').click();const active=await page.evaluate(()=>document.activeElement.textContent);
   await page.evaluate(()=>{window.phase='ended';window.releasePoll()});
   await expectPlay(idle);assert.equal(await page.evaluate(()=>document.activeElement.textContent),active);
   await page.keyboard.press('Escape');
   await page.locator('.tile[data-id="steam:2"]').click();
   await page.evaluate(()=>window.fail=true);await play.click();
   await expectPlay(ko?'다시 시도':'Try again');assert(await info.isVisible());
   const launcher=page.locator('#openLauncher');
   assert(await launcher.isVisible());await launcher.click();
   assert(await page.evaluate(()=>window.calls.some(([c,a])=>c==='open_platform'&&a.source==='steam')));
   await page.locator('.tile[data-id="steam:1"]').click();await expectPlay(idle);assert(!(await launcher.isVisible()));
   await page.locator('.tile[data-id="steam:2"]').click();await page.evaluate(()=>{window.fail=false;window.phase='unknown'});
   await play.click();await expectPlay(idle);
   assert.equal(await play.getAttribute('aria-disabled'),'false');assert(!(await launcher.isVisible()));
   await page.waitForFunction(()=>!document.querySelector('#launchStatus').textContent,null,{timeout:6000});
   await page.evaluate(()=>window.phase='waiting');await play.click();await expectPlay(start);
   await page.locator('.tile[data-id="steam:1"]').click();await page.locator('#gameOptions').focus();
   await page.evaluate(()=>{window.phase='ended';window.dispatchEvent(new Event('focus'))});
   await page.waitForFunction(()=>!document.querySelector('#launchStatus').textContent);
   assert.equal(await page.locator('h1').innerText(),'Alpha');assert(await page.locator('#gameOptions').evaluate(e=>e===document.activeElement));
   await page.evaluate(()=>{
    window.nativeBusy=true;window.gameId='steam:2';window.phase='requesting';window.serial++;
    window.delayPoll=true;delete window.releasePoll;
   });
   await play.click();
   await page.waitForFunction(()=>!!window.releasePoll);
   const busyCalls=await calls();
   await page.locator('.tile.sel').focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');
   assert.equal(await calls(),busyCalls);
   await page.evaluate(()=>window.releasePoll());
   await page.waitForFunction(()=>document.querySelector('#launchStatus').textContent.includes('Beta'));
   assert.equal(await play.innerText(),idle);
   await page.locator('.tile[data-id="steam:2"]').click();await expectPlay(start);
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(80);await expectPlay(start);
   await page.evaluate(()=>{window.phase='running';window.dispatchEvent(new Event('focus'))});await expectPlay(run);
   await page.close();
  }
  console.log('Play starts in place; duplicate/other-game input, running/ended/unknown/failure, retry/launcher and retained focus passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
