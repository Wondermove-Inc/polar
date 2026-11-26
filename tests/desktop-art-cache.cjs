const {chromium}=require('playwright'), assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1024,height:680},locale:'en-US',reducedMotion:'reduce'});
 await page.addInitScript(()=>{
  const ids=['a','b','c'].map(c=>'epic:wex:'+c.repeat(32)+':Artifact'+c);
  window.rows=ids.map((id,i)=>({id,name:['A slow','B cached','C retry'][i],source:'epic'}));
  const c=document.createElement('canvas');c.width=1920;c.height=1080;const bg=c.toDataURL('image/jpeg');
  c.width=300;c.height=450;const cover=c.toDataURL('image/jpeg');
  window.calls=[];window.onlineReady=false;
  if(!localStorage.getItem('polar.desktop.v1'))localStorage.setItem('polar.desktop.v1',JSON.stringify({rows:window.rows,current:ids[0]}));
  window.__TAURI__={core:{invoke:async(cmd,a={})=>{
   window.calls.push([cmd,a]);
   if(cmd==='discover')return {complete:true,items:a.source==='epic'?window.rows:[],warnings:[]};
   if(cmd==='epic_folders')return [];
   if(cmd==='get_options')return {fullscreen:false,login:false};
   if(cmd==='epic_cover')return a.id!==ids[2]||window.onlineReady&&a.online?cover:null;
   if(cmd==='online_background'){
    if(a.source===ids[0]&&a.online)await new Promise(resolve=>{window.unblock=resolve});
    return a.source===ids[1]||a.source===ids[0]&&a.online?bg:null;
   }
   return null;
  }}};
 });
 await page.goto(process.env.POLAR_TEST_URL);
 await page.waitForFunction(()=>typeof window.unblock==='function');
 await page.locator('.tile').nth(1).click();
 await page.waitForTimeout(800);
 const before=await page.evaluate(()=>({display:document.querySelector('#fade').style.opacity,calls:window.calls.filter(([cmd,a])=>cmd==='online_background'&&a.source===window.rows[1].id).length}));
 console.log('stored hero availability after changing game with network pending',before);
 await page.evaluate(()=>window.unblock());
 await page.waitForFunction(()=>document.querySelector('#fade').style.opacity==='1');
 await page.locator('#settings').click();await page.getByRole('checkbox',{name:'Online game artwork'}).uncheck();
 await page.evaluate(()=>window.onlineReady=true);
 await page.getByRole('checkbox',{name:'Online game artwork'}).check();
 await page.keyboard.press('Escape');
 await page.waitForTimeout(500);
 const after=await page.evaluate(()=>({paint:!!document.querySelectorAll('.tile')[2].querySelector('img'),calls:window.calls.filter(([cmd,a])=>cmd==='epic_cover'&&a.id===window.rows[2].id&&a.online).length}));
 console.log('offline -> online after cold failure',after);
 assert.equal(before.display,'1','a cached backdrop should be available while another download is pending');
 assert(after.paint,'re-enabling online art must retry a failed cover');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
