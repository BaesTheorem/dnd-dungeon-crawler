/* Turn-based combat engine. State in, state out; every mutation appends display events to state.events
   which the UI drains after each dispatch ({t:'roll'|'log'|'sfx'|'phase'}). Dice come from dice.js
   (crypto-backed); tests assert invariants and transitions, not exact rolls.

   Phases: 'player' → 'monster' → … ; terminal: 'victory' | 'fled' | 'dying' → ('defeat' | back to 'player').
   Design choice for solo play: at 0 HP monsters leave you for dead — you roll death saves alone rather
   than being coup-de-graced. Kinder than RAW, and it keeps a run winnable. */

import { d20Roll, damageRoll, rollDie, parseDamageParts } from "./dice.js";
import { condEffects, advFor, combineAdv, autofails } from "./conditions.js";
import { xpForCR, avgDamage } from "./rules.js";
import * as C from "./character.js";
import { monsterAttacks, monsterHasMultiattack, spellMechanics, getSpell } from "../data/data.js";

/* Materialize a bestiary monster into serializable combat state. */
export function materializeMonster(mon, tag = ""){
  return {
    key: mon.name.toLowerCase(), name: mon.name + (tag ? " " + tag : ""),
    ac: mon.ac || 10, hp: C.monsterMaxHP(mon), maxHP: C.monsterMaxHP(mon),
    dexMod: Math.floor(((mon.dex || 10) - 10) / 2),
    cr: mon.cr, crNum: mon.crNum,
    attacks: monsterAttacks(mon), multi: monsterHasMultiattack(mon),
    conditions: [],                       // [{k, save:{abil,dc}|null, rounds}]
    recharge: {},                         // attackName -> ready:boolean
    flavor: mon.type || "",
  };
}

export function startCombat(ch, monsters, { surprise = false, label = "" } = {}){
  const st = {
    phase:"player", round:1, label,
    monsters: monsters.map(m => ({...m})),
    playerDodge:false, playerBuffs:[], events:[],
    actionsLeft:1, attacksLeft:0, bonusUsed:false, usedSecondWindThisTurn:false,
    reactionUsed:false, pendingReaction:null, mq:null, barbsAdv:false,
    fledFailed:false, xp: monsters.reduce((a,m) => a + xpForCR(m.cr), 0),
  };
  // Initiative: player d20+dex vs group (highest monster dex). Ties go to the player.
  const eff = condEffects(ch.conditions, ch.exhaustion);
  const pInit = d20Roll({ label:"Initiative", rollType:"Initiative", mod: C.abilityMod(ch, "dex"), adv: advFor(eff, ["check"]) });
  const mMod = Math.max(...st.monsters.map(m => m.dexMod));
  const mInit = d20Roll({ label:"Enemy initiative", rollType:"Initiative", mod: mMod });
  st.events.push({t:"roll", res:pInit}, {t:"log", text:`Initiative: you ${pInit.total}, enemies ${mInit.total}.`});
  st.playerFirst = surprise ? false : pInit.total >= mInit.total;
  if(!st.playerFirst){
    st.phase = "monster";
    st.events.push({t:"log", text: surprise ? "You are ambushed!" : "The enemy moves first!"});
  } else {
    beginPlayerTurn(st, ch);
  }
  return st;
}

function beginPlayerTurn(st, ch){
  st.phase = "player";
  st.playerDodge = false;
  st.actionsLeft = 1;
  st.attacksLeft = 0;
  st.bonusUsed = false;
  st.reactionUsed = false;                                 // reactions refresh at the start of your turn
  st.mq = null;
  st.playerBuffs = st.playerBuffs.filter(b => b.until !== "turnStart");   // Shield expires now
  // Heroism buff: temp HP at the start of your turn.
  st.playerBuffs.forEach(b => { if(b.buff === "heroism") ch.hp.temp = Math.max(ch.hp.temp, b.mod || 1); });
  st.events.push({t:"phase", phase:"player"});
}

function livingMonsters(st){ return st.monsters.filter(m => m.hp > 0); }
export function combatOver(st){ return ["victory","defeat","fled","stabilized"].includes(st.phase); }

function monsterCondKeys(m){ return m.conditions.map(c => c.k); }

/* Advantage/disadvantage granted BY the target's state to an attacker. */
function advAgainstTarget(targetConds, melee, targetDodge){
  let adv = false, dis = false;
  const t = new Set(targetConds);
  if(["paralyzed","stunned","unconscious","petrified","restrained","blinded"].some(c => t.has(c))) adv = true;
  if(t.has("prone")){ if(melee) adv = true; else dis = true; }
  if(t.has("invisible")) dis = true;
  if(targetDodge) dis = true;
  if(adv && dis) return null;
  return adv ? "adv" : (dis ? "disadv" : null);
}
function autoCritVs(targetConds, melee){
  return melee && ["paralyzed","unconscious"].some(c => targetConds.includes(c));
}

function blessBonus(st){
  return st.playerBuffs.some(b => b.buff === "bless") ? rollDie(4) : 0;
}

function applyDamageToPlayer(st, ch, amount, source){
  let dmg = amount;
  if(ch.hp.temp > 0){ const t = Math.min(ch.hp.temp, dmg); ch.hp.temp -= t; dmg -= t; }
  ch.hp.cur = Math.max(0, ch.hp.cur - dmg);
  st.events.push({t:"sfx", name:"damage-taken"}, {t:"log", text:`You take ${amount} damage from ${source}.`});
  // Concentration check on damage.
  const conc = st.playerBuffs.filter(b => b.conc);
  if(conc.length && ch.hp.cur > 0){
    const dc = Math.max(10, Math.floor(amount / 2));
    const eff = condEffects(ch.conditions, ch.exhaustion);
    const res = d20Roll({ label:"Concentration (Con save)", rollType:"Save", mod: C.saveBonus(ch, "con"), adv: advFor(eff, ["save","save:con"]) });
    st.events.push({t:"roll", res});
    if(res.total < dc){
      st.playerBuffs = st.playerBuffs.filter(b => !b.conc);
      st.events.push({t:"log", text:`Concentration broken (DC ${dc}).`});
    }
  }
  if(ch.hp.cur <= 0){
    st.phase = "dying";
    st.playerBuffs = [];
    ch.deathSaves = {s:0, f:0};
    st.events.push({t:"sfx", name:"down"}, {t:"phase", phase:"dying"},
      {t:"log", text:"You collapse! The enemy leaves you for dead… Roll death saves."});
  }
}

function checkVictory(st, ch){
  if(livingMonsters(st).length === 0 && !combatOver(st)){
    st.phase = "victory";
    st.playerDodge = false;
    st.playerBuffs = st.playerBuffs.filter(b => !b.conc);
    ch.conditions = [];                                   // combat-applied conditions fade when the fight ends
    st.events.push({t:"sfx", name:"victory"}, {t:"phase", phase:"victory"},
      {t:"log", text:`Victory! You earn ${st.xp} XP.`});
    return true;
  }
  return false;
}

/* ---- Player actions ---- */
export function playerAttack(st, ch, weaponName, targetIdx){
  if(st.phase !== "player") return st;
  if(st.attacksLeft <= 0){
    if(st.actionsLeft <= 0) return st;
    st.actionsLeft -= 1;
    st.attacksLeft = 1 + C.extraAttacks(ch);
  }
  st.attacksLeft -= 1;
  const target = st.monsters[targetIdx];
  if(!target || target.hp <= 0) return st;
  const atk = C.weaponAttack(ch, weaponName);
  const eff = condEffects(ch.conditions, ch.exhaustion);
  let adv = combineAdv(advFor(eff, ["attack"]), advAgainstTarget(monsterCondKeys(target), !atk.ranged, false));
  if(st.barbsAdv){ adv = combineAdv(adv, "adv"); st.barbsAdv = false; }   // Silvery Barbs' self-empowerment
  const bb = blessBonus(st);
  const res = d20Roll({ label:`${atk.name} vs ${target.name}`, rollType:"Attack", mod: atk.toHit + bb, adv });
  st.events.push({t:"roll", res});
  const critFloor = /champion/i.test(ch.subclass || "") ? 19 : 20;
  const crit = (res.dice[0].v >= critFloor) || autoCritVs(monsterCondKeys(target), !atk.ranged);
  const hit = res.dice[0].v !== 1 && (res.dice[0].v >= critFloor || res.total >= target.ac);
  if(!hit){
    st.events.push({t:"sfx", name:"miss"}, {t:"log", text:`You miss ${target.name}.`});
  } else {
    const parts = atk.parts.map(p => ({...p, dice:[...p.dice]}));
    const sneak = C.sneakDice(ch);
    if(sneak && adv === "adv") parts.push({label:"Sneak Attack", type:parts[0]?.type || "", dice:[{n:sneak, d:6}], mod:0});
    const dmg = damageRoll({ label:`${atk.name} damage`, parts, crit });
    target.hp = Math.max(0, target.hp - dmg.total);
    st.events.push({t:"sfx", name: crit ? "crit" : "hit"}, {t:"roll", res:dmg},
      {t:"log", text:`${crit ? "CRITICAL! " : ""}${target.name} takes ${dmg.total} damage${target.hp <= 0 ? " and falls!" : ` (${target.hp}/${target.maxHP})`}.`});
    if(target.hp <= 0) st.events.push({t:"sfx", name:"kill"});
  }
  checkVictory(st, ch);
  return st;
}

export function playerCastSpell(st, ch, spellName, slotLevel, targetIdx){
  if(st.phase !== "player" || st.actionsLeft <= 0) return st;
  const mech = spellMechanics(spellName, ch.level);
  if(!mech) return st;
  const s = mech.spell;
  const isCantrip = s.level === 0;
  if(!isCantrip){
    const slot = ch.spells.slots[slotLevel];
    if(!slot || slot.cur <= 0) return st;
    slot.cur -= 1;
  }
  st.actionsLeft -= 1;
  st.attacksLeft = 0;
  st.events.push({t:"sfx", name:"spell"});
  const lbl = s.name + (!isCantrip && slotLevel > s.level ? ` (Lv ${slotLevel})` : "");
  const upcastParts = (parts) => {
    if(!parts || isCantrip || !mech.upcast || slotLevel <= (mech.upcast.at ?? s.level)) return parts;
    const extra = slotLevel - (mech.upcast.at ?? s.level);
    const up = /(\d+)d(\d+)/.exec(mech.upcast.up);
    if(!up) return parts;
    const out = parts.map(p => ({...p, dice:[...p.dice]}));
    out[0].dice.push({n: +up[1] * extra, d: +up[2]});
    return out;
  };

  if(mech.kind === "heal"){
    const dice = [...mech.heal.dice];
    if(!isCantrip && mech.upcast && slotLevel > s.level){
      const up = /(\d+)d(\d+)/.exec(mech.upcast.up);
      if(up) dice.push({n:+up[1] * (slotLevel - s.level), d:+up[2]});
    }
    const modV = mech.heal.addMod ? C.abilityMod(ch, C.castingAbility(ch)) : 0;
    const res = damageRoll({ label:lbl, rollType:"Healing", parts:[{label:"healing", type:"", dice, mod:modV}] });
    ch.hp.cur = Math.min(C.computeMaxHP(ch), ch.hp.cur + res.total);
    st.events.push({t:"roll", res}, {t:"sfx", name:"heal"}, {t:"log", text:`You regain ${res.total} HP (${ch.hp.cur}/${ch.hp.max}).`});
  } else if(mech.kind === "buff"){
    if(mech.buff === "mageArmor"){                        // 8-hour spell: persists across fights until long rest
      ch.effects = (ch.effects || []).filter(b => b.buff !== "mageArmor");
      ch.effects.push({ buff:"mageArmor", label:mech.label });
      st.events.push({t:"log", text:`${mech.label} — lasts until your next long rest.`});
    } else {
      st.playerBuffs = st.playerBuffs.filter(b => !(b.conc && s.conc));   // one concentration effect at a time
      st.playerBuffs.push({ buff:mech.buff, amount:mech.amount, label:mech.label, conc: !!s.conc,
        mod: mech.buff === "heroism" ? C.abilityMod(ch, C.castingAbility(ch)) : 0 });
      st.events.push({t:"log", text:`${mech.label} active.`});
    }
  } else if(mech.kind === "attack"){
    const target = st.monsters[targetIdx];
    if(!target || target.hp <= 0) return st;
    const eff = condEffects(ch.conditions, ch.exhaustion);
    const adv = combineAdv(advFor(eff, ["attack"]), advAgainstTarget(monsterCondKeys(target), false, false));
    const bb = blessBonus(st);
    const res = d20Roll({ label:`${lbl} vs ${target.name}`, rollType:"Spell attack", mod: (C.spellAttackBonus(ch) || 0) + bb, adv });
    st.events.push({t:"roll", res});
    const crit = res.dice[0].v === 20;
    const hit = res.dice[0].v !== 1 && (crit || res.total >= target.ac);
    if(!hit){ st.events.push({t:"sfx", name:"miss"}, {t:"log", text:`${lbl} misses ${target.name}.`}); }
    else {
      const dmg = damageRoll({ label:`${lbl} damage`, parts: upcastParts(mech.parts), crit });
      target.hp = Math.max(0, target.hp - dmg.total);
      st.events.push({t:"sfx", name: crit ? "crit" : "spell-hit"}, {t:"roll", res:dmg},
        {t:"log", text:`${crit ? "CRITICAL! " : ""}${target.name} takes ${dmg.total} damage${target.hp <= 0 ? " and falls!" : ""}.`});
      if(target.hp <= 0) st.events.push({t:"sfx", name:"kill"});
    }
  } else if(mech.kind === "save"){
    const dc = C.spellSaveDC(ch) || 10;
    // AoE save spells hit every living monster; single-target ones hit the chosen target.
    const aoe = /each creature|all creatures/i.test(s.text || "");
    const targets = aoe ? livingMonsters(st) : [st.monsters[targetIdx]].filter(m => m && m.hp > 0);
    targets.forEach(target => {
      const saveMod = target.dexMod;                    // bestiary blob lacks per-save mods; dex mod is the common case
      const sv = d20Roll({ label:`${target.name} ${mech.save.toUpperCase()} save`, rollType:"Save", mod:saveMod });
      st.events.push({t:"roll", res:sv});
      const failed = sv.total < dc;
      if(mech.parts){
        const dmg = damageRoll({ label:`${lbl} damage`, parts: upcastParts(mech.parts) });
        const dealt = failed ? dmg.total : (mech.halfOnSave ? Math.floor(dmg.total / 2) : 0);
        target.hp = Math.max(0, target.hp - dealt);
        st.events.push({t:"roll", res:dmg}, {t:"sfx", name: dealt ? "spell-hit" : "miss"},
          {t:"log", text:`${target.name} ${failed ? "fails" : "saves"} (DC ${dc}) — takes ${dealt} damage${target.hp <= 0 ? " and falls!" : ""}.`});
        if(target.hp <= 0) st.events.push({t:"sfx", name:"kill"});
      }
      if(failed && mech.condition){
        target.conditions.push({ k:mech.condition, save:{abil:mech.save, dc}, rounds:10 });
        st.events.push({t:"log", text:`${target.name} is ${mech.condition}!`});
      }
      if(!mech.parts && !failed) st.events.push({t:"log", text:`${target.name} resists ${lbl} (DC ${dc}).`});
    });
    if(s.conc) st.playerBuffs.push({ buff:"conc-marker", label:`Concentrating: ${s.name}`, conc:true });
  } else {
    st.events.push({t:"log", text:`You cast ${lbl}.`});
  }
  checkVictory(st, ch);
  return st;
}

export function playerDodge(st, ch){
  if(st.phase !== "player" || st.actionsLeft <= 0) return st;
  st.actionsLeft -= 1; st.attacksLeft = 0;
  st.playerDodge = true;
  st.events.push({t:"log", text:"You take the Dodge action — attacks against you have disadvantage until your next turn."});
  return st;
}

export function playerUsePotion(st, ch, itemIdx){
  if(st.phase !== "player" || st.bonusUsed) return st;
  const item = ch.equipment.items[itemIdx];
  if(!item || !/potion of .*healing/i.test(item.name) || item.qty <= 0) return st;
  st.bonusUsed = true;                                    // house rule: potions are a bonus action (keeps solo fights moving)
  item.qty -= 1;
  if(item.qty <= 0) ch.equipment.items.splice(itemIdx, 1);
  const tiers = { "potion of healing":[2,4,2], "potion of greater healing":[4,4,4], "potion of superior healing":[8,4,8], "potion of supreme healing":[10,4,20] };
  const [n, d, m] = tiers[item.name.toLowerCase()] || [2,4,2];
  const res = damageRoll({ label:item.name, rollType:"Healing", parts:[{label:"healing", type:"", dice:[{n, d}], mod:m}] });
  ch.hp.cur = Math.min(C.computeMaxHP(ch), ch.hp.cur + res.total);
  st.events.push({t:"roll", res}, {t:"sfx", name:"heal"}, {t:"log", text:`You drink a ${item.name}: +${res.total} HP (${ch.hp.cur}/${ch.hp.max}).`});
  return st;
}

export function playerSecondWind(st, ch){
  if(st.phase !== "player" || st.bonusUsed) return st;
  const r = ch.resources.secondWind;
  if(!r || r.cur <= 0) return st;
  r.cur -= 1; st.bonusUsed = true;
  const res = damageRoll({ label:"Second Wind", rollType:"Healing", parts:[{label:"healing", type:"", dice:[{n:1, d:10}], mod:ch.level}] });
  ch.hp.cur = Math.min(C.computeMaxHP(ch), ch.hp.cur + res.total);
  st.events.push({t:"roll", res}, {t:"sfx", name:"heal"}, {t:"log", text:`Second Wind: +${res.total} HP (${ch.hp.cur}/${ch.hp.max}).`});
  return st;
}

export function playerActionSurge(st, ch){
  if(st.phase !== "player") return st;
  const r = ch.resources.actionSurge;
  if(!r || r.cur <= 0) return st;
  r.cur -= 1;
  st.actionsLeft += 1;
  st.events.push({t:"log", text:"Action Surge! You gain an additional action."});
  return st;
}

export function playerChannelDivinity(st, ch){
  if(st.phase !== "player" || st.actionsLeft <= 0) return st;
  const r = ch.resources.channelDivinity;
  if(!r || r.cur <= 0) return st;
  r.cur -= 1; st.actionsLeft -= 1; st.attacksLeft = 0;
  const heal = Math.min(5 * ch.level, Math.max(0, Math.floor(C.computeMaxHP(ch) / 2) - ch.hp.cur) + 5 * ch.level);
  const amt = 5 * ch.level;
  ch.hp.cur = Math.min(C.computeMaxHP(ch), ch.hp.cur + amt);
  st.events.push({t:"sfx", name:"heal"}, {t:"log", text:`Channel Divinity — Preserve Life: +${amt} HP (${ch.hp.cur}/${ch.hp.max}).`});
  return st;
}

export function playerFlee(st, ch, floor = 1){
  if(st.phase !== "player" || st.actionsLeft <= 0) return st;
  st.actionsLeft -= 1; st.attacksLeft = 0;
  const dc = 10 + floor;
  const eff = condEffects(ch.conditions, ch.exhaustion);
  const ath = C.skillBonus(ch, "athletics"), acr = C.skillBonus(ch, "acrobatics");
  const useAth = ath >= acr;
  const res = d20Roll({ label:`Flee (${useAth ? "Athletics" : "Acrobatics"})`, rollType:"Check",
    mod: useAth ? ath : acr, adv: advFor(eff, ["check", "skill:" + (useAth ? "athletics" : "acrobatics")]) });
  st.events.push({t:"roll", res});
  if(res.total >= dc){
    st.phase = "fled";
    ch.conditions = [];
    st.events.push({t:"phase", phase:"fled"}, {t:"log", text:"You slip away into the dark! (No XP or loot from this room.)"});
  } else {
    st.fledFailed = true;
    st.events.push({t:"log", text:`You fail to escape (DC ${dc})! The enemy closes in.`});
    endPlayerTurn(st, ch);
  }
  return st;
}

export function endPlayerTurn(st, ch){
  if(st.phase !== "player") return st;
  st.phase = "monster";
  st.events.push({t:"phase", phase:"monster"});
  return st;
}

/* ---- Monster turn: a STEP MACHINE so a swing can pause for the player's reaction (Shield /
   Silvery Barbs). The UI calls monsterStep() repeatedly; a pending reaction suspends the queue
   until reactionChoose() resolves it. Everything in st.mq / st.pendingReaction is JSON-safe, so
   a mid-turn refresh restores exactly. ---- */

function buildMonsterQueue(st){
  const q = [];
  st.monsters.forEach((m, mi) => { if(m.hp > 0) q.push({kind:"act", mi}, {kind:"upkeep", mi}); });
  return q;
}

/* Advance the monster phase by one step. Returns false when there is nothing to do
   (not monster phase, or waiting on a reaction). */
export function monsterStep(st, ch){
  if(st.phase !== "monster" || st.pendingReaction) return false;
  if(!st.mq) st.mq = buildMonsterQueue(st);
  const step = st.mq.shift();
  if(!step){
    st.round += 1;
    beginPlayerTurn(st, ch);
    return true;
  }
  const m = st.monsters[step.mi];
  if(!m || m.hp <= 0) return true;
  if(step.kind === "upkeep"){
    m.conditions = m.conditions.filter(c => {
      c.rounds -= 1;
      if(c.rounds <= 0){ st.events.push({t:"log", text:`${m.name} is no longer ${c.k}.`}); return false; }
      if(c.save){
        const sv = d20Roll({ label:`${m.name} shakes it off?`, rollType:"Save", mod:m.dexMod });
        if(sv.total >= c.save.dc){ st.events.push({t:"log", text:`${m.name} shakes off ${c.k}.`}); return false; }
      }
      return true;
    });
    return true;
  }
  // act: choose an attack, queue its swings ahead of this monster's upkeep
  const incap = m.conditions.some(c => ["paralyzed","stunned","unconscious","petrified","incapacitated"].includes(c.k));
  if(incap){ st.events.push({t:"log", text:`${m.name} is ${m.conditions[0].k} and cannot act.`}); return true; }
  const attacks = m.attacks;
  if(!attacks.length) return true;
  attacks.forEach(a => {
    if(a.recharge != null && m.recharge[a.name] === false){
      if(rollDie(6) >= a.recharge) m.recharge[a.name] = true;
    }
  });
  const ready = attacks.filter(a => a.recharge == null || m.recharge[a.name] !== false);
  ready.sort((a, b) => avgDamage(b.parts) - avgDamage(a.parts));
  const chosen = ready[0] || attacks[0];
  if(chosen.recharge != null) m.recharge[chosen.name] = false;
  const swings = (m.multi && !chosen.save) ? 2 : 1;
  const swingSteps = Array.from({length: swings}, () => ({kind:"swing", mi: step.mi, atk: chosen}));
  st.mq.unshift(...swingSteps);
  // execute the first swing immediately so each step visibly does something
  return doSwing(st, ch);
}

function doSwing(st, ch){
  const step = st.mq.shift();
  if(!step || step.kind !== "swing") { if(step) st.mq.unshift(step); return true; }
  const m = st.monsters[step.mi];
  if(!m || m.hp <= 0) return true;
  if(step.atk.save) monsterSaveAttack(st, ch, m, step.atk);
  else attemptSwing(st, ch, step.mi, m, step.atk);
  return true;
}

const knowsSpell = (ch, name) => (ch.spells.known || []).some(n => n.toLowerCase() === name.toLowerCase());
function lowestSlot(ch, minLvl = 1){
  const lvls = Object.keys(ch.spells.slots || {}).map(Number).filter(l => l >= minLvl && ch.spells.slots[l].cur > 0);
  return lvls.length ? Math.min(...lvls) : null;
}

function attemptSwing(st, ch, mi, m, atk){
  const mEff = condEffects(monsterCondKeys(m), 0);
  const adv = combineAdv(advFor(mEff, ["attack"]), advAgainstTarget([...ch.conditions], true, st.playerDodge));
  const res = d20Roll({ label:`${m.name} — ${atk.name}`, rollType:"Attack", mod:atk.toHit, adv });
  st.events.push({t:"roll", res});
  const ac = C.armorClass(ch, st.playerBuffs);
  const crit = res.dice[0].v === 20;
  const hit = res.dice[0].v !== 1 && (crit || res.total >= ac);
  if(!hit){
    st.events.push({t:"sfx", name:"monster-miss"}, {t:"log", text:`${m.name}'s ${atk.name} misses you.`});
    return;
  }
  // Reaction window: offer Shield only when +5 AC would turn this hit into a miss (never vs a nat 20);
  // offer Silvery Barbs on any hit including crits (the reroll can cancel one).
  if(!st.reactionUsed && st.phase === "monster"){
    const options = [];
    if(knowsSpell(ch, "Shield") && lowestSlot(ch) != null && !crit && res.total < ac + 5) options.push("shield");
    if(knowsSpell(ch, "Silvery Barbs") && lowestSlot(ch) != null) options.push("barbs");
    if(options.length){
      st.pendingReaction = { mi, atk, res, crit, ac, options };
      st.events.push({t:"log", text:`${m.name}'s ${atk.name} is about to hit you (${res.total} vs AC ${ac})…`});
      return;
    }
  }
  resolveSwingHit(st, ch, m, atk, res, crit);
}

function resolveSwingHit(st, ch, m, atk, res, crit){
  const dmg = damageRoll({ label:`${atk.name} damage`, parts:atk.parts, crit });
  st.events.push({t:"roll", res:dmg});
  if(crit) st.events.push({t:"log", text:`${m.name} scores a critical hit!`});
  applyDamageToPlayer(st, ch, dmg.total, m.name);
  if(st.phase !== "dying" && atk.condition && !ch.conditions.includes(atk.condition)){
    if(atk.condSave){
      const eff = condEffects(ch.conditions, ch.exhaustion);
      const auto = autofails(ch.conditions).has(atk.condSave.abil);
      const sv = auto ? null : d20Roll({ label:`${atk.condSave.abil.toUpperCase()} save vs ${atk.condition}`, rollType:"Save",
        mod: C.saveBonus(ch, atk.condSave.abil), adv: advFor(eff, ["save", "save:" + atk.condSave.abil]) });
      if(sv) st.events.push({t:"roll", res:sv});
      if(auto || sv.total < atk.condSave.dc){
        ch.conditions.push(atk.condition);
        st.events.push({t:"log", text:`You are ${atk.condition}!`});
      }
    }
  }
}

/* Resolve a pending reaction: 'shield' | 'barbs' | 'decline'. */
export function reactionChoose(st, ch, choice){
  const pr = st.pendingReaction;
  if(!pr) return st;
  st.pendingReaction = null;
  const m = st.monsters[pr.mi];
  if(choice === "shield"){
    const sl = lowestSlot(ch);
    if(sl != null){
      ch.spells.slots[sl].cur -= 1;
      st.reactionUsed = true;
      st.playerBuffs.push({ buff:"acBonus", amount:5, until:"turnStart", label:"Shield (+5 AC)" });
      st.events.push({t:"sfx", name:"spell"}, {t:"log", text:`⚡ Reaction — Shield! Your AC leaps to ${pr.ac + 5} until your next turn.`});
      const newAC = C.armorClass(ch, st.playerBuffs);
      if(!pr.crit && pr.res.total < newAC){
        st.events.push({t:"sfx", name:"monster-miss"}, {t:"log", text:`${m.name}'s ${pr.atk.name} glances off the shimmering barrier!`});
        return st;
      }
    }
    resolveSwingHit(st, ch, m, pr.atk, pr.res, pr.crit);
    return st;
  }
  if(choice === "barbs"){
    const sl = lowestSlot(ch);
    if(sl != null){
      ch.spells.slots[sl].cur -= 1;
      st.reactionUsed = true;
      st.barbsAdv = true;                                  // you also empower yourself: advantage on your next attack
      const r2 = rollDie(20);
      const orig = pr.res.dice[0].v;
      const kept = Math.min(orig, r2);
      const total = kept + (pr.res.mod || 0);
      st.events.push({t:"sfx", name:"spell"},
        {t:"log", text:`⚡ Reaction — Silvery Barbs! ${m.name} rerolls: ${orig} → ${r2}, keeps ${kept}.`});
      const crit = kept === 20;
      const hit = kept !== 1 && (crit || total >= pr.ac);
      if(!hit){
        st.events.push({t:"sfx", name:"monster-miss"}, {t:"log", text:`${m.name}'s ${pr.atk.name} falters and misses!`});
        return st;
      }
      resolveSwingHit(st, ch, m, pr.atk, { ...pr.res, dice:[{d:20, v:kept}], total }, crit);
      return st;
    }
  }
  resolveSwingHit(st, ch, m, pr.atk, pr.res, pr.crit);
  return st;
}

/* Compatibility wrapper (tests + monsters-first openings): run the whole monster phase,
   auto-declining any reaction windows. */
export function monsterTurn(st, ch){
  let guard = 300;
  while(st.phase === "monster" && guard-- > 0){
    if(st.pendingReaction) reactionChoose(st, ch, "decline");
    else monsterStep(st, ch);
  }
  return st;
}

function monsterSaveAttack(st, ch, m, atk){
  const auto = autofails(ch.conditions).has(atk.save.abil);
  const eff = condEffects(ch.conditions, ch.exhaustion);
  const sv = auto ? null : d20Roll({ label:`${atk.save.abil.toUpperCase()} save vs ${m.name}'s ${atk.name}`, rollType:"Save",
    mod: C.saveBonus(ch, atk.save.abil), adv: advFor(eff, ["save", "save:" + atk.save.abil]) });
  if(sv) st.events.push({t:"roll", res:sv});
  const failed = auto || sv.total < atk.save.dc;
  const dmg = damageRoll({ label:`${atk.name} damage`, parts:atk.parts });
  st.events.push({t:"roll", res:dmg});
  const dealt = failed ? dmg.total : (atk.halfOnSave ? Math.floor(dmg.total / 2) : 0);
  if(dealt > 0) applyDamageToPlayer(st, ch, dealt, `${m.name}'s ${atk.name}`);
  else st.events.push({t:"log", text:`You evade ${m.name}'s ${atk.name}!`});
  if(failed && st.phase !== "dying" && atk.condition && !ch.conditions.includes(atk.condition)){
    ch.conditions.push(atk.condition);
    st.events.push({t:"log", text:`You are ${atk.condition}!`});
  }
}

/* ---- Death saves (phase 'dying'; one roll per tap) ---- */
export function deathSave(st, ch){
  if(st.phase !== "dying") return st;
  const res = d20Roll({ label:"Death saving throw", rollType:"Death save", mod:0 });
  st.events.push({t:"roll", res});
  if(res.nat === 20){
    ch.hp.cur = 1; ch.deathSaves = {s:0, f:0};
    beginPlayerTurn(st, ch);
    st.events.push({t:"sfx", name:"heal"}, {t:"log", text:"Natural 20! You surge back to your feet with 1 HP!"});
    return st;
  }
  if(res.nat === 1) ch.deathSaves.f += 2;
  else if(res.total >= 10) ch.deathSaves.s += 1;
  else ch.deathSaves.f += 1;
  st.events.push({t:"log", text:`Death saves: ${ch.deathSaves.s} successes, ${ch.deathSaves.f} failures.`});
  if(ch.deathSaves.f >= 3){
    st.phase = "defeat";
    ch.status = "dead";
    st.events.push({t:"sfx", name:"death"}, {t:"phase", phase:"defeat"}, {t:"log", text:"You die in the dark, far from home."});
  } else if(ch.deathSaves.s >= 3){
    st.phase = "stabilized";
    ch.deathSaves = {s:0, f:0};
    ch.hp.cur = 1;                                        // stabilized solo = you eventually come to at 1 HP
    st.events.push({t:"phase", phase:"stabilized"}, {t:"log", text:"You stabilize… and later drag yourself up with 1 HP. The enemy has moved on."});
  }
  return st;
}
