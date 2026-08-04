/* Combat screen: enemy list with tap-to-target, adventure log, bottom action bar.
   Drives the combat engine and drains its event stream into log + toasts + SFX. */

import { h, clear, $, hpBarEl, renderEvents, showBar, logEl } from "./ui.js";
import * as CB from "./combat.js";
import * as C from "./character.js";
import { spellMechanics } from "../data/data.js";
import { sfx, startMusic } from "./audio.js";
import { queueSave } from "./state.js";
import { fmtMod } from "./rules.js";
import { icon } from "./icons.js";

let st = null, ch = null, floor = 1, onEnd = null;
let targetIdx = 0;
let submenu = null;           // 'attack' | 'cast' | 'item' | null

export function currentCombat(){ return st; }

export function startCombatUI(state, character, floorNum, endCb){
  st = state; ch = character; floor = floorNum; onEnd = endCb;
  targetIdx = st.monsters.findIndex(m => m.hp > 0);
  submenu = null;
  startMusic(st.monsters.some(m => m.crNum >= 4) ? "boss" : "combat");
  drain();
  render();
  maybeAutoCast();                                       // resume a mid-spell save queue after a refresh
  maybeAutoMonster();
}

function drain(){
  st.events.forEach(e => { if(e.t === "sfx") sfx(e.name); });
  renderEvents(logEl(), st.events);
  st.events = [];
  queueSave();
}

function maybeAutoMonster(){
  if(st && st.phase === "monster" && !st.pendingReaction){
    setTimeout(() => {
      if(!st || st.phase !== "monster" || st.pendingReaction) return;
      CB.monsterStep(st, ch);
      drain(); render();
      if(st && st.phase === "monster" && !st.pendingReaction) maybeAutoMonster();
      else finishIfOver();
    }, 550);
  }
}

/* Multi-target save spells resolve one target at a time (pausing on Barbs prompts). */
function maybeAutoCast(){
  if(st && st.castQueue && !st.pendingReaction){
    setTimeout(() => {
      if(!st || !st.castQueue || st.pendingReaction) return;
      CB.castStep(st, ch);
      drain(); render();
      if(st && st.castQueue && !st.pendingReaction) maybeAutoCast();
      else finishIfOver();
    }, 450);
  }
}

function finishIfOver(){
  if(st && (CB.combatOver(st) || st.phase === "defeat")){
    const done = st;
    setTimeout(() => { if(onEnd) onEnd(done); }, 900);
  }
}

export function render(){
  if(!st) return;
  const area = clear($("combat-area"));
  const alive = st.monsters.filter(m => m.hp > 0);
  if(targetIdx < 0 || !st.monsters[targetIdx] || st.monsters[targetIdx].hp <= 0)
    targetIdx = st.monsters.findIndex(m => m.hp > 0);

  area.append(h("p", {class:"floorpip center"}, `Round ${st.round} — ${st.phase === "player" ? "your turn" : st.phase === "monster" ? "enemy turn" : st.phase}`));

  // Your side always leads the screen, whatever the initiative order.
  area.append(h("div", {class:"card", style:"margin-bottom:10px"},
    h("div", {class:"charcard"},
      h("div", {class:"info"},
        h("div", {class:"nm"}, ch.name),
        hpBarEl(ch.hp.cur, ch.hp.max),
        h("div", {class:"meta"}, `${ch.hp.cur}/${ch.hp.max} HP${ch.hp.temp ? ` +${ch.hp.temp}` : ""} · AC ${C.armorClass(ch, st.playerBuffs)}${ch.conditions.length ? " · " + ch.conditions.join(", ") : ""}${st.playerBuffs.length ? " · " + st.playerBuffs.map(b => b.label.split(" (")[0]).join(", ") : ""}`),
        ch.familiar && ch.familiar.alive
          ? h("div", {class:"meta", style:"color:var(--accent)"}, `${ch.familiar.form} familiar — Help ${st.helpUsed ? "used this round" : "ready"}`)
          : null))));

  st.monsters.forEach((m, i) => {
    area.append(h("div", {class:"enemy" + (m.hp <= 0 ? " dead" : i === targetIdx ? " target" : ""),
      onclick: () => { if(m.hp > 0){ targetIdx = i; sfx("ui-tap"); render(); } }},
      h("div", {style:"flex:1;min-width:0"},
        h("div", {class:"nm"}, m.name),
        h("div", {class:"meta"}, `AC ${m.ac} · CR ${m.cr}${m.conditions.length ? " · " + m.conditions.map(c => c.k).join(", ") : ""}`)),
      h("div", {class:"ebar"}, hpBarEl(m.hp, m.maxHP), h("div", {class:"meta center"}, `${m.hp}/${m.maxHP}`))));
  });

  area.append(h("div", {class:"log", id:"combat-log-holder"}, logEl()));
  renderBar();
}

function renderBar(){
  const bar = clear($("actionbar"));
  bar.classList.add("active");
  showBar("actionbar");
  if(!st) return;
  if(st.phase === "dying"){
    bar.append(h("button", {class:"btn danger", onclick: () => act(() => CB.deathSave(st, ch))},
      icon("skull"), `Roll death save (${ch.deathSaves.s} saved · ${ch.deathSaves.f} failed)`));
    return;
  }
  if(st.pendingReaction){
    const pr = st.pendingReaction;
    if(pr.type === "save"){
      const t = st.monsters[pr.ti];
      bar.append(h("p", {class:"center reactline"},
        `Reaction — ${t.name} resists ${pr.lbl} (${pr.sv.total} vs DC ${pr.dc})!`));
      bar.append(h("button", {class:"btn primary", onclick: () => act(() => CB.reactionChoose(st, ch, "barbs"))}, icon("sparkle"), "Silvery Barbs — force a reroll (L1 slot)"));
      bar.append(h("button", {class:"btn", onclick: () => act(() => CB.reactionChoose(st, ch, "decline"))}, "Let it stand"));
      return;
    }
    const m = st.monsters[pr.mi];
    bar.append(h("p", {class:"center reactline"},
      `Reaction — ${m.name}'s ${pr.atk.name} hits (${pr.res.total} vs AC ${pr.ac})${pr.crit ? ", a critical" : ""}!`));
    if(pr.options.includes("shield"))
      bar.append(h("button", {class:"btn primary", onclick: () => act(() => CB.reactionChoose(st, ch, "shield"))}, icon("shield"),
        pr.deflects ? "Shield — turns it into a miss (L1 slot)" : "Shield — +5 AC until next turn; won't stop this one (L1 slot)"));
    if(pr.options.includes("barbs"))
      bar.append(h("button", {class:"btn primary", onclick: () => act(() => CB.reactionChoose(st, ch, "barbs"))}, icon("sparkle"), "Silvery Barbs — force a reroll (L1 slot)"));
    bar.append(h("button", {class:"btn", onclick: () => act(() => CB.reactionChoose(st, ch, "decline"))}, "Take the hit"));
    return;
  }
  if(st.castQueue){
    bar.append(h("button", {class:"btn", disabled:""}, "Resolving the spell…"));
    return;
  }
  if(st.phase !== "player"){
    bar.append(h("button", {class:"btn", disabled:""}, st.phase === "monster" ? "Enemy acting…" : "…"));
    return;
  }
  if(submenu === "attack"){
    ch.equipment.weapons.forEach(w => {
      const atk = C.weaponAttack(ch, w);
      bar.append(h("button", {class:"btn primary", onclick: () => { submenu = null; act(() => CB.playerAttack(st, ch, w, targetIdx)); }},
        `${w} (${fmtMod(atk.toHit)})`));
    });
    bar.append(h("button", {class:"btn", onclick: () => { submenu = null; render(); }}, "Cancel"));
    return;
  }
  if(submenu && submenu.opts){                            // utility spell: pick which trick
    const { n, lo } = submenu;
    CB.utilityOptions(ch, n).forEach(o => {
      bar.append(h("button", {class:"btn primary", onclick: () => { submenu = null; act(() => CB.playerCastSpell(st, ch, n, lo, targetIdx, o.opt)); }}, o.label));
    });
    bar.append(h("button", {class:"btn", onclick: () => { submenu = "cast"; render(); }}, "Back"));
    return;
  }
  if(submenu === "cast"){
    const canCast = ch.spells.known.map(n => ({ n, mech: spellMechanics(n, ch.level) })).filter(x => x.mech)
      .filter(x => !(x.n.toLowerCase() === "find familiar" && ch.familiar && ch.familiar.alive));
    canCast.forEach(({n, mech}) => {
      const s = mech.spell;
      let lo = 0;
      if(s.level > 0){
        const lvls = Object.keys(ch.spells.slots).map(Number).filter(l => l >= s.level && ch.spells.slots[l].cur > 0);
        if(!lvls.length) return;
        lo = Math.min(...lvls);
      }
      const slotNote = s.level === 0 ? "cantrip" : `L${lo} slot: ${ch.spells.slots[lo].cur}`;
      const opts = mech.kind === "utility" ? CB.utilityOptions(ch, n) : null;
      if(opts && opts.length > 1){
        bar.append(h("button", {class:"btn primary", onclick: () => { submenu = { opts:true, n, lo }; render(); }}, `${n} (${slotNote}) …`));
      } else {
        const suffix = mech.kind === "utility" && !opts
          ? (s.level === 0 ? " — +1d4 next attack" : " — adv next attack + ward")
          : "";
        bar.append(h("button", {class:"btn primary", onclick: () => { submenu = null; act(() => CB.playerCastSpell(st, ch, n, lo, targetIdx, opts ? opts[0].opt : undefined)); }},
          `${n} (${slotNote})${suffix}`));
      }
    });
    if(!canCast.length) bar.append(h("button", {class:"btn", disabled:""}, "No castable spells"));
    bar.append(h("button", {class:"btn", onclick: () => { submenu = null; render(); }}, "Cancel"));
    return;
  }
  if(submenu === "item"){
    const potions = ch.equipment.items.map((it, i) => ({it, i})).filter(x => /potion of .*healing/i.test(x.it.name));
    potions.forEach(({it, i}) =>
      bar.append(h("button", {class:"btn primary", onclick: () => { submenu = null; act(() => CB.playerUsePotion(st, ch, i)); }}, `${it.name} ×${it.qty}`)));
    if(!potions.length) bar.append(h("button", {class:"btn", disabled:""}, "No potions"));
    bar.append(h("button", {class:"btn", onclick: () => { submenu = null; render(); }}, "Cancel"));
    return;
  }
  const grid = h("div", {class:"grid2"});
  const noAction = st.actionsLeft <= 0 && st.attacksLeft <= 0;
  grid.append(h("button", {class:"btn primary", disabled: noAction ? "" : null,
    onclick: () => { if(ch.equipment.weapons.length === 1) act(() => CB.playerAttack(st, ch, ch.equipment.weapons[0], targetIdx)); else { submenu = "attack"; render(); } }},
    icon("swords"), st.attacksLeft > 0 ? `Attack (${st.attacksLeft} left)` : "Attack"));
  if(ch.spells.known.length) grid.append(h("button", {class:"btn primary", disabled: st.actionsLeft <= 0 ? "" : null, onclick: () => { submenu = "cast"; render(); }}, icon("sparkle"), "Cast"));
  grid.append(h("button", {class:"btn", disabled: st.actionsLeft <= 0 ? "" : null, onclick: () => act(() => CB.playerDodge(st, ch))}, icon("shield"), "Dodge"));
  grid.append(h("button", {class:"btn", disabled: st.bonusUsed ? "" : null, onclick: () => { submenu = "item"; render(); }}, icon("flask"), "Potion"));
  if(ch.resources.secondWind?.cur > 0)
    grid.append(h("button", {class:"btn", disabled: st.bonusUsed ? "" : null, onclick: () => act(() => CB.playerSecondWind(st, ch))}, icon("wind"), "Second Wind"));
  if(ch.resources.actionSurge?.cur > 0)
    grid.append(h("button", {class:"btn", onclick: () => act(() => CB.playerActionSurge(st, ch))}, icon("bolt"), "Action Surge"));
  if(ch.resources.channelDivinity?.cur > 0)
    grid.append(h("button", {class:"btn", disabled: st.actionsLeft <= 0 ? "" : null, onclick: () => act(() => CB.playerChannelDivinity(st, ch))}, icon("sun"), "Channel Divinity"));
  if(ch.familiar && ch.familiar.alive)
    grid.append(h("button", {class:"btn", disabled: st.helpUsed ? "" : null, onclick: () => act(() => CB.playerFamiliarHelp(st, ch))}, icon("eye"), "Owl: Help"));
  grid.append(h("button", {class:"btn", disabled: st.actionsLeft <= 0 ? "" : null, onclick: () => act(() => CB.playerFlee(st, ch, floor))}, icon("run"), "Flee"));
  bar.append(grid);
  bar.append(h("button", {class:"btn", onclick: () => act(() => CB.endPlayerTurn(st, ch))}, icon("next"), "End turn"));
}

function act(fn){
  if(!st) return;
  fn();
  drain();
  render();
  maybeAutoCast();
  maybeAutoMonster();
  finishIfOver();
}

export function teardownCombatUI(){ st = null; }
