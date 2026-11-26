export const folderKey=path=>path.replaceAll('/','\\').replace(/\\+$/,'').toLowerCase();
export const folderName=path=>path.split(/[\\/]/).filter(Boolean).at(-1)||path;

export function unresolvedFolders(report,rows,links){
 const associated=new Set(rows.filter(g=>g.bucket==='manual'&&g.source==='epic'&&!g.unconfirmed).map(g=>g.id));
 const pending=new Map();
 for(const path of report?.unresolvedEpic||[]){
  const key=folderKey(path);
  if(!associated.has(links[key])&&!pending.has(key))pending.set(key,path);
 }
 return [...pending.values()];
}

export function mergeLinkedShortcuts(rows,report,links){
 const matches=Object.entries(report?.resolvedEpic||{});
 if(!matches.length)return rows;
 const confirmed=new Set(rows.filter(g=>g.bucket==='epic'&&!g.unconfirmed).map(g=>g.id));
 const manual=new Set(rows.filter(g=>g.bucket==='manual'&&g.source==='epic'&&!g.unconfirmed).map(g=>g.id));
 const aliases=new Map(),canonical=new Set(),ambiguous=new Set();
 for(const [path,id] of matches){
  const alias=links[folderKey(path)];
  if(!alias?.startsWith('shortcut:')||!manual.has(alias)||!confirmed.has(id)||manual.has(id))continue;
  if(canonical.has(id))ambiguous.add(id);
  if(aliases.has(alias)){ambiguous.add(id);ambiguous.add(aliases.get(alias))}
  canonical.add(id);aliases.set(alias,id);
 }
 return rows.map(game=>{
  const id=game.bucket==='manual'&&aliases.get(game.id);
  return id&&!ambiguous.has(id)?{...game,id,alias:game.id}:game;
 });
}
