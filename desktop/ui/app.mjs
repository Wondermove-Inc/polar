import {decodeBackground, homeBackground} from './background.mjs';
import {languageFor, libraryView, mergeSource, words} from './model.mjs';

const $=selector=>document.querySelector(selector);
const invoke=(name,args={})=>window.__TAURI__.core.invoke(name,args);
const root=$('#polar'),panel=$('#panel'),content=$('#content'),rail=$('.rail'),grid=$('.grid');
function fitInterface(){
 const scale=Math.max(1, Math.min(window.innerWidth/1920,window.innerHeight/1080));
 $('#interface').style.zoom=String(scale);
 requestAnimationFrame(()=>{if(!panel.open && !rail.hidden)rail.querySelector('.sel')?.scrollIntoView({block:'nearest',inline:'nearest'})});
}
fitInterface();
window.addEventListener('resize',fitInterface);
const platforms=['steam','xbox','epic','manual'];
const platformNames={steam:'Steam',xbox:'PC Game Pass',epic:'Epic Games'};
const stateKey='polar.desktop.v1';
let saved={};
try{saved=JSON.parse(localStorage.getItem(stateKey)||'{}')||{}}catch{}
let rows=Array.isArray(saved.rows)?saved.rows.filter(g=>g&&typeof g.id==='string'&&typeof g.name==='string'&&platforms.includes(g.source)):[];
let favorites=Array.isArray(saved.favorites)?saved.favorites:[],recent=Array.isArray(saved.recent)?saved.recent:[];
let current=typeof saved.current==='string'?saved.current:'',lang=Object.hasOwn(words,saved.lang)?saved.lang:languageFor(navigator.languages);
let remembered=current;
try{remembered=localStorage.getItem('polar.selected')||current;current=remembered}catch{}
let motion=saved.motion===true,fullscreen=saved.fullscreen!==false,login=false;
let library=false,editing=false,filter='all',section='display',modal='',origin=null;
let games=[],tiles=[],scanning=false,launching=false,phase='idle',launchId='',poll=null,hasPad=false;
let selectedApps=[],draft=null,replaceId=null,firstScan=true,introduced=false;
let folders=[],folderBusy=false;
const reports=new Map(),artCache=new Map();
let onlineArt=saved.onlineArt!==false;
const artSources=Object.assign(Object.create(null),saved.artSources);
const setBackground=homeBackground($('#fade'),invoke);
function background(refresh=false){
 const game=games.find(g=>g.id===current);
 const override=artSources[current]||artSources[game?.alias];
 const source=override||(/^steam:[1-9]\d*$/.test(current)?current:null);
 const active=library||!game?'':current;
 const ambient=$('#ambient'),coverKey=active && coverCacheKey(active);
 if(ambient.dataset.key!==coverKey || refresh){
  ambient.dataset.key=coverKey;
  ambient.style.removeProperty('--cover');
  if(active)coverArt(active).then(image=>{
   if(image && ambient.dataset.key===coverKey)ambient.style.setProperty('--cover','url('+image+')');
  });
 }
 setBackground(library||!game?'':current,source,onlineArt,!!override,refresh);
}
const tr=key=>words[lang][key],platform=src=>platformNames[src]||tr('manual');
const count=n=>tr(n===1?'countOne':'countMany').replace('{n}',new Intl.NumberFormat(lang).format(n));
function persist(){
  try{localStorage.setItem(stateKey,JSON.stringify({rows,favorites,recent,current,lang,motion,fullscreen,onlineArt,artSources}))}
  catch{$('#notice').textContent=tr('storage')}
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
 $('#nav').ariaLabel=tr('mainNav');rail.ariaLabel=tr('recent');$('.filters').ariaLabel=tr('sourceFilter');for(const key of ['previousGame','nextGame'])$('#'+key).ariaLabel=tr(key);clock();hints();
}
function hue(id){let hash=0;for(const ch of id)hash=(hash*31+ch.charCodeAt(0))|0;return String(Math.abs(hash)%360)}
function steamCover(id){
 const link=artSources[id]||artSources[games.find(g=>g.id===id)?.alias];
 return /^steam:[1-9]\d*$/.test(id)?id:link?.startsWith('steam:')?link:null;
}
function coverCacheKey(id){return id+'|'+(steamCover(id)||'')+'|'+onlineArt}
function coverArt(id){
 const key=coverCacheKey(id);
 if(!artCache.has(key)){
  if(artCache.size>=72)artCache.delete(artCache.keys().next().value);
  const source=steamCover(id),online=onlineArt;
  artCache.set(key,(async()=>{
   const local=await invoke('artwork',{id,hero:false}).catch(()=>null);
   if(typeof local==='string'){
    const image=new Image();image.src=local;
    try{await image.decode();return local}catch{}
   }
   if(!source || (online&&!onlineArt))return null;
   const remote=await invoke('online_cover',{id:Number(source.slice(6)),online}).catch(()=>null);
   return typeof remote==='string'?remote:null;
  })());
 }
 return artCache.get(key);
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
 b.dataset.id=game.id;b.title=game.name;b.ariaLabel=game.name+' · '+platform(game.source);b.style.setProperty('--hue',hue(game.id));
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
  if(!library)selected.scrollIntoView({block:'nearest',inline:'nearest'});
 }
 $('#previousGame').disabled=tiles[0]?.id===id;
 $('#nextGame').disabled=tiles.at(-1)?.id===id;
 background();
 $('.counter').textContent=count(games.length);
}
function render(focus=false){
 const active=document.activeElement,focusId=active?.dataset.id,wasRail=rail.contains(active),wasGrid=grid.contains(active);
 observer.disconnect();games=libraryView(rows,'all',favorites,lang);
 if(!games.some(g=>g.id===current))current=games.find(g=>g.alias===current)?.id||games[0]?.id||'';
 const byId=new Map(games.map(g=>[g.id,g]));
 const aliases=new Map(games.filter(g=>g.alias).map(g=>[g.alias,g.id]));
 const ordered=[...new Set([...recent.map(id=>aliases.get(id)||id),...byId.keys()])].map(id=>byId.get(id)).filter(Boolean);
 tiles=ordered;
 root.classList.toggle('libOn',library);root.classList.toggle('noMotion',motion);
 for(const [id,on] of [['#library',library],['#home',!library]]){if(on)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current')}
 $('#shelf').hidden=rail.hidden=library||!games.length;$('#stage').hidden=library;$('.lib').hidden=!library;
 $('.details').hidden=!games.length;$('#homeEmpty').hidden=!!games.length||firstScan;$('#homeLoading').hidden=!!games.length||!firstScan;
 if(!introduced&&(games.length||!firstScan)){
  introduced=true;root.classList.add('entering');setTimeout(()=>root.classList.remove('entering'),650);
 }
 rail.replaceChildren(...tiles.map(g=>tile(g,true)));
 if(current)select(current,!library&&!panel.open&&(focus||wasRail));
 if(!games.length){background();$('.counter').textContent=count(0)}
 if(library){
  $('.filters').replaceChildren(...['all','steam','xbox','epic','favorites'].map(k=>{
   const b=button(platformNames[k]||tr(k),()=>{editing=false;filter=k;render();[...$('.filters').children].find(x=>x.dataset.key===k)?.focus()},'filter');
   b.dataset.key=k;b.setAttribute('aria-pressed',String(filter===k));return b;
  }));
  $('#edit').hidden=filter!=='favorites';$('#edit').textContent=tr(editing?'done':'edit');
  const list=libraryView(rows,editing?'all':filter,favorites,lang);grid.replaceChildren(...list.map(g=>tile(g,false)));
  $('.empty').hidden=!!list.length;$('.counter').textContent=count(list.length);
  if(wasGrid&&!panel.open)([...grid.children].find(b=>b.dataset.id===focusId)||grid.firstElementChild||$('#addLib')).focus();
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

async function loadSource(source){
 let report;
 try{report=await invoke('discover',{source})}catch(e){report={complete:false,warnings:[String(e)],items:[]}}
 reports.set(source,report);rows=mergeSource(rows,source,report);for(const item of report.items)artCache.delete(coverCacheKey(item.id));render();if(rows.some(g=>g.id===current&&(g.bucket??g.source)===source))background(true);persist();
 if(modal==='settings'&&section==='sources')settingsBody(true);
}
async function scan(){
 if(scanning)return;scanning=true;
 if(modal==='settings'&&section==='sources')settingsBody(true);
 try{await Promise.all(platforms.map(loadSource))}finally{scanning=false;firstScan=false;render();if(modal==='settings'&&section==='sources')settingsBody(true)}
}
$('#scanEmpty').onclick=scan;
function open(mode,title){
 if(!panel.open){origin=document.activeElement;panel.showModal()}
 modal=mode;$('#panelTitle').textContent=title;$('#alert').textContent='';content.replaceChildren();
 $('#close').textContent=tr('close');panel.scrollTop=0;
}
function close(){
 if(!panel.open)return;panel.close();modal='';
 if(!library&&current&&(launchId===current||!origin?.isConnected)){select(current,true)}
 else if(origin?.isConnected)origin.focus();else (library?$('#library'):$('#home')).focus();
}
$('#close').onclick=close;panel.addEventListener('cancel',e=>{e.preventDefault();close()});
function prefRow(label,control){const r=el('label','','settingRow');r.append(el('span',label),control);return r}
function toggle(value,set){
 const input=document.createElement('input');input.type='checkbox';input.checked=value;
 input.onchange=async()=>{input.disabled=true;try{await set(input.checked)}catch(e){input.checked=!input.checked;error(e)}finally{input.disabled=false;input.focus()}};return input;
}
async function nativeAction(action,enabled=false){return invoke('window_action',{action,enabled})}
function settingsBody(keep=false){
 const key=keep?document.activeElement?.dataset.control:null;
 content.replaceChildren();const prefs=el('div');prefs.id='preferences';const nav=el('div','','categories');nav.ariaLabel=tr('section');
 for(const k of ['display','sources','system']){const b=button(tr(k),()=>{section=k;settingsBody();content.querySelector('.categories [aria-pressed=true]').focus()},'');
  b.dataset.control=k;b.setAttribute('aria-pressed',String(section===k));nav.append(b)}
 const body=el('section','','settingGroup');body.append(el('h3',tr(section)));prefs.append(nav,body);content.append(prefs);
 if(section==='display'){
  const languages=el('div','','languages');
  for(const [code,name] of [['ko','한국어'],['en','English']]){
    const b=button(name,()=>{lang=code;persist();localize();render();$('#panelTitle').textContent=tr('settings');settingsBody();content.querySelector('[lang='+code+']').focus()},'');
    b.lang=code;b.setAttribute('aria-pressed',String(lang===code));languages.append(b);
  }
  const row=el('div','','languageRow');row.append(el('span',tr('language')),languages);body.append(row,
   prefRow(tr('motion'),toggle(motion,v=>{motion=v;root.classList.toggle('noMotion',v);persist()})),
   prefRow(tr('fullscreen'),toggle(fullscreen,async v=>{await nativeAction('fullscreen',v);fullscreen=v;persist()})));
  const onlineToggle=toggle(onlineArt,v=>{onlineArt=v;persist();render();settingsBody(true)});
  onlineToggle.dataset.control='onlineArt';body.append(prefRow(tr('onlineArt'),onlineToggle));
  const game=games.find(g=>g.id===current);
  if(game)backgroundSettings(body,game);
 }else if(section==='sources'){
  for(const s of platforms){
   const report=reports.get(s);const r=el('div','','scanRow');
   r.append(el('span',platform(s)),el('span',count(rows.filter(x=>(x.bucket??x.source)===s).length)+' · '+tr(!report?'scanning':report.complete?'ready':'partial')));body.append(r);
   if(report?.warnings.length){const d=el('details'),summary=el('summary',tr('diagnostics'));d.append(summary,el('div',report.warnings.join('\n'),'faults'));body.append(d)}
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
   remove.disabled=folderBusy||scanning;remove.ariaLabel=tr('removeFolder')+' · '+path;row.append(el('span',path),remove);body.append(row);
  }
  const addFolder=button(tr('addEpicFolder'),()=>changeFolder('add'));
  addFolder.dataset.control='addEpicFolder';addFolder.disabled=folderBusy||scanning;body.append(addFolder);
  const scanBtn=button(tr(scanning?'scanning':'scan'),scan);scanBtn.dataset.control='scan';scanBtn.disabled=scanning;
  body.append(scanBtn,button(tr('add'),()=>addDialog()));
  for(const m of rows.filter(x=>x.bucket==='manual')){
   const r=el('div','','settingRow');r.append(el('span',m.name),button(tr('change'),()=>addDialog(m.id)),button(tr('remove'),()=>removeDialog(m)));body.append(r);
  }
 }else{
  body.append(prefRow(tr('login'),toggle(login,async v=>{await nativeAction('login',v);login=v})));
  const buttons=el('div','','buttons');for(const k of ['desktop','quit'])buttons.append(button(tr(k),()=>nativeAction(k).catch(error)));body.append(buttons);
 }
 if(key)content.querySelector('[data-control="'+CSS.escape(key)+'"]')?.focus();
}
function backgroundSettings(body,game){
 const group=el('section','','backgroundSettings'), results=el('div','','appList');
 const status=el('p','','note');status.setAttribute('role','status');
 const field=el('label',tr('heroUrl'),'field'),input=document.createElement('input');
 input.type='url';input.placeholder='https://cdn2.steamgriddb.com/hero/…';field.append(input);
 const searchField=el('label',tr('steamTitle'),'field'),query=document.createElement('input');
 query.type='text';query.maxLength=180;query.value=game.name;searchField.append(query);
 group.append(el('h3',tr('gameBackground')+' · '+game.name),searchField);body.append(group);
 const actions=el('div','','buttons');
 const find=button(tr('findSteam'),async()=>{
  find.disabled=true;results.replaceChildren();status.textContent=tr('loading');
  try{
   const hits=await invoke('search_backgrounds',{title:query.value.trim(),lang});
   if(!group.isConnected)return;
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
   if(!group.isConnected||!panel.open||current!==game.id)return;
   if(!image){status.textContent=tr('artUnavailable');return}
   if(game.alias)delete artSources[game.alias];artSources[game.id]=source;
   persist();render();settingsBody();
   content.querySelector('[data-control="resetArt"]')?.focus();
  }catch{status.textContent=tr('artUnavailable')}finally{group.inert=false}
 }
 find.disabled=!onlineArt;apply.disabled=!onlineArt;
 group.append(find,results,field);actions.append(apply);group.append(actions,status);
 if(artSources[game.id]||artSources[game.alias]){
  const reset=button(tr('resetArt'),()=>{
   delete artSources[game.id];if(game.alias)delete artSources[game.alias];
   persist();render();settingsBody();content.querySelector('[data-control="findArt"]')?.focus();
  });reset.dataset.control='resetArt';actions.append(reset);
 }
 find.dataset.control='findArt';
}
$('#settings').onclick=()=>{open('settings',tr('settings'));settingsBody();content.querySelector('.categories [aria-pressed=true]').focus()};
function removeDialog(m){
 open('remove',tr('removeConfirm'));content.append(el('p',m.name),el('p',tr('localOnly')),button(tr('remove'),async()=>{
  try{await invoke('remove_manual',{id:m.id});await loadSource('manual');open('settings',tr('settings'));settingsBody();$('#close').focus()}catch(e){error(e)}
 }));
 $('#close').focus();
}
function addDialog(previous=null){
 open('add',tr(previous?'change':'add'));replaceId=previous;draft=null;selectedApps=[];
 content.append(el('p',tr('manualHelp'),'note'));
 const actions=el('div','','buttons'),picker=button(tr('shortcut'),async()=>{
  try{const row=await invoke('pick_shortcut');if(row&&modal==='add'){draft={kind:'shortcut',id:row.id,name:row.name};manualForm()}}catch(e){error(e)}
 });
 const apps=button(tr('applications'),async()=>{
  apps.disabled=true;try{selectedApps=await invoke('registered_apps');if(modal==='add')appsList()}catch(e){error(e)}finally{apps.disabled=false}
 });actions.append(picker,apps);content.append(actions);picker.focus();
}
function appsList(){
 content.replaceChildren();const search=document.createElement('input');search.id='search';search.ariaLabel=tr('appFilter');search.placeholder=tr('appFilter');
 const list=el('div','','appList');content.append(search,list);
 function draw(){const match=selectedApps.filter(x=>x.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
 list.replaceChildren(...match.map(x=>button(x.name,()=>{draft={kind:'app',id:x.id,name:x.name};manualForm()},'')));if(!match.length)list.textContent=tr('appsEmpty')}
 search.oninput=draw;draw();search.focus();
}
function manualForm(){
 const old=rows.find(g=>g.id===replaceId&&g.bucket==='manual');content.replaceChildren();
 const name=document.createElement('input');name.value=old?.name||draft.name;name.maxLength=180;
 const src=document.createElement('select');for(const s of platforms){const o=el('option',platform(s));o.value=s;src.append(o)}
 src.value=old?.source||({app:'xbox'}[draft.kind])||platforms.find(s=>draft.id.startsWith(s+':'))||'manual';
 const nameRow=el('label',tr('title'),'field'),srcRow=el('label',tr('platform'),'field');nameRow.append(name);srcRow.append(src);
 const save=button(tr('save'),async()=>{
  save.disabled=true;try{await invoke('save_manual',{...draft,name:name.value,source:src.value,previous:replaceId});await loadSource('manual');close()}
  catch(e){error(e)}finally{save.disabled=false}
 });content.append(nameRow,srcRow,save);name.focus();
}
$('#addEmpty').onclick=$('#addLib').onclick=()=>addDialog();
function launchView(){
 if(modal!=='launch')return;
 const game=games.find(g=>g.id===launchId);
 $('#panelTitle').textContent=game?.name||tr('play');content.replaceChildren(el('p',tr(phase),'note'));
 if(phase==='failed'||phase==='unknown'){content.append(button(tr('retry'),()=>launch(launchId)));
  if(game&&platforms.slice(0,3).includes(game.source))content.append(button(tr('platformOpen'),()=>invoke('open_platform',{source:game.source}).catch(error)));
 }
 $('#close').textContent=tr('home');
}
async function pollSession(){
 try{const s=await invoke('get_session');if(s.id&&s.id!==launchId)return;
  if(s.phase==='ended'){phase='ended';if(modal==='launch')close();stopPoll()}
  else if(['waiting','running','unknown','failed'].includes(s.phase)){if(phase!==s.phase){phase=s.phase;launchView()}if(['unknown','failed'].includes(phase))stopPoll()}
 }catch(e){stopPoll();phase='unknown';launchView();error(e)}
}
function stopPoll(){clearInterval(poll);poll=null}
async function launch(id=current){
 if(!id)return;
 if(launching||poll){if(!panel.open){open('launch',tr('play'));launchView();$('#close').focus()}return}
 launchId=id;phase='request';launching=true;open('launch',tr('play'));launchView();$('#close').focus();
 try{
  await invoke('launch_game',{id});recent=[id,...recent.filter(x=>x!==id)].slice(0,100);persist();
  phase='waiting';launchView();poll=setInterval(pollSession,800);await pollSession();
 }catch(e){phase=String(e)==='busy'?'busy':'failed';launchView();error(e)}
 finally{launching=false}
}
$('#play').onclick=()=>launch();
window.addEventListener('focus',()=>{if(modal==='launch')pollSession();else if(!modal&&!library&&current)select(current,true)});
function navigate(key){
 const active=document.activeElement;
 if(key==='Escape'){if(panel.open)close();else switchPage(false);return true}
 if(active.matches('input:not([type=checkbox]),select')&&!['Escape','ArrowDown'].includes(key))return false;
 if(!panel.open&&!library&&current&&((active===$('#play')&&key==='ArrowUp')||(active===$('#home')&&key==='ArrowDown'))){select(current,true);return true}
 if(!panel.open&&!library&&(rail.contains(active)||active===document.body)&&current){
  if(['ArrowLeft','ArrowRight'].includes(key)){step(key==='ArrowLeft'?-1:1);return true}
  if(key==='Enter'){launch();return true}
  if(key==='ArrowUp'||key==='ArrowDown'){$(key==='ArrowUp'?'#home':'#play').focus();return true}
 }
 if(!key.startsWith('Arrow'))return false;
 const controls=[...(panel.open?panel:root).querySelectorAll('button:not(:disabled),input:not(:disabled),select,summary')].filter(b=>b.offsetWidth&&b.tabIndex>=0);
 const r=active.getBoundingClientRect();const h=['ArrowLeft','ArrowRight'].includes(key),sign=['ArrowUp','ArrowLeft'].includes(key)?-1:1;
 let best,score=Infinity;
 for(const b of controls){if(b===active)continue;const t=b.getBoundingClientRect();
  const dx=t.left+t.width/2-r.left-r.width/2,dy=t.top+t.height/2-r.top-r.height/2,along=sign*(h?dx:dy),across=Math.abs(h?dy:dx);
  if(along<3||across>along*2)continue;if(along+across*4<score){score=along+across*4;best=b}}
 if(best){best.focus();return true}return false;
}
document.addEventListener('keydown',e=>{if(e.repeat&&e.key==='Enter'){e.preventDefault();return}if(navigate(e.key))e.preventDefault()});
let last=new Set(),repeatAt=0;
setInterval(()=>{
 if(document.hidden||!document.hasFocus()){last.clear();return}
 let pad;try{pad=Array.from(navigator.getGamepads?.()||[]).find(p=>p?.mapping==='standard')}catch{return}
 if(hasPad!==!!pad){hasPad=!!pad;hints()}if(!pad){last.clear();return}
 const keys=new Set();for(const [n,k] of [[12,'ArrowUp'],[13,'ArrowDown'],[14,'ArrowLeft'],[15,'ArrowRight'],[0,'Enter'],[1,'Escape']])if(pad.buttons[n]?.pressed)keys.add(k);
 const [x,y]=pad.axes;if(Math.abs(x)>.65&&Math.abs(x)>Math.abs(y))keys.add(x<0?'ArrowLeft':'ArrowRight');else if(Math.abs(y)>.65)keys.add(y<0?'ArrowUp':'ArrowDown');
 for(const k of keys){const fresh=!last.has(k);if(!fresh&&(!k.startsWith('Arrow')||performance.now()<repeatAt))continue;
  if(k.startsWith('Arrow'))repeatAt=performance.now()+(fresh?380:140);
  if(!navigate(k)&&k==='Enter')document.activeElement.click();
 }last=keys;
},60);
localize();render();root.classList.add('ready');setInterval(clock,30000);
invoke('epic_folders',{action:'list'}).then(result=>{
 folders=Array.isArray(result)?result:[];if(modal==='settings'&&section==='sources')settingsBody(true);
}).catch(error);
nativeAction('present',fullscreen).catch(error);
invoke('get_options').then(opts=>{login=opts.login;if(modal==='settings')settingsBody()}).catch(error);
scan();
