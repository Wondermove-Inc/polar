// Exercise real icon decoding and the order of native/online cover requests on a warm start.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:1500,height:900},locale:'en',reducedMotion:'reduce'});
    const epic = 'epic:ns:00000000000000000000000000000001:Example';
    const alias = 'epic-short:Example';
    // Use the first real frame (16×16) from the shipped ICO.
    const ico = fs.readFileSync(path.join(__dirname,'../desktop/icons/icon.ico'));
    const header = Buffer.from(ico.subarray(0,22));
    const pos = header.readUInt32LE(18), size = header.readUInt32LE(14);
    header.writeUInt16LE(1,4); header.writeUInt32LE(22,18);
    const icon = 'data:image/x-icon;base64,'+Buffer.concat([header,ico.subarray(pos,pos+size)]).toString('base64');
    await page.addInitScript(({icon,epic,alias})=>{
      const rows=[
        {id:epic,source:'epic',name:'Epic game'},
        {id:alias,source:'epic',bucket:'manual',name:'My Epic game'},
        {id:'steam:10',source:'steam',name:'Steam game'},
        {id:'steam:20',source:'steam',name:'Bad icon'},
        {id:'steam:30',source:'steam',name:'No icon'},
      ];
      if (!localStorage.getItem('polar.desktop.v1')) localStorage.setItem('polar.desktop.v1',JSON.stringify({
        rows,current:'steam:10',artSources:{[epic]:'steam:900'}
      }));
      const canvas=document.createElement('canvas'); canvas.width=120; canvas.height=160;
      const portrait=canvas.toDataURL();
      canvas.width=140;const localCover=canvas.toDataURL();
      window.calls=[]; window.discovery={};
      window.__TAURI__={core:{invoke:async(cmd,args={})=>{
        window.calls.push([cmd,args]);
        if(cmd==='discover') {
          if(window.rescan && args.source==='steam')return {complete:false,warnings:['drive unavailable'],items:[]};
          if(!window.rescan && args.source!=='xbox') await new Promise(resolve=>window.discovery[args.source]=resolve);
          return {complete:true,warnings:[],items:rows.filter(r=>(r.bucket||r.source)===args.source)
            .map(r=>({...r,hasGameIcon:[alias,'steam:10','steam:20'].includes(r.id)}))};
        }
        if(cmd==='get_options')return {fullscreen:false,login:false};
        if(cmd==='epic_folders')return [];
        if(cmd==='game_icon')return args.id==='steam:20'?'data:image/x-icon;base64,YmFk':icon;
        if(cmd==='artwork'&&!args.hero&&args.id==='steam:30')return localCover;
        if(cmd==='online_cover'||cmd==='epic_cover')return portrait;
        return null;
      }}};
    },{icon,epic,alias});
    await page.goto(process.env.POLAR_TEST_URL);
    await page.waitForFunction(()=>window.discovery.steam && window.discovery.epic && window.discovery.manual
      && window.calls.some(([cmd])=>cmd==='online_background'));
    const covers=()=>page.evaluate(()=>window.calls.filter(([cmd])=>cmd==='online_cover'||cmd==='epic_cover'));
    assert.deepEqual(await covers(),[],'saved RC22 rows must wait for native discovery before requesting covers');
    await page.evaluate(()=>{window.discovery.epic();window.discovery.steam()});
    await page.locator('#library').click();
    await page.evaluate(()=>window.discovery.manual());
    const image = id=>page.locator(`.card[data-id="${id}"] img`);
    for(const id of [epic,'steam:10']){
      await image(id).waitFor();
      assert.deepEqual(await image(id).evaluate(i=>[i.naturalWidth,getComputedStyle(i).objectFit]),[16,'scale-down']);
    }
    for(const [id,width] of [['steam:20',120],['steam:30',140]]){
      await image(id).waitFor();
      assert.deepEqual(await image(id).evaluate(i=>[i.naturalWidth,getComputedStyle(i).objectFit]),[width,'cover']);
    }
    const requestedIds=(await covers()).map(([cmd,a])=>a.id);
    assert(!requestedIds.some(id=>[epic,10,30,900].includes(id)),'a matching icon must suppress cover downloads');
    assert(!await page.evaluate(()=>window.calls.some(([cmd,a])=>cmd==='game_icon'&&a.id==='steam:30')));
    await page.locator(`.card[data-id="${epic}"]`).click({button:'right'});
    const preview=page.locator('.editorGame img');
    await preview.waitFor();
    assert.equal(await preview.evaluate(i=>getComputedStyle(i).objectFit),'scale-down');
    const custom=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=270;c.height=300;return c.toDataURL().split(',')[1];
    });
    await page.getByLabel('Choose cover image').setInputFiles({name:'art.png',mimeType:'image/png',buffer:Buffer.from(custom,'base64')});
    await page.waitForFunction(()=>document.querySelector('.editorGame img')?.naturalWidth===270);
    assert.equal(await preview.evaluate(i=>getComputedStyle(i).objectFit),'cover');
    await page.keyboard.press('Escape');
    await page.locator('#home').click();await page.locator('.tile[data-id="steam:10"]').click();
    await page.waitForFunction(()=>document.querySelector('.tile.sel img')?.naturalWidth===16);
    assert.equal(await page.locator('#ambient').evaluate(e=>e.style.getPropertyValue('--cover')),'');
    await page.locator('#settings').click();
    await page.getByRole('checkbox',{name:'Online game artwork'}).uncheck();
    await page.reload();
    await page.waitForFunction(()=>window.discovery.steam && window.discovery.epic && window.discovery.manual);
    await page.evaluate(()=>Object.values(window.discovery).forEach(resolve=>resolve()));
    await page.locator('#library').click();await image(epic).waitFor();await image('steam:10').waitFor();
    assert.equal(await image(epic).evaluate(i=>i.naturalWidth),270,'custom cover survives reload and beats the shortcut icon');
    assert.equal(await image('steam:10').evaluate(i=>i.naturalWidth),16,'native icons work offline');
    assert(!await page.evaluate(alias=>window.calls.some(([cmd,a])=>cmd==='game_icon'&&a.id===alias),alias));
    assert(!(await covers()).some(([,a])=>a.online));
    await page.evaluate(()=>{window.rescan=true;window.calls=[]});
    await page.locator('#settings').click();
    await page.locator('[data-control=sources]').click();
    await page.locator('[data-control=scan]').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('polar.desktop.v1')).rows
      .some(row=>row.id==='steam:10' && row.unconfirmed));
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('.card[data-id="steam:10"] img')?.complete);
    assert.equal(await image('steam:10').evaluate(i=>i.naturalWidth),16,'partial rescan must retain usable local icons');
    assert(!(await covers()).some(([,a])=>a.id===10));
    console.log('Warm discovery, manual Epic alias, local icons, native sizing, custom artwork, fallback and offline passed.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
