// Serve desktop/ui and set POLAR_TEST_URL. Measure rendered text and hit areas in output pixels.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

async function checkFont(page, selector, weight) {
  await page.locator(selector).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const {root} = await session.send('DOM.getDocument');
    const {nodeId} = await session.send('DOM.querySelector', {nodeId:root.nodeId, selector});
    const {fonts} = await session.send('CSS.getPlatformFontsForNode', {nodeId});
    const painted = fonts.filter(face => face.glyphCount > 0);
    assert(painted.length && painted.every(face => face.isCustomFont && /^Pretendard( Variable)?$/.test(face.familyName)),
      selector + ' rendered with ' + JSON.stringify(fonts));
    assert.equal(await page.locator(selector).first().evaluate(e => getComputedStyle(e).fontWeight), String(weight), selector);
  } finally {
    await session.detach();
  }
}

async function measure(page, target) {
  return page.locator(target).first().evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const textHeight = range.getBoundingClientRect().height;
    return {text: textHeight * devicePixelRatio, box: element.getBoundingClientRect().height * devicePixelRatio};
  });
}

async function visibleInside(page, selector) {
  const rect = await page.locator(selector).first().boundingBox();
  const {width,height} = page.viewportSize();
  assert(rect && rect.width>0 && rect.height>0 && rect.x>=-1 && rect.y>=-1 &&
    rect.x+rect.width<=width+1 && rect.y+rect.height<=height+1, selector + ' outside ' + width + '×' + height);
}

async function checkFooterCenter(page) {
  const footer = await page.locator('footer').boundingBox();
  for (const item of await page.locator('.footkeys, .footkeys kbd, .counter').all()) {
    const box = await item.boundingBox();
    const above = box.y - footer.y;
    const below = footer.y + footer.height - box.y - box.height;
    assert(Math.abs(above-below) <= 2, (await item.innerText()) + ' has unequal footer margins: ' + above + ', ' + below);
  }
}

async function checkKeycapInk(page) {
  await page.evaluate(() => document.fonts.ready);
  const keys = page.locator('.footkeys kbd');
  assert.deepEqual(await keys.allTextContents(), ['← →', 'Enter', 'Esc']);
  for (const key of await keys.all()) {
    const pixels = await key.screenshot();
    const offset = await page.evaluate(async png => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + png;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const {data} = ctx.getImageData(0, 0, img.width, img.height);
      let top = img.height, bottom = -1;
      for (let i = 0; i < data.length; i += 4) {
        // White lettering is brighter than the outline on the solid library footer.
        if (data[i] < 170) continue;
        const y = Math.floor(i / 4 / img.width);
        top = Math.min(top, y);
        bottom = y;
      }
      return bottom < 0 ? Infinity : (top + bottom + 1 - img.height) / 2;
    }, pixels.toString('base64'));
    assert(Math.abs(offset) <= 1.5, (await key.innerText()) + ' ink offset: ' + offset + ' device pixels');
  }
}

async function checkTitleInk(page) {
  const heading = page.locator('.details h1');
  await heading.evaluate(element => { element.getBoundingClientRect(); return document.fonts.ready; });
  const box = await heading.boundingBox();
  // Include pixels outside the element: a locator screenshot would crop both versions.
  const clip = {x:Math.floor(box.x)-3, y:Math.floor(box.y)-8,
    width:Math.ceil(box.width)+6, height:Math.ceil(box.height)+16};
  const painted = await page.screenshot({clip});
  const reference = await page.addStyleTag({content:'.details h1 { overflow:visible; -webkit-line-clamp:unset }'});
  try {
    const unclipped = await heading.boundingBox();
    assert(Math.abs(box.y-unclipped.y)<1 && Math.abs(box.height-unclipped.height)<1, 'fixture must fit in two lines');
    assert(painted.equals(await page.screenshot({clip})), (await heading.textContent())+' lost glyph pixels');
  } finally {
    await reference.evaluate(element=>element.remove());
  }
}

async function checkLocalizedLayout(browser) {
  const page = await browser.newPage({viewport:{width:1499,height:820},locale:'ko-KR',reducedMotion:'reduce'});
  const longName = 'AdventureChronicles'.repeat(8);
  await page.addInitScript(name => {
    window.__TAURI__ = {core:{invoke:async (cmd, args={}) => {
      if (cmd === 'get_options') return {login:false,fullscreen:false};
      if (cmd === 'epic_folders') return [];
      if (cmd === 'discover') return {warnings:[],complete:true,items:args.source === 'steam' ? [
        {source:'steam',id:'steam:1',name}, {source:'steam',id:'steam:2',name:'Crusader Kings III'},
        {source:'steam',id:'steam:3',name:'Age of Empires IV: Anniversary Edition'}
      ] : []};
      if (cmd === 'launch_game') window.runningGame = args.id;
      if (cmd === 'get_session') return {id:window.runningGame,phase:window.runningGame?'running':'idle',serial:1};
      if (cmd === 'registered_apps') return [{id:'example',name}];
      if (cmd === 'window_action' && args.action === 'quit') throw new Error('D:/Games/' + name);
    }}};
  }, longName);
  try {
    await page.goto(process.env.POLAR_TEST_URL);
    await page.locator('#play').waitFor();
    const fontSize = selector => page.locator(selector).first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
    const before = await fontSize('#play');
    await page.setViewportSize({width:1500,height:820});
    assert(Math.abs(await fontSize('#play')-before)<1, 'body type jumps when resizing across 1500px');
    await page.setViewportSize({width:1920,height:1080});
    assert(await fontSize('#play')<=18 && await fontSize('.details h1')<=56 && await fontSize('#home')<=20, 'home type exceeds the desktop scale');
    assert((await page.locator('#play').boundingBox()).height>=40, 'Play hit area shrank with the type');
    await page.locator('#library').click();
    assert(await fontSize('.libHeading h2')<=36, 'library heading exceeds the desktop scale');
    const edition=page.locator('.card[data-id="steam:3"] b');
    assert(await edition.evaluate(e=>e.scrollHeight<=e.clientHeight+1 && e.scrollWidth<=e.clientWidth+1), 'two-line edition name should fit in full');
    const stores=await page.locator('.card small').evaluateAll(labels=>labels.map(e=>e.getBoundingClientRect().top));
    assert(Math.max(...stores)-Math.min(...stores)<1, 'store names should align in a mixed row');
    await page.locator('.card[data-id="steam:2"]').click({button:'right'});
    await page.locator('#favoriteAction').click();
    await page.keyboard.press('Escape');
    await page.locator('.filter[data-key=favorites]').click();
    assert(await page.locator('.card b').evaluate(e=>e.offsetHeight<2*parseFloat(getComputedStyle(e).fontSize)), 'short titles should use one line in an all-short row');
    await page.locator('.filter[data-key=all]').click();
    await page.locator('#home').click();
    await page.setViewportSize({width:640,height:420});
    await page.locator('.tile[data-id="steam:1"]').click();
    await page.locator('#play').click();
    await page.locator('.tile[data-id="steam:2"]').click();
    for (const [lang,state] of [['en','Running'], ['ko','실행 중']]) {
      await page.locator('#settings').click();
      await page.locator('.languages button[lang='+lang+']').click();
      assert.equal(await page.locator('html').getAttribute('lang'), lang);
      const category = page.locator('[data-control=display]');
      assert((await category.boundingBox()).height<=45, 'settings categories wrap at the supported minimum width');
      await page.keyboard.press('Escape');
      const status = page.locator('#launchStatus');
      await page.waitForFunction(s=>document.querySelector('#launchStatus').textContent.toLowerCase().includes(s.toLowerCase()),state);
      assert(await status.evaluate((e, state) => {
        const node=e.firstChild, start=node.textContent.toLowerCase().indexOf(state.toLowerCase());
        const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+state.length);
        const r=range.getBoundingClientRect(), box=e.getBoundingClientRect();
        return r.left>=box.left-1 && r.right<=box.right+1 && r.bottom<=box.bottom+1;
      },state), 'running status is obscured by the long game name in '+lang);
      await visibleInside(page,'#play');
      await visibleInside(page,'.counter');
      await page.locator('#library').click();
      const title=page.locator('.card[data-id="steam:1"] b');
      assert.equal(await title.textContent(),longName);
      assert(await title.evaluate(e=>e.scrollWidth<=e.clientWidth+1 && e.offsetHeight>=2*parseFloat(getComputedStyle(e).fontSize)), 'long library title needs two lines within its card');
      await page.locator('#addLib').click();
      await page.getByRole('button',{name:lang==='en'?'Registered Windows apps':'Windows 등록 앱'}).click();
      await page.locator('.appList button').waitFor();
      assert(await page.locator('.appList').evaluate(e=>e.scrollWidth<=e.clientWidth+1), 'registered app result scrolls horizontally');
      await page.keyboard.press('Escape');
      await page.locator('#home').click();
    }
    await page.locator('#quit').click();
    const notice=page.locator('#notice');
    await notice.waitFor();
    assert(await notice.evaluate(e=>e.scrollWidth<=e.clientWidth+1), 'long native error escapes its notice');
  } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
  try {
    await checkLocalizedLayout(browser);
    for (const lang of ['ko','en']) {
      let reference;
      for (const [width,height,dpr] of [[1920,1080,1],[3840,2160,1],[2560,1440,1.5],[1920,1080,2]]) {
        const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,locale:lang,reducedMotion:'reduce'});
        page.on('pageerror', error => console.error(error));
        page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
        await page.addInitScript(() => {
          window.__TAURI__={core:{invoke:async(cmd,args={})=>{
            if(cmd==='get_options')return {login:false,fullscreen:true};
            if(cmd==='discover')return {complete:true,warnings:[],items:args.source==='steam'?[
              {source:'steam',id:'steam:10',name:'Crusader Kings III'},
              {source:'steam',id:'steam:15',name:'Crusader Kings III 왕국 Pygmy 왕국 Pygmy'},
              {source:'steam',id:'steam:20',name:'아주 긴 한국어 게임 이름과 확장판에 포함된 모험 이야기 '.repeat(3).trim()}]:[]};
            return null;
          }}};
        });
        await page.goto(process.env.POLAR_TEST_URL);
        await page.locator('.tile.sel').waitFor();
        await page.waitForFunction(()=>!document.querySelector('#polar').classList.contains('entering'));
        for (const id of ['steam:10','steam:15']) {
          await page.locator('.tile[data-id="'+id+'"]').click();
          await checkTitleInk(page);
        }
        if (!reference) {
          await checkFont(page, '.details h1', 600);
          await checkFont(page, '#home', 500);
          await checkFont(page, '.clock', 500);
          await checkFont(page, '#play', 500);
          await checkFont(page, '.store', 500);
          await checkFont(page, '.counter', 400);
        }
        assert.deepEqual(await page.locator('#fade').boundingBox(),{x:0,y:0,width,height});
        const samples = {};
        for(const target of ['#home','.gear span:last-child','.counter','kbd','#play','.tile.sel']) samples[target]=await measure(page,target);
        if(!reference) for(const target of ['.gear span:last-child','.counter','kbd']) assert(samples[target].text>=15,target);
        await checkFooterCenter(page);
        await page.locator('#library').click();
        await checkFooterCenter(page);
        await checkKeycapInk(page);
        await checkFooterCenter(page);
        if (!reference) await checkFont(page, '.card[data-id="steam:15"] b', 600);
        samples.card=await measure(page,'.card b');
        await page.locator('#settings').click();
        samples.settings=await measure(page,'.categories button');
        if (!reference) {
          await checkFont(page, '#panel h2', 600);
          await checkFont(page, '.categories button[aria-pressed=true]', 500);
          await page.locator('[data-control=sources]').click();
          await checkFont(page, '.settingGroup p.note', 400);
          await checkFont(page, '.settingGroup h3', 600);
        }
        const drawer=await page.locator('#panel').boundingBox();
        assert(drawer.x>width/2 && Math.abs(drawer.x+drawer.width-width)<1 && drawer.y===0 && Math.abs(drawer.height-height)<1);
        await page.locator('#close').scrollIntoViewIfNeeded();
        await visibleInside(page,'#close');
        await page.keyboard.press('Escape');
        assert(await page.locator('#settings').evaluate(e=>e===document.activeElement));
        if(!reference) reference=samples;
        else for(const [selector, sample] of Object.entries(samples)){
          for(const [dimension,value] of Object.entries(sample)){
            const expected=2*reference[selector][dimension];
            assert(Math.abs(value-expected)<=Math.max(3,expected*.045),
              lang+' '+width+' @'+dpr+' '+selector+' '+dimension+' '+value+' expected '+expected);
          }
        }
        if(width===3840){
          await page.locator('#home').click();
          for(const size of [{width:640,height:420},{width:3440,height:800},{width:1920,height:1080}]){
            await page.setViewportSize(size);
            await page.locator('.tile[data-id="steam:10"]').click();
            await checkTitleInk(page);
            await page.locator('.tile[data-id="steam:15"]').click();
            await checkTitleInk(page);
            await page.locator('.tile[data-id="steam:20"]').click();
            assert(await page.locator('h1').evaluate(e=>e.scrollHeight>e.clientHeight), 'long title should be clamped');
            await visibleInside(page,'#play');
            await visibleInside(page,'.counter');
            await checkFooterCenter(page);
            await page.locator('#settings').click();
            await page.locator('#close').scrollIntoViewIfNeeded();
            await visibleInside(page,'#close');
            await page.keyboard.press('Escape');
          }
          const restored=await measure(page,'#home');
          for(const dimension of ['box','text'])assert(Math.abs(restored[dimension]-reference['#home'][dimension])<.01);
        }
        await page.close();
      }
    }
    console.log('1080p and 4K physical text/controls at 100%, 150%, 200%, narrow windows and dialog focus passed (ko/en).');
  } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
