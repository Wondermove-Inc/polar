const assert=require('node:assert/strict');
const {chromium}=require('playwright');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
  for(const [width,height,dpr,locale,motion] of [[640,420,1,'en-US',false],[1920,420,1,'en-US',true],[1572,932,1.25,'ko-KR',true],[3840,2160,1,'ko-KR',false]]){
   const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,locale,reducedMotion:width===3840?'reduce':'no-preference'});
   await page.addInitScript(motion=>{
    const rows=Array.from({length:120},(_,i)=>({id:'steam:'+i,source:'steam',name:'Game '+i}));
    localStorage.setItem('polar.desktop.v1',JSON.stringify({rows,motion,current:'steam:4'}));
    window.exitRequests=0;
    window.__TAURI__={core:{invoke:async(cmd,args={})=>{
     if(cmd==='discover'){
      if(args.source==='epic')await new Promise(r=>window.finishScan=r);
      return {complete:true,warnings:args.source==='steam'?['Diagnostic '+('folder/'.repeat(24))]:[],items:args.source==='steam'?rows:[]};
     }
     if(cmd==='epic_folders')return Array.from({length:12},(_,i)=>'D:/'+('Games'.repeat(28))+'/'+i);
     if(cmd==='get_options')return new Promise(r=>window.readOptions=()=>r({login:false,fullscreen:false}));
     if(cmd==='window_action'&&args.action==='quit'){
      window.exitRequests++;
      return new Promise((resolve,reject)=>window.finishExit=ok=>ok?resolve():reject('close failed'));
     }
     if(cmd==='window_action'&&['login','fullscreen'].includes(args.action))
      return new Promise((resolve,reject)=>window.writeOption=ok=>ok?resolve():reject('declined'));
     return null;
    }}};
   },motion);
   await page.goto(process.env.POLAR_TEST_URL);
   await page.locator('.tile.sel').waitFor();
   const settings=page.locator('#settings'),panel=page.locator('#panel');
   const quit=page.getByRole('button',{name:locale==='ko-KR'?'Polar 종료':'Exit Polar',exact:true});
   assert.equal(await quit.count(),1,'the header needs an accessible exit button');
   const clock=await page.locator('.clock').boundingBox(),settingsBox=await settings.boundingBox(),exit=await quit.boundingBox();
   assert(clock.x+clock.width<=settingsBox.x,'the time should appear before Settings');
   assert(settingsBox.x+settingsBox.width<=exit.x&&exit.x+exit.width<=width,'Exit should follow Settings and fit in the header');
   assert(Math.abs(exit.y+exit.height/2-clock.y-clock.height/2)<1.5);
   await quit.click();await page.keyboard.press('Enter');
   assert.equal(await page.evaluate(()=>window.exitRequests),1,'deduplicate pending close');
   await page.evaluate(()=>window.finishExit(false));await page.locator('#notice').filter({hasText:'close failed'}).waitFor();
   await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.exitRequests),2);
   await page.evaluate(()=>window.finishExit(true));
   await settings.click();
   await page.waitForFunction(()=>document.querySelector('#panel').getAnimations().every(a=>a.playState!=='running'));
   const rect=await panel.boundingBox();
   assert(rect.x>=width*.14&&Math.abs(rect.x+rect.width-width)<1&&rect.y===0&&Math.abs(rect.height-height)<1,'settings should expose the page on its left');
   const animation=await panel.evaluate(e=>getComputedStyle(e).animationName);
   assert.equal(animation==='none',motion||width===3840,'drawer motion preference');
   const selected=await page.locator('.tile.sel').getAttribute('data-id');
   await page.locator('#play').evaluate(e=>e.focus());
   assert(await panel.evaluate(e=>e.contains(document.activeElement)));
   const insideX=rect.x+12,outsideX=rect.x-12;
   await page.mouse.move(insideX,12);await page.mouse.down();await page.mouse.move(outsideX,12);await page.mouse.up();
   assert(await panel.isVisible(),'drag from drawer must not dismiss');
   await page.mouse.click(outsideX,12);
   assert(!(await panel.isVisible()));assert(await settings.evaluate(e=>e===document.activeElement));
   assert.equal(await page.locator('.tile.sel').getAttribute('data-id'),selected);
   await settings.click();
   const system=page.locator('[data-control=system]'),display=page.locator('[data-control=display]');
   await system.click();
   const groupName=locale==='ko-KR'?'시작':'Startup';
   assert.equal(await panel.locator('.settingGroup').getByRole('button').count(),0,'startup settings should only contain the login option');
   assert.equal(await system.innerText(),groupName);
   const login=panel.getByRole('region',{name:groupName,exact:true}).getByRole('checkbox',{name:locale==='ko-KR'?'Windows 로그인 시 시작':'Start when I sign in to Windows',exact:true});
   await page.keyboard.press('ArrowDown');
   assert(await login.evaluate(e=>e===document.activeElement));
   await page.keyboard.press('ArrowUp');
   assert(await system.evaluate(e=>e===document.activeElement));
   await login.check();await page.evaluate(()=>window.writeOption(true));await page.waitForFunction(()=>!document.querySelector('.settingGroup input').disabled);
   await page.evaluate(()=>window.readOptions());assert(await login.isChecked(),'late startup read overwrote a saved setting');
   for(const ok of [false,true]){
    await login.uncheck();await display.click();await system.click();
    assert(await login.isDisabled(),'option still being written');assert(!(await login.isChecked()));
    await page.evaluate(ok=>window.writeOption(ok),ok);await page.waitForFunction(()=>!document.querySelector('.settingGroup input').disabled);
    assert.equal(await login.isChecked(),!ok);
    assert(await system.evaluate(e=>e===document.activeElement));
   }
   await page.keyboard.press('Escape');
   await page.locator('#library').click();await page.locator('.filter[data-key=steam]').click();
   const results=page.locator('.grid').locator('..');
   const chrome=page.locator('.libHeading h2, #addLib, .filter, footer');
   const bounds=()=>chrome.evaluateAll(els=>els.map(e=>e.getBoundingClientRect().toJSON()));
   const before=await bounds();
   const card=page.locator('.grid .card').first(), first=await card.boundingBox();
   const viewport=await results.boundingBox();
   assert(first.height+10<=viewport.height,'focused card and outline should fit even in a short wide window');
   await page.mouse.move(first.x+20,first.y+18);await page.mouse.wheel(0,800);
   await page.waitForFunction(()=>document.querySelector('.grid').parentElement.scrollTop>0);
   const scroll=await results.evaluate(e=>e.scrollTop);
   assert((await card.boundingBox()).y<first.y-10,'wheel should move game cards');
   assert.deepEqual(await bounds(),before,'library heading, actions, filters and footer must stay pinned');
   await page.keyboard.press('ArrowUp');
   assert(!(await page.locator('.grid').evaluate(e=>e.contains(document.activeElement))),'Up from a pinned filter enters the header');
   assert.equal(await results.evaluate(e=>e.scrollTop),scroll);
   await settings.click();await page.locator('[data-control=sources]').click();
   const group=page.locator('.settingGroup');
   await group.locator('summary').first().click();
   await group.evaluate(e=>e.scrollTop=e.scrollHeight);
   const position=await group.evaluate(e=>e.scrollTop);
   assert(position>0);assert(await group.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
   const header=await page.locator('#close').boundingBox();
   assert(header.y>=0&&header.y+header.height<height/2);
   await page.evaluate(()=>window.finishScan());
   await page.waitForFunction(()=>!document.querySelector('[data-control=scan]').disabled);
   assert(await group.locator('details').first().evaluate(e=>e.open),'expanded diagnostics must survive scan');
   const afterScan=await group.evaluate(e=>({top:e.scrollTop,max:e.scrollHeight-e.clientHeight}));
   assert(Math.abs(afterScan.top-Math.min(position,afterScan.max))<2,'inner scroll preserved within new content bounds');
   await page.keyboard.press('Escape');
   assert(await settings.evaluate(e=>e===document.activeElement));
   assert.equal(await results.evaluate(e=>e.scrollTop),scroll);
   assert.equal(await page.locator('.filter[aria-pressed=true]').getAttribute('data-key'),'steam');
   await page.locator('.filter[data-key=all]').click();
   assert.equal(await results.evaluate(e=>e.scrollTop),0,'a new filter starts at its first result');
   await page.locator('.filter[data-key=xbox]').click();
   assert(await page.locator('.empty').isVisible());
   assert.deepEqual(await bounds(),before,'empty result keeps the same header');
   await page.close();
  }
  console.log('Right settings drawer, reduced motion, pointer dismissal, modal focus, fixed header and preserved scroll/filter/diagnostics passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
