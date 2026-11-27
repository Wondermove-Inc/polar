const assert=require('node:assert/strict');
const {chromium}=require('playwright');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
  for(const [width,height,dpr,locale,motion] of [[640,420,1,'en-US',false],[1572,932,1.25,'ko-KR',true],[3840,2160,1,'ko-KR',false]]){
   const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,locale,reducedMotion:width===3840?'reduce':'no-preference'});
   await page.addInitScript(motion=>{
    const rows=Array.from({length:120},(_,i)=>({id:'steam:'+i,source:'steam',name:'Game '+i}));
    localStorage.setItem('polar.desktop.v1',JSON.stringify({rows,motion,current:'steam:4'}));
    window.__TAURI__={core:{invoke:async(cmd,args={})=>{
     if(cmd==='discover'){
      if(args.source==='epic')await new Promise(r=>window.finishScan=r);
      return {complete:true,warnings:args.source==='steam'?['Diagnostic '+('folder/'.repeat(24))]:[],items:args.source==='steam'?rows:[]};
     }
     if(cmd==='epic_folders')return Array.from({length:12},(_,i)=>'D:/'+('Games'.repeat(28))+'/'+i);
     if(cmd==='get_options')return new Promise(r=>window.readOptions=()=>r({login:false,fullscreen:false}));
     if(cmd==='window_action'&&['login','fullscreen'].includes(args.action))
      return new Promise((resolve,reject)=>window.writeOption=ok=>ok?resolve():reject('declined'));
     return null;
    }}};
   },motion);
   await page.goto(process.env.POLAR_TEST_URL);
   await page.locator('.tile.sel').waitFor();
   const settings=page.locator('#settings'),panel=page.locator('#panel');
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
   const login=page.locator('.settingGroup input');
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
   const lib=page.locator('.lib');await lib.evaluate(e=>e.scrollTop=800);
   const scroll=await lib.evaluate(e=>e.scrollTop);
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
   assert(Math.abs(await group.evaluate(e=>e.scrollTop)-position)<2,'inner scroll preserved');
   await page.keyboard.press('Escape');
   assert(await settings.evaluate(e=>e===document.activeElement));
   assert.equal(await lib.evaluate(e=>e.scrollTop),scroll);
   assert.equal(await page.locator('.filter[aria-pressed=true]').getAttribute('data-key'),'steam');
   await page.close();
  }
  console.log('Right settings drawer, reduced motion, pointer dismissal, modal focus, fixed header and preserved scroll/filter/diagnostics passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
