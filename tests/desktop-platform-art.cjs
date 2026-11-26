// Exercise the shipped frontend with independent provider responses and Windows scaling.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({locale:'en-US',viewport:{width:1500,height:900},reducedMotion:'reduce'});
  const epic='epic:f4a904fcef2447439c35c4e6457f3027:761fe09295aa422e8199cebaacf51675:Boga';
  await page.addInitScript(epic=>{
   function photo(w,h){
    const c=document.createElement('canvas');c.width=w;c.height=h;return c.toDataURL('image/jpeg');
   }
   const cover=photo(250,360),hero=photo(1920,1080),square=photo(200,200);
   const rows=[
    {id:epic,name:'DeathStranding',source:'epic'},
    {id:'shortcut:opaque',name:'Manual Xbox',source:'xbox',bucket:'manual'},
    {id:'steam:11',name:'Steam game',source:'steam'},
    {id:'xbox:fm',name:'Football Manager',source:'xbox'},
   ];
   if(!localStorage.getItem('polar.desktop.v1'))localStorage.setItem('polar.desktop.v1',JSON.stringify({rows,current:epic,artSources:{'xbox:fm':'steam:900'}}));
   window.calls=[];window.__TAURI__={core:{invoke:async(cmd,a={})=>{
    window.calls.push([cmd,a]);
    if(cmd==='discover')return {complete:true,items:rows.filter(r=>(r.bucket||r.source)===a.source),warnings:[]};
    if(cmd==='get_options')return {fullscreen:false,login:false};
    if(cmd==='epic_folders')return [];
    if(cmd==='epic_cover'&&a.id===epic)return cover;
    if(cmd==='online_background'&&a.source===epic)return hero;
    if(cmd==='online_cover')return cover;
    if(cmd==='artwork'&&!a.hero&&(a.id==='xbox:fm'||a.id==='shortcut:opaque'))return square;
    return null;
   }}};
  },epic);
  await page.goto(process.env.POLAR_TEST_URL);
  await page.waitForFunction(()=>document.querySelector('#fade').style.opacity==='1'&&document.querySelector('.tile.sel img')?.complete,null,{timeout:3500});
  const native=page.locator('.tile[data-id="xbox:fm"]');
  await native.locator('img').waitFor();
  assert.equal(await native.locator('img').evaluate(i=>i.naturalWidth),200);
  for(const size of [{width:640,height:420},{width:1500,height:900},{width:3840,height:2160}]){
   await page.setViewportSize(size);await native.click();
   await page.waitForFunction(()=>{
    const mid=r=>(r.top+r.bottom)/2;
    const tile=document.querySelector('.tile:not(.sel)').getBoundingClientRect();
    return [...document.querySelectorAll('.railStep')].every(button=>{
     const circle=button.getBoundingClientRect(),glyph=button.firstElementChild?.getBoundingClientRect();
     return glyph&&glyph.height>0&&Math.abs(mid(tile)-mid(circle))<=1&&Math.abs(mid(circle)-mid(glyph))<=1&&Math.abs(circle.height-circle.width)<=1
      &&Math.abs((circle.left+circle.right)-(glyph.left+glyph.right))<=2;
    });
   },null,{timeout:2000});
  }
  for(const view of ['home','library']){
   if(view==='library')await page.locator('#library').click();
   const cards=await page.locator(view==='home'?'.tile':'.card').evaluateAll((buttons,home)=>buttons.map(b=>{
    const r=(home?b:b.querySelector('.cover')).getBoundingClientRect();
    return {id:b.dataset.id,ratio:r.width/r.height,top:r.top};
   }),view==='home');
   for(const card of cards)assert(Math.abs(card.ratio-(['xbox:fm','shortcut:opaque'].includes(card.id)?1:2/3))<.01,JSON.stringify(card));
   assert(Math.max(...cards.map(c=>c.top))-Math.min(...cards.map(c=>c.top))<1);
  }
  await page.locator('.card[data-id="xbox:fm"]').click({button:'right'});
  assert(await page.locator('.editorGame .cover').evaluate(e=>Math.abs(e.clientWidth-e.clientHeight)<=1));
  await page.keyboard.press('Escape');
  await page.locator('#settings').click();
  await page.getByRole('checkbox',{name:'Online game artwork'}).uncheck();await page.reload();
  await page.locator('.tile[data-id^="epic:"]').click();
  await page.waitForFunction(()=>window.calls.some(([k,a])=>k==='epic_cover'&&!a.online)&&window.calls.some(([k,a])=>k==='online_background'&&a.source?.startsWith('epic:')&&!a.online));
  assert(!await page.evaluate(()=>window.calls.some(([k,a])=>['epic_cover','online_cover','online_background'].includes(k)&&a.online)));
  console.log('Epic automatic cover/background, offline, square native Xbox and mixed grid, centered arrows at three viewport sizes passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
