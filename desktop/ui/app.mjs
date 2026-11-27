import {importCover,readCover,writeCover} from './custom-cover.mjs';
import {decodeBackground, homeBackground} from './background.mjs';
import {folderKey,folderName,mergeLinkedShortcuts,unresolvedFolders} from './epic-pending.mjs';
import {languageFor, libraryView, mergeSource, words} from './model.mjs';

const $=selector=>document.querySelector(selector);
const invoke=(name,args={})=>window.__TAURI__.core.invoke(name,args);
const root=$('#polar'),panel=$('#panel'),content=$('#content'),rail=$('.rail'),grid=$('.grid');
let railFrame=0;
function revealSelection(){
 if(!rail.hidden&&!panel.open)rail.querySelector('.sel')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function settleRail(){
 if(!railFrame)railFrame=requestAnimationFrame(()=>{railFrame=0;revealSelection()});
}
const selectionSize=new ResizeObserver(revealSelection);
function fitInterface(){
 const scale=Math.max(1, Math.min(window.innerWidth/1920,window.innerHeight/1080));
 $('#interface').style.zoom=String(scale);
 settleRail();
}
fitInterface();
window.addEventListener('resize',fitInterface);
const platforms=['steam','xbox','epic','manual'];
const platformNames={steam:'Steam',xbox:'PC Game Pass',epic:'Epic Games'};
const stateKey='polar.desktop.v1';
let saved={};
try{saved=JSON.parse(localStorage.getItem(stateKey)||'{}')||{}}catch{}
const epicLinks=Object.assign(Object.create(null),saved.epicLinks);
let rows=Array.isArray(saved.rows)?saved.rows.filter(g=>g&&typeof g.id==='string'&&typeof g.name==='string'&&platforms.includes(g.source)):[];
let favorites=Array.isArray(saved.favorites)?saved.favorites:[],recent=Array.isArray(saved.recent)?saved.recent:[];
let current=typeof saved.current==='string'?saved.current:'',lang=Object.hasOwn(words,saved.lang)?saved.lang:languageFor(navigator.languages);
let remembered=current;
try{remembered=localStorage.getItem('polar.selected')||current;current=remembered}catch{}
let motion=saved.motion===true,fullscreen=saved.fullscreen!==false,login;
const pendingOptions=new Map();
let library=false,editing=false,filter='all',section='display',modal='',origin=null;
let games=[],tiles=[],scanning=false,hasPad=false;
let launchState=null,pollTimer,lastSerial=0;
let selectedApps=[],draft=null,replaceId=null,firstScan=true,introduced=false;
let folders=[],folderBusy=false;
const reports=new Map(),artCache=new Map();
let onlineArt=saved.onlineArt!==false;
const artSources=Object.assign(Object.create(null),saved.artSources);
const names=Object.assign(Object.create(null),saved.names);
const setBackground=homeBackground($('#fade'),invoke);
let ambientRequest;
function background(refresh=false){
 const game=games.find(g=>g.id===current);
 const override=artSources[current]||artSources[game?.alias];
 const source=override||(/^steam:[1-9]\d*$/.test(current)||current.startsWith('epic:')?current:null);
 const active=library||!game?'':current;
 const ambient=$('#ambient'),coverKey=active && coverCacheKey(active);
 if(ambient.dataset.key!==coverKey || refresh){
  ambient.dataset.key=coverKey;
  ambient.style.removeProperty('--cover');
  const request=ambientRequest=active?coverArt(active):null;
  request?.then(image=>{
   if(image && ambientRequest===request)ambient.style.setProperty('--cover','url('+image+')');
  });
 }
 setBackground(library||!game?'':current,source,onlineArt,!!override,refresh);
}
const tr=key=>words[lang][key],platform=src=>platformNames[src]||tr('manual');
const count=n=>tr(n===1?'countOne':'countMany').replace('{n}',new Intl.NumberFormat(lang).format(n));
function persist(){
  try{localStorage.setItem(stateKey,JSON.stringify({rows,favorites,recent,current,lang,motion,fullscreen,onlineArt,artSources,names,epicLinks}));return true}
  catch{(panel.open?$('#alert'):$('#notice')).textContent=tr('storage');return false}
}
function button(text,fn,cls='quietBtn'){
  const b=document.createElement('button');b.className=cls;b.textContent=text;b.onclick=fn;return b;
}
function el(tag,text='',cls=''){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e}
function error(e){const target=panel.open?$('#alert'):$('#notice');target.textContent=tr('failedAction')+' '+String(e)}
function clock(){$('.clock').textContent=new Intl.DateTimeFormat(lang,{hour:'numeric',minute:'2-digit'}).format(new Date())}
function hints(){
  const keys=hasPad?['✥',tr('lower'),tr('right')]:['← →','Enter','Esc'];
  $('.footkeys').replaceChildren(...['move','choose','back'].map((k,i)=>{const s=el('span');s.append(el('kbd',keys[i]),' '+tr(k));return s}));
}
function localize(){
 document.documentElement.lang=lang;for(const e of document.querySelectorAll('[data-word]'))e.textContent=tr(e.dataset.word);
 $('#gameOptions').ariaLabel=$('#gameOptions').title=tr('gameEdit');$('#nav').ariaLabel=tr('mainNav');rail.ariaLabel=tr('recent');$('.filters').ariaLabel=tr('sourceFilter');for(const key of ['previousGame','nextGame'])$('#'+key).ariaLabel=tr(key);clock();hints();
}
function hue(id){let hash=0;for(const ch of id)hash=(hash*31+ch.charCodeAt(0))|0;return String(Math.abs(hash)%360)}
function steamCover(id){
 const link=artSources[id]||artSources[games.find(g=>g.id===id)?.alias];
 return /^steam:[1-9]\d*$/.test(id)?id:link?.startsWith('steam:')?link:null;
}
function coverCacheKey(id){
 const game=games.find(g=>g.id===id);
 return [id,game?.source,game?.alias,steamCover(id),onlineArt].join('|');
}
function clearCovers(ids){
 for(const [key,entry] of artCache)if(ids.has(entry.id))artCache.delete(key);
}
function coverArt(id){
 const key=coverCacheKey(id);
 if(!artCache.has(key)){
  if(artCache.size>=72)artCache.delete(artCache.keys().next().value);
  const source=steamCover(id),online=onlineArt,game=games.find(g=>g.id===id);
  const image=(async()=>{
   const custom=await readCover(id,game?.alias).catch(()=>null);
   if(custom)return custom;
   async function portrait(){
    if(!source||(online&&!onlineArt))return null;
    return invoke('online_cover',{id:Number(source.slice(6)),online}).catch(()=>null);
   }
   const preferLinked=source&&!id.startsWith('steam:')&&game?.source!=='xbox';
   if(preferLinked){
    const image=await portrait();if(image)return image;
   }
   const local=await invoke('artwork',{id,hero:false}).catch(()=>null);
   if(typeof local==='string'){
    const image=new Image();image.src=local;
    try{await image.decode();return local}catch{}
   }
   if(source&&!preferLinked){
    const image=await portrait();if(image)return image;
   }
   if(id.startsWith('epic:'))return invoke('epic_cover',{id,online:online&&onlineArt}).catch(()=>null);
   return null;
  })();
  artCache.set(key,{id,image});
 }
 return artCache.get(key).image;
}
const observer=new IntersectionObserver(entries=>{
 for(const {isIntersecting,target} of entries)if(isIntersecting){
   observer.unobserve(target);
   coverArt(target.dataset.art).then(url=>{
    if(!url||!target.isConnected)return;
    const image=new Image();image.alt='';image.draggable=false;
    image.onload=()=>target.classList.add('hasArt');
    image.onerror=()=>image.remove();
    image.src=url;target.append(image);
   });
 }
});
function tile(game,small){
 const b=button('',()=>{
   if(!small&&editing){favorite(game.id,b);return}
   if(!small){current=game.id;library=false;render(true)}else select(game.id,true);
 },small?'tile':'card');
 b.dataset.id=game.id;b.ariaLabel=game.name+' · '+platform(game.source);b.style.setProperty('--hue',hue(game.id));
 b.setAttribute('aria-haspopup','dialog');
 b.oncontextmenu=e=>{e.preventDefault();editGame(game,b)};
 if(small){b.tabIndex=-1;b.setAttribute('aria-pressed','false')}
 const cover=small?b:el('div','','cover');cover.dataset.art=game.id;cover.dataset.initials=(game.name.match(/[\p{L}\p{N}]+/gu)||[]).slice(0,2).map(w=>[...w][0]).join('').toLocaleUpperCase(lang);observer.observe(cover);
 if(!small){b.append(cover,el('b',game.name),el('small',platform(game.source)));if(editing)b.setAttribute('aria-pressed',String(favorites.includes(game.id)||favorites.includes(game.alias)))}
 return b;
}
function favorite(id,b){
 const alias=games.find(g=>g.id===id)?.alias;
 favorites=favorites.includes(id)||favorites.includes(alias)?favorites.filter(x=>x!==id&&x!==alias):[...favorites,id];
 b.setAttribute('aria-pressed',String(favorites.includes(id)));persist();
}
const pendingEpic=()=>unresolvedFolders(reports.get('epic'),rows,epicLinks);
function pendingCard(path){
 const b=button('',()=>addDialog(null,path),'card');
 b.dataset.epicFolder=path;b.title=path;
 const cover=el('div','','cover');cover.dataset.initials='+';cover.ariaHidden='true';
 b.style.setProperty('--hue','196');b.append(cover,el('b',folderName(path)),el('small',tr('connectShortcut')));
 return b;
}
function libraryCount(confirmed,pending){
 return pending?count(confirmed)+' · '+tr('pendingEpicCount').replace('{n}',new Intl.NumberFormat(lang).format(pending)):count(confirmed);
}
function select(id,focus=false){
 const game=games.find(g=>g.id===id);if(!game)return;
 current=id;
 if(id!==remembered){try{localStorage.setItem('polar.selected',id);remembered=id}catch{$('#notice').textContent=tr('storage')}}
 root.style.setProperty('--hue',hue(id));
 $('h1').textContent=game.name;$('h1').title=game.name;$('.store').textContent=platform(game.source);$('.genre').textContent=game.unconfirmed?tr('unconfirmed'):'';
 const previous=rail.querySelector('.sel'),selected=rail.querySelector('[data-id="'+CSS.escape(id)+'"]');
 if(previous && previous!==selected){previous.classList.remove('sel');previous.tabIndex=-1;previous.setAttribute('aria-pressed','false')}
 if(selected){
  selected.classList.add('sel');selected.tabIndex=0;selected.setAttribute('aria-pressed','true');
  if(focus)selected.focus({preventScroll:true});
  selectionSize.disconnect();
  if(!library){selectionSize.observe(selected);revealSelection()}
 }
 $('#previousGame').disabled=tiles[0]?.id===id;
 $('#nextGame').disabled=tiles.at(-1)?.id===id;
 launchView();background();
 $('.counter').textContent=count(games.length);
}
function render(focus=false){
 const active=document.activeElement,focusId=active?.dataset.id,focusFolder=active?.dataset.epicFolder,wasRail=rail.contains(active),wasGrid=grid.contains(active);
 const linkedRows=mergeLinkedShortcuts(rows,reports.get('epic'),epicLinks);
 observer.disconnect();games=libraryView(linkedRows,'all',favorites,lang,names);
 if(!games.some(g=>g.id===current))current=games.find(g=>g.alias===current)?.id||games[0]?.id||'';
 const byId=new Map(games.map(g=>[g.id,g]));
 const aliases=new Map(games.filter(g=>g.alias).map(g=>[g.alias,g.id]));
 const ordered=[...new Set([...recent.map(id=>aliases.get(id)||id),...byId.keys()])].map(id=>byId.get(id)).filter(Boolean);
 tiles=ordered;
 root.classList.toggle('libOn',library);root.classList.toggle('noMotion',motion);
 for(const [id,on] of [['#library',library],['#home',!library]]){if(on)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current')}
 $('#shelf').hidden=rail.hidden=library||!games.length;$('#stage').hidden=library;$('.lib').hidden=!library;
 $('.details').hidden=!games.length;$('#homeEmpty').hidden=!!games.length||firstScan;$('#homeLoading').hidden=!!games.length||!firstScan;
 const pending=pendingEpic();
 $('#homeEmpty h2').textContent=tr(pending.length?'foundEpicFolder':'empty');
 $('#homeEmpty p').textContent=tr(pending.length?'connectHelp':'emptyHelp');
 $('#addEmpty').textContent=tr(pending.length?'connectEpic':'add');
 if(!introduced&&(games.length||!firstScan)){
  introduced=true;root.classList.add('entering');setTimeout(()=>root.classList.remove('entering'),650);
 }
 selectionSize.disconnect();rail.replaceChildren(...tiles.map(g=>tile(g,true)));
 if(current)select(current,!library&&!panel.open&&(focus||wasRail));
 if(!games.length){background();$('.counter').textContent=libraryCount(0,pending.length)}
 if(library){
  $('.filters').replaceChildren(...['all','steam','xbox','epic','favorites'].map(k=>{
   const b=button(platformNames[k]||tr(k),()=>{editing=false;filter=k;render();[...$('.filters').children].find(x=>x.dataset.key===k)?.focus()},'filter');
   b.dataset.key=k;b.setAttribute('aria-pressed',String(filter===k));return b;
  }));
  $('#edit').hidden=filter!=='favorites';$('#edit').textContent=tr(editing?'done':'edit');
  const list=libraryView(linkedRows,editing?'all':filter,favorites,lang,names);grid.replaceChildren(...list.map(g=>tile(g,false)));
  const visiblePending=!editing&&(filter==='all'||filter==='epic')?pending:[];
  grid.append(...visiblePending.map(pendingCard));
  $('.empty').hidden=!!(list.length||visiblePending.length);$('.counter').textContent=libraryCount(list.length,visiblePending.length);
  if(wasGrid&&!panel.open)([...grid.children].find(b=>focusFolder?b.dataset.epicFolder===focusFolder:b.dataset.id===focusId)||grid.firstElementChild||$('#addLib')).focus();
 }else{grid.replaceChildren();if(focus&&!current)$('#addEmpty').focus()}
}
function step(direction){
 const i=tiles.findIndex(g=>g.id===current);
 const next=tiles[Math.min(tiles.length-1,Math.max(0,i+direction))];
 if(next)select(next.id,true);
}
$('#previousGame').onclick=()=>step(-1);$('#nextGame').onclick=()=>step(1);
function switchPage(value){library=value;editing=false;render(!value);if(value)$('#library').focus();persist()}
$('#home').onclick=()=>switchPage(false);$('#library').onclick=()=>switchPage(true);$('#edit').onclick=()=>{editing=!editing;render()};

const latestScan=new Map();
async function loadSource(source){
 const request=Symbol();latestScan.set(source,request);
 let report;
 const args={source};
 if(source==='epic')args.linkedFolders=Object.keys(epicLinks).slice(0,256);
 try{report=await invoke('discover',args)}catch(e){report={complete:false,warnings:[String(e)],items:[]}}
 if(latestScan.get(source)!==request)return;
 if(source==='manual'&&report.complete){
  const ids=new Set(report.items.filter(g=>g.source==='epic').map(g=>g.id));
  for(const [path,id] of Object.entries(epicLinks))if(!ids.has(id))delete epicLinks[path];
 }
 reports.set(source,report);rows=mergeSource(rows,source,report);clearCovers(new Set(report.items.map(item=>item.id)));render();if(rows.some(g=>g.id===current&&(g.bucket??g.source)===source))background(true);persist();
 if(modal==='settings'&&section==='sources')settingsBody(true);
}
async function scan(){
 if(scanning)return;scanning=true;
 if(modal==='settings'&&section==='sources')settingsBody(true);
 try{await Promise.all(platforms.map(loadSource))}finally{scanning=false;firstScan=false;render();if(modal==='settings'&&section==='sources')settingsBody(true)}
}
$('#scanEmpty').onclick=scan;
function open(mode,title){
 modal=mode;panel.dataset.mode=mode;
 if(!panel.open){origin=document.activeElement;panel.showModal()}
 $('#panelTitle').textContent=title;$('#alert').textContent='';content.replaceChildren();
 $('#close').textContent=tr('close');panel.scrollTop=0;
}
function close(){
 if(!panel.open)return;panel.close();modal='';content.replaceChildren();
 const folder=origin?.dataset.epicFolder;
 const linked=folder&&epicLinks[folderKey(folder)];
 const entry=origin?.dataset.id||linked;
 const tileId=entry&&games.find(g=>g.id===entry||g.alias===entry)?.id;
 const restored=(tileId&&(library?grid.querySelector('[data-id="'+CSS.escape(tileId)+'"]'):rail.querySelector('.sel')))||
  (library&&folder&&grid.querySelector('[data-epic-folder="'+CSS.escape(folder)+'"]'));
 if(restored){restored.focus({preventScroll:true});if(library)restored.scrollIntoView({block:'nearest',inline:'nearest'})}
 else if(!library&&current&&!origin?.isConnected){select(current,true)}
 else if(origin?.isConnected)origin.focus();else (library?$('#library'):$('#home')).focus();
 settleRail();
}
$('#close').onclick=close;panel.addEventListener('cancel',e=>{e.preventDefault();close()});
function onSettingsBackdrop(event){
 if(modal!=='settings'||event.target!==panel)return false;
 const r=panel.getBoundingClientRect();
 return event.clientX<r.left||event.clientX>=r.right||event.clientY<r.top||event.clientY>=r.bottom;
}
let backdropPress=false;
panel.addEventListener('pointerdown',e=>{backdropPress=e.isPrimary&&e.button===0&&onSettingsBackdrop(e)});
panel.addEventListener('pointercancel',()=>{backdropPress=false});
panel.addEventListener('click',e=>{
 const dismiss=backdropPress&&onSettingsBackdrop(e);backdropPress=false;
 if(dismiss)close();
});
function prefRow(label,control){const r=el('label','','settingRow');r.append(el('span',label),control);return r}
function toggle(value,set){
 const input=document.createElement('input');input.type='checkbox';input.checked=value;
 input.onchange=async()=>{
  const focused=input===document.activeElement;input.disabled=true;
  try{await set(input.checked)}catch(e){input.checked=!input.checked;error(e)}
  finally{input.disabled=false;if(focused&&input.isConnected&&document.activeElement===document.body)input.focus()}
 };return input;
}
async function nativeAction(action,enabled=false){return invoke('window_action',{action,enabled})}
function nativeToggle(action){
 const savedValue=()=>action==='login'?!!login:fullscreen;
 const input=toggle(pendingOptions.get(action)??savedValue(),async enabled=>{
  pendingOptions.set(action,enabled);
  try{
   await nativeAction(action,enabled);
   if(action==='login')login=enabled;else{fullscreen=enabled;persist()}
  }catch(e){error(e)}
  finally{
   pendingOptions.delete(action);
   // The drawer may have been closed and reopened while Windows applied the option.
   const visible=content.querySelector('input[data-control="'+action+'"]');
   if(visible){visible.checked=savedValue();visible.disabled=false}
  }
 });
 input.dataset.control=action;input.disabled=pendingOptions.has(action);return input;
}
function settingsBody(keep=false){
 const group=content.querySelector('.settingGroup');
 const scroll=keep&&group?group.scrollTop:0;
 const expanded=new Set(keep?[...content.querySelectorAll('details[open]')].map(d=>d.dataset.source):[]);
 const focused=keep&&content.contains(document.activeElement)?document.activeElement.dataset.control:null;
 content.replaceChildren();const prefs=el('div');prefs.id='preferences';const nav=el('div','','categories');nav.setAttribute('role','group');nav.ariaLabel=tr('section');
 for(const k of ['display','sources','system']){const b=button(tr(k),()=>{section=k;settingsBody();content.querySelector('.categories [aria-pressed=true]').focus()},'');
  b.dataset.control=k;b.setAttribute('aria-pressed',String(section===k));nav.append(b)}
 const body=el('section','','settingGroup');body.ariaLabel=tr(section);prefs.append(nav,body);content.append(prefs);
 if(section==='display'){
  const languages=el('div','','languages');
  for(const [code,name] of [['ko','한국어'],['en','English']]){
    const b=button(name,()=>{lang=code;persist();localize();render();$('#panelTitle').textContent=tr('settings');settingsBody();content.querySelector('[lang='+code+']').focus()},'');
    b.lang=code;b.setAttribute('aria-pressed',String(lang===code));languages.append(b);
  }
  const row=el('div','','languageRow');row.append(el('span',tr('language')),languages);body.append(row,
   prefRow(tr('motion'),toggle(motion,v=>{motion=v;root.classList.toggle('noMotion',v);persist()})),
   prefRow(tr('fullscreen'),nativeToggle('fullscreen')));
  const onlineToggle=toggle(onlineArt,v=>{onlineArt=v;artCache.clear();persist();render()});
  onlineToggle.dataset.control='onlineArt';body.append(prefRow(tr('onlineArt'),onlineToggle));

 }else if(section==='sources'){
  for(const s of platforms){
   const report=reports.get(s);const r=el('div','','scanRow');
   const found=rows.filter(x=>(x.bucket??x.source)===s).length,pending=s==='epic'?pendingEpic().length:0;
   r.append(el('span',platform(s)),el('span',libraryCount(found,pending)+' · '+tr(!report?'scanning':report.complete?'ready':'partial')));body.append(r);
   if(report?.warnings.length){
    const d=el('details'),summary=el('summary',tr('diagnostics'));d.dataset.source=s;d.open=expanded.has(s);summary.dataset.control='details-'+s;
    d.append(summary,el('div',report.warnings.join('\n'),'faults'));body.append(d);
   }
  }
  body.append(el('h3',tr('epicFolders')),el('p',tr('epicFolderHelp'),'note'));
  async function changeFolder(action,path=null){
   if(folderBusy||scanning)return;
   folderBusy=true;settingsBody(true);
   try{
    const updated=await invoke('epic_folders',{action,path});
    if(updated.length!==folders.length){folders=updated;await scan()}
   }catch(e){error(e)}
   finally{folderBusy=false;if(modal==='settings'&&section==='sources')settingsBody(true)}
  }
  for(const path of folders){
   const row=el('div','','settingRow'),remove=button(tr('removeFolder'),()=>changeFolder('remove',path));
   remove.disabled=folderBusy||scanning;remove.dataset.control='remove-'+path;remove.ariaLabel=tr('removeFolder')+' · '+path;row.append(el('span',path),remove);body.append(row);
  }
  const addFolder=button(tr('addEpicFolder'),()=>changeFolder('add'));
  addFolder.dataset.control='addEpicFolder';addFolder.disabled=folderBusy||scanning;body.append(addFolder);
  const scanBtn=button(tr(scanning?'scanning':'scan'),scan);scanBtn.dataset.control='scan';scanBtn.disabled=scanning;
  body.append(scanBtn);
 }else{
  body.append(prefRow(tr('login'),nativeToggle('login')));
  const buttons=el('div','','buttons');for(const k of ['desktop','quit'])buttons.append(button(tr(k),()=>nativeAction(k).catch(error)));body.append(buttons);
 }
 if(focused){
  const restored=content.querySelector('[data-control="'+CSS.escape(focused)+'"]:not(:disabled)');
  (restored||nav.querySelector('[aria-pressed=true]')).focus({preventScroll:true});
 }
 body.scrollTop=scroll;
}
function editGame(game,trigger){
 if(!game)return;
 open('game',tr('gameEdit'));origin=trigger;
 const main=el('section','','gameEditor'),header=el('div','','editorGame'),preview=el('div','','cover');
 preview.style.setProperty('--hue',hue(game.id));preview.dataset.initials=[...game.name][0]||'';
 const summary=el('div','','editorTitle');summary.append(el('small',platform(game.source)));header.append(preview,summary);
 const title=el('label',tr('title'),'field'),name=el('input');
 name.type='text';name.maxLength=180;name.value=game.name;title.append(name);
 const status=el('p','','note');status.setAttribute('role','status');
 const nameActions=el('div','','buttons');
 const original=game.originalName||game.name;
 function saveName(value){
  if(!value){name.focus();return}
  if(game.alias)delete names[game.alias];
  if(value===original)delete names[game.id];else names[game.id]=value;
  name.value=value;
  resetName.hidden=value===original;const saved=persist();render();status.textContent=saved?tr('savedEdit'):'';
 }
 const resetName=button(tr('resetName'),()=>saveName(original));resetName.hidden=name.value===original;
 const save=button(tr('saveName'),()=>saveName(name.value.trim()));
 name.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();save.click()}};
 nameActions.append(save,resetName);
 const art=el('section','','editorCover'),files=el('label',tr('chooseCover'),'filePicker');
 const input=el('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';files.append(input);
 const reset=button(tr('resetCover'),()=>changeCover(null));reset.hidden=true;
 let lastPreview;
 async function refresh(){
  const request=lastPreview=coverArt(game.id),url=await request;
  if(!main.isConnected||lastPreview!==request)return;
  preview.replaceChildren();preview.classList.remove('hasArt');
  if(url){
   const image=new Image();image.alt='';image.onload=()=>{if(preview.contains(image))preview.classList.add('hasArt')};image.src=url;preview.append(image);
  }
 }
 async function changeCover(file){
  input.disabled=reset.disabled=true;status.textContent='';
  try{
   const data=file?await importCover(file):null;
   if(!main.isConnected)return;
   await writeCover(game.id,game.alias,data);
   clearCovers(new Set([game.id,game.alias]));render();
   if(game.id===current)background(true);
   if(main.isConnected){reset.hidden=!data;refresh();status.textContent=tr('savedEdit')}
  }catch{status.textContent=tr(file?'coverError':'storage')}
  finally{input.disabled=reset.disabled=false;input.value=''}
 }
 input.onchange=()=>{if(input.files[0])changeCover(input.files[0])};
 const coverActions=el('div','','buttons');coverActions.append(files,reset);art.append(el('h3',tr('cover')),coverActions);
 summary.append(title,nameActions);main.append(header,art,status);content.append(main);
 refresh();readCover(game.id,game.alias).then(data=>{if(data&&main.isConnected)reset.hidden=false}).catch(()=>{});
 backgroundSettings(main,game,refresh);
 const manual=rows.find(row=>row.bucket==='manual'&&(row.id===game.id||row.id===game.alias));
 if(manual){const actions=el('div','','buttons');actions.append(button(tr('change'),()=>addDialog(manual.id)),button(tr('remove'),()=>removeDialog(manual)));main.append(actions)}
 name.focus({preventScroll:true});
}
$('#gameOptions').onclick=()=>editGame(games.find(g=>g.id===current),$('#gameOptions'));
function backgroundSettings(body,game,refresh){
 const group=el('section','','backgroundSettings'), results=el('div','','appList');
 const status=el('p','','note');status.setAttribute('role','status');
 const field=el('label',tr('heroUrl'),'field'),input=document.createElement('input');
 input.type='url';input.placeholder='https://cdn2.steamgriddb.com/hero/…';field.append(input);
 const searchField=el('label',tr('steamTitle'),'field'),query=document.createElement('input');
 query.type='text';query.maxLength=180;query.value=game.name;searchField.append(query);
 group.append(el('h3',tr('gameBackground')));body.append(group);
 const actions=el('div','','buttons');
 const find=button(tr('search'),async()=>{
  find.disabled=true;results.replaceChildren();status.textContent=tr('loading');
  try{
   const hits=await invoke('search_backgrounds',{title:query.value.trim(),lang});
   if(!group.isConnected||!panel.open)return;
   status.textContent=tr(hits.length?'selectEdition':'noMatches');
   for(const hit of hits)results.append(button(hit.name+' · '+hit.id,()=>link('steam:'+hit.id)));
   results.firstElementChild?.focus();
  }catch{status.textContent=tr('artUnavailable')}finally{find.disabled=!onlineArt}
 });
 const apply=button(tr('applyHero'),()=>{
  const url=input.value.trim();
  if(!/^https:\/\/cdn2\.steamgriddb\.com\/hero\/[a-fA-F0-9]{32}\.(png|jpg|webp)$/.test(url)){status.textContent=tr('heroOriginal');input.focus();return}
  link(url);
 });
 async function link(source){
  if(group.inert)return;
  group.inert=true;status.textContent=tr('loading');
  try{
   const image=await decodeBackground(await invoke('online_background',{source,online:onlineArt}),source.startsWith('steam:'));
   if(!group.isConnected||!panel.open||modal!=='game')return;
   if(!image){status.textContent=tr('artUnavailable');return}
   if(game.alias)delete artSources[game.alias];artSources[game.id]=source;
   persist();render();refresh();group.remove();backgroundSettings(body,game,refresh);
   content.querySelector('[data-control="resetArt"]')?.focus();
  }catch{status.textContent=tr('artUnavailable')}finally{group.inert=false}
 }
 find.disabled=!onlineArt;apply.disabled=!onlineArt;
 const advanced=el('details');advanced.append(el('summary',tr('moreArtwork')),field,apply);
 const steam=el('details'),expand=el('summary',tr('findSteam'));
 expand.dataset.control='findArt';steam.append(expand,searchField,find,results);
 group.append(steam,advanced,actions,status);
 if(artSources[game.id]||artSources[game.alias]){
  const reset=button(tr('resetArt'),()=>{
   delete artSources[game.id];if(game.alias)delete artSources[game.alias];
   persist();render();refresh();group.remove();backgroundSettings(body,game,refresh);content.querySelector('[data-control="findArt"]')?.focus();
  });reset.dataset.control='resetArt';actions.append(reset);
 }

}
$('#settings').onclick=()=>{open('settings',tr('settings'));settingsBody();content.querySelector('.categories [aria-pressed=true]').focus()};
function removeDialog(m){
 open('remove',tr('removeConfirm'));content.append(el('p',m.name),el('p',tr('localOnly')),button(tr('remove'),async()=>{
  try{await invoke('remove_manual',{id:m.id});await loadSource('manual');close()}catch(e){error(e)}
 }));
 $('#close').focus();
}
function addDialog(previous=null,folder=null){
 open('add',tr(folder?'connectShortcut':previous?'change':'add'));replaceId=previous;draft=null;selectedApps=[];
 content.append(el('p',tr(folder?'connectHelp':'manualHelp'),'note'));
 if(folder)content.append(el('p',folder,'faults'));
 const actions=el('div','','buttons'),picker=button(tr('shortcut'),async()=>{
  picker.disabled=true;
  try{
   const row=await invoke('pick_shortcut');
   if(row&&panel.open&&picker.isConnected){
    if(folder&&/^(steam|xbox):/.test(row.id)){$('#alert').textContent=tr('epicShortcutOnly');return}
    draft={kind:'shortcut',id:row.id,name:row.name};manualForm(folder)
   }
  }catch(e){if(panel.open&&picker.isConnected)error(e)}finally{picker.disabled=false}
 });
 const apps=button(tr('applications'),async()=>{
  apps.disabled=true;try{const items=await invoke('registered_apps');if(panel.open&&apps.isConnected){selectedApps=items;appsList()}}catch(e){if(panel.open&&apps.isConnected)error(e)}finally{apps.disabled=false}
 });actions.append(picker);if(!folder)actions.append(apps);content.append(actions);picker.focus();
}
function appsList(){
 content.replaceChildren();const search=document.createElement('input');search.id='search';search.ariaLabel=tr('appFilter');search.placeholder=tr('appFilter');
 const list=el('div','','appList');content.append(search,list);
 function draw(){const match=selectedApps.filter(x=>x.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
 list.replaceChildren(...match.map(x=>button(x.name,()=>{draft={kind:'app',id:x.id,name:x.name};manualForm()},'')));if(!match.length)list.textContent=tr('appsEmpty')}
 search.oninput=draw;draw();search.focus();
}
function manualForm(folder=null){
 const old=rows.find(g=>g.id===replaceId&&g.bucket==='manual');content.replaceChildren();
 const name=document.createElement('input');name.value=folder?folderName(folder):old?.name||draft.name;name.maxLength=180;
 const src=document.createElement('select');for(const s of platforms){const o=el('option',platform(s));o.value=s;src.append(o)}
 src.value=folder?'epic':old?.source||({app:'xbox'}[draft.kind])||platforms.find(s=>draft.id.startsWith(s+':'))||'manual';src.disabled=!!folder;
 const nameRow=el('label',tr('title'),'field'),srcRow=el('label',tr('platform'),'field');nameRow.append(name);srcRow.append(src);
 const save=button(tr('save'),async()=>{
  const entry={...draft,name:name.value,source:src.value,previous:replaceId},key=folder&&folderKey(folder);
  if(folder&&!pendingEpic().some(p=>folderKey(p)===key)){error(tr('folderChanged'));return}
  if(folder&&Object.entries(epicLinks).some(([path,id])=>path!==key&&id===entry.id)){error(tr('shortcutInUse'));return}
  save.disabled=true;try{
   await invoke('save_manual',entry);
   if(folder)epicLinks[key]=entry.id;
   else if(entry.previous)for(const [path,id] of Object.entries(epicLinks)){
    if(id===entry.previous){if(entry.source==='epic')epicLinks[path]=entry.id;else delete epicLinks[path]}
   }
   await loadSource('manual');if(save.isConnected&&panel.open)close();
  }catch(e){if(panel.open&&save.isConnected)error(e)}finally{save.disabled=false}
 });content.append(nameRow,srcRow,save);name.focus();
}
$('#addLib').onclick=()=>addDialog();
$('#addEmpty').onclick=()=>{if(pendingEpic().length){filter='epic';switchPage(true);grid.querySelector('[data-epic-folder]')?.focus()}else addDialog()};
function inFlight(){
 return launchState&&['request','waiting','running'].includes(launchState.phase);
}
function launchView(){
 const play=$('#play'),info=$('#launchStatus'),launcher=$('#openLauncher');
 const game=games.find(g=>g.id===current);
 const own=launchState&&(launchState.id===current||launchState.id===game?.alias),active=inFlight(),phase=launchState?.phase;
 let label='play',note='',showNote=false;
 if(own&&active){
  label=phase==='running'?'running':'starting';note=tr(label);
 }else if(own&&phase){
  label=phase==='unknown'?'play':'retry';note=tr(phase);showNote=true;
 }else if(active){
  const title=games.find(g=>g.id===launchState.id)?.name||launchState.name;
  note=tr(phase==='running'?'otherRunning':'otherStarting').replace('{game}',()=>title);
  showNote=true;
 }
 play.textContent=tr(label);play.setAttribute('aria-disabled',String(!!active));
 info.classList.toggle('visuallyHidden',!showNote);
 if(info.textContent!==note)info.textContent=note;
 launcher.hidden=!(own&&['failed','busy'].includes(phase)&&platforms.slice(0,3).includes(game?.source));
}
async function pollSession(state){
 if(!state||launchState!==state||state.reading||!['waiting','running'].includes(state.phase))return;
 clearTimeout(pollTimer);state.reading=true;
 try{
  const snapshot=await invoke('get_session');
  if(launchState!==state)return;
  state.readErrors=0;
  if((!snapshot.id||snapshot.id===state.id)&&(!Number.isSafeInteger(snapshot.serial)||snapshot.serial>=state.minSerial)){
   if(Number.isSafeInteger(snapshot.serial))state.minSerial=lastSerial=snapshot.serial;
   if(snapshot.phase==='ended')launchState=null;
   else if(snapshot.phase==='requesting')state.phase='waiting';
   else state.phase=['waiting','running','failed','unknown'].includes(snapshot.phase)?snapshot.phase:'unknown';
  }
 }catch{if(launchState===state&&++state.readErrors>=3)state.phase='unknown'}
 finally{state.reading=false}
 if(launchState&&launchState!==state)return;
 launchView();
 if(inFlight())pollTimer=setTimeout(()=>pollSession(state),800);
 else if(launchState===state&&state.phase==='unknown'){
  pollTimer=setTimeout(()=>{if(launchState===state){launchState=null;launchView()}},3500);
 }
}
async function launch(id=current){
 if(!id||inFlight())return;
 clearTimeout(pollTimer);
 const state={id,name:games.find(g=>g.id===id)?.name||id,minSerial:lastSerial+1,phase:'request',readErrors:0};
 launchState=state;launchView();
 try{
  await invoke('launch_game',{id});recent=[id,...recent.filter(x=>x!==id)].slice(0,100);persist();
  state.phase='waiting';launchView();await pollSession(state);
 }catch(e){
  const busy=String(e)==='busy';
  if(busy){
   // A WebView reload can leave a live native session without a corresponding UI request.
   try{
    const live=await invoke('get_session');
    if(launchState!==state)return;
    if(live.id&&['requesting','waiting','running'].includes(live.phase)){
     state.id=live.id;state.name=games.find(g=>g.id===live.id)?.name||tr('otherGame');
     state.minSerial=Number.isSafeInteger(live.serial)?live.serial:0;
     lastSerial=Math.max(lastSerial,state.minSerial);
     state.phase=live.phase==='running'?'running':'waiting';
     launchView();pollTimer=setTimeout(()=>pollSession(state),800);return;
    }
   }catch{}
  }
  state.phase=busy?'busy':'failed';launchView();
 }
}
$('#play').onclick=()=>launch();
$('#openLauncher').onclick=()=>{
 const game=games.find(g=>g.id===current);
 if(game&&platforms.slice(0,3).includes(game.source))invoke('open_platform',{source:game.source}).catch(error)
};
window.addEventListener('focus',()=>pollSession(launchState));
const intro=$('#intro'),systemMotion=matchMedia('(prefers-reduced-motion: reduce)');
let introTimer;
const skipKeys=new Set();
function dismissIntro(){intro.hidden=true;clearTimeout(introTimer)}
function present(){
 intro.hidden=motion||systemMotion.matches;
 intro.onclick=dismissIntro;
 intro.addEventListener('animationend',e=>{if(e.target===intro&&e.animationName==='introDissolve')dismissIntro()});
 systemMotion.addEventListener('change',e=>{if(e.matches)dismissIntro()});
 // The native window also has a three-second fallback if its ready handshake stalls.
 introTimer=setTimeout(dismissIntro,3000);
 nativeAction('present',fullscreen).then(()=>{
  if(intro.hidden)return;
  clearTimeout(introTimer);
  intro.classList.add('playing');
  introTimer=setTimeout(dismissIntro,1000);
 }).catch(e=>{dismissIntro();error(e)});
}
function moveLibraryCard(card,key){
 const backwards=key==='ArrowUp'||key==='ArrowLeft';
 const sibling=backwards?'previousElementSibling':'nextElementSibling';
 let next=card[sibling];
 if(key==='ArrowLeft'||key==='ArrowRight'){
  if(next?.offsetTop===card.offsetTop)next.focus();
  return;
 }
 while(next&&next.offsetTop===card.offsetTop)next=next[sibling];
 if(!next){
  if(backwards)$('.filters [aria-pressed=true]')?.focus();
  return;
 }
 const center=el=>{const r=el.getBoundingClientRect();return r.left+r.width/2};
 const x=center(card),row=next.offsetTop;
 let closest=next,distance=Math.abs(center(next)-x);
 for(next=next[sibling];next&&next.offsetTop===row;next=next[sibling]){
  const d=Math.abs(center(next)-x);
  if(d<distance){closest=next;distance=d}
 }
 closest.focus();
}
function navigate(key){
 const active=document.activeElement;
 if(key==='ContextMenu'&&!panel.open){
  const target=active.closest('.tile,.card')||(!library&&rail.querySelector('.sel'));
  if(target?.dataset.id){editGame(games.find(g=>g.id===target.dataset.id),target);return true}
 }
 if(key==='Escape'){if(panel.open)close();else switchPage(false);return true}
 if(modal==='settings'&&key.startsWith('Arrow')){
  const tab=active.closest('.categories button'),selected=content.querySelector('.categories [aria-pressed=true]');
  if(tab&&(key==='ArrowLeft'||key==='ArrowRight')){
   (key==='ArrowLeft'?tab.previousElementSibling:tab.nextElementSibling)?.click();return true;
  }
  if(key==='ArrowDown'||key==='ArrowUp'){
   const down=key==='ArrowDown';
   if(active===$('#close')){if(down)selected.focus();return true}
   if(tab&&!down){$('#close').focus();return true}
   if(tab&&tab!==selected)tab.click();
   const controls=[...content.querySelectorAll('.settingGroup :is(button:enabled,input:enabled,summary)')];
   const next=controls.indexOf(active)+(down?1:-1);
   (next<0?selected:controls[Math.min(next,controls.length-1)]||selected).focus();return true;
  }
 }
 if(modal==='game'&&['ArrowUp','ArrowDown'].includes(key)){
  const controls=[...panel.querySelectorAll('button:enabled,input:enabled,summary')].filter(e=>e.checkVisibility()&&!e.closest('[inert]'));
  const next=controls.indexOf(active)+(key==='ArrowDown'?1:-1);
  controls[Math.max(0,Math.min(controls.length-1,next))]?.focus();return true;
 }
 if(active.matches('input:not([type=checkbox]),select')&&!['Escape','ArrowDown'].includes(key))return false;
 if(!panel.open&&!library&&current&&((active===$('#play')&&key==='ArrowUp')||(active===$('#home')&&key==='ArrowDown'))){select(current,true);return true}
 if(!panel.open&&!library&&(rail.contains(active)||active===document.body)&&current){
  if(['ArrowLeft','ArrowRight'].includes(key)){step(key==='ArrowLeft'?-1:1);return true}
  if(key==='Enter'){launch();return true}
  if(key==='ArrowUp'||key==='ArrowDown'){$(key==='ArrowUp'?'#home':'#play').focus();return true}
 }
 if(!key.startsWith('Arrow'))return false;
 if(!panel.open&&active.parentElement===grid){moveLibraryCard(active,key);return true}
 const controls=[...(panel.open?panel:root).querySelectorAll('button:not(:disabled),input:not(:disabled),select,summary')].filter(b=>b.offsetWidth&&b.tabIndex>=0);
 const r=active.getBoundingClientRect();const h=['ArrowLeft','ArrowRight'].includes(key),sign=['ArrowUp','ArrowLeft'].includes(key)?-1:1;
 let best,score=Infinity;
 for(const b of controls){if(b===active)continue;const t=b.getBoundingClientRect();
  const dx=t.left+t.width/2-r.left-r.width/2,dy=t.top+t.height/2-r.top-r.height/2,along=sign*(h?dx:dy),across=Math.abs(h?dy:dx);
  if(along<3||across>along*2)continue;if(along+across*4<score){score=along+across*4;best=b}}
 if(best){best.focus();return true}return false;
}
document.addEventListener('keydown',e=>{
 if(skipKeys.has(e.code)){e.preventDefault();return}
 if(!intro.hidden){dismissIntro();if(['Enter',' ','Escape'].includes(e.key)){skipKeys.add(e.code);e.preventDefault();return}}
 if(e.repeat&&e.key==='Enter'){e.preventDefault();return}if(navigate(e.key==='F10'&&e.shiftKey?'ContextMenu':e.key))e.preventDefault()});
document.addEventListener('keyup',e=>{if(skipKeys.delete(e.code))e.preventDefault()});
window.addEventListener('blur',()=>skipKeys.clear());
let last=new Set(),repeatAt=0;
setInterval(()=>{
 if(document.hidden||!document.hasFocus()){last.clear();return}
 let pad;try{pad=Array.from(navigator.getGamepads?.()||[]).find(p=>p?.mapping==='standard')}catch{return}
 if(hasPad!==!!pad){hasPad=!!pad;hints()}if(!pad){last.clear();return}
 const keys=new Set();for(const [n,k] of [[12,'ArrowUp'],[13,'ArrowDown'],[14,'ArrowLeft'],[15,'ArrowRight'],[0,'Enter'],[1,'Escape'],[9,'ContextMenu']])if(pad.buttons[n]?.pressed)keys.add(k);
 const [x,y]=pad.axes;if(Math.abs(x)>.65&&Math.abs(x)>Math.abs(y))keys.add(x<0?'ArrowLeft':'ArrowRight');else if(Math.abs(y)>.65)keys.add(y<0?'ArrowUp':'ArrowDown');
 if(!intro.hidden&&keys.size){
  dismissIntro();
  if(keys.has('Enter')||keys.has('Escape')){last=keys;return}
 }
 for(const k of keys){const fresh=!last.has(k);if(!fresh&&(!k.startsWith('Arrow')||performance.now()<repeatAt))continue;
  if(k.startsWith('Arrow'))repeatAt=performance.now()+(fresh?380:140);
  if(!navigate(k)&&k==='Enter')document.activeElement.click();
 }last=keys;
},60);
localize();render();root.classList.add('ready');setInterval(clock,30000);
invoke('epic_folders',{action:'list'}).then(result=>{
 folders=Array.isArray(result)?result:[];if(modal==='settings'&&section==='sources')settingsBody(true);
}).catch(error);
present();
invoke('get_options').then(opts=>{
 if(login!==undefined)return;
 login=opts.login;
 const input=content.querySelector('input[data-control=login]');
 if(input&&!pendingOptions.has('login'))input.checked=login;
}).catch(error);
scan();
