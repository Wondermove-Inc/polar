// Serve desktop/ui and set POLAR_TEST_URL. Use the actual frontend with delayed native responses.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
  for(const mode of ['cold','warm','keyboard','space','pointer','pad','savedReduced','systemReduced','delayed']){
   const page=await browser.newPage({viewport:{width:mode==='cold'?3840:960,height:mode==='cold'?2160:540},
    reducedMotion:mode==='systemReduced'?'reduce':'no-preference'});
   await page.addInitScript(mode=>{
    const rows=Array.from({length:21},(_,i)=>({id:'xbox:'+i,source:'xbox',name:'Game '+String(i).padStart(2,'0')}));
    localStorage.setItem('polar.desktop.v1',JSON.stringify({rows:mode==='cold'?[]:rows,motion:mode==='savedReduced',fullscreen:mode==='cold'}));
    window.introEvents=[];
    document.addEventListener('animationend',e=>{if(e.target.id==='intro')window.introEvents.push(e.animationName)});
    window.launched=0;window.pad={mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};
    Object.defineProperty(navigator,'getGamepads',{value:()=>[window.pad]});
    window.__TAURI__={core:{invoke:async(cmd,a={})=>{
     if(cmd==='get_options')return {login:false,fullscreen:mode==='cold'};
     if(cmd==='window_action'&&a.action==='present'){window.presentMode=a.enabled;if(mode==='delayed')await new Promise(r=>window.showWindow=r)}
     if(cmd==='discover'){if(mode==='cold')await new Promise(r=>window.addEventListener('scanned',r,{once:true}));return {complete:true,warnings:[],items:a.source==='xbox'?rows:[]}}
     if(cmd==='launch_game')window.launched++;
     if(cmd==='get_session')return {phase:'unknown'};
     if(cmd==='epic_folders')return [];
     return null;
    }}};
   },mode);
   await page.goto(process.env.POLAR_TEST_URL);
   const intro=page.locator('#intro');
   assert.equal(await page.evaluate(()=>window.presentMode),mode==='cold');
   if(mode.endsWith('Reduced')){
    assert(!(await intro.isVisible()),'reduce motion should skip intro');await page.close();continue;
   }
   assert(await intro.isVisible(),'show Polar entrance on '+mode);
   if(mode==='delayed'){
    assert.equal(await intro.evaluate(e=>e.getAnimations().length),0,'do not finish playing behind a hidden native window');
    await page.evaluate(()=>window.showWindow());
   }
   if(mode==='keyboard'){await page.keyboard.down('Enter');await page.keyboard.press('Enter');await page.keyboard.up('Enter')}
   if(mode==='space'){
    await page.locator('#play').focus();
    await page.keyboard.down('Space');await page.keyboard.down('Space');await page.keyboard.up('Space');
   }
   if(mode==='pointer')await page.locator('#intro').click({position:{x:12,y:12}});
   if(mode==='pad'){
    await page.evaluate(()=>window.pad.buttons[0].pressed=true);await page.waitForTimeout(220);
    await page.evaluate(()=>window.pad.buttons[0].pressed=false);
   }
   await intro.waitFor({state:'hidden',timeout:1600});
   if(['cold','warm','delayed'].includes(mode)){
    assert(await page.evaluate(()=>window.introEvents.includes('introDissolve')),'the complete fade must finish');
   }
   assert.equal(await page.evaluate(()=>window.launched),0,'skipping must not launch a game');
   if(mode==='cold'){
    assert(await page.locator('#homeLoading').isVisible());
    await page.evaluate(()=>window.dispatchEvent(new Event('scanned')));
   }
   await page.locator('.tile.sel').waitFor();
   await page.locator('#library').click();await page.locator('#home').click();
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert(!(await intro.isVisible()));
   await page.close();
  }
  console.log('Polar entrance, native presentation, skip inputs, reduced motion and return to home passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
