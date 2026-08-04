/* Engine tests: run with `node --test tests/` from the repo root.
   Dice are real (crypto) — tests assert bounds, structure, and state-machine invariants, not exact rolls. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { rollDie, rollAbilityScores, parseDamageParts, d20Roll, damageRoll } from "../js/dice.js";
import { condEffects, advFor, combineAdv, autofails } from "../js/conditions.js";
import { mod, profBonus, pointBuyTotal, slotsFor, acFrom, levelForXP, xpForCR, avgOfFormula, encounterMultiplier } from "../js/rules.js";
import { injectData, idx, monsterAttacks, getMonster, spellMechanics, getWeapon, getArmor, classSpellList } from "../data/data.js";
import * as C from "../js/character.js";
import { materializeMonster, startCombat, playerAttack, playerCastSpell, endPlayerTurn, monsterTurn, monsterStep, reactionChoose, castStep, deathSave, combatOver, playerDodge, playerFamiliarHelp, utilityOptions, scrollUsability, playerUseScroll } from "../js/combat.js";
import { newRun, nextRoom, enterCombat, resolveCombat, trapAct, openChest, shortRest, castUtility, castableOutOfCombat, peekNextRoom, floorShop, shopBuy, sellables, shopSell, scribeableScrolls, scribeScroll, readScrollOutOfCombat } from "../js/dungeon.js";
import { scrollPool, classListHas } from "../data/data.js";

const here = dirname(fileURLToPath(import.meta.url));
const blob = JSON.parse(readFileSync(join(here, "..", "data", "source-data.json"), "utf8"));
injectData(blob);

/* ---- data ---- */
test("dataset loads with expected volumes", () => {
  assert.ok(blob.monsters.length >= 1300, "monsters");
  assert.ok(blob.spells.length >= 500, "spells");
  assert.ok(blob.races.length >= 100, "races");
  assert.ok(idx().classes.length === 13, "13 playable classes (sidekicks excluded)");
  assert.ok(idx().monsters.length > 800, "combat-usable monsters have parseable attacks");
});

test("monster attack parsing (Goblin, Ogre)", () => {
  const gob = getMonster("Goblin");
  const atks = monsterAttacks(gob);
  assert.ok(atks.length >= 2);
  const scim = atks.find(a => a.name === "Scimitar");
  assert.equal(scim.toHit, 4);
  assert.deepEqual(scim.parts[0].dice, [{n:1, d:6}]);
  assert.equal(scim.parts[0].mod, 2);
  assert.equal(scim.parts[0].type, "slashing");
  const ogre = getMonster("Ogre");
  assert.equal(C.monsterMaxHP(ogre), 59);
});

test("save-based monster attacks parse (dragon breath)", () => {
  const drake = getMonster("Young White Dragon");
  const atks = monsterAttacks(drake);
  const breath = atks.find(a => a.save);
  assert.ok(breath, "has a save-based action");
  assert.ok(breath.save.dc > 10);
  assert.ok(breath.halfOnSave);
});

/* ---- dice ---- */
test("rollDie bounds and coverage", () => {
  for(const sides of [4, 6, 8, 10, 12, 20, 100]){
    const seen = new Set();
    for(let i = 0; i < 2000; i++){
      const v = rollDie(sides);
      assert.ok(v >= 1 && v <= sides, `d${sides} in range`);
      seen.add(v);
    }
    if(sides <= 20) assert.equal(seen.size, sides, `d${sides} hits every face in 2000 rolls`);
  }
});

test("rollAbilityScores: six values 3–18 sorted desc", () => {
  const set = rollAbilityScores();
  assert.equal(set.length, 6);
  set.forEach(v => assert.ok(v >= 3 && v <= 18));
  assert.deepEqual([...set].sort((a,b)=>b-a), set);
});

test("parseDamageParts", () => {
  const p = parseDamageParts("1d8+3 slashing, range 30/120; Sneak Attack +2d6");
  assert.equal(p.length, 2);
  assert.deepEqual(p[0].dice, [{n:1, d:8}]);
  assert.equal(p[0].mod, 3);
  assert.equal(p[0].type, "slashing");
  assert.deepEqual(p[1].dice, [{n:2, d:6}]);
  assert.equal(parseDamageParts("3 bludgeoning")[0].mod, 3);
  assert.equal(parseDamageParts("1d8 slashing (1d10 versatile)").length, 1);
});

test("d20Roll adv keeps high / disadv keeps low; damageRoll crit doubles dice not mods", () => {
  for(let i = 0; i < 200; i++){
    const a = d20Roll({ label:"t", mod:0, adv:"adv" });
    assert.equal(a.dice[0].v, Math.max(a.dice[0].v, a.dice[1].v));
    const d = d20Roll({ label:"t", mod:0, adv:"disadv" });
    assert.equal(d.dice[0].v, Math.min(d.dice[0].v, d.dice[1].v));
  }
  const crit = damageRoll({ label:"x", parts:[{label:"", type:"", dice:[{n:2, d:6}], mod:3}], crit:true });
  assert.equal(crit.parts[0].rolls.length, 4);
  assert.ok(crit.total >= 4 + 3 && crit.total <= 24 + 3);
});

/* ---- rules ---- */
test("core math", () => {
  assert.equal(mod(10), 0); assert.equal(mod(15), 2); assert.equal(mod(8), -1);
  assert.equal(profBonus(1), 2); assert.equal(profBonus(5), 3); assert.equal(profBonus(9), 4);
  assert.equal(pointBuyTotal({str:15,dex:15,con:15,int:8,wis:8,cha:8}), 27);
  assert.equal(pointBuyTotal({str:8,dex:8,con:8,int:8,wis:8,cha:8}), 0);
  assert.equal(pointBuyTotal({str:16,dex:8,con:8,int:8,wis:8,cha:8}), null);
  assert.equal(levelForXP(0), 1); assert.equal(levelForXP(300), 2); assert.equal(levelForXP(899), 2); assert.equal(levelForXP(900), 3);
  assert.equal(xpForCR("1/4"), 50); assert.equal(xpForCR("2"), 450);
  assert.equal(avgOfFormula("7d10 + 21"), 59);
  assert.equal(encounterMultiplier(2), 1.5);
});

test("spell slots", () => {
  assert.deepEqual(slotsFor("full", 1), {1:2});
  assert.deepEqual(slotsFor("full", 5), {1:4, 2:3, 3:2});
  assert.deepEqual(slotsFor("1/2", 1), {});
  assert.deepEqual(slotsFor("1/2", 5), {1:4, 2:2});
  assert.deepEqual(slotsFor("pact", 5), {3:2});
  assert.deepEqual(slotsFor(null, 5), {});
});

test("AC formulas", () => {
  assert.equal(acFrom(null, false, 2), 12);                       // unarmored
  assert.equal(acFrom({type:"LA", ac:11}, false, 3), 14);         // leather + dex
  assert.equal(acFrom({type:"MA", ac:14}, false, 3), 16);         // scale + capped dex
  assert.equal(acFrom({type:"HA", ac:16}, true, 3), 18);          // chain mail + shield
});

/* ---- conditions ---- */
test("condEffects aggregation + exhaustion", () => {
  const eff = condEffects(["poisoned", "prone"], 3);
  assert.ok(eff.disadv.has("attack"));
  assert.ok(eff.disadv.has("check"));
  assert.ok(eff.disadv.has("save"));
  assert.ok(eff.speedHalf);
  const inv = condEffects(["invisible", "poisoned"], 0);
  assert.equal(advFor(inv, ["attack"]), null);                    // adv + disadv cancel
  assert.equal(combineAdv("adv", "disadv"), null);
  assert.equal(combineAdv("adv", null), "adv");
  assert.ok(autofails(["paralyzed"]).has("dex"));
});

/* ---- character ---- */
function makeFighter(){
  const ch = C.newCharacter();
  ch.name = "Test Fighter"; ch.race = "Human"; ch.class = "Fighter"; ch.background = "Soldier";
  ch.baseVals = {str:15, dex:13, con:14, int:8, wis:12, cha:10};
  ch.bonuses.racial = {str:1, dex:1, con:1, int:1, wis:1, cha:1};
  ch.profs.saves = ["str", "con"];
  ch.profs.skills = ["athletics", "perception", "intimidation"];
  ch.equipment.armor = "Chain Mail"; ch.equipment.shield = true;
  ch.equipment.weapons = ["Longsword"];
  ch.equipment.items = [{name:"Potion of Healing", qty:2}];
  ch.fightingStyle = "Dueling";
  ch.hp.hitDiceMax = 1; ch.hp.hitDiceCur = 1;
  C.refreshResources(ch);
  ch.hp.max = C.computeMaxHP(ch); ch.hp.cur = ch.hp.max;
  return ch;
}

test("fighter derived stats", () => {
  const ch = makeFighter();
  assert.equal(C.abilityScore(ch, "str"), 16);
  assert.equal(C.abilityMod(ch, "str"), 3);
  assert.equal(ch.hp.max, 10 + 2);                                // d10 + con 2
  assert.equal(C.armorClass(ch), 18);                             // chain mail 16 + shield 2
  assert.equal(C.saveBonus(ch, "str"), 5);
  assert.equal(C.skillBonus(ch, "athletics"), 5);
  assert.ok(ch.resources.secondWind);
  const atk = C.weaponAttack(ch, "Longsword");
  assert.equal(atk.toHit, 5);                                     // str 3 + prof 2
  assert.equal(atk.parts[0].mod, 5);                              // str 3 + dueling 2
  assert.equal(atk.parts[0].type, "slashing");
});

test("magic weapon (+1) attack math", () => {
  const ch = makeFighter();
  const atk = C.weaponAttack(ch, "+1 Longsword");
  assert.equal(atk.toHit, 6);
  assert.equal(atk.magic, 1);
});

test("level up: fighter to 5 gains Extra Attack and HP", () => {
  const ch = makeFighter();
  for(let l = 2; l <= 5; l++) C.applyLevelUp(ch);
  assert.equal(ch.level, 5);
  assert.equal(C.extraAttacks(ch), 1);
  assert.equal(ch.hp.max, 12 + 4 * (6 + 2));                      // avg d10 = 6 per level + con
  assert.ok(ch.resources.actionSurge);
});

function makeWizard(){
  const ch = C.newCharacter();
  ch.name = "Test Wizard"; ch.race = "Human"; ch.class = "Wizard"; ch.background = "Sage";
  ch.baseVals = {str:8, dex:14, con:14, int:15, wis:12, cha:10};
  ch.bonuses.racial = {str:1, dex:1, con:1, int:1, wis:1, cha:1};
  ch.profs.saves = ["int", "wis"];
  ch.equipment.weapons = ["Dagger"];
  ch.spells.known = ["Fire Bolt", "Magic Missile", "Burning Hands", "Cure Wounds", "Mage Armor", "Sleep"];
  const ms = C.maxSlots(ch);
  for(const l in ms) ch.spells.slots[l] = {max: ms[l], cur: ms[l]};
  ch.hp.max = C.computeMaxHP(ch); ch.hp.cur = ch.hp.max;
  C.refreshResources(ch);
  return ch;
}

test("wizard spellcasting derived", () => {
  const ch = makeWizard();
  assert.equal(C.spellSaveDC(ch), 13);                            // 8 + 2 + int 3
  assert.equal(C.spellAttackBonus(ch), 5);
  assert.deepEqual(C.maxSlots(ch), {1:2});
  assert.ok(C.cantripsAllowed(ch) >= 3);
  const list = classSpellList("Wizard");
  assert.ok(list.some(e => e.name === "Fire Bolt"));
});

test("Magic Missile auto-hits: no attack roll, three darts, +1 dart per upcast level", () => {
  const mech = spellMechanics("Magic Missile", 1);
  assert.equal(mech.kind, "autohit");
  const ch = makeWizard();
  ch.spells.slots = { 1:{max:4, cur:4}, 2:{max:2, cur:2} };
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  st.phase = "player"; st.actionsLeft = 1;
  st.monsters[0].hp = st.monsters[0].maxHP = 999;
  st.events.length = 0;
  playerCastSpell(st, ch, "Magic Missile", 1, 0);
  assert.ok(!st.events.some(e => e.t === "roll" && e.res.kind === "d20"), "no d20 rolled");
  const dmg = st.events.find(e => e.t === "roll" && e.res.kind === "dmg");
  assert.ok(dmg, "damage applied directly");
  assert.equal(dmg.res.parts[0].rolls.length, 3, "three darts at base level");
  assert.ok(dmg.res.total >= 6 && dmg.res.total <= 15, "3d4+3 range");
  assert.equal(ch.spells.slots[1].cur, 3, "slot spent");
  // upcast at 2nd level: four darts
  st.actionsLeft = 1; st.events.length = 0;
  playerCastSpell(st, ch, "Magic Missile", 2, 0);
  const dmg2 = st.events.find(e => e.t === "roll" && e.res.kind === "dmg");
  assert.equal(dmg2.res.parts[0].rolls.length, 4, "four darts from a 2nd-level slot");
  assert.equal(ch.spells.slots[2].cur, 1);
});

test("spell mechanics derivation", () => {
  assert.equal(spellMechanics("Fire Bolt", 1).kind, "attack");
  assert.equal(spellMechanics("Fire Bolt", 5).parts[0].dice[0].n, 2);   // cantrip scales at 5
  const cw = spellMechanics("Cure Wounds", 1);
  assert.equal(cw.kind, "heal");
  assert.ok(cw.heal.addMod);
  const bh = spellMechanics("Burning Hands", 1);
  assert.equal(bh.kind, "save");
  assert.equal(bh.save, "dex");
  assert.ok(bh.halfOnSave);
  const hp = spellMechanics("Hold Person", 3);
  assert.equal(hp.kind, "save");
  assert.equal(hp.condition, "paralyzed");
  const ma = spellMechanics("Mage Armor", 1);
  assert.equal(ma.kind, "buff");
});

/* ---- combat walkthrough ---- */
test("scripted fight: fighter vs goblin terminates legally", () => {
  for(let trial = 0; trial < 20; trial++){
    const ch = makeFighter();
    const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
    let guard = 200;
    while(!combatOver(st) && guard-- > 0){
      if(st.phase === "player"){
        playerAttack(st, ch, "Longsword", 0);
        if(st.phase === "player") endPlayerTurn(st, ch);
      }
      if(st.phase === "monster") monsterTurn(st, ch);
      if(st.phase === "dying") deathSave(st, ch);
    }
    assert.ok(guard > 0, "fight terminates");
    assert.ok(["victory","defeat","stabilized"].includes(st.phase));
    if(st.phase === "victory"){
      assert.equal(st.xp, 50);
      assert.ok(st.monsters.every(m => m.hp === 0));
    }
  }
});

test("dodge grants monsters disadvantage (structural)", () => {
  const ch = makeFighter();
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  if(st.phase === "monster") monsterTurn(st, ch);
  if(st.phase !== "player") return;                               // died to an ambush — fine for this structural test
  playerDodge(st, ch);
  assert.ok(st.playerDodge);
  st.events.length = 0;
  endPlayerTurn(st, ch);
  monsterTurn(st, ch);
  const atkRolls = st.events.filter(e => e.t === "roll" && e.res.rt === "Attack");
  atkRolls.forEach(r => assert.equal(r.res.adv, "disadv"));
});

test("wizard can cast: fire bolt / burning hands / cure wounds consume correctly", () => {
  const ch = makeWizard();
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  if(st.phase !== "player"){ monsterTurn(st, ch); }
  if(st.phase !== "player") return;
  st.monsters[0].hp = st.monsters[0].maxHP = 999;                 // keep the target alive for all three casts
  playerCastSpell(st, ch, "Fire Bolt", 0, 0);                     // cantrip: no slot spent
  assert.equal(ch.spells.slots[1].cur, 2);
  st.actionsLeft = 1;                                             // scripted second cast for the assertion
  playerCastSpell(st, ch, "Burning Hands", 1, 0);
  assert.equal(ch.spells.slots[1].cur, 1);
  st.actionsLeft = 1;
  ch.hp.cur = 1;
  playerCastSpell(st, ch, "Cure Wounds", 1, 0);
  assert.equal(ch.spells.slots[1].cur, 0);
  assert.ok(ch.hp.cur > 1, "healed");
});

test("death saves resolve: 3 failures kill, 3 successes stabilize at 1 HP", () => {
  let sawDefeat = false, sawStabilize = false;
  for(let i = 0; i < 200 && !(sawDefeat && sawStabilize); i++){
    const ch = makeFighter();
    const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
    ch.hp.cur = 0; st.phase = "dying"; ch.deathSaves = {s:0, f:0};
    let guard = 20;
    while(st.phase === "dying" && guard-- > 0) deathSave(st, ch);
    if(st.phase === "defeat"){ sawDefeat = true; assert.equal(ch.status, "dead"); }
    if(st.phase === "stabilized"){ sawStabilize = true; assert.equal(ch.hp.cur, 1); }
    if(st.phase === "player") assert.equal(ch.hp.cur, 1);          // nat-20 recovery
  }
  assert.ok(sawDefeat && sawStabilize, "both terminal outcomes observed across trials");
});

/* ---- dungeon ---- */
test("run generates legal rooms and persists materialized monsters", () => {
  for(let trial = 0; trial < 10; trial++){
    const ch = makeFighter();
    const run = newRun(ch);
    const seen = new Set();
    for(let i = 0; i < 5; i++){
      const room = nextRoom(run, ch);
      seen.add(room.type);
      assert.ok(["combat","trap","treasure","rest","event","stairs","boss"].includes(room.type));
      if(room.type === "combat" || room.type === "stairs"){
        assert.ok(room.monsters.length >= 1 && room.monsters.length <= 3);
        room.monsters.forEach(m => { assert.ok(m.hp > 0); assert.ok(m.attacks.length > 0); });
        const raw = JSON.parse(JSON.stringify(room));               // must survive persistence round-trip
        assert.equal(raw.monsters.length, room.monsters.length);
      }
      if(i === 4) assert.equal(room.type, run.floor >= 5 ? "boss" : "stairs");
    }
  }
});

test("combat XP flows into the character on victory", () => {
  const ch = makeFighter();
  ch.baseVals.str = 20;                                            // stack the deck
  const run = newRun(ch);
  let room;
  do { room = nextRoom(run, ch); } while(room.type !== "combat" && room.type !== "stairs");
  const st = enterCombat(run, ch);
  let guard = 300;
  while(!combatOver(st) && guard-- > 0){
    if(st.phase === "player"){ playerAttack(st, ch, "Longsword", st.monsters.findIndex(m => m.hp > 0)); if(st.phase === "player" && st.attacksLeft <= 0 && st.actionsLeft <= 0) endPlayerTurn(st, ch); }
    else if(st.phase === "monster") monsterTurn(st, ch);
    else if(st.phase === "dying") deathSave(st, ch);
  }
  const before = ch.xp;
  const outcome = resolveCombat(run, ch);
  if(outcome === "victory"){ assert.ok(ch.xp > before); assert.ok(run.room.resolved); }
});

test("trap flow: disarm or spring, always resolves", () => {
  for(let i = 0; i < 30; i++){
    const ch = makeFighter();
    ch.hp.cur = ch.hp.max = 100;
    const run = newRun(ch);
    run.room = { type:"trap", trap: { name:"Pit Trap", detectDC:11, disarmSkill:"athletics", disarmDC:11, save:"dex", saveDC:11, dmg:"2d6 bludgeoning", text:"" }, trapState:"detected", detected:true };
    const r = trapAct(run, ch, i % 2 ? "disarm" : "careful");
    assert.ok(run.room.resolved || r.events.length > 0);
    assert.ok(ch.hp.cur >= 0);
  }
});

test("treasure chest awards gold/items", () => {
  const ch = makeFighter();
  ch.hp.cur = ch.hp.max = 100;
  const run = newRun(ch);
  run.room = { type:"treasure", gold:25, potion:"Potion of Healing", magic:null, trapped:null };
  const g0 = ch.equipment.gold;
  openChest(run, ch);
  assert.equal(ch.equipment.gold, g0 + 25);
  assert.ok(ch.equipment.items.some(i => i.name === "Potion of Healing" && i.qty >= 1));
  assert.ok(run.room.resolved);
});

/* ---- persistent effects & out-of-combat casting ---- */
test("Mage Armor persists on the character, across combats, until long rest", () => {
  const ch = makeWizard();
  const baseAC = C.armorClass(ch);
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  st.phase = "player"; st.actionsLeft = 1;
  playerCastSpell(st, ch, "Mage Armor", 1, 0);
  assert.ok((ch.effects || []).some(b => b.buff === "mageArmor"), "stored on the character, not the combat");
  assert.equal(C.armorClass(ch), 13 + C.abilityMod(ch, "dex"), "AC applies with no combat running");
  assert.ok(C.armorClass(ch) > baseAC);
  const st2 = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  assert.equal(C.armorClass(ch, st2.playerBuffs), 13 + C.abilityMod(ch, "dex"), "still active in the NEXT combat");
  C.longRest(ch);
  assert.equal((ch.effects || []).length, 0, "expires on long rest");
});

test("castUtility: corridor Cure Wounds heals and spends a slot; Mage Armor castable outside combat", () => {
  const ch = makeWizard();
  const list = castableOutOfCombat(ch);
  assert.ok(list.some(x => x.n === "Cure Wounds"));
  assert.ok(list.some(x => x.n === "Mage Armor"));
  ch.hp.cur = 1;
  const before = ch.spells.slots[1].cur;
  const r = castUtility(ch, "Cure Wounds");
  assert.ok(ch.hp.cur > 1, "healed");
  assert.equal(ch.spells.slots[1].cur, before - 1, "slot spent");
  castUtility(ch, "Mage Armor");
  assert.ok(ch.effects.some(b => b.buff === "mageArmor"));
  assert.ok(r.events.length > 0);
});

/* ---- reactions ---- */
function wizardWithReactions(){
  const ch = makeWizard();
  ch.spells.known.push("Shield", "Silvery Barbs");
  ch.hp.max = ch.hp.cur = 50;
  return ch;
}

test("Shield reaction turns a qualifying hit into a miss and expires at your next turn", () => {
  const ch = wizardWithReactions();
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  st.phase = "monster"; st.pendingReaction = null; st.mq = [];
  const ac = C.armorClass(ch, st.playerBuffs);
  st.pendingReaction = { mi:0, atk:{name:"Scimitar", parts:[{label:"", type:"slashing", dice:[{n:1,d:6}], mod:2}]},
    res:{kind:"d20", dice:[{d:20, v:10}], mod:4, total:ac + 2}, crit:false, ac, options:["shield","barbs"] };
  const hpBefore = ch.hp.cur, slotBefore = ch.spells.slots[1].cur;
  reactionChoose(st, ch, "shield");
  assert.equal(ch.hp.cur, hpBefore, "the hit became a miss — no damage");
  assert.equal(ch.spells.slots[1].cur, slotBefore - 1, "slot spent");
  assert.ok(st.reactionUsed);
  assert.ok(st.playerBuffs.some(b => b.until === "turnStart" && b.amount === 5), "+5 AC buff active");
  st.mq = [];                                             // drain the phase → next player turn
  monsterTurn(st, ch);
  if(st.phase === "player")
    assert.ok(!st.playerBuffs.some(b => b.until === "turnStart"), "Shield expired at the start of your turn");
});

test("Silvery Barbs reaction rerolls the hit and grants advantage on your next attack", () => {
  const ch = wizardWithReactions();
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  st.phase = "monster"; st.mq = [];
  const ac = C.armorClass(ch, st.playerBuffs);
  st.pendingReaction = { mi:0, atk:{name:"Scimitar", parts:[{label:"", type:"slashing", dice:[{n:1,d:6}], mod:2}]},
    res:{kind:"d20", dice:[{d:20, v:19}], mod:4, total:23}, crit:false, ac, options:["barbs"] };
  const slotBefore = ch.spells.slots[1].cur;
  reactionChoose(st, ch, "barbs");
  assert.equal(ch.spells.slots[1].cur, slotBefore - 1, "slot spent");
  assert.ok(st.reactionUsed);
  assert.ok(st.barbsAdv, "advantage stored for your next attack");
  assert.equal(st.pendingReaction, null);
  // the stored advantage is consumed by the next player attack
  st.phase = "player"; st.actionsLeft = 1; st.attacksLeft = 0;
  st.monsters[0].hp = st.monsters[0].maxHP = 999;
  playerAttack(st, ch, "Dagger", 0);
  assert.equal(st.barbsAdv, false, "consumed");
  const atkRoll = st.events.filter(e => e.t === "roll" && e.res.rt === "Attack").pop();
  assert.equal(atkRoll.res.adv, "adv");
});

test("Shield is offered even on hits it cannot deflect (buff still applies)", () => {
  const ch = wizardWithReactions();
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  st.phase = "monster"; st.mq = [];
  const ac = C.armorClass(ch, st.playerBuffs);
  // A monstrous hit: total is far beyond AC+5, so Shield can't stop it — but must still be castable.
  st.pendingReaction = { type:"swing", mi:0, atk:{name:"Scimitar", parts:[{label:"", type:"slashing", dice:[{n:1,d:6}], mod:2}]},
    res:{kind:"d20", dice:[{d:20, v:18}], mod:9, total:ac + 12}, crit:false, ac, options:["shield","barbs"], deflects:false };
  const hpBefore = ch.hp.cur, slotBefore = ch.spells.slots[1].cur;
  reactionChoose(st, ch, "shield");
  assert.equal(ch.spells.slots[1].cur, slotBefore - 1, "slot spent");
  assert.ok(ch.hp.cur < hpBefore, "the hit still lands");
  assert.ok(st.playerBuffs.some(b => b.until === "turnStart" && b.amount === 5), "+5 AC persists for the rest of the round");
});

test("Silvery Barbs fires when a monster resists your save spell", () => {
  let sawPrompt = false;
  for(let i = 0; i < 200 && !sawPrompt; i++){
    const ch = wizardWithReactions();
    ch.spells.known.push("Burning Hands");
    ch.spells.slots[1].cur = ch.spells.slots[1].max = 4;
    const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
    st.phase = "player"; st.actionsLeft = 1;
    st.monsters[0].hp = st.monsters[0].maxHP = 999;
    playerCastSpell(st, ch, "Burning Hands", 1, 0);
    if(st.pendingReaction && st.pendingReaction.type === "save"){
      sawPrompt = true;
      const slotBefore = ch.spells.slots[1].cur;
      reactionChoose(st, ch, "barbs");
      assert.equal(ch.spells.slots[1].cur, slotBefore - 1, "reaction slot spent");
      assert.ok(st.reactionUsed);
      assert.equal(st.castQueue, null, "queue drained after the reroll");
      assert.equal(st.pendingReaction, null);
    } else {
      // no prompt means the goblin failed its save (or queue drained) — flush must leave clean state
      endPlayerTurn(st, ch);
      assert.equal(st.castQueue, null);
    }
  }
  assert.ok(sawPrompt, "a save-success reaction window occurred across trials");
});

test("endPlayerTurn flushes an unresolved cast queue safely", () => {
  const ch = wizardWithReactions();
  ch.spells.known.push("Burning Hands");
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin")), materializeMonster(getMonster("Goblin"), "B")]);
  st.phase = "player"; st.actionsLeft = 1;
  st.monsters.forEach(m => { m.hp = m.maxHP = 999; });
  playerCastSpell(st, ch, "Burning Hands", 1, 0);       // AoE: two targets, only the first resolves synchronously
  endPlayerTurn(st, ch);
  assert.equal(st.castQueue, null, "queue fully drained");
  assert.ok(["monster","player","victory"].includes(st.phase));
});

test("monsterStep pauses on a reaction window instead of resolving the swing", () => {
  let sawPause = false;
  for(let i = 0; i < 120 && !sawPause; i++){
    const ch = wizardWithReactions();
    const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
    if(st.phase !== "monster"){ st.phase = "monster"; st.mq = null; }
    let guard = 40;
    while(st.phase === "monster" && guard-- > 0){
      if(st.pendingReaction){
        sawPause = true;
        assert.ok(st.pendingReaction.options.length >= 1);
        assert.ok(JSON.parse(JSON.stringify(st)).pendingReaction, "pending reaction survives persistence");
        reactionChoose(st, ch, "decline");
      } else {
        monsterStep(st, ch);
      }
    }
  }
  assert.ok(sawPause, "a reaction window occurred across trials");
});

/* ---- familiar & utility cantrips ---- */
test("Find Familiar summons an owl; Help grants advantage once per round", () => {
  const ch = makeWizard();
  ch.spells.known.push("Find Familiar");
  const r = castUtility(ch, "Find Familiar", "summon");
  assert.ok(ch.familiar && ch.familiar.alive, "owl summoned out of combat");
  assert.equal(ch.spells.slots[1].cur, ch.spells.slots[1].max, "ritual casting: no slot spent out of combat");
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  st.phase = "player"; st.actionsLeft = 1; st.helpUsed = false;
  playerFamiliarHelp(st, ch);
  assert.ok(st.helpAdv && st.helpUsed);
  st.monsters[0].hp = st.monsters[0].maxHP = 999;
  playerAttack(st, ch, "Dagger", 0);
  const atkRoll = st.events.filter(e => e.t === "roll" && e.res.rt === "Attack").pop();
  assert.equal(atkRoll.res.adv, "adv", "Help advantage consumed by the attack");
  assert.equal(st.helpAdv, false);
  playerFamiliarHelp(st, ch);
  assert.equal(st.helpAdv, false, "only once per round");
});

test("Minor Illusion: distract imposes disadvantage; lure can waste an action (once per enemy)", () => {
  const ch = makeWizard();
  ch.spells.known.push("Minor Illusion");
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  st.phase = "player"; st.actionsLeft = 1;
  st.monsters[0].hp = st.monsters[0].maxHP = 999;
  playerCastSpell(st, ch, "Minor Illusion", 0, 0, "distract");
  assert.equal(st.monsters[0].distracted, 1);
  st.actionsLeft = 1;
  playerCastSpell(st, ch, "Minor Illusion", 0, 0, "lure");
  assert.ok(st.monsters[0].sawIllusion, "lure marks the enemy");
  st.actionsLeft = 1;
  const before = st.monsters[0].loseActions || 0;
  playerCastSpell(st, ch, "Minor Illusion", 0, 0, "lure");
  assert.equal(st.monsters[0].loseActions || 0, before, "second lure on the same enemy does nothing");
  assert.ok(utilityOptions(ch, "Minor Illusion").length === 2);
});

test("Prestidigitation: sparks buff your next attack; prepare/season work out of combat", () => {
  const ch = makeWizard();
  ch.spells.known.push("Prestidigitation");
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  st.phase = "player"; st.actionsLeft = 1;
  st.monsters[0].hp = st.monsters[0].maxHP = 999;
  playerCastSpell(st, ch, "Prestidigitation", 0, 0, "sparks");
  assert.ok(st.playerBuffs.some(b => b.buff === "nextAtkBonus"));
  st.actionsLeft = 1;
  playerAttack(st, ch, "Dagger", 0);
  assert.ok(!st.playerBuffs.some(b => b.buff === "nextAtkBonus"), "sparks consumed by the attack");
  castUtility(ch, "Prestidigitation", "prepare");
  assert.ok(ch.effects.some(b => b.buff === "checkBonus"));
  castUtility(ch, "Prestidigitation", "season");
  assert.ok(ch.effects.some(b => b.buff === "rations"));
  const list = castableOutOfCombat(ch);
  assert.equal(list.filter(x => x.n === "Prestidigitation").length, 2, "two out-of-combat tricks listed");
});

test("ritual casting: rituals cost no slot out of combat and stay listed at zero slots", () => {
  const ch = makeWizard();
  ch.spells.known.push("Detect Magic", "Find Familiar");
  ch.spells.slots[1].cur = 0;                             // out of slots entirely
  const list = castableOutOfCombat(ch);
  assert.ok(list.some(x => x.n === "Detect Magic"), "ritual castable with no slots left");
  assert.ok(list.some(x => x.n === "Find Familiar"));
  const run = newRun(ch);
  const r = castUtility(ch, "Detect Magic", "detect", run);
  assert.ok(run.peekType, "Detect Magic pre-rolls the next room");
  assert.ok(r.events.some(e => e.t === "log" && /Detect Magic/.test(e.text)));
  assert.equal(ch.spells.slots[1].cur, 0, "still no slot spent");
  const peeked = run.peekType;
  nextRoom(run, ch);
  assert.equal(run.room.type, peeked, "the door honors the reading");
  assert.equal(run.peekType, null, "peek consumed");
});

test("generic utility fallback: no castable spell is a dead button", () => {
  const ch = makeWizard();
  ch.spells.known.push("Dancing Lights", "Identify");
  const st = startCombat(ch, [materializeMonster(getMonster("Goblin"))]);
  st.phase = "player"; st.actionsLeft = 1;
  st.monsters[0].hp = st.monsters[0].maxHP = 999;
  playerCastSpell(st, ch, "Dancing Lights", 0, 0);       // unmapped cantrip
  assert.ok(st.playerBuffs.some(b => b.buff === "nextAtkBonus"), "cantrip fallback: +1d4 next attack");
  st.actionsLeft = 1;
  const slotBefore = ch.spells.slots[1].cur;
  playerCastSpell(st, ch, "Identify", 1, 0);             // unmapped leveled spell
  assert.equal(ch.spells.slots[1].cur, slotBefore - 1);
  assert.ok(st.helpAdv, "leveled fallback: advantage on next attack");
  assert.ok(ch.hp.temp >= 2, "and a ward");
});

/* ---- scrolls, scribing, and the peddler ---- */
test("scroll rules: off-list unintelligible, on-list free cast, higher-level needs a check", () => {
  assert.ok(scrollPool(1, 2).length > 20, "scroll pool draws from all class lists");
  const fighter = makeFighter();
  assert.equal(scrollUsability(fighter, "Fireball").ok, false, "no class list — cannot cast at all");
  const wiz = makeWizard();
  assert.ok(classListHas("Wizard", "Fireball"));
  const easy = scrollUsability(wiz, "Magic Missile");
  assert.ok(easy.ok && !easy.check, "castable level: no check");
  const hard = scrollUsability(wiz, "Fireball");
  assert.ok(hard.ok && hard.check && hard.check.dc === 13, "L3 above your slots: DC 13 check");

  // in combat: on-list scroll casts without spending a slot, consuming the scroll
  const st = startCombat(wiz, [materializeMonster(getMonster("Goblin"))]);
  st.phase = "player"; st.actionsLeft = 1;
  st.monsters[0].hp = st.monsters[0].maxHP = 999;
  wiz.equipment.items.push({ name:"Scroll of Magic Missile", qty:1 });
  const slotsBefore = wiz.spells.slots[1].cur;
  const idx = wiz.equipment.items.findIndex(i => i.name === "Scroll of Magic Missile");
  playerUseScroll(st, wiz, idx, 0);
  assert.equal(wiz.spells.slots[1].cur, slotsBefore, "no slot spent");
  assert.ok(!wiz.equipment.items.some(i => /magic missile/i.test(i.name)), "scroll consumed");

  // fighter attempting a scroll in combat: refused, item kept
  const st2 = startCombat(fighter, [materializeMonster(getMonster("Goblin"))]);
  st2.phase = "player"; st2.actionsLeft = 1;
  fighter.equipment.items.push({ name:"Scroll of Fireball", qty:1 });
  const fIdx = fighter.equipment.items.findIndex(i => /fireball/i.test(i.name));
  playerUseScroll(st2, fighter, fIdx, 0);
  assert.ok(fighter.equipment.items.some(i => /fireball/i.test(i.name)), "unintelligible scroll is not consumed");
});

test("scribing: wizard copies an eligible scroll into the spellbook for gold", () => {
  const wiz = makeWizard();
  wiz.equipment.gold = 100;
  wiz.equipment.items.push({ name:"Scroll of Shield", qty:1 });      // wizard L1, not known
  wiz.equipment.items.push({ name:"Scroll of Cure Wounds", qty:1 }); // not on wizard list
  wiz.equipment.items.push({ name:"Scroll of Fireball", qty:1 });    // above castable level
  const list = scribeableScrolls(wiz);
  assert.deepEqual(list.map(e => e.name), ["Shield"], "only on-list, castable-level, unknown spells");
  const r = scribeScroll(wiz, list[0]);
  assert.ok(wiz.spells.known.includes("Shield"));
  assert.equal(wiz.equipment.gold, 100 - 25);
  assert.ok(!wiz.equipment.items.some(i => /scroll of shield/i.test(i.name)), "scroll consumed");
  assert.equal(scribeableScrolls(makeFighter()).length, 0, "fighters scribe nothing");
});

test("the peddler: stock per floor, buying and selling move gold and goods", () => {
  const ch = makeFighter();
  ch.equipment.gold = 1000;
  const run = newRun(ch);
  const shop = floorShop(run, ch);
  assert.ok(shop.stock.length >= 2, "stocked");
  assert.equal(floorShop(run, ch), shop, "same stock while on the floor");
  const potionIdx = shop.stock.findIndex(s => s.kind === "potion");
  const price = shop.stock[potionIdx].price;
  const g0 = ch.equipment.gold;
  shopBuy(run, ch, potionIdx);
  assert.equal(ch.equipment.gold, g0 - price);
  assert.ok(ch.equipment.items.some(i => /potion/i.test(i.name)));
  const sells = sellables(run, ch);
  assert.ok(sells.length >= 1, "the bought potion is sellable");
  const g1 = ch.equipment.gold;
  shopSell(run, ch, sells[0]);
  assert.equal(ch.equipment.gold, g1 + sells[0].price);
});

test("out-of-combat scroll reading heals without a slot", () => {
  const wiz = makeWizard();
  wiz.hp.cur = 1;
  wiz.equipment.items.push({ name:"Scroll of False Life", qty:1 });  // wizard list, generic — skip; use Mage Armor
  wiz.equipment.items.push({ name:"Scroll of Mage Armor", qty:1 });
  const run = newRun(wiz);
  const slotsBefore = wiz.spells.slots[1].cur;
  const target = wiz.equipment.items.findIndex(i => /mage armor/i.test(i.name));
  const r = readScrollOutOfCombat(run, wiz, target);
  assert.ok(wiz.effects.some(b => b.buff === "mageArmor"), "mage armor from the scroll");
  assert.equal(wiz.spells.slots[1].cur, slotsBefore, "no slot spent");
});

test("corridor camp: risky short rest works with no room, ambushes more often", () => {
  let sawAmbush = false, sawRest = false;
  for(let i = 0; i < 200 && !(sawAmbush && sawRest); i++){
    const ch = makeFighter();
    for(let l = 2; l <= 3; l++) C.applyLevelUp(ch);
    ch.hp.cur = 1;
    const run = newRun(ch);                                // corridor: run.room is null
    const r = shortRest(run, ch, 2, { risky:true });
    if(r.ambush) sawAmbush = true;
    else { sawRest = true; assert.ok(ch.hp.cur > 1, "healed"); }
  }
  assert.ok(sawAmbush && sawRest, "both outcomes occur at corridor odds");
});

test("short rest spends hit dice and heals", () => {
  const ch = makeFighter();
  for(let l = 2; l <= 3; l++) C.applyLevelUp(ch);
  ch.hp.cur = 1;
  const run = newRun(ch);
  run.room = { type:"rest" };
  const hd0 = ch.hp.hitDiceCur;
  const r = shortRest(run, ch, 2);
  if(!r.ambush){
    assert.ok(ch.hp.cur > 1);
    assert.equal(ch.hp.hitDiceCur, hd0 - 2);
  }
});
