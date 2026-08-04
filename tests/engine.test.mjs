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
import { materializeMonster, startCombat, playerAttack, playerCastSpell, endPlayerTurn, monsterTurn, deathSave, combatOver, playerDodge } from "../js/combat.js";
import { newRun, nextRoom, enterCombat, resolveCombat, trapAct, openChest, shortRest } from "../js/dungeon.js";

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
