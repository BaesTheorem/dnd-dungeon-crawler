/* Dungeon run engine: 5 floors × 5 rooms, materialized on entry and persisted so a refresh restores
   exact state. Room 5 of a floor is the guarded stair; floor 5 room 5 is the boss. */

import { FLOORS, ROOMS_PER_FLOOR, FLOOR_TUNING, ROOM_WEIGHTS, TRAPS, EVENTS, BOSSES, STAIR_GUARDS, MAGIC_LOOT, ROOM_FLAVOR,
  SCROLL_BAND, SCROLL_PRICE, POTION_PRICE, SCRIBE_COST_PER_LEVEL } from "../data/tables.js";
import { rollDie, d20Roll, damageRoll, parseDamageParts } from "./dice.js";
import { xpForCR, encounterMultiplier, levelForXP, XP_TABLE } from "./rules.js";
import { monstersInBand, getMonster, scrollPool, scrollSpellName, classListHas, getSpell } from "../data/data.js";
import { materializeMonster, startCombat, scrollUsability } from "./combat.js";
import * as C from "./character.js";
import { condEffects, advFor, combineAdv } from "./conditions.js";

export function newRun(ch){
  return {
    v:1, charId: ch.id, floor:1, roomIndex:0, room:null, combat:null,
    restRoomSeenThisFloor:false, longRestUsedThisFloor:false,
    xpEarned:0, kills:0, log:[], status:"active", startedAt: Date.now(),
  };
}

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)] || null; }
function weightedPick(pairs){
  const total = pairs.reduce((a, [,w]) => a + w, 0);
  let r = Math.random() * total;
  for(const [k, w] of pairs){ r -= w; if(r <= 0) return k; }
  return pairs[0][0];
}
function flavor(kind){ return pick(ROOM_FLAVOR[kind] || ROOM_FLAVOR.empty); }
function rollGold(expr){
  const m = /(\d+)d(\d+)(?:x(\d+))?/.exec(expr); if(!m) return 10;
  let t = 0; for(let i = 0; i < +m[1]; i++) t += rollDie(+m[2]);
  return t * (m[3] ? +m[3] : 1);
}
function potionForFloor(floor){
  return floor >= 5 ? "Potion of Superior Healing" : floor >= 3 ? "Potion of Greater Healing" : "Potion of Healing";
}
function randomScroll(floor){
  const [lo, hi] = SCROLL_BAND[Math.max(1, Math.min(5, floor))] || [1, 1];
  const pool = scrollPool(lo, hi);
  const pickd = pick(pool);
  return pickd ? { name:`Scroll of ${pickd.name}`, level:pickd.level } : null;
}
export function addItem(ch, name, qty = 1){
  const ex = ch.equipment.items.find(i => i.name.toLowerCase() === name.toLowerCase());
  if(ex) ex.qty += qty; else ch.equipment.items.push({ name, qty });
}

/* ---- Encounter building ---- */
function buildEncounter(ch, floor, budget){
  const tune = FLOOR_TUNING[floor - 1];
  const pool = monstersInBand(tune.band[0], tune.band[1]);
  if(!pool.length) return [materializeMonster(getMonster("Goblin") || pool[0])];
  // Try a few random picks; keep the group whose adjusted XP lands closest to budget.
  let best = null, bestDiff = Infinity;
  for(let tries = 0; tries < 12; tries++){
    const m = pick(pool);
    const xp = xpForCR(m.cr);
    for(let n = 1; n <= 3; n++){
      const adj = xp * n * encounterMultiplier(n);
      const diff = Math.abs(adj - budget) + (adj > budget * 1.4 ? 1e6 : 0);   // hard-cap overshoot
      if(diff < bestDiff){ bestDiff = diff; best = { m, n }; }
    }
  }
  if(!best) best = { m: pick(pool), n: 1 };
  const tags = ["A", "B", "C"];
  return Array.from({length: best.n}, (_, i) => materializeMonster(best.m, best.n > 1 ? tags[i] || String(i+1) : ""));
}
function buildEliteEncounter(ch, floor){
  const tune = FLOOR_TUNING[floor - 1];
  for(const name of (STAIR_GUARDS[floor] || [])){
    const m = getMonster(name);
    if(m) return [materializeMonster(m)];
  }
  const pool = monstersInBand(tune.band[0], tune.band[1]).sort((a, b) => b.crNum - a.crNum);
  return [materializeMonster(pool[0] || getMonster("Ogre"))];
}
/* A single wandering monster from the floor's lower CR half (rest-room ambushes). */
export function buildAmbush(run, ch){
  const tune = FLOOR_TUNING[run.floor - 1];
  const midCR = (tune.band[0] + tune.band[1]) / 2;
  const pool = monstersInBand(tune.band[0], Math.max(tune.band[0], midCR));
  const m = pick(pool) || getMonster("Goblin");
  return [materializeMonster(m)];
}

function buildBoss(){
  for(const name of BOSSES){
    const m = getMonster(name);
    if(m) return [materializeMonster(m)];
  }
  return [materializeMonster(getMonster("Ogre"))];
}

/* ---- Room generation (materialized + persisted) ---- */
function chooseRoomType(run, idx){
  if(idx >= ROOMS_PER_FLOOR) return (run.floor >= FLOORS) ? "boss" : "stairs";
  if(idx === ROOMS_PER_FLOOR - 1 && !run.restRoomSeenThisFloor) return "rest";   // guarantee a rest per floor
  return weightedPick(ROOM_WEIGHTS);
}

/* Detect Magic (ritual): pre-rolls and reveals the next room's nature; nextRoom then honors it. */
export function peekNextRoom(run, ch){
  const events = [];
  if(!run.peekType) run.peekType = chooseRoomType(run, run.roomIndex + 1);
  const senses = {
    combat:"Aggression. Something breathing waits beyond the next door.",
    trap:"A thin lattice of hostile intent — mechanism or glyph. Careful.",
    treasure:"A warm shimmer of enchantment and precious metal ahead.",
    rest:"Still air and old ash. A safe place to breathe, you think.",
    event:"Something strange and old hums beyond the door.",
    stairs:"A downward draft — the way deeper is close, and it is guarded.",
    boss:"A pressure like a storm-front. Something terrible is very near.",
  };
  events.push({t:"sfx", name:"spell"}, {t:"log", text:`Detect Magic (ritual): ${senses[run.peekType] || "The weave is murky here."}`});
  return { events };
}

export function nextRoom(run, ch){
  run.roomIndex += 1;
  const floor = run.floor;
  const type = run.peekType || chooseRoomType(run, run.roomIndex);
  run.peekType = null;
  if(type === "rest") run.restRoomSeenThisFloor = true;

  const tune = FLOOR_TUNING[floor - 1];
  const room = { type, floor, index: run.roomIndex, resolved:false, flavor: flavor(type === "stairs" ? "stairs" : type === "boss" ? "boss" : type) };
  if(type === "combat") room.monsters = buildEncounter(ch, floor, tune.budget);
  else if(type === "stairs") room.monsters = buildEliteEncounter(ch, floor);
  else if(type === "boss") room.monsters = buildBoss();
  else if(type === "trap"){
    room.trap = pick(TRAPS.slice(0, Math.min(TRAPS.length, floor + 2)));   // deadlier traps only on deeper floors
    room.trapState = "hidden";
    const scout = (ch.familiar && ch.familiar.alive) ? 5 : 0;              // the owl flies ahead
    room.detected = C.passivePerception(ch) + scout >= room.trap.detectDC;
    if(room.detected){
      room.trapState = "detected";
      if(scout) room.spottedByFamiliar = true;
    }
  }
  else if(type === "treasure"){
    room.gold = rollGold(tune.gold);
    room.potion = Math.random() < tune.potionChance ? potionForFloor(floor) : null;
    const magicPool = MAGIC_LOOT[floor];
    room.magic = magicPool && Math.random() < 0.3 ? pick(magicPool) : null;
    room.scroll = Math.random() < 0.35 ? (randomScroll(floor) || {}).name : null;
    room.trapped = Math.random() < 0.25 ? pick(TRAPS.slice(0, Math.min(TRAPS.length, floor + 2))) : null;
  }
  else if(type === "event"){ room.event = pick(EVENTS); }
  run.room = room;
  return room;
}

export function enterCombat(run, ch, opts = {}){
  run.combat = startCombat(ch, run.room.monsters, opts);
  return run.combat;
}

/* After combat resolves, fold the result into the run. Returns 'victory'|'defeat'|'fled'|'stabilized'. */
export function resolveCombat(run, ch){
  const st = run.combat;
  if(!st) return null;
  const outcome = st.phase;
  run.room.outcome = outcome;
  if(outcome === "victory"){
    run.xpEarned += st.xp;
    run.kills += st.monsters.length;
    ch.xp += st.xp;
    run.room.resolved = true;
    run.room.reward = victoryLoot(run, ch);
  } else if(outcome === "fled" || outcome === "stabilized"){
    run.room.resolved = true;                            // room passed, no reward
  } else if(outcome === "defeat"){
    run.status = "dead";
  }
  run.combat = null;
  return outcome;
}

function victoryLoot(run, ch){
  const floor = run.floor;
  const reward = { gold: Math.max(1, Math.floor(rollGold(FLOOR_TUNING[floor-1].gold) / 2)) };
  ch.equipment.gold += reward.gold;
  if(Math.random() < 0.25){ reward.potion = potionForFloor(floor); addItem(ch, reward.potion); }
  if(run.room.type === "boss" || run.room.type === "stairs"){
    reward.gold += rollGold(FLOOR_TUNING[floor-1].gold);
    ch.equipment.gold += reward.gold;
    const magicPool = MAGIC_LOOT[Math.min(5, floor + 1)] || MAGIC_LOOT[floor];
    if(magicPool && Math.random() < 0.5){ reward.magic = pick(magicPool); }
    if(reward.magic && !ch.equipment.weapons.includes(reward.magic)) ch.equipment.weapons.push(reward.magic);
    if(Math.random() < 0.4){ const sc = randomScroll(floor + 1); if(sc){ reward.scroll = sc.name; addItem(ch, sc.name); } }
  }
  return reward;
}

/* ---- The Wandering Peddler: waits by the landing at the start of every floor ---- */
export function floorShop(run, ch){
  if(run.shop && run.shop.floor === run.floor) return run.shop;
  const floor = run.floor;
  const stock = [];
  const potion = potionForFloor(floor);
  stock.push({ kind:"potion", name:potion, price:POTION_PRICE[potion] || 50, qty:3 });
  for(let i = 0; i < 2; i++){
    const sc = randomScroll(floor);
    if(sc) stock.push({ kind:"scroll", name:sc.name, price:SCROLL_PRICE[sc.level] || 50, qty:1 });
  }
  const magicPool = MAGIC_LOOT[Math.max(3, Math.min(5, floor + 1))];
  const mw = pick(magicPool || []);
  if(mw && floor >= 2) stock.push({ kind:"weapon", name:mw, price:200 * floor, qty:1 });
  run.shop = { floor, stock };
  return run.shop;
}
export function shopBuy(run, ch, idx){
  const shop = run.shop; const events = [];
  const it = shop && shop.stock[idx];
  if(!it || it.qty <= 0) return { events };
  if(ch.equipment.gold < it.price){ events.push({t:"log", text:"You can't afford that."}); return { events }; }
  ch.equipment.gold -= it.price;
  it.qty -= 1;
  if(it.qty <= 0) shop.stock.splice(idx, 1);
  if(it.kind === "weapon"){ if(!ch.equipment.weapons.includes(it.name)) ch.equipment.weapons.push(it.name); }
  else addItem(ch, it.name);
  events.push({t:"sfx", name:"treasure"}, {t:"log", text:`Bought: ${it.name} (${it.price} gp). ${ch.equipment.gold} gp left.`});
  return { events };
}
/* Sellables: potions at half price; magic weapons at half of shop rate (never your last weapon). */
export function sellables(run, ch){
  const out = [];
  ch.equipment.items.forEach((it, i) => {
    const p = POTION_PRICE[it.name]; if(p) out.push({ kind:"item", idx:i, name:it.name, qty:it.qty, price:Math.floor(p/2) });
    const sc = scrollSpellName(it.name);
    if(sc){ const s = getSpell(sc); if(s) out.push({ kind:"item", idx:i, name:it.name, qty:it.qty, price:Math.floor((SCROLL_PRICE[s.level] || 50)/2) }); }
  });
  if(ch.equipment.weapons.length > 1){
    ch.equipment.weapons.forEach((w, i) => {
      if(/^\+\d /.test(w) || /flame tongue/i.test(w)) out.push({ kind:"weapon", idx:i, name:w, price:100 * run.floor });
    });
  }
  return out;
}
export function shopSell(run, ch, entry){
  const events = [];
  if(entry.kind === "weapon"){
    if(ch.equipment.weapons.length <= 1) return { events };
    ch.equipment.weapons.splice(entry.idx, 1);
  } else {
    const it = ch.equipment.items[entry.idx];
    if(!it) return { events };
    it.qty -= 1;
    if(it.qty <= 0) ch.equipment.items.splice(entry.idx, 1);
  }
  ch.equipment.gold += entry.price;
  events.push({t:"sfx", name:"treasure"}, {t:"log", text:`Sold: ${entry.name} (+${entry.price} gp). ${ch.equipment.gold} gp.`});
  return { events };
}

/* ---- Scribing: a wizard copies an eligible scroll into the spellbook ---- */
export function scribeableScrolls(ch){
  if(!/wizard/i.test(ch.class)) return [];
  const maxLvl = Math.max(C.highestSlotLevel(ch), 0);
  const out = [];
  ch.equipment.items.forEach((it, idx) => {
    const nm = scrollSpellName(it.name); if(!nm) return;
    const s = getSpell(nm); if(!s) return;
    if(!classListHas("Wizard", s.name)) return;
    if(s.level === 0 || s.level > maxLvl) return;
    if(ch.spells.known.some(k => k.toLowerCase() === s.name.toLowerCase())) return;
    out.push({ idx, name:s.name, level:s.level, cost:SCRIBE_COST_PER_LEVEL * s.level });
  });
  return out;
}
export function scribeScroll(ch, entry){
  const events = [];
  if(ch.equipment.gold < entry.cost){ events.push({t:"log", text:`Scribing ${entry.name} needs ${entry.cost} gp for inks.`}); return { events }; }
  const it = ch.equipment.items[entry.idx];
  if(!it || scrollSpellName(it.name)?.toLowerCase() !== entry.name.toLowerCase()) return { events };
  ch.equipment.gold -= entry.cost;
  it.qty -= 1;
  if(it.qty <= 0) ch.equipment.items.splice(entry.idx, 1);
  ch.spells.known.push(entry.name);
  events.push({t:"sfx", name:"level-up"}, {t:"log", text:`You scribe ${entry.name} into your spellbook (${entry.cost} gp of rare inks). It is yours now.`});
  return { events };
}

/* ---- Traps ----
   action: 'disarm' (skill check) | 'careful' (save w/ advantage) | 'barge' (plain save) | 'search' (find it first)
   Returns {events:[...roll/log], damage, done} */
export function trapAct(run, ch, action){
  const room = run.room, trap = room.trap;
  const events = [];
  const eff = condEffects(ch.conditions, ch.exhaustion);
  const finish = () => { room.resolved = true; room.trapState = "done"; };
  if(action === "search"){
    const famAdv = familiarAlive(ch) ? "adv" : null;      // two pairs of eyes
    const bonus = consumeCheckBonus(ch, events);
    const res = d20Roll({ label:"Search (Perception)", rollType:"Check", mod: C.skillBonus(ch, "perception") + bonus,
      adv: combineAdv(advFor(eff, ["check","skill:perception"]), famAdv) });
    events.push({t:"roll", res});
    if(res.total >= trap.detectDC){ room.trapState = "detected"; room.detected = true; events.push({t:"log", text:`You spot it: ${trap.name}!${familiarAlive(ch) ? " (Your owl shrieks a warning.)" : ""}`}); }
    else { events.push({t:"log", text:"You find nothing… you'll have to chance it."}); room.trapState = "unfound"; }
    return { events };
  }
  if(action === "disarm"){
    const bonus = consumeCheckBonus(ch, events);
    const res = d20Roll({ label:`Disarm (${trap.disarmSkill})`, rollType:"Check", mod: C.skillBonus(ch, trap.disarmSkill) + bonus, adv: advFor(eff, ["check","skill:"+trap.disarmSkill]) });
    events.push({t:"roll", res});
    if(res.total >= trap.disarmDC){ events.push({t:"sfx", name:"treasure"}, {t:"log", text:`You disarm the ${trap.name}.`}); finish(); return { events, done:true }; }
    events.push({t:"log", text:"You fumble it — the trap springs!"});
    return { events, ...springTrap(run, ch, events, null) };
  }
  // careful (detected → save with advantage) or barge/walk-in (plain save)
  return { events, ...springTrap(run, ch, events, action === "careful" ? "adv" : null) };
}
function springTrap(run, ch, events, advOverride){
  const room = run.room, trap = room.trap || room.trapped;
  const eff = condEffects(ch.conditions, ch.exhaustion);
  const auto = new Set();
  const adv = advOverride || advFor(eff, ["save", "save:" + trap.save]);
  const sv = d20Roll({ label:`${trap.save.toUpperCase()} save vs ${trap.name}`, rollType:"Save", mod: C.saveBonus(ch, trap.save), adv });
  events.push({t:"sfx", name:"trap"}, {t:"roll", res:sv});
  const failed = sv.total < trap.saveDC;
  const dmgRes = damageRoll({ label: trap.name, parts: parseDamageParts(trap.dmg) });
  const dealt = failed ? dmgRes.total : Math.floor(dmgRes.total / 2);
  events.push({t:"roll", res:dmgRes});
  ch.hp.cur = Math.max(0, ch.hp.cur - Math.max(0, dealt - ch.hp.temp));
  ch.hp.temp = Math.max(0, ch.hp.temp - dealt);
  events.push({t:"log", text:`${failed ? "It catches you full on" : "You twist aside"} — ${dealt} damage (${ch.hp.cur}/${ch.hp.max} HP).`});
  room.resolved = true; room.trapState = "done";
  let died = false;
  if(ch.hp.cur <= 0){                                     // trap deaths skip death saves: you're alone at the bottom of a pit
    ch.status = "dead"; run.status = "dead"; died = true;
    events.push({t:"sfx", name:"death"}, {t:"log", text:"The dungeon claims you."});
  }
  return { damage: dealt, done:true, died };
}

/* ---- Treasure ---- */
export function openChest(run, ch){
  const room = run.room; const events = [];
  if(room.trapped){
    room.trap = room.trapped; room.trapped = null;
    const r = springTrap(run, ch, events, null);
    if(r.died) return { events };
    room.resolved = false;                                 // trap sprung; loot still inside
  }
  ch.equipment.gold += room.gold;
  events.push({t:"sfx", name:"treasure"}, {t:"log", text:`You find ${room.gold} gp.`});
  if(room.potion){ addItem(ch, room.potion); events.push({t:"log", text:`You find a ${room.potion}.`}); }
  if(room.scroll){ addItem(ch, room.scroll); events.push({t:"log", text:`You find a ${room.scroll}.`}); }
  if(room.magic){
    ch.equipment.weapons.push(room.magic);
    events.push({t:"sfx", name:"level-up"}, {t:"log", text:`You find a ${room.magic}!`});
  }
  room.resolved = true;
  return { events };
}

/* ---- Rest ---- */
export function shortRest(run, ch, diceToSpend, { risky = false } = {}){
  const events = [];
  // Rest sites are defensible; camping in a corridor is not — double the ambush odds there.
  const ambushChance = risky ? (familiarAlive(ch) ? 0.15 : 0.30) : (familiarAlive(ch) ? 0.05 : 0.15);
  if(Math.random() < ambushChance){
    events.push({t:"log", text: risky ? "Your corridor camp was too exposed — something found you!" : "Something found you while you rested!"});
    return { events, ambush:true };
  }
  const cls = C.charClass(ch); const hd = (cls && cls.hd) || 8;
  let healed = 0;
  const ri = (ch.effects || []).findIndex(b => b.buff === "rations");
  const perDie = ri >= 0 ? (ch.effects[ri].amount || 2) : 0;
  if(ri >= 0){ ch.effects.splice(ri, 1); events.push({t:"log", text:"The seasoned rations do you good."}); }
  const n = Math.min(diceToSpend, ch.hp.hitDiceCur);
  for(let i = 0; i < n; i++){
    ch.hp.hitDiceCur -= 1;
    healed += Math.max(1, rollDie(hd) + C.abilityMod(ch, "con") + perDie);
  }
  ch.hp.cur = Math.min(C.computeMaxHP(ch), ch.hp.cur + healed);
  C.shortRestRecover(ch);
  if(ch.resources.arcaneRecovery?.cur > 0){                // Wizard: auto-recover slots totaling ceil(level/2)
    ch.resources.arcaneRecovery.cur = 0;
    let budgetSlots = Math.ceil(ch.level / 2);
    for(const lvl of Object.keys(ch.spells.slots).map(Number).sort((a,b)=>a-b)){
      const s = ch.spells.slots[lvl];
      while(budgetSlots >= lvl && s.cur < s.max){ s.cur += 1; budgetSlots -= lvl; }
    }
    events.push({t:"log", text:"Arcane Recovery restores some spell slots."});
  }
  events.push({t:"sfx", name:"heal"}, {t:"log", text:`Short rest: ${n} Hit ${n===1?"Die":"Dice"} spent, +${healed} HP (${ch.hp.cur}/${ch.hp.max}).`});
  if(run.room) run.room.resolved = true;                  // corridor camps have no room to resolve
  return { events, healed };
}
export function longRestHere(run, ch){
  const events = [];
  if(run.longRestUsedThisFloor){ events.push({t:"log", text:"You've already taken a long rest on this floor."}); return { events }; }
  if(Math.random() < (familiarAlive(ch) ? 0.05 : 0.15)){
    events.push({t:"log", text:"Your sleep is cut short — something found you!"});
    return { events, ambush:true };
  }
  run.longRestUsedThisFloor = true;
  C.longRest(ch);
  events.push({t:"sfx", name:"heal"}, {t:"log", text:`Long rest: fully restored (${ch.hp.cur}/${ch.hp.max} HP, all slots back).`});
  run.room.resolved = true;
  return { events };
}

/* ---- Events ---- */
export function eventChoose(run, ch, choiceKey){
  const room = run.room, ev = room.event;
  const choice = ev.choices.find(c => c.key === choiceKey);
  const events = [];
  room.resolved = true;
  if(!choice || choiceKey === "skip"){ events.push({t:"log", text:"You move on."}); return { events }; }
  if(choice.cost){
    if(ch.equipment.gold < choice.cost){ events.push({t:"log", text:"You can't afford the offering."}); return { events }; }
    ch.equipment.gold -= choice.cost;
  }
  const lucky = Math.random() < (choice.good?.chance ?? 1);
  const out = lucky ? choice.good : choice.bad;
  if(!out){ events.push({t:"log", text:"Nothing happens."}); return { events }; }
  if(out.heal){
    const r = damageRoll({ label:ev.name, rollType:"Healing", parts: parseDamageParts(out.heal + " healing") });
    ch.hp.cur = Math.min(C.computeMaxHP(ch), ch.hp.cur + r.total);
    events.push({t:"roll", res:r}, {t:"sfx", name:"heal"}, {t:"log", text:`You feel renewed: +${r.total} HP (${ch.hp.cur}/${ch.hp.max}).`});
  }
  if(out.dmg){
    const r = damageRoll({ label:ev.name, parts: parseDamageParts(out.dmg) });
    ch.hp.cur = Math.max(0, ch.hp.cur - r.total);
    events.push({t:"roll", res:r}, {t:"sfx", name:"damage-taken"}, {t:"log", text:`Agony! ${r.total} damage (${ch.hp.cur}/${ch.hp.max} HP).`});
    if(out.condition && !ch.conditions.includes(out.condition)){ ch.conditions.push(out.condition); events.push({t:"log", text:`You are ${out.condition}.`}); }
    if(ch.hp.cur <= 0){ ch.status = "dead"; run.status = "dead"; events.push({t:"sfx", name:"death"}, {t:"log", text:"The dungeon claims you."}); }
  }
  if(out.gold){ const g = rollGold(out.gold); ch.equipment.gold += g; events.push({t:"sfx", name:"treasure"}, {t:"log", text:`You find ${g} gp.`}); }
  if(out.potion){ const p = potionForFloor(run.floor); addItem(ch, p); events.push({t:"log", text:`You find a ${p}.`}); }
  if(out.buff){ events.push({t:"sfx", name:"level-up"}, {t:"log", text:"A warm light settles over you. (Blessed: +1d4 on your next fight's attacks and saves.)"}); run.pendingBless = true; }
  if(out.trap){ room.trap = TRAPS.find(t => t.name === out.trap) || TRAPS[0]; const r = springTrap(run, ch, events, null); }
  return { events };
}

/* ---- Out-of-combat casting (corridor): healing, persistent buffs, and utility rituals ---- */
import { spellMechanics } from "../data/data.js";
const hasSlotFor = (ch, level) =>
  level === 0 || Object.keys(ch.spells.slots || {}).some(l => +l >= level && ch.spells.slots[l].cur > 0);

export function castableOutOfCombat(ch){
  const out = [];
  (ch.spells.known || []).forEach(n => {
    const mech = spellMechanics(n, ch.level);
    if(!mech) return;
    const ritual = !!mech.spell.ritual;                   // rituals need time, not slots — free out of combat
    if(!ritual && !hasSlotFor(ch, mech.spell.level)) return;
    const key = n.toLowerCase();
    if(mech.kind === "heal" || mech.buff === "mageArmor"){ out.push({ n, mech }); return; }
    if(key === "find familiar" && !(ch.familiar && ch.familiar.alive))
      out.push({ n, mech, opt:"summon", label:"Find Familiar — summon your owl (ritual, no slot)" });
    if(key === "detect magic")
      out.push({ n, mech, opt:"detect", label:"Detect Magic — sense the next room (ritual, no slot)" });
    if(key === "prestidigitation"){
      out.push({ n, mech, opt:"prepare", label:"Prestidigitation — tidy & prepare (+2 on your next check)" });
      out.push({ n, mech, opt:"season", label:"Prestidigitation — season rations (+2 HP per Hit Die next short rest)" });
    }
  });
  return out;
}

export function castUtility(ch, name, opt, run, free = false){
  const mech = spellMechanics(name, ch.level);
  const events = [];
  if(!mech) return { events };
  const s = mech.spell;
  const key = s.name.toLowerCase();
  let slotLevel = 0;
  if(s.level > 0 && !s.ritual && !free){                  // rituals & scrolls: no slot
    const lvls = Object.keys(ch.spells.slots || {}).map(Number).filter(l => l >= s.level && ch.spells.slots[l].cur > 0);
    if(!lvls.length){ events.push({t:"log", text:"No spell slots left."}); return { events }; }
    slotLevel = Math.min(...lvls);
    ch.spells.slots[slotLevel].cur -= 1;
  }
  if(key === "detect magic" && run) return peekNextRoom(run, ch);
  if(key === "find familiar"){
    ch.familiar = { form:"Owl", alive:true };
    events.push({t:"sfx", name:"heal"}, {t:"log", text:"A spectral owl takes shape and settles on your shoulder. It scouts for traps, keeps watch while you rest, and can harry foes in battle."});
    return { events };
  }
  if(key === "prestidigitation"){
    ch.effects = ch.effects || [];
    if(opt === "season"){
      if(!ch.effects.some(b => b.buff === "rations")) ch.effects.push({ buff:"rations", amount:2, label:"Seasoned rations (+2 HP/die next short rest)" });
      events.push({t:"sfx", name:"spell"}, {t:"log", text:"You season and warm your rations — your next short rest will restore +2 HP per Hit Die."});
    } else {
      ch.effects = ch.effects.filter(b => b.buff !== "checkBonus");
      ch.effects.push({ buff:"checkBonus", amount:2, label:"Prepared (+2 next check)" });
      events.push({t:"sfx", name:"spell"}, {t:"log", text:"You clean, mend, and ready everything just so — +2 on your next skill check."});
    }
    return { events };
  }
  if(mech.kind === "heal"){
    const dice = [...mech.heal.dice];
    if(mech.upcast && slotLevel > s.level){
      const up = /(\d+)d(\d+)/.exec(mech.upcast.up);
      if(up) dice.push({n:+up[1] * (slotLevel - s.level), d:+up[2]});
    }
    const modV = mech.heal.addMod ? C.abilityMod(ch, C.castingAbility(ch)) : 0;
    const res = damageRoll({ label:s.name, rollType:"Healing", parts:[{label:"healing", type:"", dice, mod:modV}] });
    ch.hp.cur = Math.min(C.computeMaxHP(ch), ch.hp.cur + res.total);
    events.push({t:"roll", res}, {t:"sfx", name:"heal"}, {t:"log", text:`${s.name}: +${res.total} HP (${ch.hp.cur}/${ch.hp.max}).`});
  } else if(mech.buff === "mageArmor"){
    ch.effects = (ch.effects || []).filter(b => b.buff !== "mageArmor");
    ch.effects.push({ buff:"mageArmor", label:mech.label });
    events.push({t:"sfx", name:"spell"}, {t:"log", text:`${mech.label} — lasts until your next long rest.`});
  }
  return { events };
}

/* ---- Reading scrolls between fights (healing / Mage Armor / ritual-style scrolls) ---- */
export function usableScrollsOutOfCombat(ch){
  const out = [];
  ch.equipment.items.forEach((it, idx) => {
    const nm = scrollSpellName(it.name); if(!nm) return;
    const mech = spellMechanics(nm, ch.level); if(!mech) return;
    const useful = mech.kind === "heal" || mech.buff === "mageArmor" || ["find familiar","detect magic"].includes(nm.toLowerCase());
    if(!useful) return;
    out.push({ idx, itemName: it.name, spell: nm, usable: scrollUsability(ch, nm) });
  });
  return out;
}
export function readScrollOutOfCombat(run, ch, idx){
  const events = [];
  const it = ch.equipment.items[idx];
  const nm = it && scrollSpellName(it.name);
  if(!nm) return { events };
  const use = scrollUsability(ch, nm);
  if(!use.ok){ events.push({t:"log", text:`The ${it.name} is unintelligible to you.`}); return { events }; }
  it.qty -= 1;
  if(it.qty <= 0) ch.equipment.items.splice(idx, 1);
  if(use.check){
    const mod = C.abilityMod(ch, C.castingAbility(ch) || "int");
    const res = d20Roll({ label:`${it.name} (casting check)`, rollType:"Check", mod });
    events.push({t:"roll", res});
    if(res.total < use.check.dc){
      events.push({t:"log", text:`The words twist away from you (DC ${use.check.dc}) — the scroll crumbles, spent.`});
      return { events };
    }
  }
  events.push({t:"log", text:`You read the ${it.name}…`});
  const r = castUtility(ch, nm, undefined, run, true);
  return { events: [...events, ...r.events] };
}

/* Consume the one-shot Prestidigitation check bonus (skill checks in trap/event rooms). */
function consumeCheckBonus(ch, events){
  const i = (ch.effects || []).findIndex(b => b.buff === "checkBonus");
  if(i < 0) return 0;
  const amt = ch.effects[i].amount || 2;
  ch.effects.splice(i, 1);
  events.push({t:"log", text:`(+${amt} from your preparations)`});
  return amt;
}
const familiarAlive = ch => !!(ch.familiar && ch.familiar.alive);

/* ---- Floor / run advancement ---- */
export function advanceAfterRoom(run, ch){
  if(run.status !== "active") return run.status;
  if(run.room && run.room.type === "boss" && run.room.outcome === "victory"){
    run.status = "won";
    return "won";
  }
  if(run.roomIndex >= ROOMS_PER_FLOOR){
    run.floor += 1;
    run.roomIndex = 0;
    run.restRoomSeenThisFloor = false;
    run.longRestUsedThisFloor = false;
  }
  return "active";
}

export function xpToNext(ch){
  return { have: ch.xp, need: (levelForXP(ch.xp) > ch.level) ? 0 : (XP_TABLE[ch.level] ?? Infinity) };
}
