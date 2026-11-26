// Keep user artwork separate from the small library/settings cache.
let database;
function openStore(){
 if(!database)database=new Promise((resolve,reject)=>{
  const request=indexedDB.open('polar.artwork',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('covers');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>{database=null;reject(request.error)};
 });
 return database;
}
export async function readCover(id,alias){
 const db=await openStore();
 const read=key=>new Promise((resolve,reject)=>{
  const request=db.transaction('covers').objectStore('covers').get(key);
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 return await read(id)||(alias&&await read(alias));
}
export async function writeCover(id,alias,data){
 const db=await openStore();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('covers','readwrite'),store=tx.objectStore('covers');
  if(alias)store.delete(alias);
  if(data)store.put(data,id);else store.delete(id);
  tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
 });
}
export async function importCover(file){
 if(!file||file.size>12*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('image');
 const bitmap=await createImageBitmap(file);
 try{
  const scale=Math.min(1,900/bitmap.width,1350/bitmap.height);
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/webp',.94);
 }finally{bitmap.close()}
}
