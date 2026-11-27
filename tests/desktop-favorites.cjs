const assert = require('node:assert/strict');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:960,height:640},locale:'en-US',reducedMotion:'reduce'});
    await page.addInitScript(() => {
      const rows = ['Alpha','Bravo','Charlie','Delta','Zulu'].map((name,i)=>({id:'steam:'+i,source:'steam',name}));
      if (!localStorage.getItem('polar.desktop.v1')) localStorage.setItem('polar.desktop.v1',JSON.stringify({
        rows,current:'steam:0',favorites:['steam:2','steam:4'],recent:['steam:0','steam:4','steam:1'],motion:true
      }));
      window.__TAURI__={core:{invoke:async(cmd,args={})=>{
        if(cmd==='discover')return {complete:true,items:args.source==='steam'?rows:[],warnings:[]};
        if(cmd==='get_options')return {fullscreen:false,login:false};
        return null;
      }}};
    });
    const ids=selector=>page.locator(selector).evaluateAll(els=>els.map(e=>e.dataset.id));
    const card=id=>page.locator('.card[data-id="steam:'+id+'"]');
    const btn=name=>page.getByRole('button',{name,exact:true});
    await page.goto(process.env.POLAR_TEST_URL);
    await page.locator('.tile.sel').waitFor();
    assert.deepEqual(await ids('.tile'),['steam:4','steam:2','steam:0','steam:1','steam:3']);
    assert.equal(await page.locator('h1').innerText(),'Zulu');
    await page.locator('#library').click();
    await btn('Steam').click();
    assert.deepEqual(await ids('.card'),['steam:2','steam:4','steam:0','steam:1','steam:3']);
    await card(1).click({button:'right'});
    await page.evaluate(()=>{
      const write=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        if(key==='polar.desktop.v1'){Storage.prototype.setItem=write;throw new Error('storage full')}
        return write.call(this,key,value);
      };
    });
    await btn('Add to favorites').click();assert(await btn('Add to favorites').isVisible());
    assert.match(await page.locator('#alert').innerText(),/save library state/);
    await btn('Add to favorites').click();await btn('Remove from favorites').waitFor();
    assert.equal(await page.locator('#alert').innerText(),'');
    await page.keyboard.press('Escape');
    assert.equal(await card(1).evaluate(e=>e===document.activeElement),true);
    assert.deepEqual(await ids('.card'),['steam:1','steam:2','steam:4','steam:0','steam:3']);
    await btn('Favorites').click();await btn('Edit list').click();
    const all=['steam:0','steam:1','steam:2','steam:3','steam:4'];
    assert.deepEqual(await ids('.card'),all);
    for(const id of [1,2]) {
      await card(id).click();
      assert.equal(await card(id).getAttribute('aria-pressed'),'false');
      assert.deepEqual(await ids('.card'),all);
    }
    await btn('Done editing').click();assert.deepEqual(await ids('.card'),['steam:4']);
    await page.reload();await page.locator('#gameOptions').click();
    await btn('Remove from favorites').click();await page.keyboard.press('Escape');
    await page.locator('#library').click();await btn('Favorites').click();
    assert.deepEqual(await ids('.card'),[]);assert(await page.locator('.empty').isVisible());
    await btn('All').click();assert.deepEqual(await ids('.card'),all);

    const epic=await browser.newPage({locale:'en-US',reducedMotion:'reduce'});
    await epic.addInitScript(()=>{
      const shortcut={id:'epic-short:DS',name:'Zulu',source:'epic',bucket:'manual'};
      const official={id:'epic:ns:cat:DS',name:'Zulu',source:'epic'};
      const steam={id:'steam:3',name:'Alpha',source:'steam'};
      if(!localStorage.getItem('polar.desktop.v1'))localStorage.setItem('polar.desktop.v1',JSON.stringify({rows:[steam,shortcut],motion:true}));
      window.__TAURI__={core:{invoke:async(cmd,args={})=>{
        if(cmd==='discover'){
          if(args.source==='epic')await new Promise(done=>window.finishEpic=done);
          return {complete:true,warnings:[],items:{steam:[steam],manual:[shortcut],epic:[official]}[args.source]||[]};
        }
        if(cmd==='get_options')return {fullscreen:false,login:false};
        return null;
      }}};
    });
    await epic.goto(process.env.POLAR_TEST_URL);
    const favoritesTab=epic.locator('.filter[data-key=favorites]');
    await epic.locator('#library').click();await favoritesTab.click();await epic.locator('#edit').click();
    await epic.locator('.card[data-id="epic-short:DS"]').click();
    await epic.evaluate(()=>window.finishEpic());
    const merged=epic.locator('.card[data-id="epic:ns:cat:DS"]');
    await merged.waitFor();assert.equal(await merged.getAttribute('aria-pressed'),'true');
    assert(await merged.evaluate(e=>e===document.activeElement));
    await epic.evaluate(()=>{
      const prefs=JSON.parse(localStorage.getItem('polar.desktop.v1'));
      prefs.rows=prefs.rows.filter(row=>row.id!=='epic:ns:cat:DS');
      localStorage.setItem('polar.desktop.v1',JSON.stringify(prefs));
    });
    await epic.reload();await epic.locator('#library').click();await favoritesTab.click();
    await epic.locator('.card[data-id="epic-short:DS"]').click({button:'right'});
    await epic.getByRole('button',{name:'Remove from favorites'}).click();await epic.keyboard.press('Escape');
    assert(await favoritesTab.evaluate(e=>e===document.activeElement));
    await epic.evaluate(()=>window.finishEpic());
    await epic.waitForFunction(()=>JSON.parse(localStorage.getItem('polar.desktop.v1')).rows.some(r=>r.id==='epic:ns:cat:DS'));
    assert.equal(await epic.locator('.card').count(),0,'rediscovery must not resurrect a removed shortcut favorite');
    console.log('Favorites order, context and bulk controls, persistence, recovery and Epic identity/focus passed.');
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
