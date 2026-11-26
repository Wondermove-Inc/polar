// Exercise the packaged frontend with Windows IPC responses under our control.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
  for(const mode of ['cold','warm','late','systemReduced','savedReduced']){
   const page=await browser.newPage({viewport:{width:1280,height:780},locale:'ko-KR',reducedMotion:mode==='systemReduced'?'reduce':'no-preference'});
   await page.addInitScript(mode=>{
    const rows=Array.from({length:21},(_,i)=>({source:'xbox',id:'xbox:'+i,name:i===20?'한'.repeat(180):i===0?'Cities: Skylines II':'Game '+String(i).padStart(2,'0')}));
    if(mode!=='cold')localStorage.setItem('polar.desktop.v1',JSON.stringify({rows,motion:mode==='savedReduced',fullscreen:false}));
    window.folders=[];window.scanDone=false;
    window.__TAURI__={core:{invoke:async(cmd,args={})=>{
     if(cmd==='window_action'&&args.action==='present')window.presented=args.enabled;
     if(cmd==='get_options')return {fullscreen:true,login:false};
     if(cmd==='discover'){
      if(mode==='cold'&&!window.scanDone)await new Promise(r=>{window.addEventListener('finish-scan',r,{once:true})});
      return {complete:true,warnings:[],items:args.source==='xbox'?rows:[]};
     }
     if(cmd==='epic_folders'){
      if(args.action==='add')window.folders=['F:\\Custom'];
      if(args.action==='remove')window.folders=[];
      return [...window.folders];
     }
     if(cmd==='artwork'&&!args.hero){
      if(mode==='late'){await new Promise(r=>{if(window.readyArt)r();else window.addEventListener('ready-art',r,{once:true})})}
      const sizes=[[300,450],[400,400],[600,300]],n=Number(args.id.split(':')[1])%3;
      const c=document.createElement('canvas');[c.width,c.height]=mode==='late'?[900,210]:sizes[n];
      const ctx=c.getContext('2d');ctx.fillStyle='#fed';ctx.fillRect(0,0,c.width,c.height);
      return c.toDataURL();
     }
     return null;
    }}};
   },mode);
   await page.goto(process.env.POLAR_TEST_URL);
   if(mode==='cold'){
    assert(await page.locator('#homeLoading').isVisible());
    assert(!(await page.locator('#homeEmpty').isVisible()));
    await page.evaluate(()=>{window.scanDone=true;window.dispatchEvent(new Event('finish-scan'))});
   }
   await page.locator('.tile.sel').waitFor();
   assert.equal(await page.evaluate(()=>window.presented),mode==='cold');
   assert.equal(await page.locator('#shelf').evaluate(e=>getComputedStyle(e).animationName),
    mode.endsWith('Reduced')?'none':'polarEnter');
   if(mode==='late'){
    await page.setViewportSize({width:640,height:420});
    await page.locator('.tile.sel').focus();
    for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight');
    const selected=await page.locator('.tile.sel').getAttribute('data-id');
    await page.locator('#settings').click();
    await page.evaluate(()=>{window.readyArt=true;window.dispatchEvent(new Event('ready-art'))});
    await page.waitForFunction(()=>document.querySelectorAll('.tile.hasArt').length>=8);
    await page.keyboard.press('Escape');
    const inView=()=>{const r=document.querySelector('.tile.sel').getBoundingClientRect();return r.left>=4&&r.right<=innerWidth-4};
    await page.waitForFunction(inView,null,{timeout:1500});
    assert.equal(await page.locator('.tile.sel').getAttribute('data-id'),selected);
    assert(await page.locator('#settings').evaluate(e=>e===document.activeElement));
    await page.locator('.tile.sel').focus();
    for(let i=0;i<6;i++){
     await page.keyboard.press('ArrowRight');
     await page.waitForTimeout(240);
     assert(await page.evaluate(inView),'expanded landscape tile outside the rail');
    }
    await page.close();continue;
   }
   if(mode!=='cold'){await page.close();continue;}
   for(const view of ['home','library']){
    if(view==='library')await page.locator('#library').click();
    const tiles=page.locator(view==='home'?'.tile':'.card .cover');
    for(let i=0;i<3;i++){
     const box=tiles.nth(i);
     await box.locator('img').waitFor({timeout:3000});
     {
      const aspect=await box.evaluate(box=>{const img=box.querySelector('img'),r=box.getBoundingClientRect();
       return {frame:r.width/r.height,art:img.naturalWidth/img.naturalHeight}});
      assert(Math.abs(aspect.frame-2/3)<.02,'every frame must be 2:3 '+JSON.stringify(aspect));
     }
     const info=await box.evaluate(box=>{
      const img=box.querySelector('img'),outer=box.getBoundingClientRect(),r=img.getBoundingClientRect(),s=getComputedStyle(img);
      return {fit:s.objectFit,center:s.objectPosition,inside:r.left>=outer.left-1&&r.right<=outer.right+1&&r.top>=outer.top-1&&r.bottom<=outer.bottom+1,
       complete:img.complete&&img.naturalWidth>0,caption:box.textContent};
     });
     assert.deepEqual(info,{fit:'contain',center:'50% 50%',inside:true,complete:true,caption:''});
     if(view==='library')assert.equal(await box.locator('..').locator('b').count(),1);
    }
   }
   await page.locator('#home').click();
   for(let i=0;i<20;i++)await page.keyboard.press('ArrowRight');
   assert.equal(await page.locator('.tile').last().getAttribute('aria-pressed'),'true');
   for(const size of [{width:640,height:420},{width:1920,height:420},{width:3440,height:420},{width:1280,height:780},{width:3840,height:2160},{width:3440,height:601},{width:2560,height:620}]){
    await page.setViewportSize(size);
    await page.waitForFunction(()=>{
     const b=document.querySelector('.tile.sel').getBoundingClientRect(),p=document.querySelector('#play').getBoundingClientRect();
     return b.left>=4&&b.right<=innerWidth-4&&p.left>=0&&p.bottom<=innerHeight&&document.querySelector('footer').getBoundingClientRect().bottom<=innerHeight+.5;
    },null,{timeout:3000});
   }
   const options=await page.locator('#gameOptions').evaluate(e=>{
    const r=e.getBoundingClientRect(),p=document.querySelector('#play').getBoundingClientRect();
    return {ratio:r.width/r.height,width:e.offsetWidth,height:e.offsetHeight,gap:r.left-p.right};
   });
   assert(Math.abs(options.ratio-1)<.01&&options.width===40&&options.height===40&&options.gap>=8,JSON.stringify(options));
   await page.keyboard.press('ArrowDown');assert(await page.locator('#play').evaluate(e=>e===document.activeElement));
   await page.keyboard.press('ArrowUp');assert(await page.locator('.tile.sel').evaluate(e=>e===document.activeElement));
   await page.locator('#home').focus();await page.keyboard.press('ArrowDown');
   assert(await page.locator('.tile.sel').evaluate(e=>e===document.activeElement));
   await page.locator('#settings').click();await page.getByRole('button',{name:'게임 라이브러리',exact:true}).click();
   await page.getByRole('button',{name:'Epic 게임 폴더 추가'}).click();
   const remove=page.getByRole('button',{name:/폴더 연결 해제/});
   await remove.waitFor();await remove.click();assert.equal(await remove.count(),0);
   await page.keyboard.press('Escape');
   await page.locator('.tile.sel').focus();await page.keyboard.press('ArrowLeft');
   const remembered=await page.locator('.tile.sel').getAttribute('data-id');
   await page.reload();assert.equal(await page.locator('.tile.sel').getAttribute('data-id'),remembered);
   await page.close();
  }
  console.log('Cold/warm startup, reduced motion, cover geometry, resizing with last game selected and Epic folder settings passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
