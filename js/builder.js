/* Character builder wizard: name → abilities → race → class → background → skills → equipment →
   spells (casters) → review. Full option catalog straight from the dataset. */

import { h, clear, $, showScreen } from "./ui.js";
import { ABILITIES, SKILLS, STANDARD_ARRAY, POINT_BUY_BUDGET, pointBuyCost, pointBuyTotal, mod, fmtMod } from "./rules.js";
import { rollAbilityScores, rollDie } from "./dice.js";
import { idx, getWeapon, classSpellList, findGearInText } from "../data/data.js";
import * as C from "./character.js";
import { addItem } from "./dungeon.js";
import { sfx } from "./audio.js";

let draft = null;
let step = 0;
let onDone = null;
let equipChoices = [];       // per choice-group: {options:[text], sel:idx, weaponPicks:[names]}

const STEPS = ["Name", "Abilities", "Race", "Class", "Background", "Skills", "Equipment", "Spells", "Review"];

export function startBuilder(done){
  draft = C.newCharacter();
  draft.genMode = "pointbuy";
  draft.baseVals = {str:8,dex:8,con:8,int:8,wis:8,cha:8};
  step = 0; equipChoices = [];
  onDone = done;
  showScreen("screen-builder");
  render();
}

function stepName(){ return STEPS[step]; }
function needsSpellStep(){
  const cls = idx().classByName.get(draft.class.toLowerCase());
  return !!(cls && (cls.casterProgression || (cls.cantrips && cls.cantrips[0])));
}
function next(){
  step += 1;
  if(STEPS[step] === "Spells" && !needsSpellStep()) step += 1;
  render();
}
function back(){
  if(step === 0){ showScreen("screen-roster"); window.dispatchEvent(new Event("render-roster")); return; }
  step -= 1;
  if(STEPS[step] === "Spells" && !needsSpellStep()) step -= 1;
  render();
}

function render(){
  const body = clear($("builder-body"));
  $("builder-title").textContent = `${stepName()} · step ${step+1}`;
  sfx("ui-tap");
  const fns = { Name: sName, Abilities: sAbilities, Race: sRace, Class: sClass, Background: sBackground, Skills: sSkills, Equipment: sEquipment, Spells: sSpells, Review: sReview };
  fns[stepName()](body);
  body.append(h("div", {class:"btnrow", style:"margin-top:16px"},
    h("button", {class:"btn", onclick: back}, "‹ Back"),
    stepName() === "Review" ? null : h("button", {class:"btn primary", onclick: () => { if(validateStep()) next(); }}, "Next ›"),
  ));
}

function validateStep(){
  const name = stepName();
  if(name === "Name" && !draft.name.trim()){ alert("Give your hero a name."); return false; }
  if(name === "Abilities"){
    if(draft.genMode === "pointbuy" && pointBuyTotal(draft.baseVals) > POINT_BUY_BUDGET){ alert("Over the point-buy budget."); return false; }
    if((draft.genMode === "array" || draft.genMode === "rolled") && ABILITIES.some(([k]) => !draft.baseVals[k])){ alert("Assign every score."); return false; }
  }
  if(name === "Race" && !draft.race){ alert("Choose a race."); return false; }
  if(name === "Class" && !draft.class){ alert("Choose a class."); return false; }
  if(name === "Background" && !draft.background){ alert("Choose a background."); return false; }
  if(name === "Skills"){
    const cls = idx().classByName.get(draft.class.toLowerCase());
    const want = cls?.skillChoose?.count || 0;
    if(draft._classSkills.length < want){ alert(`Pick ${want} class skills.`); return false; }
  }
  if(name === "Spells"){
    // soft-validate: allow under-picking, block over-picking (enforced in UI)
  }
  return true;
}

/* ---- steps ---- */
function sName(body){
  body.append(h("div", {class:"card"},
    h("label", {}, "Hero name"),
    h("input", {type:"text", value: draft.name, maxlength:"24",
      oninput: e => draft.name = e.target.value, placeholder:"e.g. Sera Blackthorn"}),
    h("p", {class:"muted"}, "A lone hero descends into the deep. Five floors. One way out."),
  ));
}

function sAbilities(body){
  const card = h("div", {class:"card"});
  const modes = [["pointbuy","Point Buy (27)"],["array","Standard Array"],["rolled","Roll 4d6"]];
  card.append(h("div", {class:"btnrow"},
    ...modes.map(([k, lbl]) => h("button", {class:"btn small" + (draft.genMode === k ? " primary" : ""),
      onclick: () => { draft.genMode = k;
        if(k === "rolled" && !draft.rolledArray) draft.rolledArray = rollAbilityScores();
        if(k !== "pointbuy") ABILITIES.forEach(([a]) => draft.baseVals[a] = null);
        else draft.baseVals = {str:8,dex:8,con:8,int:8,wis:8,cha:8};
        render(); }}, lbl))));
  const pool = draft.genMode === "array" ? STANDARD_ARRAY : draft.genMode === "rolled" ? (draft.rolledArray || []) : null;
  if(draft.genMode === "rolled"){
    card.append(h("p", {class:"center", style:"font-size:18px;font-weight:700"}, (draft.rolledArray||[]).join(" · ")),
      h("button", {class:"btn small", onclick: () => { draft.rolledArray = rollAbilityScores(); ABILITIES.forEach(([a]) => draft.baseVals[a] = null); sfx("roll"); render(); }}, "↻ Reroll"));
  }
  if(draft.genMode === "pointbuy"){
    const spent = pointBuyTotal(draft.baseVals) ?? 0;
    card.append(h("p", {class:"center"}, h("span", {class:"badge"}, `${POINT_BUY_BUDGET - spent} points left`)));
  }
  ABILITIES.forEach(([k, label]) => {
    const row = h("div", {class:"abilrow"}, h("span", {class:"nm"}, label));
    if(pool){
      const used = ABILITIES.filter(([a]) => a !== k).map(([a]) => draft.baseVals[a]);
      const counts = {};
      pool.forEach(v => counts[v] = (counts[v] || 0) + 1);
      used.forEach(v => { if(v != null && counts[v]) counts[v] -= 1; });
      const sel = h("select", {onchange: e => { draft.baseVals[k] = e.target.value ? +e.target.value : null; render(); }},
        h("option", {value:""}, "—"),
        ...Object.keys(counts).map(Number).sort((a,b)=>b-a).filter(v => counts[v] > 0 || draft.baseVals[k] === v)
          .map(v => h("option", {value:v, selected: draft.baseVals[k] === v ? "" : null}, v)));
      row.append(sel);
    } else {
      const v = draft.baseVals[k];
      row.append(h("div", {class:"stepper"},
        h("button", {onclick: () => { if(v > 8){ draft.baseVals[k] = v - 1; render(); } }}, "−"),
        h("span", {class:"val", style:"width:44px"}, v),
        h("button", {onclick: () => {
          const nv = v + 1;
          if(nv <= 15 && pointBuyTotal({...draft.baseVals, [k]: nv}) <= POINT_BUY_BUDGET){ draft.baseVals[k] = nv; render(); }
        }}, "+")));
    }
    const rb = draft.bonuses.racial[k] || 0;
    row.append(h("span", {class:"bonus"}, rb ? `+${rb}` : ""));
    const total = (draft.baseVals[k] || 0) + rb;
    row.append(h("span", {class:"val"}, draft.baseVals[k] ? `${total} (${fmtMod(mod(total))})` : "—"));
    card.append(row);
  });
  body.append(card);
}

function applyRace(race){
  draft.race = race.name;
  draft.bonuses.racial = {str:0,dex:0,con:0,int:0,wis:0,cha:0};
  draft.racialChoices = [];
  (race.ability || []).forEach(entry => {
    for(const k in entry){
      if(k === "choose"){
        const n = entry.choose.count || 1, amt = entry.choose.amount || 1;
        draft._raceChoose = { count:n, amount:amt, from:(entry.choose.from || ABILITIES.map(([a])=>a)) };
      }
      else if(draft.bonuses.racial[k] != null) draft.bonuses.racial[k] += entry[k];
    }
  });
}
function sRace(body){
  const races = [...idx().raceByName.values()]
    .filter(r => (r.ability || []).length || /human/i.test(r.name))     // playable races have ability bonuses
    .sort((a, b) => a.name.localeCompare(b.name));
  const grid = h("div", {class:"choicegrid"});
  races.forEach(r => {
    const bon = (r.ability || []).map(e => Object.entries(e).map(([k, v]) =>
      k === "choose" ? `+${v.amount || 1} × ${v.count || 1} any` : `${k.toUpperCase()} +${v}`).join(", ")).join(", ");
    grid.append(h("div", {class:"choice" + (draft.race === r.name ? " sel" : ""),
      onclick: () => { applyRace(r); render(); }},
      h("div", {class:"t"}, r.name),
      h("div", {class:"d"}, bon || "—")));
  });
  body.append(h("div", {class:"card"}, h("h2", {}, "Race"), grid));
  if(draft.race){
    const r = idx().raceByName.get(draft.race.toLowerCase());
    const info = h("div", {class:"card"}, h("h2", {}, r.name),
      h("p", {class:"muted"}, `Speed ${r.speed || 30} ft.${r.darkvision ? ` · Darkvision ${r.darkvision} ft.` : ""}`),
      ...(r.traits || []).slice(0, 8).map(t => h("p", {}, h("b", {}, t.name + ". "), h("span", {class:"muted"}, t.text.split("\n")[0]))));
    if(draft._raceChoose){
      const rc = draft._raceChoose;
      info.append(h("p", {}, h("b", {}, `Choose ${rc.count} abilit${rc.count > 1 ? "ies" : "y"} to raise by ${rc.amount}:`)));
      const picks = h("div", {class:"btnrow", style:"flex-wrap:wrap"});
      rc.from.forEach(k => {
        const seld = draft.racialChoices.includes(k);
        picks.append(h("button", {class:"btn small" + (seld ? " primary" : ""), onclick: () => {
          if(seld) draft.racialChoices = draft.racialChoices.filter(x => x !== k);
          else if(draft.racialChoices.length < rc.count) draft.racialChoices.push(k);
          // rebuild racial bonuses = fixed + choices
          applyRaceChoices(); render();
        }}, k.toUpperCase()));
      });
      info.append(picks);
    }
    body.append(info);
  }
}
function applyRaceChoices(){
  const r = idx().raceByName.get(draft.race.toLowerCase());
  const choices = [...draft.racialChoices];
  applyRaceKeepChoices(r, choices);
}
function applyRaceKeepChoices(race, choices){
  const keep = choices;
  applyRace(race);
  draft.racialChoices = keep;
  const rc = draft._raceChoose;
  if(rc) keep.slice(0, rc.count).forEach(k => { draft.bonuses.racial[k] = (draft.bonuses.racial[k] || 0) + rc.amount; });
}

function sClass(body){
  const grid = h("div", {class:"choicegrid"});
  idx().classes.forEach(c => {
    grid.append(h("div", {class:"choice" + (draft.class === c.name ? " sel" : ""),
      onclick: () => { draft.class = c.name; draft._classSkills = []; draft.fightingStyle = null; draft.subclass = ""; equipChoices = []; render(); }},
      h("div", {class:"t"}, c.name),
      h("div", {class:"d"}, `d${c.hd} · saves ${c.saves.map(s => s.toUpperCase()).join("/")}${c.casterProgression ? " · caster" : ""}`)));
  });
  body.append(h("div", {class:"card"}, h("h2", {}, "Class"), grid));
  if(draft.class){
    const c = idx().classByName.get(draft.class.toLowerCase());
    const card = h("div", {class:"card"}, h("h2", {}, c.name),
      ...(c.features || []).filter(f => f.level === 1).map(f => h("p", {}, h("b", {}, f.name + ". "), h("span", {class:"muted"}, f.text.split("\n")[0]))));
    if(/fighter/i.test(c.name)){
      card.append(h("p", {}, h("b", {}, "Fighting Style:")));
      const row = h("div", {class:"btnrow", style:"flex-wrap:wrap"});
      ["Defense","Dueling","Archery","Great Weapon"].forEach(fs =>
        row.append(h("button", {class:"btn small" + (draft.fightingStyle === fs ? " primary" : ""), onclick: () => { draft.fightingStyle = fs; render(); }}, fs)));
      card.append(row);
    }
    if(c.subclassLevel === 1 && (c.subclasses || []).length){
      card.append(h("p", {}, h("b", {}, c.subclassTitle + ":")));
      const row = h("div", {class:"btnrow", style:"flex-wrap:wrap"});
      c.subclasses.slice(0, 8).forEach(sc => {
        const nm = typeof sc === "string" ? sc : sc.name;
        row.append(h("button", {class:"btn small" + (draft.subclass === nm ? " primary" : ""), onclick: () => { draft.subclass = nm; render(); }}, nm));
      });
      card.append(row);
    }
    body.append(card);
  }
}

function sBackground(body){
  const grid = h("div", {class:"choicegrid"});
  [...idx().bgByName.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(b => {
    grid.append(h("div", {class:"choice" + (draft.background === b.name ? " sel" : ""),
      onclick: () => { draft.background = b.name; render(); }},
      h("div", {class:"t"}, b.name),
      h("div", {class:"d"}, (b.skills || []).join(", ") || "—")));
  });
  body.append(h("div", {class:"card"}, h("h2", {}, "Background"), grid));
  if(draft.background){
    const b = idx().bgByName.get(draft.background.toLowerCase());
    if(b && b.feature) body.append(h("div", {class:"card"}, h("h2", {}, b.feature.name),
      h("p", {class:"muted"}, b.feature.text.split("\n")[0])));
  }
}

function sSkills(body){
  const cls = idx().classByName.get(draft.class.toLowerCase());
  const bg = idx().bgByName.get(draft.background.toLowerCase());
  const bgSkills = (bg?.skills || []).map(normSkill).filter(Boolean);
  draft._classSkills = draft._classSkills || [];
  const from = (cls?.skillChoose?.from || SKILLS.map(([k]) => k)).map(normSkill).filter(Boolean);
  const count = cls?.skillChoose?.count || 2;
  const card = h("div", {class:"card"},
    h("h2", {}, `Pick ${count} class skills`),
    h("p", {class:"muted"}, bgSkills.length ? `Your background grants: ${bgSkills.map(skillLabel).join(", ")}` : ""));
  from.forEach(k => {
    const fromBg = bgSkills.includes(k);
    const seld = draft._classSkills.includes(k);
    card.append(h("div", {class:"choice" + (seld ? " sel" : ""), style: fromBg ? "opacity:.5" : "",
      onclick: () => {
        if(fromBg) return;
        if(seld) draft._classSkills = draft._classSkills.filter(x => x !== k);
        else if(draft._classSkills.length < count) draft._classSkills.push(k);
        render();
      }},
      h("div", {class:"t"}, skillLabel(k) + (fromBg ? " (background)" : "")),
      h("div", {class:"d"}, SKILLS.find(s => s[0] === k)?.[2].toUpperCase() || "")));
  });
  body.append(card);
}
function normSkill(name){
  const lc = String(name).toLowerCase();
  const hit = SKILLS.find(([k, label]) => k === lc || label.toLowerCase() === lc);
  return hit ? hit[0] : null;
}
function skillLabel(k){ return SKILLS.find(s => s[0] === k)?.[1] || k; }

function sEquipment(body){
  const cls = idx().classByName.get(draft.class.toLowerCase());
  const groups = (cls?.equip?.items || []);
  if(!equipChoices.length) equipChoices = groups.map(g => ({ options: splitOptions(g), sel: 0, weaponPicks: {} }));
  const card = h("div", {class:"card"}, h("h2", {}, "Starting equipment"));
  equipChoices.forEach((gc, gi) => {
    const grp = h("div", {style:"margin-bottom:12px"});
    gc.options.forEach((opt, oi) => {
      grp.append(h("div", {class:"choice" + (gc.sel === oi ? " sel" : ""), onclick: () => { gc.sel = oi; render(); }},
        h("div", {class:"t"}, opt)));
    });
    // Generic weapon slots ("a martial weapon", "two martial weapons", "any simple weapon")
    const sel = gc.options[gc.sel] || "";
    const wm = /(?:(two|a|any))\s+(martial|simple)\s+(?:melee\s+)?weapons?/i.exec(sel);
    if(wm){
      const n = /two/i.test(wm[1]) ? 2 : 1;
      const cat = wm[2].toLowerCase();
      const pool = idx().weapons.filter(w => w.cat === cat).sort((a, b) => a.name.localeCompare(b.name));
      for(let i = 0; i < n; i++){
        const selv = gc.weaponPicks[i] || "";
        grp.append(h("select", {onchange: e => { gc.weaponPicks[i] = e.target.value; }},
          h("option", {value:""}, `— choose ${cat} weapon ${n > 1 ? i+1 : ""} —`),
          ...pool.map(w => h("option", {value:w.name, selected: selv === w.name ? "" : null}, `${w.name} (${w.dmg} ${w.dmgType})`))));
      }
    }
    card.append(grp, h("hr", {class:"sep"}));
  });
  card.append(h("p", {class:"muted"}, "You also start with a Potion of Healing and your class pack."));
  body.append(card);
}
function splitOptions(line){
  // "(a) chain mail or (b) leather armor, longbow, and 20 arrows" → the two texts
  const parts = String(line).split(/\([a-z]\)\s*/).map(s => s.replace(/\s+or\s*$/i, "").trim()).filter(Boolean);
  return parts.length > 1 ? parts : [String(line)];
}

function sSpells(body){
  const cls = idx().classByName.get(draft.class.toLowerCase());
  draft.level = 1;
  const nCan = cls.cantrips ? (cls.cantrips[0] || 0) : 0;
  const nSp = cls.casterProgression ? C.spellsAllowed(draft) : 0;
  draft._cantrips = draft._cantrips || [];
  draft._spells = draft._spells || [];
  const spellList = classSpellListSafe(cls.name);
  const cantrips = spellList.filter(e => e.level === 0);
  const firsts = spellList.filter(e => e.level === 1);
  const card = h("div", {class:"card"},
    h("h2", {}, "Spells"),
    h("p", {class:"muted"}, `Choose ${nCan} cantrips and ${nSp} 1st-level spells.`));
  if(nCan){
    card.append(h("p", {}, h("b", {}, `Cantrips (${draft._cantrips.length}/${nCan})`)));
    cantrips.forEach(e => card.append(spellChoice(e, draft._cantrips, nCan)));
  }
  card.append(h("p", {}, h("b", {}, `1st-level spells (${draft._spells.length}/${nSp})`)));
  firsts.forEach(e => card.append(spellChoice(e, draft._spells, nSp)));
  body.append(card);
}
function classSpellListSafe(name){ try{ return classSpellList(name); }catch(e){ return []; } }
function spellChoice(e, arr, cap){
  const seld = arr.includes(e.name);
  return h("div", {class:"choice" + (seld ? " sel" : ""), onclick: () => {
    if(seld) arr.splice(arr.indexOf(e.name), 1);
    else if(arr.length < cap) arr.push(e.name);
    render();
  }},
    h("div", {class:"t"}, e.name),
    h("div", {class:"d"}, `${e.spell.school} · ${e.spell.time}${e.spell.conc ? " · conc." : ""} — ${(e.spell.text || "").slice(0, 90)}…`));
}

function sReview(body){
  const ch = draft;
  const cls = idx().classByName.get(ch.class.toLowerCase());
  const lines = [
    ["Name", ch.name], ["Race", ch.race], ["Class", ch.class + (ch.subclass ? ` (${ch.subclass})` : "")],
    ["Background", ch.background],
    ["Abilities", ABILITIES.map(([k]) => `${k.toUpperCase()} ${C.abilityScore(ch, k)}`).join(" · ")],
    ["Skills", [...new Set([...(ch._classSkills || []), ...bgSkillsOf(ch)])].map(skillLabel).join(", ")],
  ];
  body.append(h("div", {class:"card"}, h("h2", {}, "Ready?"),
    ...lines.map(([k, v]) => h("div", {class:"sheetrow"}, h("span", {class:"k"}, k), h("span", {class:"v"}, v || "—")))));
  body.append(h("button", {class:"btn primary", onclick: finalize}, "⚔ Begin the descent"));
}
function bgSkillsOf(ch){
  const bg = idx().bgByName.get(String(ch.background).toLowerCase());
  return (bg?.skills || []).map(normSkill).filter(Boolean);
}

function finalize(){
  const ch = draft;
  const cls = idx().classByName.get(ch.class.toLowerCase());
  // proficiencies
  ch.profs.saves = [...(cls.saves || [])];
  ch.profs.skills = [...new Set([...(ch._classSkills || []), ...bgSkillsOf(ch)])];
  // rogue expertise: two of your proficient skills (auto-pick stealth+first)
  if(/rogue/i.test(ch.class)) ch.profs.expertise = ch.profs.skills.slice(0, 2);
  // equipment
  ch.equipment = { armor:null, shield:false, weapons:[], items:[], gold:0 };
  equipChoices.forEach(gc => {
    const text = gc.options[gc.sel] || "";
    const picks = Object.values(gc.weaponPicks).filter(Boolean);
    picks.forEach(p => ch.equipment.weapons.push(p));
    const found = findGearSafe(text);
    if(found.armor && !ch.equipment.armor) ch.equipment.armor = found.armor.name;
    if(found.shield) ch.equipment.shield = true;
    found.weapons.forEach(w => { if(!ch.equipment.weapons.includes(w.name)) ch.equipment.weapons.push(w.name); });
    if(/pack/i.test(text)) addItem(ch, text.match(/[a-z']+ pack/i)?.[0] || "Explorer's Pack");
    if(/arrows|bolts/i.test(text)) addItem(ch, "Ammunition", 20);
  });
  if(!ch.equipment.weapons.length) ch.equipment.weapons.push(/wizard|sorcerer/i.test(ch.class) ? "Dagger" : "Mace");
  addItem(ch, "Potion of Healing");
  ch.equipment.gold = 10 + rollDie(20);
  // spells
  ch.spells.known = [...(ch._cantrips || []), ...(ch._spells || [])];
  const ms = C.maxSlots(ch);
  ch.spells.slots = {};
  for(const l in ms) ch.spells.slots[l] = { max: ms[l], cur: ms[l] };
  // hp & resources
  ch.hp.mode = "avg";
  ch.hp.hitDiceMax = ch.hp.hitDiceCur = 1;
  ch.hp.max = ch.hp.cur = C.computeMaxHP(ch);
  C.refreshResources(ch);
  ch.features = C.featuresAtLevel(ch).map(f => f.name);
  delete ch._classSkills; delete ch._cantrips; delete ch._spells; delete ch._raceChoose;
  sfx("level-up");
  if(onDone) onDone(ch);
}
function findGearSafe(t){ try{ return findGearInText(t); }catch(e){ return {weapons:[], armor:null, shield:false}; } }
