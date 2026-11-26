// Serve desktop/ui and set POLAR_TEST_URL. Only the native IPC is substituted.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.POLAR_CHROME, args: ['--no-sandbox']});
  try {
    const page = await browser.newPage({locale:'en-US', viewport:{width:1920,height:1080}, deviceScaleFactor:2});
    await page.addInitScript(() => {
      const canvas = document.createElement('canvas');
      canvas.width=1920; canvas.height=1080;
      const hd = canvas.toDataURL('image/jpeg');
      window.calls=[];
      window.__TAURI__={core:{invoke:async (cmd, args={})=>{
        window.calls.push([cmd,args]);
        if(cmd==='discover') return {complete:true,warnings:[],items:args.source==='epic'?[{id:'epic:a:b:c',source:'epic',name:'B Game'}]:args.source==='steam'?[{id:'steam:20',source:'steam',name:'A Game'}]:[]};
        if(cmd==='get_options') return {login:false,fullscreen:true};
        if(cmd==='search_backgrounds') return [{id:30,name:'B Game Special Edition'}];
        if(cmd==='artwork' && args.hero && args.id==='steam:20' && window.localReady)return hd;
        if(cmd==='online_background') {
          if(window.delayArt && args.source==='steam:30') await new Promise(resolve=>{window.finishArt=resolve});
          return args.source.startsWith('steam:')?hd:null;
        }
        if(cmd==='artwork' && args.hero && args.id.startsWith('epic:')) return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
        return null;
      }}};
    });
    await page.goto(process.env.POLAR_TEST_URL);
    const fade=page.locator('#fade');
    await page.waitForFunction(()=>document.querySelector('#fade').style.opacity==='1',null,{timeout:5000});
    assert.equal(await fade.evaluate(e=>e.style.backgroundSize),'960px 540px');
    await page.setViewportSize({width:960,height:540});
    await page.waitForFunction(()=>document.querySelector('#fade').style.backgroundSize==='cover');
    await page.locator('.tile[data-id^="epic"]').click();
    await page.waitForTimeout(350);
    assert.equal(await fade.evaluate(e=>e.style.opacity),'0');
    await page.locator('.tile[data-id^="epic"]').click({button:'right'});
    await page.getByText('Find on Steam',{exact:true}).click();
    const title=page.getByRole('textbox',{name:'Steam game title'});
    assert.equal(await title.inputValue(),'B Game');
    await title.fill('B Game Special Edition');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    assert(await page.evaluate(()=>window.calls.some(([cmd,a])=>cmd==='search_backgrounds'&&a.lang==='en'&&a.title==='B Game Special Edition')));
    await page.getByRole('button',{name:/B Game Special Edition/}).click();
    await page.waitForFunction(()=>window.calls.some(([cmd,a])=>cmd==='online_background'&&a.source==='steam:30'));
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#fade').style.opacity==='1');
    await page.locator('.tile[data-id^="epic"]').click({button:'right'});
    await page.getByText('Use a background image URL').click();
    await page.getByRole('textbox',{name:'SteamGridDB original Hero image URL'}).fill('https://www.steamgriddb.com/hero/1');
    await page.getByRole('button',{name:'Apply image'}).click();
    assert.match(await page.locator('.backgroundSettings [role=status]').innerText(),/original Hero/);
    await page.getByRole('textbox',{name:'SteamGridDB original Hero image URL'}).fill('https://cdn2.steamgriddb.com/hero/0123456789abcdef0123456789abcdef.png');
    await page.getByRole('button',{name:'Apply image'}).click();
    await page.waitForFunction(()=>document.querySelector('.backgroundSettings [role=status]').textContent.includes('Could not load'));
    await page.keyboard.press('Escape');await page.locator('#settings').click();
    await page.getByRole('checkbox',{name:'Online game backgrounds'}).uncheck();
    await page.reload();
    await page.locator('.tile[data-id^="epic"]').click();
    await page.waitForFunction(()=>window.calls.some(([cmd,a])=>cmd==='online_background'&&a.source==='steam:30'&&!a.online));
    assert(!await page.evaluate(()=>window.calls.some(([cmd,a])=>cmd==='online_background'&&a.online)));
    await page.locator('.tile[data-id^="steam"]').click();
    await page.evaluate(()=>window.delayArt=true);
    await page.locator('.tile[data-id^="epic"]').click();
    await page.waitForFunction(()=>!!window.finishArt);
    await page.locator('.tile[data-id^="epic"]').click({button:'right'});
    await page.getByRole('button',{name:'Restore default background'}).click();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.evaluate(()=>window.localReady=true);
    await page.locator('.tile[data-id="steam:20"]').click();
    await page.waitForFunction(()=>document.querySelector('#fade').style.opacity==='1',null,{timeout:2000});
    await page.locator('.tile[data-id^="epic"]').click();
    await page.evaluate(()=>window.finishArt());
    await page.waitForTimeout(350);
    assert.equal(await fade.evaluate(e=>e.style.opacity),'0');
    console.log('Per-game backgrounds: display pixels, no small cover, confirmed edition, offline preference and saved mapping passed.');
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
