/* App state: roster + active run, autosave (debounced, donor pattern). */

import { csInit, csKeys, getJSON, setJSON, csDel } from "./storage.js";

export const S = { chars: [], current: null, run: null };

export async function initState(){
  await csInit();
  S.chars = csKeys("char::").map(k => getJSON(k)).filter(Boolean)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

let saveTimer = null;
export function queueSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
export function saveNow(){
  clearTimeout(saveTimer);
  if(S.current){
    S.current.savedAt = Date.now();
    setJSON("char::" + S.current.id, S.current);
    const i = S.chars.findIndex(c => c.id === S.current.id);
    if(i >= 0) S.chars[i] = S.current; else S.chars.unshift(S.current);
  }
  if(S.run) setJSON("run::" + S.run.charId, S.run);
}

export function deleteCharacter(id){
  csDel("char::" + id);
  csDel("run::" + id);
  S.chars = S.chars.filter(c => c.id !== id);
  if(S.current && S.current.id === id){ S.current = null; S.run = null; }
}

export function loadRun(charId){ return getJSON("run::" + charId, null); }
export function clearRun(charId){ csDel("run::" + charId); if(S.run && S.run.charId === charId) S.run = null; }
