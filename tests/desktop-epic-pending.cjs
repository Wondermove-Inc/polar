const assert=require('node:assert/strict');
const {chromium}=require('playwright');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({locale:'en-US',reducedMotion:'reduce'});
  const folder=String.raw`D:\Epic Games\DeathStranding`;
  await page.addInitScript(folder=>{
   const official=localStorage.getItem('test:official');
   window.folders=official?[]:[folder];
   window.autoEpic=official?[{id:official,name:'Official name',source:'epic'}]:[];
   window.launches=[];window.saves=[];
   const state='test:manual';
   window.__TAURI__={core:{invoke:async(cmd,args={})=>{
    if(cmd==='discover'){
     const report={complete:true,warnings:[],unresolvedEpic:args.source==='epic'?window.folders:[],items:args.source==='manual'?JSON.parse(localStorage.getItem(state)||'[]'):args.source==='epic'?window.autoEpic:[]};
     if(args.source==='epic'&&official&&args.linkedFolders?.includes(folder.toLowerCase()))report.resolvedEpic={[folder.toLowerCase()]:official};
     if(args.source==='manual'&&localStorage.getItem('test:hold')){
      localStorage.removeItem('test:hold');
      return new Promise(resolve=>window.finishScan=()=>resolve(report));
     }
     return report;
    }
    if(cmd==='get_options')return {login:false};
    if(cmd==='epic_folders')return [];
    if(cmd==='artwork'||cmd==='online_background')return null;
    if(cmd==='pick_shortcut'){
     if(window.delayPicker)return new Promise(resolve=>window.finishPicker=resolve);
     return {id:window.pickedId||'epic-short:DS',name:'Launch shortcut'};
    }
    if(cmd==='save_manual'){window.saves.push(args);localStorage.setItem(state,JSON.stringify([{id:args.id,name:args.name,source:args.source}]))}
    if(cmd==='launch_game')window.launches.push(args);
   }}};
  },folder);
  await page.goto(process.env.POLAR_TEST_URL);
  const button=name=>page.getByRole('button',{name,exact:true});
  const pending=page.locator('.grid [data-epic-folder]');
  await page.locator('#library').click();
  await pending.waitFor({timeout:2000});
  assert.equal(await pending.count(),1);assert.match(await pending.innerText(),/DeathStranding/);
  assert.match(await page.locator('.counter').innerText(),/0 games.*1/);
  assert(!(await page.locator('.empty').isVisible()));
  await button('Steam').click();assert.equal(await pending.count(),0);
  await button('Epic Games').click();await pending.click();
  assert(await page.getByText(folder,{exact:true}).isVisible());
  assert.equal(await button('Registered Windows apps').count(),0);
  await page.evaluate(()=>window.delayPicker=true);await button('Choose shortcut').click();
  await page.keyboard.press('Escape');await pending.click();
  await page.evaluate(()=>window.finishPicker({id:'epic-short:Wrong',name:'Wrong picker'}));
  assert.equal(await page.getByLabel('Game title').count(),0);
  await page.evaluate(()=>{window.delayPicker=false;window.pickedId='steam:22'});await button('Choose shortcut').click();
  assert.equal(await page.getByLabel('Game title').count(),0);
  await page.evaluate(()=>window.pickedId='epic-short:DS');await button('Choose shortcut').click();
  assert.equal(await page.getByLabel('Game title').inputValue(),'DeathStranding');
  assert.equal(await page.getByRole('combobox').inputValue(),'epic');
  await button('Save').click();await page.waitForFunction(()=>!document.querySelector('dialog').open);
  assert.equal(await pending.count(),0);assert.equal(await page.locator('.grid .card').count(),1);
  assert.deepEqual(await page.evaluate(()=>window.launches),[]);
  assert.equal(await page.evaluate(()=>window.saves[0].id),'epic-short:DS');
  await page.reload();await page.locator('#library').click();await button('Epic Games').click();
  assert.equal(await pending.count(),0);assert.equal(await page.locator('.grid .card').count(),1);
  await page.evaluate(()=>{localStorage.removeItem('test:manual')});await page.reload();
  await page.locator('#library').click();await pending.waitFor();assert.equal(await pending.count(),1);
  await page.locator('#home').click();
  await button('Connect Epic Games shortcut').click();
  assert(await pending.isVisible());await pending.click();await button('Choose shortcut').click();
  await page.keyboard.press('Escape');assert.equal(await pending.count(),1);
  await page.evaluate(()=>localStorage.setItem('test:hold','yes'));await page.reload();
  await page.locator('#library').click();await pending.click();await button('Choose shortcut').click();await button('Save').click();
  await page.waitForFunction(()=>!document.querySelector('dialog').open);
  await page.evaluate(()=>window.finishScan());
  await page.waitForFunction(()=>document.querySelector('#homeLoading').hidden);
  assert.equal(await pending.count(),0);assert.equal(await page.locator('.grid .card').count(),1);
  const opaque=String.raw`shortcut:d:\links\death stranding.lnk`,canonical='epic:ns:item:DS';
  await page.evaluate(({opaque,canonical})=>{
   const key='polar.desktop.v1',prefs=JSON.parse(localStorage.getItem(key));
   const folder=Object.keys(prefs.epicLinks)[0];
   prefs.epicLinks[folder]=opaque;prefs.names={[opaque]:'Renamed game'};prefs.favorites=[opaque];
   localStorage.setItem(key,JSON.stringify(prefs));
   localStorage.setItem('test:manual',JSON.stringify([{id:opaque,source:'epic',name:'Linked game'}]));
   localStorage.setItem('test:official',canonical);
  },{opaque,canonical});
  await page.reload();await page.locator('#library').click();await button('Epic Games').click();
  assert.equal(await page.locator('.grid .card').count(),1);
  assert.equal(await page.locator('.grid .card').getAttribute('data-id'),canonical);
  await button('Favorites').click();assert.match(await page.locator('.grid .card').innerText(),/Renamed game/);
  console.log('Unresolved Epic folder is actionable, scoped by filter and picker, durable after confirmation and visible again after shortcut removal.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
