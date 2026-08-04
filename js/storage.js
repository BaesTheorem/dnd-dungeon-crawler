/* IndexedDB-backed key/value store with a synchronous in-memory cache — ported from dnd-character-sheet.
   Open the database WITHOUT a version number (never triggers an upgrade), create stores only when it is
   genuinely new, and guarantee the promise settles come what may (a blocked open must not stall the app).
   Keys: char::<id> (character JSON), run::<charId> (run JSON), prefs (settings JSON). */

const DB_NAME = "dnd-crawler";
const STORE = "kv";

let _idb = null, _idbFailed = false;
function idb(){
  if(_idb) return _idb;
  _idb = new Promise(resolve => {
    let done = false;
    const finish = db => { if(!done){ done = true; if(!db) _idbFailed = true; resolve(db || null); } };
    setTimeout(() => finish(null), 4000);
    if(typeof indexedDB === "undefined"){ finish(null); return; }
    const makeStores = db => { if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
    let req;
    try{ req = indexedDB.open(DB_NAME); }catch(e){ finish(null); return; }
    req.onupgradeneeded = () => { try{ makeStores(req.result); }catch(e){} };   // only fires on a brand-new db
    req.onblocked = () => finish(null);
    req.onerror = () => finish(null);
    req.onsuccess = () => {
      const db = req.result;
      if(db.objectStoreNames.contains(STORE)) return finish(db);
      const next = db.version + 1;
      db.close();
      let up;
      try{ up = indexedDB.open(DB_NAME, next); }catch(e){ return finish(null); }
      up.onupgradeneeded = () => { try{ makeStores(up.result); }catch(e){} };
      up.onsuccess = () => finish(up.result);
      up.onerror = () => finish(null);
      up.onblocked = () => finish(null);
    };
  });
  return _idb;
}

function idbAll(){ return idb().then(db => new Promise(res => {
  if(!db) return res({});
  const out = {}; const tx = db.transaction(STORE,"readonly"); const cur = tx.objectStore(STORE).openCursor();
  cur.onsuccess = e => { const c = e.target.result; if(c){ out[c.key] = c.value; c.continue(); } else res(out); };
  cur.onerror = () => res(out); })).catch(() => ({})); }
function idbPut(key, val){ return idb().then(db => new Promise((res, rej) => {
  if(!db) return res();
  const tx = db.transaction(STORE,"readwrite"); tx.objectStore(STORE).put(val, key);
  tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); })).catch(() => {}); }
function idbDel(key){ return idb().then(db => new Promise(res => {
  if(!db) return res();
  const tx = db.transaction(STORE,"readwrite"); tx.objectStore(STORE).delete(key);
  tx.oncomplete = () => res(); tx.onerror = () => res(); })).catch(() => {}); }

// In-memory cache fronting IndexedDB: reads are synchronous after csInit().
const _cs = new Map();
export function csGet(key){ return _cs.has(key) ? _cs.get(key) : null; }
export function csSet(key, val){ if(val == null) return csDel(key); _cs.set(key, String(val)); idbPut(key, String(val)); }
export function csDel(key){ _cs.delete(key); idbDel(key); }
export function csKeys(prefix){ const ks = [..._cs.keys()]; return prefix ? ks.filter(k => k.startsWith(prefix)) : ks; }
export function storageFailed(){ return _idbFailed; }

export async function csInit(){
  let all = {}; try{ all = await idbAll(); }catch(e){}
  for(const k in all) _cs.set(k, all[k]);
}

// JSON convenience wrappers.
export function getJSON(key, fallback = null){
  const raw = csGet(key);
  if(raw == null) return fallback;
  try{ return JSON.parse(raw); }catch(e){ return fallback; }
}
export function setJSON(key, obj){ csSet(key, JSON.stringify(obj)); }
