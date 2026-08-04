/* Dice engine — ported from dnd-character-sheet.
   Results are pure data; UI renders them as roll cards. No DOM in here. */

export const DMG_TYPES = /\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\b/i;

// Unbiased 1..sides die using crypto.getRandomValues with rejection sampling (no modulo bias); Math.random fallback.
const cryptoObj = (typeof globalThis !== "undefined" && globalThis.crypto) || null;
export function rollDie(sides){
  if(cryptoObj && cryptoObj.getRandomValues){
    const max = 256 - (256 % sides);                 // largest multiple of `sides` ≤ 256 — reject the rest
    const buf = new Uint8Array(1);
    let x; do { cryptoObj.getRandomValues(buf); x = buf[0]; } while(x >= max);
    return 1 + (x % sides);
  }
  return 1 + Math.floor(Math.random() * sides);
}

// 4d6 drop lowest, six times, sorted high→low.
export function rollAbilityScores(){
  const set = [];
  for(let i=0;i<6;i++){ const d = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)].sort((a,b)=>a-b); set.push(d[1]+d[2]+d[3]); }
  return set.sort((a,b)=>b-a);
}

/* Damage-string parser: "1d8+3 slashing, range 30/120; Sneak Attack +2d6" →
   [{label:"slashing",type:"slashing",dice:[{n:1,d:8}],mod:3},{label:"Sneak Attack",dice:[{n:2,d:6}],mod:0}].
   Versatile/two-handed alternates in parentheses are ignored. */
export function parseDamageParts(str){
  const out = [];
  const s0 = String(str || "").replace(/\([^)]*(?:versatile|two-handed)[^)]*\)/gi, " ");
  s0.split(/[;,]/).forEach(seg => {
    const s = seg.trim(); if(!s) return;
    const dice = []; let m; const re = /(\d+)\s*[dD](\d+)/g;
    while((m = re.exec(s))) dice.push({n:+m[1], d:+m[2]});
    let mod = 0; const mre = /([+-])\s*(\d+)(?!\s*[dD]\d)(?!\d)/g; let mm;
    while((mm = mre.exec(s))) mod += (mm[1] === "-" ? -1 : 1) * +mm[2];
    const ty = DMG_TYPES.exec(s);
    if(!dice.length){                                 // no dice: keep a flat "3 bludgeoning" part, skip "range 30/120" etc.
      const flat = /^\s*(\d+)\s*(?:[a-z]|$)/i.exec(s);
      if(!(flat && ty)) return;
      mod = +flat[1];
    }
    const lbl = s.replace(re, " ").replace(/([+-])\s*\d+/g, " ").replace(DMG_TYPES, " ")
                 .replace(/\s+/g, " ").replace(/^[\s:+\-·]+|[\s:+\-·]+$/g, "");
    out.push({ label: lbl || (ty ? ty[1].toLowerCase() : ""), type: ty ? ty[1].toLowerCase() : "", dice, mod });
  });
  return out;
}

/* d20 roll. adv: 'adv' | 'disadv' | null. Returns
   {kind:'d20', rt, label, mod, dice:[{d:20,v},(dropped)], adv, total, nat} */
export function d20Roll(o){
  const adv = o.adv || null;
  const r1 = rollDie(20), r2 = adv ? rollDie(20) : null;
  let kept = r1, dropped = null;
  if(adv){ const hi = Math.max(r1, r2), lo = Math.min(r1, r2); kept = adv === "adv" ? hi : lo; dropped = adv === "adv" ? lo : hi; }
  return { kind:"d20", rt:o.rollType || "Roll", label:o.label || "", mod:o.mod || 0,
    dice:[{d:20, v:kept}].concat(dropped != null ? [{d:20, v:dropped, dropped:true}] : []),
    adv, total: kept + (o.mod || 0), nat: kept === 20 ? 20 : (kept === 1 ? 1 : null) };
}

/* Damage roll over parseDamageParts output. crit doubles dice, never modifiers. */
export function damageRoll(o){
  const parts = (o.parts || []).map(p => {
    const rolls = [];
    (p.dice || []).forEach(g => { const n = o.crit ? g.n * 2 : g.n; for(let j = 0; j < n; j++) rolls.push({d:g.d, v:rollDie(g.d)}); });
    return { label:p.label, type:p.type, rolls, mod:p.mod || 0, sum: rolls.reduce((a, r) => a + r.v, 0) + (p.mod || 0) };
  });
  return { kind:"dmg", rt:o.rollType || "Damage", label:(o.label || "") + (o.crit ? " — critical hit!" : ""), parts,
    total: parts.reduce((a, p) => a + p.sum, 0), crit: !!o.crit };
}

export function plainRoll(n, d, mod = 0, label){
  n = Math.max(1, Math.min(40, n|0) || 1);
  return damageRoll({ label: label || (n + "d" + d + (mod ? (mod > 0 ? "+" + mod : mod) : "")), rollType:"Manual",
    parts:[{label:"", type:"", dice:[{n, d}], mod}] });
}

// "2d8+4" / "1d6" / "7" → parts for damageRoll
export function parseDiceExpr(s){
  const m = /^\s*(?:(\d+)\s*[dD](\d+))?\s*([+-]\s*\d+)?\s*$/.exec(String(s || ""));
  if(!m) return null;
  const dice = m[1] ? [{n:+m[1], d:+m[2]}] : [];
  const mod = m[3] ? +m[3].replace(/\s+/g, "") : 0;
  if(!dice.length && !m[3]) return null;
  return [{label:"", type:"", dice, mod}];
}
