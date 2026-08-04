/* In-game character sheet: swipe-up drawer with tabs (Stats / Skills / Gear / Spells).
   Read view over derived stats — modeled on the donor sheet's sections. */

import { h, clear, $, hpBarEl } from "./ui.js";
import { ABILITIES, SKILLS, fmtMod } from "./rules.js";
import * as C from "./character.js";
import { CONDITIONS, EXHAUSTION_STAGES } from "./conditions.js";
import { sfx } from "./audio.js";

let tab = "stats";
let getCombat = () => null;

export function bindSheet(combatGetter){
  getCombat = combatGetter || (() => null);
  $("sheet-close").addEventListener("click", closeSheet);
  $("sheet-drawer").addEventListener("click", e => { if(e.target === $("sheet-drawer")) closeSheet(); });
  document.querySelectorAll("#sheet-drawer .tabs button").forEach(b =>
    b.addEventListener("click", () => { tab = b.dataset.tab; renderSheet(window.__sheetChar); }));
}
export function openSheet(ch){
  window.__sheetChar = ch;
  $("sheet-drawer").classList.add("open");
  sfx("ui-tap");
  renderSheet(ch);
}
export function closeSheet(){ $("sheet-drawer").classList.remove("open"); }

export function renderSheet(ch){
  if(!ch) return;
  document.querySelectorAll("#sheet-drawer .tabs button").forEach(b => b.classList.toggle("sel", b.dataset.tab === tab));
  const body = clear($("sheet-body"));
  const combat = getCombat();
  const buffs = combat ? combat.playerBuffs : [];
  if(tab === "stats"){
    body.append(
      h("h2", {style:"margin:0 0 2px"}, ch.name),
      h("p", {class:"muted", style:"margin:0 0 10px"}, `Level ${ch.level} ${ch.race} ${ch.class}${ch.subclass ? ` (${ch.subclass})` : ""} · ${ch.background} · ${ch.xp} XP`),
      hpBarEl(ch.hp.cur, ch.hp.max),
      h("p", {class:"center", style:"margin:2px 0 10px"}, `${ch.hp.cur} / ${ch.hp.max} HP${ch.hp.temp ? ` (+${ch.hp.temp} temp)` : ""}`),
      h("div", {class:"statgrid"},
        ...ABILITIES.map(([k, label]) => h("div", {class:"cell"},
          h("div", {class:"v"}, C.abilityScore(ch, k)),
          h("div", {class:"k"}, `${k.toUpperCase()} ${fmtMod(C.abilityMod(ch, k))}`)))),
      h("div", {class:"statgrid", style:"margin-top:8px"},
        h("div", {class:"cell"}, h("div", {class:"v"}, C.armorClass(ch, buffs)), h("div", {class:"k"}, "AC")),
        h("div", {class:"cell"}, h("div", {class:"v"}, fmtMod(C.abilityMod(ch, "dex"))), h("div", {class:"k"}, "Initiative")),
        h("div", {class:"cell"}, h("div", {class:"v"}, C.speed(ch)), h("div", {class:"k"}, "Speed")),
        h("div", {class:"cell"}, h("div", {class:"v"}, "+" + C.prof(ch)), h("div", {class:"k"}, "Prof")),
        h("div", {class:"cell"}, h("div", {class:"v"}, C.passivePerception(ch)), h("div", {class:"k"}, "Pass. Perc")),
        h("div", {class:"cell"}, h("div", {class:"v"}, `${ch.hp.hitDiceCur}/${ch.hp.hitDiceMax}`), h("div", {class:"k"}, "Hit Dice"))),
    );
    body.append(h("h2", {style:"margin-top:14px"}, "Saving throws"),
      ...ABILITIES.map(([k, label]) => h("div", {class:"sheetrow"},
        h("span", {class:"k" + (ch.profs.saves.includes(k) ? " prof-dot" : "")}, label),
        h("span", {class:"v"}, fmtMod(C.saveBonus(ch, k))))));
    const conds = ch.conditions || [];
    if(conds.length || ch.exhaustion){
      body.append(h("h2", {style:"margin-top:14px"}, "Conditions"),
        h("div", {class:"condchips"},
          ...conds.map(k => h("span", {class:"chip bad"}, CONDITIONS.find(c => c.k === k)?.name || k)),
          ch.exhaustion ? h("span", {class:"chip bad"}, `Exhaustion ${ch.exhaustion}: ${EXHAUSTION_STAGES[ch.exhaustion-1]}`) : null));
    }
    if(buffs.length){
      body.append(h("h2", {style:"margin-top:14px"}, "Active effects"),
        h("div", {class:"condchips"}, ...buffs.map(b => h("span", {class:"chip"}, b.label))));
    }
    const res = ch.resources || {};
    const resNames = {secondWind:"Second Wind", actionSurge:"Action Surge", channelDivinity:"Channel Divinity", arcaneRecovery:"Arcane Recovery"};
    const rEntries = Object.entries(res);
    if(rEntries.length) body.append(h("h2", {style:"margin-top:14px"}, "Resources"),
      ...rEntries.map(([k, r]) => h("div", {class:"sheetrow"}, h("span", {class:"k"}, resNames[k] || k), h("span", {class:"v"}, `${r.cur}/${r.max}`))));
    body.append(h("h2", {style:"margin-top:14px"}, "Features"),
      h("p", {class:"muted"}, C.featuresAtLevel(ch).map(f => f.name).filter((v, i, a) => a.indexOf(v) === i).join(" · ") || "—"));
  }
  if(tab === "skills"){
    SKILLS.forEach(([k, label, ab]) => {
      const cls = ch.profs.expertise.includes(k) ? " exp-dot" : ch.profs.skills.includes(k) ? " prof-dot" : "";
      body.append(h("div", {class:"sheetrow"},
        h("span", {class:"k" + cls}, `${label} (${ab.toUpperCase()})`),
        h("span", {class:"v"}, fmtMod(C.skillBonus(ch, k)))));
    });
  }
  if(tab === "gear"){
    body.append(h("h2", {}, "Weapons"));
    (ch.equipment.weapons.length ? ch.equipment.weapons : ["—"]).forEach(wn => {
      if(wn === "—"){ body.append(h("p", {class:"muted"}, "None")); return; }
      const atk = C.weaponAttack(ch, wn);
      body.append(h("div", {class:"sheetrow"},
        h("span", {class:"k"}, wn),
        h("span", {class:"v"}, `${fmtMod(atk.toHit)} · ${atk.parts.map(p => `${p.dice.map(d => d.n + "d" + d.d).join("+")}${p.mod ? fmtMod(p.mod) : ""} ${p.type}`).join(", ")}`)));
    });
    body.append(h("h2", {style:"margin-top:12px"}, "Armor"),
      h("div", {class:"sheetrow"}, h("span", {class:"k"}, ch.equipment.armor || "Unarmored"),
        h("span", {class:"v"}, `AC ${C.armorClass(ch, buffs)}${ch.equipment.shield ? " (incl. shield)" : ""}`)));
    body.append(h("h2", {style:"margin-top:12px"}, "Items"),
      ...(ch.equipment.items.length ? ch.equipment.items.map(i => h("div", {class:"sheetrow"},
        h("span", {class:"k"}, i.name), h("span", {class:"v"}, "×" + i.qty))) : [h("p", {class:"muted"}, "Empty pack")]),
      h("div", {class:"sheetrow"}, h("span", {class:"k"}, "Gold"), h("span", {class:"v"}, ch.equipment.gold + " gp")));
  }
  if(tab === "spells"){
    if(!C.isCaster(ch) && !ch.spells.known.length){
      body.append(h("p", {class:"muted"}, `${ch.class}s don't cast spells.`));
    } else {
      const dc = C.spellSaveDC(ch), atk = C.spellAttackBonus(ch);
      if(dc) body.append(h("div", {class:"statgrid"},
        h("div", {class:"cell"}, h("div", {class:"v"}, dc), h("div", {class:"k"}, "Save DC")),
        h("div", {class:"cell"}, h("div", {class:"v"}, fmtMod(atk)), h("div", {class:"k"}, "Spell attack")),
        h("div", {class:"cell"}, h("div", {class:"v"}, (C.castingAbility(ch) || "—").toUpperCase()), h("div", {class:"k"}, "Ability"))));
      const slots = ch.spells.slots || {};
      const slotStr = Object.keys(slots).sort().map(l => `L${l}: ${slots[l].cur}/${slots[l].max}`).join(" · ");
      if(slotStr) body.append(h("p", {class:"center", style:"margin:10px 0"}, h("span", {class:"badge"}, slotStr)));
      body.append(h("h2", {}, "Known spells"));
      ch.spells.known.forEach(n => body.append(h("div", {class:"sheetrow"}, h("span", {class:"k"}, n), h("span", {class:"v"}, ""))));
      if(!ch.spells.known.length) body.append(h("p", {class:"muted"}, "None chosen."));
    }
  }
}
