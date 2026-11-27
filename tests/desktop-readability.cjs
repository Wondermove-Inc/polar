// Serve desktop/ui and set POLAR_TEST_URL. Measure rendered text and hit areas in output pixels.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

async function checkFont(page, selector, ...expected) {
  await page.locator(selector).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const {root} = await session.send('DOM.getDocument');
    const {nodeId} = await session.send('DOM.querySelector', {nodeId:root.nodeId, selector});
    const {fonts} = await session.send('CSS.getPlatformFontsForNode', {nodeId});
    const actual = fonts.filter(face => face.isCustomFont && face.glyphCount > 0).map(face => face.postScriptName);
    assert.deepEqual(actual.sort(), expected.sort(), selector + ' rendered with ' + JSON.stringify(fonts));
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

(async () => {
  const browser = await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
  try {
    for (const lang of ['ko','en']) {
      let reference;
      for (const [width,height,dpr] of [[1920,1080,1],[3840,2160,1],[2560,1440,1.5],[1920,1080,2]]) {
        const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,locale:lang,reducedMotion:'reduce'});
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
          await checkFont(page, '.details h1', 'Spectral-SemiBold', 'NanumMyeongjoBold');
          await checkFont(page, '#home', 'GmarketSansTTFBold');
          await checkFont(page, '.clock', 'GmarketSansTTFMedium');
          await checkFont(page, '#play', 'GmarketSansTTFBold');
          await checkFont(page, '.store', 'GmarketSansTTFMedium');
        }
        assert.deepEqual(await page.locator('#fade').boundingBox(),{x:0,y:0,width,height});
        const samples = {};
        for(const target of ['#home','.gear span:last-child','.counter','kbd','#play','.tile.sel']) samples[target]=await measure(page,target);
        if(!reference) for(const target of ['.gear span:last-child','.counter','kbd']) assert(samples[target].text>=15,target);
        await checkFooterCenter(page);
        await page.locator('#library').click();
        await checkFooterCenter(page);
        if (!reference) await checkFont(page, '.card[data-id="steam:15"] b', 'Spectral-SemiBold', 'NanumMyeongjoBold');
        samples.card=await measure(page,'.card b');
        await page.locator('#settings').click();
        samples.settings=await measure(page,'.categories button');
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
