/* Dungeon run engine: 5 floors × 5 rooms, materialized on entry and persisted so a refresh restores
   exact state. Room 5 of a floor is the guarded stair; floor 5 room 5 is the boss. */

import { FLOORS, ROOMS_PER_FLOOR, FLOOR_TUNING, ROOM_WEIGHTS, TRAPS, EVENTS, BOSSES, STAIR_GUARDS, MAGIC_LOOT, ROOM_FLAVOR } from "../data/tables.js";
import { rollDie, d20Roll, damageRoll, parseDamageParts } from "./dice.js";
import { xpForCR, encounterMultiplier, levelForXP, XP_TABLE } from "./rules.js";
import { monstersInBand, getMonster } from "../data/data.js";
import { materializeMonster, startCombat } from "./combat.js";
import * as C from "./character.js";
import { condEffects, advFor } from "./conditions.js";

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
  const tags = ["", "B", "C"];
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
export function nextRoom(run, ch){
  run.roomIndex += 1;
  const floor = run.floor;
  let type;
  if(run.roomIndex >= ROOMS_PER_FLOOR){
    type = (floor >= FLOORS) ? "boss" : "stairs";
  } else if(run.roomIndex === ROOMS_PER_FLOOR - 1 && !run.restRoomSeenThisFloor){
    type = "rest";                                       // guarantee at least one rest per floor
  } else {
    type = weightedPick(ROOM_WEIGHTS);
  }
  if(type === "rest") run.restRoomSeenThisFloor = true;

  const tune = FLOOR_TUNING[floor - 1];
  const room = { type, floor, index: run.roomIndex, resolved:false, flavor: flavor(type === "stairs" ? "stairs" : type === "boss" ? "boss" : type) };
  if(type === "combat") room.monsters = buildEncounter(ch, floor, tune.budget);
  else if(type === "stairs") room.monsters = buildEliteEncounter(ch, floor);
  else if(type === "boss") room.monsters = buildBoss();
  else if(type === "trap"){
    room.trap = pick(TRAPS.slice(0, Math.min(TRAPS.length, floor + 2)));   // deadlier traps only on deeper floors
    room.trapState = "hidden";
    room.detected = C.passivePerception(ch) >= room.trap.detectDC;
    if(room.detected) room.trapState = "detected";
  }
  else if(type === "treasure"){
    room.gold = rollGold(tune.gold);
    room.potion = Math.random() < tune.potionChance ? potionForFloor(floor) : null;
    const magicPool = MAGIC_LOOT[floor];
    room.magic = magicPool && Math.random() < 0.3 ? pick(magicPool) : null;
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
  }
  return reward;
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
    const res = d20Roll({ label:"Search (Perception)", rollType:"Check", mod: C.skillBonus(ch, "perception"), adv: advFor(eff, ["check","skill:perception"]) });
    events.push({t:"roll", res});
    if(res.total >= trap.detectDC){ room.trapState = "detected"; room.detected = true; events.push({t:"log", text:`You spot it: ${trap.name}!`}); }
    else { events.push({t:"log", text:"You find nothing… you'll have to chance it."}); room.trapState = "unfound"; }
    return { events };
  }
  if(action === "disarm"){
    const res = d20Roll({ label:`Disarm (${trap.disarmSkill})`, rollType:"Check", mod: C.skillBonus(ch, trap.disarmSkill), adv: advFor(eff, ["check","skill:"+trap.disarmSkill]) });
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
  if(room.magic){
    ch.equipment.weapons.push(room.magic);
    events.push({t:"sfx", name:"level-up"}, {t:"log", text:`You find a ${room.magic}!`});
  }
  room.resolved = true;
  return { events };
}

/* ---- Rest ---- */
export function shortRest(run, ch, diceToSpend){
  const events = [];
  if(Math.random() < 0.15){
    events.push({t:"log", text:"Something found you while you rested!"});
    return { events, ambush:true };
  }
  const cls = C.charClass(ch); const hd = (cls && cls.hd) || 8;
  let healed = 0;
  const n = Math.min(diceToSpend, ch.hp.hitDiceCur);
  for(let i = 0; i < n; i++){
    ch.hp.hitDiceCur -= 1;
    healed += Math.max(1, rollDie(hd) + C.abilityMod(ch, "con"));
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
  run.room.resolved = true;
  return { events, healed };
}
export function longRestHere(run, ch){
  const events = [];
  if(run.longRestUsedThisFloor){ events.push({t:"log", text:"You've already taken a long rest on this floor."}); return { events }; }
  if(Math.random() < 0.15){
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
