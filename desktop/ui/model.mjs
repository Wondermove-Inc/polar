export const words = {ko:{},en:{}};
const labels = {
  onlineArt:['온라인 게임 배경','Online game backgrounds'], gameBackground:['게임 배경','Game background'],
  steamTitle:['Steam 게임 이름','Steam game title'], findSteam:['Steam에서 찾기','Find on Steam'],selectEdition:['설치한 게임과 같은 에디션을 선택하세요.','Select the edition you installed.'],
  heroUrl:['SteamGridDB Hero 원본 이미지 주소','SteamGridDB original Hero image URL'], applyHero:['이미지 적용','Apply image'],
  heroOriginal:['SteamGridDB에서 Hero 원본 이미지 주소를 복사하세요.','Copy the original Hero image address from SteamGridDB.'],
  artUnavailable:['고해상도 배경을 불러오지 못했습니다. 연결과 원본 크기(최소 1920×1080)를 확인하세요.','Could not load an HD background. Check your connection and the original dimensions (at least 1920×1080).'],
  resetArt:['기본 배경으로 복원','Restore default background'],
  search:['검색','Search'],gameEdit:['게임 편집','Edit game'],saveName:['이름 저장','Save name'],resetName:['기본 이름으로 복원','Restore default name'],
  cover:['표지','Cover'],chooseCover:['표지 사진 선택','Choose cover image'],resetCover:['기본 표지로 복원','Restore default cover'],
  coverError:['12MB 이하의 JPG, PNG 또는 WebP 사진을 선택하세요.','Choose a JPG, PNG or WebP image up to 12 MB.'],
  savedEdit:['저장했습니다.','Saved.'], moreArtwork:['이미지 주소로 배경 지정','Use a background image URL'],
  previousGame:['이전 게임','Previous game'],nextGame:['다음 게임','Next game'],
  epicFolders:['추가한 Epic Games 폴더','Additional Epic Games folders'],addEpicFolder:['Epic 게임 폴더 추가','Add Epic games folder'],
  removeFolder:['폴더 연결 해제','Remove folder'],epicFolderHelp:['각 드라이브의 Epic Games 폴더를 자동으로 확인합니다. 다른 위치에 설치했다면 게임 폴더나 상위 폴더를 추가하세요.','Polar checks the Epic Games folder on each local drive. For other locations, add a game folder or its parent.'],
  games:['게임','Games'], library:['라이브러리','Library'], settings:['설정','Settings'], play:['플레이','Play'],
  display:['화면·언어','Display & language'], sources:['게임 라이브러리','Game library'], system:['시작·종료','Startup & exit'],
  all:['전체','All'], favorites:['즐겨찾기','Favorites'], edit:['목록 편집','Edit list'], done:['편집 완료','Done editing'],
  add:['게임 추가','Add game'], change:['변경','Change'], remove:['목록에서 제거','Remove from list'], save:['저장','Save'],
  language:['언어','Language'], motion:['움직임 줄이기','Reduce motion'], fullscreen:['전체 화면','Full screen'],
  login:['Windows 로그인 시 시작','Start when I sign in to Windows'], desktop:['바탕 화면으로','Show desktop'], quit:['Polar 종료','Exit Polar'],
  scan:['다시 찾기','Scan again'], scanning:['게임을 찾는 중…','Looking for games…'], ready:['탐색 완료','Scan complete'], partial:['일부 경로를 확인할 수 없습니다','Some locations could not be checked'],
  unconfirmed:['설치 상태 미확인','Installation unconfirmed'], empty:['설치된 게임이 아직 없습니다','No installed games yet'],
  emptyHelp:['설치한 게임을 다시 찾거나 기존 바로가기를 추가하세요.','Scan your libraries or add an existing game shortcut.'],
  noMatches:['이 목록에 게임이 없습니다.','No games in this list.'], manual:['직접 등록','Added by you'],
  shortcut:['바로가기 선택','Choose shortcut'], applications:['Windows 등록 앱','Registered Windows apps'],
  choose:['선택','Select'], close:['닫기','Close'], back:['뒤로','Back'], move:['이동','Move'], lower:['하단 버튼','Lower button'], right:['오른쪽 버튼','Right button'],
  title:['게임 이름','Game title'], platform:['플랫폼','Platform'], appFilter:['앱 이름 검색','Find an app'], cancel:['취소','Cancel'],
  request:['실행 요청 중…','Sending launch request…'], waiting:['원래 런처에서 게임을 여는 중입니다.','Waiting for the game to open.'],
  running:['게임 실행 중','Game running'], ended:['게임이 종료되었습니다.','Game has closed.'],
  unknown:['실행 요청을 보냈습니다. 상태를 확인할 수 없으면 작업 전환으로 돌아오세요.','Launch request sent. If the game cannot be tracked, switch back to Polar when finished.'],
  failed:['실행하지 못했습니다. 설치 상태와 원래 런처를 확인하세요.','Could not launch. Check the installation and its launcher.'],
  busy:['다른 실행 요청을 처리 중입니다.','Another launch is in progress.'], retry:['다시 시도','Try again'], home:['홈으로','Return home'],
  restore:['선택한 바로가기를 라이브러리에서 변경할 수 있습니다.','You can change the shortcut in your library.'],
  failedAction:['작업을 마치지 못했습니다.','The action could not be completed.'], storage:['라이브러리 상태를 이 기기에 저장하지 못했습니다.','Could not save library state on this device.'],
  loading:['불러오는 중…','Loading…'], countOne:['게임 {n}개','{n} game'], countMany:['게임 {n}개','{n} games'],
  recent:['최근 게임','Recent games'], section:['설정 항목','Settings sections'], mainNav:['기본 메뉴','Main navigation'],
  sourceFilter:['플랫폼 필터','Platform filter'], removeConfirm:['이 게임을 Polar 목록에서 제거할까요?','Remove this game from Polar?'],
  localOnly:['목록에서 제거해도 게임 파일은 보존됩니다.','Removing an entry keeps the installed game files.'],
  selectGame:['게임을 선택하세요','Select a game'], manualHelp:['기존 게임 바로가기(.lnk, .url) 또는 Windows에 등록된 앱을 선택하세요.','Choose an existing game shortcut (.lnk, .url) or a registered Windows app.'],
  appsEmpty:['일치하는 앱이 없습니다.','No matching apps.'], diagnostics:['탐색 세부 정보','Scan details'],
  foundEpicFolder:['Epic 게임 설치 폴더를 찾았습니다','Epic game folders found'],
  pendingEpicCount:['바로가기 연결 대기 {n}개','{n} to connect'],
  connectEpic:['Epic 게임 바로가기 연결','Connect Epic Games shortcut'],connectShortcut:['바로가기 연결','Connect shortcut'],
  connectHelp:['게임 폴더에서 실행 정보를 읽지 못했습니다. Epic Games에서 만든 이 게임의 바로가기를 선택하세요.','Polar could not read the launch information from the game folder. Choose the shortcut Epic Games created for this game.'],
  folderChanged:['폴더 상태가 변경되었습니다. 라이브러리에서 다시 선택하세요.','This folder has changed. Select it again in the library.'],
  shortcutInUse:['이 바로가기는 다른 게임 폴더에 연결되어 있습니다.','This shortcut is already connected to another game folder.'],
  epicShortcutOnly:['다른 플랫폼의 바로가기입니다. Epic 게임의 바로가기를 선택하세요.','That shortcut belongs to another platform. Choose this Epic game’s shortcut.'],
  platformOpen:['원래 런처 열기','Open launcher']
};
for(const [key,[ko,en]] of Object.entries(labels)){words.ko[key]=ko;words.en[key]=en}
export function languageFor(tags){return tags.map(tag=>tag.toLowerCase().split('-')[0]).find(tag=>Object.hasOwn(words,tag))||'ko'}
export function mergeSource(previous,source,report){
  const rows=new Map();
  for(const item of previous){
    const bucket=item.bucket??item.source;
    if(bucket!==source)rows.set(bucket+'|'+item.id,item);
    else if(!report.complete)rows.set(bucket+'|'+item.id,{...item,unconfirmed:true});
  }
  for(const item of report.items)rows.set(source+'|'+item.id,{...item,bucket:source,unconfirmed:false});
  return [...rows.values()];
}
export function libraryView(items,filter,favorites,locale='en',names={}){
  const artifacts=new Map();
  for(const game of items){
    if((game.bucket??game.source)!=='epic'||!game.id.startsWith('epic:')||game.unconfirmed)continue;
    const key=game.id.split(':').at(-1);
    if(!artifacts.has(key))artifacts.set(key,game.id);
    else if(artifacts.get(key)!==game.id)artifacts.set(key,null);
  }
  const merged=new Map();
  for(const item of items){
    const canonical=item.id.startsWith('epic-short:')&&artifacts.get(item.id.slice(11));
    const game=canonical?{...item,id:canonical,alias:item.id}:item;
    const prior=merged.get(game.id);
    if(!prior||game.bucket==='manual'||prior.bucket!=='manual')merged.set(game.id,game);
  }
  return [...merged.values()].map(game=>{
    const name=names[game.id]||names[game.alias];
    return typeof name==='string'&&name?{...game,originalName:game.name,name}:game;
  }).filter(item=>filter==='all'||filter===item.source||(filter==='favorites'&&(favorites.includes(item.id)||favorites.includes(item.alias))))
    .sort((a,b)=>a.name.localeCompare(b.name,locale)||a.id.localeCompare(b.id));
}
