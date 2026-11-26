// Open an unselected game, preserve edits across refresh and return to its card.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({locale:'en-US',viewport:{width:640,height:420}});
  await page.addInitScript(()=>{
   const game=(id,name)=>({id,source:id.split(':')[0],name});
   window.__TAURI__={core:{invoke:async(cmd,a={})=>{
    if(cmd==='get_options')return {fullscreen:false,login:false};
    if(cmd==='discover')return {complete:true,warnings:[],items:a.source==='steam'?[game('steam:1','A Game'),...Array.from({length:70},(_,i)=>game('steam:'+(i+2),'A Game '+i))]:a.source==='xbox'?[game('xbox:bg','B Game')]:[]};
    if(cmd==='artwork'&&!a.hero&&a.id==='xbox:bg'&&!sessionStorage.getItem('released')){
     await new Promise(resolve=>window.addEventListener('art-ready',resolve,{once:true}));
     const c=document.createElement('canvas');c.width=c.height=80;return c.toDataURL();
    }
    if(cmd==='search_backgrounds')return [{id:999,name:'Linked edition'}];
    if(cmd==='online_background'&&a.source==='steam:999'){const c=document.createElement('canvas');c.width=1920;c.height=1080;return c.toDataURL('image/jpeg')}
    if(cmd==='launch_game')throw Error('unexpected launch');
    return null;
   }}};
  });
  await page.goto(process.env.POLAR_TEST_URL);
  await page.locator('#settings').click();
  assert.equal(await page.getByRole('textbox',{name:'Steam game title'}).count(),0);
  await page.keyboard.press('Escape');
  const card=page.locator('.card[data-id="xbox:bg"]'),tile=page.locator('.tile[data-id="xbox:bg"]');
  await tile.click({button:'right'});
  const name=page.getByRole('textbox',{name:'Game title',exact:true});
  assert.equal(await name.inputValue({timeout:2500}),'B Game');
  await name.fill('Discard this');await page.keyboard.press('Escape');
  assert.equal(await page.locator('h1').innerText(),'A Game');
  await page.locator('#library').click();
  await card.focus();await page.keyboard.press('Shift+F10');
  assert.equal(await name.inputValue(),'B Game');
  const image=await page.evaluate(()=>{
   const c=document.createElement('canvas');c.width=250;c.height=350;
   c.getContext('2d').fillRect(0,0,250,350);return c.toDataURL().split(',')[1];
  });
  await page.getByText('Find on Steam',{exact:true}).click();
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('button',{name:/Linked edition/}).click();
  await page.getByRole('button',{name:'Restore default background'}).waitFor();
  await page.getByLabel('Choose cover image').setInputFiles({name:'user-cover.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.getByRole('button',{name:'Restore default cover'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.editorGame img')?.naturalWidth===250);
  await page.evaluate(()=>{sessionStorage.setItem('released','1');window.dispatchEvent(new Event('art-ready'))});
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.editorGame img').evaluate(img=>img.naturalWidth),250);
  await page.getByRole('button',{name:'Restore default background'}).click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.editorGame img').evaluate(img=>img.naturalWidth),250);
  await name.fill('00 Renamed locally');await page.getByRole('button',{name:'Save name'}).click();
  await page.keyboard.press('Escape');
  assert.equal(await card.locator('b').innerText(),'00 Renamed locally');
  assert(await card.evaluate(b=>{const r=b.getBoundingClientRect(),v=document.querySelector('.lib').getBoundingClientRect();return b===document.activeElement&&r.bottom>v.top&&r.top<v.bottom}));
  await page.reload();await page.locator('#library').click();
  await card.locator('img').waitFor();assert.equal(await card.locator('b').innerText(),'00 Renamed locally');
  await card.click({button:'right'});
  await page.getByRole('button',{name:'Restore default cover'}).click();
  await page.getByRole('button',{name:'Restore default name'}).click();
  await page.keyboard.press('Escape');
  assert.equal(await card.locator('b').innerText(),'B Game');assert.equal(await card.locator('img').count(),0);
  console.log('Game context editing, focus, persisted offline cover and display name, restore and settings scope passed.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
