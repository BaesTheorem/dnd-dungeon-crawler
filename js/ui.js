/* Small DOM helpers + shared render pieces (roll cards, HP bars, log). */

export const $ = id => document.getElementById(id);

export function h(tag, attrs = {}, ...children){
  const el = document.createElement(tag);
  for(const k in attrs){
    const v = attrs[k];
    if(k === "class") el.className = v;
    else if(k === "html") el.innerHTML = v;
    else if(k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if(v != null) el.setAttribute(k, v);
  }
  children.flat().forEach(c => { if(c == null) return; el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return el;
}

export function clear(el){ while(el.firstChild) el.removeChild(el.firstChild); return el; }

export function showScreen(id){
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  document.querySelectorAll(".actionbar").forEach(b => b.classList.remove("active"));
  window.scrollTo(0, 0);
}
export function showBar(id){
  document.querySelectorAll(".actionbar").forEach(b => b.classList.toggle("active", b.id === id));
}

/* ---- roll rendering ---- */
export function rollDetail(res){
  if(res.kind === "d20"){
    let s = "d20 " + res.dice[0].v;
    if(res.dice[1]) s += " (dropped " + res.dice[1].v + ")";
    if(res.mod) s += (res.mod > 0 ? " +" : " ") + res.mod;
    if(res.adv) s += res.adv === "adv" ? " · advantage" : " · disadvantage";
    return s;
  }
  return (res.parts || []).map(p => {
    const r = p.rolls.map(x => x.v).join("+") || "";
    const m = p.mod ? ((p.mod > 0 && r ? "+" : "") + p.mod) : "";
    return (p.label ? p.label + " " : "") + r + m + " = " + p.sum;
  }).join("; ");
}

export function rollCard(res){
  const cls = "rollline" + (res.nat === 20 ? " nat20" : res.nat === 1 ? " nat1" : "");
  return h("div", {class: cls},
    h("span", {class:"total"}, res.total),
    h("span", {class:"lbl"}, (res.rt ? res.rt + " · " : "") + res.label),
    h("span", {class:"det"}, rollDetail(res)),
  );
}

/* Transient toast for dice results. */
let toastTimer = null;
export function toastRoll(res){
  let host = $("roll-toast");
  if(!host){ host = h("div", {id:"roll-toast"}); document.body.append(host); }
  const card = h("div", {class:"tcard"}, rollCard(res));
  host.append(card);
  while(host.children.length > 2) host.removeChild(host.firstChild);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => clear(host), 2600);
}

export function hpBarEl(cur, max){
  const pct = max > 0 ? Math.max(0, Math.min(100, 100 * cur / max)) : 0;
  const cls = pct <= 25 ? "fill crit" : pct <= 55 ? "fill hurt" : "fill";
  return h("div", {class:"hpbar"}, h("div", {class:cls, style:`width:${pct}%`}));
}

/* Render engine events into the adventure log, LATEST ACTIVITY ON TOP: each batch is inserted
   as a block above everything older, keeping chronological order inside the batch (an attack
   roll still reads before its damage). Old entries trim off the bottom. */
const LOG_MAX_ENTRIES = 80;
export function renderEvents(logEl, events, { toast = true } = {}){
  const batch = document.createDocumentFragment();
  (events || []).forEach(e => {
    if(e.t === "roll"){
      const cls = "entry roll" + (e.res.nat === 20 || e.res.crit ? " crit" : "");
      batch.append(h("div", {class: cls}, rollCard(e.res)));
      if(toast) toastRoll(e.res);
    } else if(e.t === "log"){
      const hurt = /you take|you die|claims you|collapse/i.test(e.text);
      batch.append(h("div", {class:"entry" + (hurt ? " hurt" : "")}, e.text));
    }
  });
  if(!batch.childNodes.length) return;
  logEl.insertBefore(batch, logEl.firstChild);
  while(logEl.children.length > LOG_MAX_ENTRIES) logEl.removeChild(logEl.lastChild);
}

export function confirmDialog(msg){ return window.confirm(msg); }

/* The adventure log is a stable element that survives screen re-renders: screens re-append it
   wherever it should show; a plain getElementById would lose it while detached. */
let _logEl = null;
export function logEl(){
  if(!_logEl) _logEl = h("div", {id:"combat-log", class:"log"});
  return _logEl;
}
