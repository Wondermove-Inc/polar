// Exercise real icon decoding and the order of native/online cover requests on a warm start.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:1500,height:900},locale:'en',reducedMotion:'reduce'});
    const epic = 'epic:ns:00000000000000000000000000000001:Example';
    const alias = 'epic-short:Example';
    await page.addInitScript(({epic,alias})=>{
      function art(width,height,color){
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);
        return canvas.toDataURL();
      }
      const small=art(32,24,'#ff0080'),large=art(512,512,'#00c080');
      const rows=[
        {id:epic,source:'epic',name:'Epic game'},
        {id:alias,source:'epic',bucket:'manual',name:'My Epic game'},
        {id:'steam:10',source:'steam',name:'Steam game'},
        {id:'steam:20',source:'steam',name:'Bad icon'},
        {id:'steam:30',source:'steam',name:'No icon'},
        {id:'steam:40',source:'steam',name:'Small with disk cover'},
        {id:'steam:50',source:'steam',name:'Small with installed cover'},
        {id:'steam:60',source:'steam',name:'Missing art'},
        {id:'steam:70',source:'steam',name:'Tiny cover'},
      ];
      if (!localStorage.getItem('polar.desktop.v1')) localStorage.setItem('polar.desktop.v1',JSON.stringify({
        rows,current:'steam:10',artSources:{[epic]:'steam:900'}
      }));
      const portrait=art(120,160,'#456789'),localCover=art(140,200,'#375395');
      window.calls=[]; window.discovery={};
      window.__TAURI__={core:{invoke:async(cmd,args={})=>{
        window.calls.push([cmd,args]);
        if(cmd==='discover') {
          if(window.rescan && args.source==='steam')return {complete:false,warnings:['drive unavailable'],items:[]};
          if(!window.rescan && args.source!=='xbox') await new Promise(resolve=>window.discovery[args.source]=resolve);
          return {complete:true,warnings:[],items:rows.filter(r=>(r.bucket||r.source)===args.source)
            .map(r=>({...r,hasGameIcon:[epic,alias,'steam:10','steam:20','steam:40','steam:50','steam:70'].includes(r.id)}))};
        }
        if(cmd==='get_options')return {fullscreen:false,login:false};
        if(cmd==='epic_folders')return [];
        if(cmd==='game_icon') {
          if(args.id==='steam:20')return 'data:image/png;base64,YmFk';
          return args.id===alias?large:small;
        }
        if(cmd==='artwork'&&!args.hero&&args.id==='steam:70')return art(8,8,'#789abc');
        if(cmd==='artwork'&&!args.hero&&['steam:30','steam:50'].includes(args.id))return localCover;
        if(cmd==='online_cover' && (args.id===40 || (args.id===20 && args.online)))return portrait;
        return null;
      }}};
    },{epic,alias});
    await page.goto(process.env.POLAR_TEST_URL);
    await page.waitForFunction(()=>window.discovery.steam && window.discovery.epic && window.discovery.manual
      && window.calls.some(([cmd])=>cmd==='online_background'));
    const covers=()=>page.evaluate(()=>window.calls.filter(([cmd])=>cmd==='online_cover'||cmd==='epic_cover'));
    assert.deepEqual(await covers(),[],'saved RC22 rows must wait for native discovery before requesting covers');
    await page.evaluate(()=>{window.discovery.epic();window.discovery.steam()});
    await page.locator('#library').click();
    await page.evaluate(()=>window.discovery.manual());
    const image = id=>page.locator(`.card[data-id="${id}"] img`);
    for(const [id,width,fit] of [[epic,512,'contain'],['steam:10',32,'contain'],['steam:20',120,'cover'],
      ['steam:30',140,'cover'],['steam:40',120,'cover'],['steam:50',140,'cover'],['steam:70',32,'contain']]){
      await image(id).waitFor();
      assert.deepEqual(await image(id).evaluate(i=>[i.naturalWidth,getComputedStyle(i).objectFit]),[width,fit],id);
    }
    assert(!await image('steam:60').count());
    const empty=page.locator('.card[data-id="steam:60"] .cover');
    assert.equal(await empty.evaluate(e=>getComputedStyle(e,'::before').content),'"MA"');
    assert(!(await covers()).some(([,a])=>a.online&&[epic,10,30,40,50,900].includes(a.id)),'usable icons never require a cover download');
    async function checkVisibleInk(frame){
      const pixels=(await frame.screenshot({animations:'disabled'})).toString('base64');
      const [width,height,inkWidth,inkHeight]=await page.evaluate(async data=>{
        const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();
        const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
        const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
        const rgba=ctx.getImageData(0,0,c.width,c.height).data;
        let left=c.width,right=-1,top=c.height,bottom=-1;
        for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
          const i=4*(y*c.width+x);
          if(rgba[i]>200&&rgba[i+1]<60&&rgba[i+2]>85){
            left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
          }
        }
        return [c.width,c.height,right-left+1,bottom-top+1];
      },pixels);
      assert(inkWidth>=width*.9 && inkHeight>=height*.65 && inkHeight<=height*.82,
        'visible ink should fill the width and retain the 4:3 proportions: '+[width,height,inkWidth,inkHeight]);
    }
    await checkVisibleInk(page.locator('.card[data-id="steam:10"] .cover'));
    assert(!await page.evaluate(()=>window.calls.some(([cmd,a])=>cmd==='game_icon'&&a.id==='steam:30')));
    await page.locator(`.card[data-id="${epic}"]`).click({button:'right'});
    const preview=page.locator('.editorGame img');
    await preview.waitFor();
    assert.equal(await preview.evaluate(i=>getComputedStyle(i).objectFit),'contain');
    const custom=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=270;c.height=300;return c.toDataURL().split(',')[1];
    });
    await page.getByLabel('Choose cover image').setInputFiles({name:'art.png',mimeType:'image/png',buffer:Buffer.from(custom,'base64')});
    await page.waitForFunction(()=>document.querySelector('.editorGame img')?.naturalWidth===270);
    assert.equal(await preview.evaluate(i=>getComputedStyle(i).objectFit),'cover');
    await page.keyboard.press('Escape');
    await page.locator('#home').click();await page.locator('.tile[data-id="steam:10"]').click();
    await page.waitForFunction(()=>document.querySelector('.tile.sel img')?.naturalWidth===32);
    for(const size of [{width:640,height:420},{width:3840,height:2160},{width:1500,height:900}]){
      await page.setViewportSize(size);
      await checkVisibleInk(page.locator('.tile.sel'));
    }
    assert.equal(await page.locator('#ambient').evaluate(e=>e.style.getPropertyValue('--cover')),'');
    await page.locator('#settings').click();
    await page.getByRole('checkbox',{name:'Online game artwork'}).uncheck();
    await page.reload();
    await page.waitForFunction(()=>window.discovery.steam && window.discovery.epic && window.discovery.manual);
    await page.evaluate(()=>Object.values(window.discovery).forEach(resolve=>resolve()));
    await page.locator('#library').click();await image(epic).waitFor();await image('steam:10').waitFor();
    assert.equal(await image(epic).evaluate(i=>i.naturalWidth),270,'custom cover survives reload and beats the shortcut icon');
    assert.equal(await image('steam:10').evaluate(i=>i.naturalWidth),32,'native icons work offline');
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
    assert.equal(await image('steam:10').evaluate(i=>i.naturalWidth),32,'partial rescan must retain usable local icons');
    assert(!(await covers()).some(([,a])=>a.id===10 && a.online));
    console.log('Warm discovery, manual Epic alias, local icons, visible pixels, cache priority, custom artwork and offline passed.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
