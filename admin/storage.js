const DB='giraffe-studio-v1';
let connection;
async function db(){
  if(connection)return connection;
  connection=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  return connection;
}
export async function get(key){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('records').objectStore('records').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function put(key,value){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('records','readwrite');tx.objectStore('records').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('저장 공간이 부족합니다.'));});}
export async function saveVersion(version){
  const d=await db();
  return new Promise((resolve,reject)=>{const tx=d.transaction('records','readwrite'),s=tx.objectStore('records'),r=s.get('versions');r.onsuccess=()=>{const list=r.result||[];s.put(version,`version:${version.id}`);s.put([summary(version),...list.filter(v=>v.id!==version.id)],'versions');};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
}
export function summary(v){const {files,renderBlob,bakedBlob,...metadata}=v;return metadata;}
