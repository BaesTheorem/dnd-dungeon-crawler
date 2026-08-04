/* Loader + indexes over the baked 5e dataset (data/source-data.json, extracted from dnd-character-sheet).
   Everything game-mechanical the engine needs is derived here: monster attack parsing, spell mechanics,
   equipment filtering. The raw blob is fetched once at boot behind the loading screen. */

import { parseDamageParts, DMG_TYPES } from "../js/dice.js";

export let DATA = null;                 // the raw parsed blob
let _indexes = null;

export async function loadData(url = "./data/source-data.json"){
  if(DATA) return DATA;
  const res = await fetch(url);
  if(!res.ok) throw new Error("data fetch failed: " + res.status);
  DATA = await res.json();
  buildIndexes();
  return DATA;
}

/* Test seam: inject an already-parsed blob (Node tests read the JSON from disk). */
export function injectData(blob){ DATA = blob; buildIndexes(); }

export function idx(){ return _indexes; }

const NONSTANDARD_GEAR = () => new Set([...(DATA.modern||[]), ...(DATA.futuristic||[]), ...(DATA.renaissance||[])].map(n => n.toLowerCase()));
const STANDARD_ARMOR = new Set(["padded armor","leather armor","studded leather armor","hide armor","chain shirt","scale mail","breastplate","half plate armor","ring mail","chain mail","splint armor","plate armor","shield",
  "padded","leather","studded leather","hide","half plate","splint","plate"]);

function buildIndexes(){
  const spellByName = new Map();
  DATA.spells.forEach(s => spellByName.set(s.name.toLowerCase(), s));
  const attackSpells = new Set((DATA.attackSpells || []).map(n => n.toLowerCase()));
  const nonstd = NONSTANDARD_GEAR();
  const weapons = (DATA.weapons || []).filter(w => !nonstd.has(w.name.toLowerCase()));
  const armor = (DATA.armor || []).filter(a => STANDARD_ARMOR.has(a.name.toLowerCase()));
  const weaponByName = new Map(weapons.map(w => [w.name.toLowerCase(), w]));
  const armorByName = new Map(armor.map(a => [a.name.toLowerCase(), a]));
  // Builder classes: playable PC classes only (sidekicks are NPC frames).
  const classes = (DATA.classes || []).filter(c => !/sidekick/i.test(c.name));
  const classByName = new Map(classes.map(c => [c.name.toLowerCase(), c]));
  const raceByName = new Map((DATA.races || []).map(r => [r.name.toLowerCase(), r]));
  const bgByName = new Map((DATA.backgrounds || []).map(b => [b.name.toLowerCase(), b]));
  // Combat-usable monsters: has a parseable attack, sane CR.
  const monsters = (DATA.monsters || []).filter(m => m.crNum != null && monsterAttacks(m).length > 0);
  const monsterByName = new Map(monsters.map(m => [m.name.toLowerCase(), m]));
  _indexes = { spellByName, attackSpells, weapons, armor, weaponByName, armorByName,
    classes, classByName, raceByName, bgByName, monsters, monsterByName };
}

/* ---- Monsters ---- */
export function monstersInBand(minCR, maxCR){
  return _indexes.monsters.filter(m => m.crNum >= minCR && m.crNum <= maxCR);
}
export function getMonster(name){ return _indexes.monsterByName.get(String(name).toLowerCase()) || null; }

/* Parse a monster's attack actions from stat-block text.
   "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage." →
   {name, toHit:4, parts:[{dice,mod,type,label}], recharge:null}
   Save-based actions: "DC 13 Dexterity saving throw, taking 14 (4d6) fire damage ... half as much" →
   {name, save:{abil:'dex', dc:13}, parts, halfOnSave, condition} */
export function monsterAttacks(mon){
  if(mon._attacks) return mon._attacks;
  const out = [];
  (mon.actions || []).forEach(a => {
    if(!a || !a.text || /^multiattack$/i.test(a.name || "")) return;
    const text = a.text;
    const recharge = /\(recharge (\d)(?:[–-]\d)?\)/i.exec(a.name || "");
    const toHit = /([+-]\d+)\s+to hit/.exec(text);
    const save = /DC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i.exec(text);
    // All "N (dice) type damage" clauses (covers "plus 7 (2d6) fire damage" riders).
    const parts = [];
    const re = /(\d+)\s*\(([^)]+)\)\s+(\w+)\s+damage/g; let m;
    while((m = re.exec(text))){
      const p = parseDamageParts(m[2] + " " + m[3]);
      p.forEach(x => parts.push(x));
    }
    if(!parts.length){                                  // flat damage: "Hit: 1 piercing damage."
      const flat = /Hit:\s*(\d+)\s+(\w+)\s+damage/.exec(text);
      if(flat) parts.push({label:flat[2], type:flat[2].toLowerCase(), dice:[], mod:+flat[1]});
    }
    const condM = /(?:is|be(?:comes)?)\s+(blinded|charmed|deafened|frightened|grappled|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious)/i.exec(text);
    if(toHit && parts.length){
      out.push({ name:a.name, toHit:+toHit[1], parts, recharge: recharge ? +recharge[1] : null,
        condition: condM ? condM[1].toLowerCase() : null, condSave: condM && save ? {abil: save[2].slice(0,3).toLowerCase(), dc:+save[1]} : null });
    } else if(save && parts.length){
      out.push({ name:a.name, save:{abil: save[2].slice(0,3).toLowerCase(), dc:+save[1]}, parts,
        halfOnSave:/half as much/i.test(text), recharge: recharge ? +recharge[1] : null,
        condition: condM ? condM[1].toLowerCase() : null });
    }
  });
  try{ Object.defineProperty(mon, "_attacks", {value: out, enumerable:false}); }catch(e){}
  return out;
}
export function monsterHasMultiattack(mon){ return (mon.actions || []).some(a => /^multiattack$/i.test(a.name || "")); }

/* ---- Spells ---- */
export function getSpell(name){ return _indexes.spellByName.get(String(name).toLowerCase()) || null; }
export function classSpellList(className){
  const list = (DATA.classSpells || {})[className] || [];
  return list.map(e => ({ name: e.n, level: e.l, spell: getSpell(e.n) })).filter(e => e.spell);
}

/* ---- Scrolls ---- */
export function classListHas(className, spellName){
  const list = (DATA.classSpells || {})[className] || [];
  const lc = String(spellName).toLowerCase();
  return list.some(e => e.n.toLowerCase() === lc);
}
/* All spells that appear on ANY class list within a level band — the loot/shop scroll pool. */
export function scrollPool(minL, maxL){
  const seen = new Map();
  for(const cls in (DATA.classSpells || {})){
    (DATA.classSpells[cls] || []).forEach(e => {
      if(e.l < minL || e.l > maxL) return;
      if(!seen.has(e.n) && getSpell(e.n)) seen.set(e.n, e.l);
    });
  }
  return [...seen.entries()].map(([name, level]) => ({ name, level }));
}
export const scrollSpellName = itemName => (/^scroll of (.+)$/i.exec(String(itemName)) || [])[1] || null;

/* Hand-encoded buffs the engine automates (small on purpose). */
export const BUFF_SPELLS = {
  "bless":            { buff:"bless", label:"Bless (+1d4 attacks & saves)" },
  "shield of faith":  { buff:"acBonus", amount:2, label:"Shield of Faith (+2 AC)" },
  "mage armor":       { buff:"mageArmor", label:"Mage Armor (AC 13 + Dex)" },
  "barkskin":         { buff:"acFloor", amount:16, label:"Barkskin (AC min 16)" },
  "heroism":          { buff:"heroism", label:"Heroism (temp HP each turn)" },
};

/* Derive what the engine can automate for a spell.
   kind: 'attack' | 'save' | 'heal' | 'buff' | 'utility'  */
export function spellMechanics(name, charLevel = 1){
  const s = getSpell(name); if(!s) return null;
  const key = s.name.toLowerCase();
  const buff = BUFF_SPELLS[key];
  if(buff) return { kind:"buff", spell:s, ...buff };
  const heal = /regains?\s+(?:a number of\s+)?hit points equal to\s+(\d+d\d+)(\s*\+\s*your spellcasting ability modifier)?/i.exec(s.text || "");
  if(heal){
    const [n, d] = heal[1].split("d").map(Number);
    return { kind:"heal", spell:s, heal:{dice:[{n, d}], addMod: !!heal[2]}, upcast: upcastInfo(s) };
  }
  if(key === "magic missile")                             // three unerring darts, +1 per slot level above 1st
    return { kind:"autohit", spell:s, missile:true };
  const dmgParts = spellDamageParts(s, charLevel);
  const save = /must\s+(?:make|succeed on)\s+a\s+(?:DC\s*\d+\s+)?(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i.exec(s.text || "");
  const condM = /(?:is|be(?:comes)?)\s+(blinded|charmed|deafened|frightened|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious)/i.exec(s.text || "");
  if(_indexes.attackSpells.has(key) && dmgParts)
    return { kind:"attack", spell:s, parts:dmgParts, upcast: upcastInfo(s) };
  if(save && (dmgParts || condM))
    return { kind:"save", spell:s, save: save[1].slice(0,3).toLowerCase(), parts:dmgParts || null,
      halfOnSave:/half as much/i.test(s.text || ""), condition: condM ? condM[1].toLowerCase() : null,
      conc: !!s.conc, upcast: upcastInfo(s) };
  // Damaging, no attack roll, no save (Magic Missile's cousins): the spell simply hits.
  if(dmgParts) return { kind:"autohit", spell:s, parts:dmgParts, upcast: upcastInfo(s) };
  return { kind:"utility", spell:s };
}

function spellDamageParts(s, charLevel){
  if(!s.dmg) return null;
  let dice = s.dmg.dice;
  if(!dice && s.dmg.scale){                          // cantrip scaling by character level
    let best = null;
    Object.keys(s.dmg.scale).map(Number).sort((a,b)=>a-b).forEach(t => { if(charLevel >= t) best = s.dmg.scale[t]; });
    dice = best;
  }
  if(!dice) return null;
  const parts = parseDamageParts(dice + " " + (s.dmg.type || ""));
  return parts.length ? parts : null;
}

function upcastInfo(s){
  const rec = (DATA.spellUpcast || {})[s.name];
  if(rec) return { up: rec.up, at: rec.at ?? s.level };
  const m = /(?:damage|healing)\s+increases by\s+(\d+d\d+)\s+for each slot level/i.exec(s.higher || "");
  if(m) return { up: m[1], at: s.level };
  return null;
}

/* ---- Equipment ---- */
export function getWeapon(name){ return _indexes.weaponByName.get(String(name).toLowerCase()) || null; }
export function getArmor(name){
  const key = String(name).toLowerCase();
  return _indexes.armorByName.get(key) || _indexes.armorByName.get(key + " armor") || null;
}
export function itemWeight(name){ return (DATA.itemWeights || {})[name] ?? null; }

/* Find known weapon/armor names inside free text (for starting-equipment parsing). */
export function findGearInText(text){
  const found = { weapons:[], armor:null, shield:false };
  const lc = String(text).toLowerCase();
  if(/\bshield\b/.test(lc)) found.shield = true;
  for(const [key, a] of _indexes.armorByName){ if(key !== "shield" && lc.includes(key)){ found.armor = a; break; } }
  for(const [key, w] of _indexes.weaponByName){ if(lc.includes(key)) found.weapons.push(w); }
  // longest-name-first dedupe: "shortbow" also matches inside "longbow"? (it doesn't; but "sword" fragments could) — keep exact word hits only
  return found;
}
