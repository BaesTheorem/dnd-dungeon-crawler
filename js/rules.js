/* Core 5e math — constants ported from dnd-character-sheet, plus standard tables. Pure functions only. */

export const ABILITIES = [
  ["str","Strength"],["dex","Dexterity"],["con","Constitution"],
  ["int","Intelligence"],["wis","Wisdom"],["cha","Charisma"]
];
export const SKILLS = [
  ["acrobatics","Acrobatics","dex"],["animal","Animal Handling","wis"],
  ["arcana","Arcana","int"],["athletics","Athletics","str"],
  ["deception","Deception","cha"],["history","History","int"],
  ["insight","Insight","wis"],["intimidation","Intimidation","cha"],
  ["investigation","Investigation","int"],["medicine","Medicine","wis"],
  ["nature","Nature","int"],["perception","Perception","wis"],
  ["performance","Performance","cha"],["persuasion","Persuasion","cha"],
  ["religion","Religion","int"],["sleight","Sleight of Hand","dex"],
  ["stealth","Stealth","dex"],["survival","Survival","wis"]
];
export const ABBR = {str:"Str",dex:"Dex",con:"Con",int:"Int",wis:"Wis",cha:"Cha"};
export const STANDARD_ARRAY = [15,14,13,12,10,8];

export const mod = score => Math.floor((Number(score || 10) - 10) / 2);
export const fmtMod = m => (m >= 0 ? "+" : "") + m;
export const profBonus = level => 2 + Math.floor((Math.max(1, level) - 1) / 4);

/* ---- Ability generation ---- */
// Point buy: 27 points, scores 8–15.
export const POINT_BUY_BUDGET = 27;
const PB_COST = {8:0, 9:1, 10:2, 11:3, 12:4, 13:5, 14:7, 15:9};
export const pointBuyCost = score => PB_COST[score] ?? null;
export function pointBuyTotal(vals){
  let t = 0;
  for(const [k] of ABILITIES){ const c = pointBuyCost(vals[k]); if(c == null) return null; t += c; }
  return t;
}

/* ---- XP & leveling (PHB table) ---- */
export const XP_TABLE = [0,300,900,2700,6500,14000,23000,34000,48000,64000,85000,100000,120000,140000,165000,195000,225000,265000,305000,355000];
export function levelForXP(xp){
  let lvl = 1;
  for(let i=1;i<XP_TABLE.length;i++){ if(xp >= XP_TABLE[i]) lvl = i+1; }
  return Math.min(20, lvl);
}
export function xpForLevel(level){ return XP_TABLE[Math.max(1, Math.min(20, level)) - 1]; }

/* XP award by CR (DMG table). */
export const CR_XP = {"0":10,"1/8":25,"1/4":50,"1/2":100,"1":200,"2":450,"3":700,"4":1100,"5":1800,"6":2300,"7":2900,"8":3900,"9":5000,"10":5900,"11":7200,"12":8400,"13":10000,"14":11500,"15":13000};
export function xpForCR(cr){ return CR_XP[String(cr)] ?? Math.round(200 * Math.max(0.125, Number(cr) || 0)); }

/* ---- Spell slots ---- */
// Full-caster slot table, levels 1–20; each row = slots for spell levels 1..9.
export const FULL_SLOTS = [
  [2],[3],[4,2],[4,3],[4,3,2],[4,3,3],[4,3,3,1],[4,3,3,2],[4,3,3,3,1],[4,3,3,3,2],
  [4,3,3,3,2,1],[4,3,3,3,2,1],[4,3,3,3,2,1,1],[4,3,3,3,2,1,1],[4,3,3,3,2,1,1,1],[4,3,3,3,2,1,1,1],
  [4,3,3,3,2,1,1,1,1],[4,3,3,3,3,1,1,1,1],[4,3,3,3,3,2,1,1,1],[4,3,3,3,3,2,2,1,1]
];
// Warlock pact magic: [slots, slotLevel] by class level.
export const PACT_SLOTS = [[1,1],[2,1],[2,2],[2,2],[2,3],[2,3],[2,4],[2,4],[2,5],[2,5],[3,5],[3,5],[3,5],[3,5],[3,5],[3,5],[4,5],[4,5],[4,5],[4,5]];

/* progression: 'full' | '1/2' | '1/3' | 'pact' | 'artificer' | null.
   Returns {1: n, 2: n, ...} of max slots (empty object for non-casters). */
export function slotsFor(progression, level){
  if(!progression) return {};
  if(progression === "pact"){
    const [n, sl] = PACT_SLOTS[Math.max(1, Math.min(20, level)) - 1];
    return {[sl]: n};
  }
  let eff = level;
  if(progression === "1/2") eff = level === 1 ? 0 : Math.ceil(level / 2);       // PHB half-caster table: no slots at 1, then rounds up
  else if(progression === "artificer") eff = Math.ceil(level / 2);
  else if(progression === "1/3") eff = level <= 2 ? 0 : Math.ceil(level / 3);
  if(eff < 1) return {};
  const row = FULL_SLOTS[Math.max(1, Math.min(20, eff)) - 1];
  const out = {};
  row.forEach((n, i) => { if(n > 0) out[i+1] = n; });
  return out;
}

/* ---- Armor class ----
   type codes from the dataset: LA (light: ac+dex), MA (medium: ac+min(dex,2)), HA (heavy: flat), S (shield +2). */
export function acFrom(armor, hasShield, dexMod, unarmoredBonus = 0){
  let ac;
  if(!armor) ac = 10 + dexMod + unarmoredBonus;
  else if(armor.type === "LA") ac = armor.ac + dexMod;
  else if(armor.type === "MA") ac = armor.ac + Math.min(2, dexMod);
  else ac = armor.ac;                                   // HA and anything flat
  if(hasShield) ac += 2;
  return ac;
}

/* ---- Encounter building (DMG-ish, tuned for a solo hero) ----
   Multiplier for multiple monsters against one PC. */
export function encounterMultiplier(count){
  return count <= 1 ? 1 : count === 2 ? 1.5 : count <= 6 ? 2 : 2.5;
}

/* Average roll of "2d8 + 4"-style formula (for HP). */
export function avgOfFormula(formula){
  const m = /(\d+)\s*[dD](\d+)\s*(?:([+-])\s*(\d+))?/.exec(String(formula || ""));
  if(!m) return null;
  const n = +m[1], d = +m[2], b = m[3] ? (m[3] === "-" ? -1 : 1) * +m[4] : 0;
  return Math.floor(n * (d + 1) / 2 + b);
}

/* Average damage of parseDamageParts output (for monster AI attack ranking). */
export function avgDamage(parts){
  return (parts || []).reduce((a, p) =>
    a + p.dice.reduce((s, g) => s + g.n * (g.d + 1) / 2, 0) + (p.mod || 0), 0);
}
