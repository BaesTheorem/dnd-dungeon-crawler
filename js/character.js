/* Character model + derived stats. The stored record is plain data; everything computable is derived
   here as pure functions (informed by the donor sheet's field checklist, restructured). */

import { ABILITIES, SKILLS, mod, profBonus, slotsFor, acFrom, levelForXP, avgOfFormula } from "./rules.js";
import { idx, getWeapon, getArmor, classSpellList } from "../data/data.js";
import { condEffects } from "./conditions.js";
import { parseDamageParts } from "./dice.js";

export function newCharacter(){
  return {
    v:1, id: "c" + Date.now().toString(36) + Math.floor(Math.random()*1e6).toString(36),
    name:"", createdAt: Date.now(),
    race:"", class:"", subclass:"", background:"", level:1, xp:0,
    genMode:"pointbuy",
    baseVals:{str:8,dex:8,con:8,int:8,wis:8,cha:8},
    rolledArray:null,
    bonuses:{ racial:{str:0,dex:0,con:0,int:0,wis:0,cha:0}, asi:{str:0,dex:0,con:0,int:0,wis:0,cha:0} },
    racialChoices:[],                    // ability keys picked for "choose any" races (half-elf etc.)
    profs:{ saves:[], skills:[], expertise:[] },
    hp:{ max:0, cur:0, temp:0, mode:"avg", rolls:[], hitDiceMax:1, hitDiceCur:1 },
    equipment:{ armor:null, shield:false, weapons:[], items:[], gold:0 },
    spells:{ known:[], slots:{} },        // known = castable list (cantrips + spells); slots {lvl:{max,cur}}
    features:[],                          // resolved class feature names by current level (display + engine flags)
    fightingStyle:null,
    resources:{},                         // secondWind:{max,cur}, actionSurge:{max,cur}, channelDivinity:{max,cur}, arcaneRecovery:{max,cur}
    conditions:[], exhaustion:0,
    effects:[],                           // persistent buffs that outlive a combat (Mage Armor…); cleared on long rest
    deathSaves:{s:0, f:0},
    status:"alive",
    savedAt:0,
  };
}

/* ---- Ability scores ---- */
export function abilityScore(ch, k){
  return (ch.baseVals[k] || 0) + (ch.bonuses.racial[k] || 0) + (ch.bonuses.asi[k] || 0);
}
export function abilityMod(ch, k){ return mod(abilityScore(ch, k)); }

export function charClass(ch){ return idx().classByName.get(String(ch.class).toLowerCase()) || null; }
export function charRace(ch){ return idx().raceByName.get(String(ch.race).toLowerCase()) || null; }
export function charBackground(ch){ return idx().bgByName.get(String(ch.background).toLowerCase()) || null; }

export function prof(ch){ return profBonus(ch.level); }

export function saveBonus(ch, k){
  return abilityMod(ch, k) + (ch.profs.saves.includes(k) ? prof(ch) : 0);
}
export function skillBonus(ch, key){
  const sk = SKILLS.find(s => s[0] === key); if(!sk) return 0;
  const base = abilityMod(ch, sk[2]);
  const p = ch.profs.expertise.includes(key) ? prof(ch)*2 : (ch.profs.skills.includes(key) ? prof(ch) : 0);
  return base + p;
}
export function passivePerception(ch){ return 10 + skillBonus(ch, "perception"); }

/* ---- AC ---- */
export function armorClass(ch, combatBuffs = []){
  const activeBuffs = [...(ch.effects || []), ...combatBuffs];
  const dex = abilityMod(ch, "dex");
  const armor = ch.equipment.armor ? getArmor(ch.equipment.armor) : null;
  let ac;
  if(!armor && activeBuffs.some(b => b.buff === "mageArmor")) ac = 13 + dex + (ch.equipment.shield ? 2 : 0);
  else {
    let unarmoredBonus = 0;                                     // Barbarian/Monk unarmored defense
    if(!armor && /barbarian/i.test(ch.class)) unarmoredBonus = abilityMod(ch, "con");
    if(!armor && /monk/i.test(ch.class) && !ch.equipment.shield) unarmoredBonus = abilityMod(ch, "wis");
    ac = acFrom(armor, ch.equipment.shield, dex, unarmoredBonus);
  }
  if(ch.fightingStyle === "Defense" && armor) ac += 1;
  activeBuffs.forEach(b => { if(b.buff === "acBonus") ac += b.amount; });
  activeBuffs.forEach(b => { if(b.buff === "acFloor") ac = Math.max(ac, b.amount); });
  return ac;
}

/* ---- HP ---- */
export function conHPBonusPerLevel(ch){
  let extra = abilityMod(ch, "con");
  if(/dwarf \(hill\)/i.test(ch.race) || /hill dwarf/i.test(ch.race)) extra += 1;   // Dwarven Toughness
  return extra;
}
export function computeMaxHP(ch){
  const cls = charClass(ch); if(!cls) return 1;
  const hd = cls.hd || 8;
  const perLevel = conHPBonusPerLevel(ch);
  let hp = hd + perLevel;                                        // level 1: max die
  for(let lvl = 2; lvl <= ch.level; lvl++){
    const roll = ch.hp.rolls[lvl - 2];
    hp += (ch.hp.mode === "roll" && roll ? roll : Math.floor(hd/2) + 1) + perLevel;
  }
  return Math.max(1, hp);
}

/* ---- Attacks ---- */
const FINESSE = w => (w.props || []).some(p => /finesse/i.test(p));
export function weaponAttack(ch, wName){
  const w = getWeapon(wName) || { name:wName, dmg:"1d4", dmgType:"bludgeoning", melee:true, cat:"simple", props:[] };
  // "+1 Longsword"-style loot: strip the bonus, look up the base weapon.
  let magic = 0;
  const mBonus = /^\s*\+(\d)\s+(.*)$/.exec(wName);
  let base = w;
  if(!getWeapon(wName) && mBonus){ const bw = getWeapon(mBonus[2]); if(bw){ base = bw; magic = +mBonus[1]; } }
  const dex = abilityMod(ch, "dex"), str = abilityMod(ch, "str");
  const useDex = base.melee === false || (FINESSE(base) && dex > str);
  const abilM = useDex ? dex : str;
  let toHit = abilM + prof(ch) + magic;
  let dmgMod = abilM + magic;
  if(ch.fightingStyle === "Archery" && base.melee === false) toHit += 2;
  if(ch.fightingStyle === "Dueling" && base.melee !== false && !(base.props||[]).some(p => /two-handed/i.test(p))) dmgMod += 2;
  const parts = parseDamageParts(`${base.dmg || "1d4"}${dmgMod ? (dmgMod > 0 ? "+" + dmgMod : dmgMod) : ""} ${base.dmgType || ""}`);
  return { name:wName, weapon:base, toHit, parts, ranged: base.melee === false, magic };
}

/* ---- Spellcasting ---- */
export function castingAbility(ch){
  const cls = charClass(ch);
  return (cls && cls.casterAbility) || null;
}
export function spellSaveDC(ch){
  const ab = castingAbility(ch); if(!ab) return null;
  return 8 + prof(ch) + abilityMod(ch, ab);
}
export function spellAttackBonus(ch){
  const ab = castingAbility(ch); if(!ab) return null;
  return prof(ch) + abilityMod(ch, ab);
}
export function maxSlots(ch){
  const cls = charClass(ch); if(!cls || !cls.casterProgression) return {};
  return slotsFor(cls.casterProgression, ch.level);
}
export function isCaster(ch){ const cls = charClass(ch); return !!(cls && cls.casterProgression); }
export function cantripsAllowed(ch){
  const cls = charClass(ch); if(!cls || !cls.cantrips) return 0;
  return cls.cantrips[Math.max(1, Math.min(20, ch.level)) - 1] || 0;
}
export function spellsAllowed(ch){
  const cls = charClass(ch); if(!cls) return 0;
  if(cls.spellsKnown) return cls.spellsKnown[Math.max(1, Math.min(20, ch.level)) - 1] || 0;
  if(!cls.casterProgression) return 0;
  const ab = castingAbility(ch);
  // Prepared casters (cleric/druid/wizard/paladin/artificer): ability mod + level (min 1), wizard uses spellbook = same cap here.
  const half = cls.casterProgression === "1/2" || cls.casterProgression === "artificer";
  return Math.max(1, abilityMod(ch, ab) + (half ? Math.floor(ch.level/2) : ch.level));
}
export function highestSlotLevel(ch){
  const s = maxSlots(ch);
  return Object.keys(s).map(Number).reduce((a,b) => Math.max(a,b), 0);
}
export function availableSpellChoices(ch){
  const cls = charClass(ch); if(!cls) return {cantrips:[], spells:[]};
  const list = classSpellList(cls.name);
  const maxLvl = highestSlotLevel(ch);
  return {
    cantrips: list.filter(e => e.level === 0),
    spells: list.filter(e => e.level >= 1 && e.level <= maxLvl),
  };
}

/* ---- Features & resources ---- */
export function featuresAtLevel(ch){
  const cls = charClass(ch); if(!cls) return [];
  return (cls.features || []).filter(f => f.level <= ch.level);
}
export function asiLevelsOwed(ch){
  const cls = charClass(ch); if(!cls) return [];
  return (cls.features || []).filter(f => /^ability score improvement$/i.test(f.name) && f.level <= ch.level).map(f => f.level);
}
export function sneakDice(ch){
  if(!/rogue/i.test(ch.class)) return 0;
  return Math.ceil(ch.level / 2);
}
export function extraAttacks(ch){
  const f = featuresAtLevel(ch).some(x => /^extra attack$/i.test(x.name));
  return f ? 1 : 0;                                              // v1: one extra attack (level 5+ martials)
}
export function refreshResources(ch){
  const r = {};
  const has = name => featuresAtLevel(ch).some(f => f.name.toLowerCase() === name);
  if(has("second wind")) r.secondWind = { max:1, cur: ch.resources.secondWind?.cur ?? 1 };
  if(has("action surge")) r.actionSurge = { max:1, cur: ch.resources.actionSurge?.cur ?? 1 };
  if(has("channel divinity")) r.channelDivinity = { max:1, cur: ch.resources.channelDivinity?.cur ?? 1 };
  if(has("arcane recovery")) r.arcaneRecovery = { max:1, cur: ch.resources.arcaneRecovery?.cur ?? 1 };
  ch.resources = r;
  return r;
}

/* ---- Rests ---- */
export function longRest(ch){
  ch.hp.max = computeMaxHP(ch);
  ch.hp.cur = ch.hp.max;
  ch.hp.temp = 0;
  ch.hp.hitDiceCur = Math.min(ch.hp.hitDiceMax, ch.hp.hitDiceCur + Math.max(1, Math.floor(ch.hp.hitDiceMax / 2)));
  const ms = maxSlots(ch);
  ch.spells.slots = {};
  for(const lvl in ms) ch.spells.slots[lvl] = { max: ms[lvl], cur: ms[lvl] };
  for(const k in ch.resources) ch.resources[k].cur = ch.resources[k].max;
  ch.exhaustion = Math.max(0, ch.exhaustion - 1);
  ch.conditions = [];
  ch.effects = [];                                       // 8-hour buffs like Mage Armor expire over a long rest
  ch.deathSaves = {s:0, f:0};
}
export function shortRestRecover(ch){
  for(const k of ["secondWind", "actionSurge", "channelDivinity"])
    if(ch.resources[k]) ch.resources[k].cur = ch.resources[k].max;
  if(/warlock/i.test(ch.class)){                                 // pact slots refresh on short rest
    const ms = maxSlots(ch);
    for(const lvl in ms) ch.spells.slots[lvl] = { max: ms[lvl], cur: ms[lvl] };
  }
}

/* ---- Level up ---- */
export function applyLevelUp(ch, { hpRoll = null } = {}){
  ch.level += 1;
  ch.hp.hitDiceMax = ch.level;
  ch.hp.hitDiceCur = Math.min(ch.hp.hitDiceMax, ch.hp.hitDiceCur + 1);
  if(ch.hp.mode === "roll" && hpRoll) ch.hp.rolls.push(hpRoll);
  const oldMax = ch.hp.max;
  ch.hp.max = computeMaxHP(ch);
  ch.hp.cur = Math.min(ch.hp.max, ch.hp.cur + (ch.hp.max - oldMax));
  const ms = maxSlots(ch);
  for(const lvl in ms){
    const cur = ch.spells.slots[lvl]?.cur ?? 0;
    const oldMaxSlots = ch.spells.slots[lvl]?.max ?? 0;
    ch.spells.slots[lvl] = { max: ms[lvl], cur: cur + (ms[lvl] - oldMaxSlots) };
  }
  refreshResources(ch);
  ch.features = featuresAtLevel(ch).map(f => f.name);
  return ch;
}

export function pendingLevel(ch){ return levelForXP(ch.xp) > ch.level; }

/* Movement speed after conditions. */
export function speed(ch){
  const race = charRace(ch);
  const base = (race && race.speed) || 30;
  const eff = condEffects(ch.conditions, ch.exhaustion);
  if(eff.speedZero) return 0;
  return eff.speedHalf ? Math.floor(base / 2) : base;
}

/* Monster HP helper (avg from formula, falls back to listed hp). */
export function monsterMaxHP(mon){
  return mon.hp || avgOfFormula(mon.hpFormula) || 10;
}
