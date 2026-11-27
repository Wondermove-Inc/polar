const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},locale:'ko-KR'});
 await page.addInitScript(()=>{
  const rows=Array.from({length:300},(_,i)=>{
   const source=['xbox','steam','steam','steam','xbox','epic','xbox','xbox','steam','xbox','epic','steam','steam','steam','xbox','xbox'][i%16];
   return {id:source+':'+i,source,bucket:source,name:'Game '+String(i).padStart(3,'0')};
  });
  localStorage.setItem('polar.desktop.v1',JSON.stringify({rows}));
  window.pad={mapping:'standard',axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};
  Object.defineProperty(navigator,'getGamepads',{value:()=>window.pad?[window.pad]:[]});
  window.exitRequests=0;
  window.__TAURI__={core:{invoke:async(cmd,args)=>{
   if(cmd==='discover')return new Promise(resolve=>{
    if(args.source==='epic')window.finishEpic=()=>resolve({complete:true,items:rows.filter(g=>g.source==='epic'),warnings:[]});
   });
   if(cmd==='get_options')return {fullscreen:true,login:false};
   if(cmd==='launch_game')window.started=true;
   if(cmd==='window_action'&&args.action==='quit')window.exitRequests++;
   if(cmd==='get_session')return {phase:'unknown'};
   return null;
  }}};
  window.captureKeys=performance.now();
 });
 const times=[];
 for(let i=0;i<10;i++){
  await page.goto(process.env.POLAR_TEST_URL);
  await page.waitForFunction(()=>document.querySelector('.tile.sel'));
  times.push(await page.evaluate(()=>performance.now()-window.captureKeys));
 }
 await page.bringToFront();await page.locator('.tile.sel').focus();
 async function press(index){
  await page.evaluate(n=>window.pad.buttons[n].pressed=true,index);await page.waitForTimeout(120);
  await page.evaluate(n=>window.pad.buttons[n].pressed=false,index);await page.waitForTimeout(75);
 }
 assert.equal(await page.locator('.tile').count(),300);
 assert.equal(await page.locator('.tile.sel').innerText(),'');
 await page.waitForFunction(()=>document.querySelector('#intro').hidden);
 await press(12);
 for(const id of ['library','settings','quit']){
  await press(15);assert.equal(await page.evaluate(()=>document.activeElement.id),id);
 }
 await press(0);assert.equal(await page.evaluate(()=>window.exitRequests),1);
 assert(!await page.evaluate(()=>window.started));
 await press(14);assert.equal(await page.evaluate(()=>document.activeElement.id),'settings');
 await page.locator('.tile.sel').focus();
 for(let i=0;i<19;i++)await page.keyboard.press('ArrowRight');
 await press(15);
 assert.equal(await page.locator('.tile').nth(20).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'다음 게임',exact:true}).click();
 assert.equal(await page.locator('.tile').nth(21).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'이전 게임',exact:true}).click();
 for(let i=20;i<40;i++)await page.keyboard.press('ArrowRight');
 assert.equal(await page.locator('.tile').nth(40).getAttribute('aria-pressed'),'true');
 await page.waitForFunction(()=>{const r=document.querySelector('.rail'),box=r.querySelector('.sel').getBoundingClientRect();return r.scrollLeft>0&&box.left>=0&&box.right<=innerWidth});
 assert.notEqual(await page.locator('h1').innerText(),'Game 0');
 await press(9);assert.equal(await page.locator('#panelTitle').innerText(),'게임 편집');
 assert.equal(await page.getByRole('textbox',{name:'게임 이름',exact:true}).inputValue(),await page.locator('h1').innerText());
 await press(13);assert.equal(await page.evaluate(()=>document.activeElement.textContent),'이름 저장');
 await press(13);assert.equal(await page.evaluate(()=>document.activeElement.type),'file');
 await press(1);assert(await page.locator('.tile.sel').evaluate(e=>document.activeElement===e));
 await press(0);assert(await page.evaluate(()=>window.started));
 assert(!await page.locator('dialog').isVisible());assert.equal(await page.locator('#play').innerText(),'플레이');
 await press(1);assert(await page.locator('.tile.sel').evaluate(e=>e===document.activeElement));
 await page.setViewportSize({width:640,height:420});
 await page.locator('#library').click();
 const firstCards=page.locator('.grid .card');
 const positions=await firstCards.evaluateAll(cards=>cards.slice(0,16).map(card=>{
  const r=card.getBoundingClientRect();return {top:r.top,x:r.left+r.width/2,id:card.dataset.id};
 }));
 for(const [index,pos] of positions.entries()){
  const nextTop=positions.find(p=>p.top>pos.top+1)?.top;
  if(nextTop===undefined||nextTop===positions.at(-1).top)continue;
  const nextRow=positions.filter(p=>p.top===nextTop);
  const closest=Math.min(...nextRow.map(p=>Math.abs(p.x-pos.x)));
  await firstCards.nth(index).focus();await page.keyboard.press('ArrowDown');
  const focused=await page.evaluate(()=>document.activeElement.dataset.id);
  assert(nextRow.some(p=>p.id===focused && Math.abs(p.x-pos.x)<=closest+1),'move to the closest card in the next row');
 }
 await firstCards.last().focus();await press(13);
 assert(await firstCards.last().evaluate(e=>document.activeElement===e),'stay on the final row');
 const steamFilter=page.locator('.filters [data-key=steam]');
 await steamFilter.focus();await steamFilter.evaluate(e=>{window.oldFilter=e;window.finishEpic()});
 await page.waitForFunction(()=>!window.oldFilter.isConnected);
 assert(await steamFilter.evaluate(e=>e===document.activeElement),'a completed scan preserves the focused filter');
 await page.evaluate(()=>window.pad=null);await page.waitForTimeout(150);
 assert((await page.locator('.footkeys').innerText()).includes('Enter'));
 assert(times.filter(n=>n<3000).length>=9);
 console.log('Cached 300-game home, navigation to first usable rail over 10 browser loads (ms):',times.map(Math.round).join(', '),'; simulated gamepad selection, launch, back and disconnect passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
