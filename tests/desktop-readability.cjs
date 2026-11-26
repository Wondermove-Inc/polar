// Serve desktop/ui and set POLAR_TEST_URL. Measure rendered text and hit areas in output pixels.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

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

(async () => {
  const browser = await chromium.launch({executablePath:process.env.POLAR_CHROME,args:['--no-sandbox']});
  try {
    for (const lang of ['ko','en']) {
      let reference;
      for (const [width,height,dpr] of [[1920,1080,1],[3840,2160,1],[2560,1440,1.5],[1920,1080,2]]) {
        const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr,locale:lang});
        await page.addInitScript(() => {
          window.__TAURI__={core:{invoke:async(cmd,args={})=>{
            if(cmd==='get_options')return {login:false,fullscreen:true};
            if(cmd==='discover')return {complete:true,warnings:[],items:args.source==='steam'?[
              {source:'steam',id:'steam:10',name:'A Game'},{source:'steam',id:'steam:20',name:'아주 긴 한국어 게임 이름과 확장판에 포함된 모험 이야기'}]:[]};
            return null;
          }}};
        });
        await page.goto(process.env.POLAR_TEST_URL);
        await page.locator('.tile.sel').waitFor();
        await page.waitForFunction(()=>!document.querySelector('#polar').classList.contains('entering'));
        assert.deepEqual(await page.locator('#fade').boundingBox(),{x:0,y:0,width,height});
        const samples = {};
        for(const target of ['#home','.gear span:last-child','.counter','kbd','#play','.tile.sel']) samples[target]=await measure(page,target);
        if(!reference) for(const target of ['.gear span:last-child','.counter','kbd']) assert(samples[target].text>=15,target);
        await page.locator('#library').click();
        samples.card=await measure(page,'.card b');
        await page.locator('#settings').click();
        samples.settings=await measure(page,'.categories button');
        assert.deepEqual(await page.locator('#panel').boundingBox(),{x:0,y:0,width,height});
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
            await page.locator('.tile').last().click();
            await visibleInside(page,'#play');
            await visibleInside(page,'.counter');
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
