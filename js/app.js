/* App orchestrator: boot + loading, roster, dungeon flow, level-up, end screens, settings. */

import { $, h, clear, showScreen, showBar, renderEvents, confirmDialog, logEl } from "./ui.js";
import { loadData, idx } from "../data/data.js";
import { initState, S, queueSave, saveNow, deleteCharacter, loadRun, clearRun } from "./state.js";
import { startBuilder } from "./builder.js";
import { bindSheet, openSheet, renderSheet } from "./sheet.js";
import { startCombatUI, teardownCombatUI, currentCombat } from "./combat-ui.js";
import * as D from "./dungeon.js";
import * as C from "./character.js";
import * as CB from "./combat.js";
import { levelForXP, XP_TABLE, ABILITIES, fmtMod } from "./rules.js";
import { rollDie } from "./dice.js";
import { initAudio, loadAudioPrefs, audioPrefs, setAudioPref, sfx, startMusic, stopMusic, audioDebug } from "./audio.js";
import { getJSON, setJSON } from "./storage.js";
import { FLOORS, ROOMS_PER_FLOOR } from "../data/tables.js";
import { classSpellList } from "../data/data.js";
import { icon, bigIcon } from "./icons.js";

const VERSION = document.querySelector('meta[name="app-version"]')?.content || "dev";

/* ---- boot ---- */
async function boot(){
  loadAudioPrefs();
  const prefs = getJSON("prefs", {});
  if(prefs.light) document.body.classList.add("light");
  // Every gesture re-arms audio: iOS suspends the context on background/interruption, so this
  // must NOT be a once-only listener. touchend/click (not touchstart) count as activation gestures.
  ["pointerdown","touchend","click","keydown"].forEach(ev =>
    document.addEventListener(ev, () => initAudio(), { passive:true }));
  document.addEventListener("visibilitychange", () => { if(!document.hidden) initAudio(); });
  if("serviceWorker" in navigator && location.protocol.startsWith("http")){
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  try{
    await Promise.all([ initState(), loadDataWithProgress() ]);
  }catch(e){
    $("loading-note").textContent = "Failed to load game data — check your connection and reload.";
    return;
  }
  bindSheet(() => currentCombat());
  window.__audioDebug = audioDebug;                     // console/diagnostic hook
  // Save-and-exit from anywhere in the game (mid-combat included — the fight resumes on return).
  const exitBtn = $("game-exit");
  exitBtn.append(icon("arrowUp", 16));
  exitBtn.addEventListener("click", () => {
    saveNow();
    teardownCombatUI();
    renderRoster();
    showScreen("screen-roster");
    startMusic("town");
  });
  window.addEventListener("render-roster", renderRoster);
  renderRoster();
  showScreen("screen-roster");
  startMusic("town");
}

async function loadDataWithProgress(){
  const note = $("loading-note"), fill = $("loading-fill");
  note.textContent = "Loading the bestiary…";
  const res = await fetch("./data/source-data.json");
  if(!res.ok) throw new Error("HTTP " + res.status);
  const total = 11669905;                               // uncompressed size; content-length lies behind gzip
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if(!reader){ const { injectData } = await import("../data/data.js"); injectData(await res.json()); return; }
  const chunks = []; let got = 0;
  for(;;){
    const { done, value } = await reader.read();
    if(done) break;
    chunks.push(value); got += value.length;
    fill.style.width = Math.min(100, 100 * got / total) + "%";
  }
  const buf = new Uint8Array(got);
  let off = 0; chunks.forEach(c => { buf.set(c, off); off += c.length; });
  note.textContent = "Waking the monsters…";
  await new Promise(r => setTimeout(r, 30));
  const { injectData } = await import("../data/data.js");
  injectData(JSON.parse(new TextDecoder().decode(buf)));
  fill.style.width = "100%";
}

/* ---- roster ---- */
function renderRoster(){
  teardownCombatUI();
  stopMusicIfCombat();
  const body = clear($("roster-body"));
  body.append(
    h("div", {class:"center", style:"margin-top:28px;color:var(--accent)"}, bigIcon("d20", 44)),
    h("h1", {class:"title-hero"}, "Dungeon Crawler"),
    h("p", {class:"subtitle"}, "A D&D 5e roguelike descent"),
    h("div", {class:"ornament"}));
  if(!S.chars.length){
    body.append(h("div", {class:"card center"},
      h("p", {}, "No heroes yet. Forge one and descend."),
    ));
  }
  S.chars.forEach(ch => {
    const run = loadRun(ch.id);
    const dead = ch.status === "dead";
    body.append(h("div", {class:"card charcard"},
      h("div", {class:"info", onclick: () => { if(!dead) enterGame(ch); }},
        h("div", {class:"nm"}, ch.name || "Unnamed"),
        h("div", {class:"meta"}, `Level ${ch.level} ${ch.race} ${ch.class} · ${ch.xp} XP`),
        dead ? h("div", {class:"dead"}, "Fell in the dark") :
          run && run.status === "active" ? h("div", {class:"meta"}, `In the dungeon — floor ${run.floor}, room ${run.roomIndex}`) :
          h("div", {class:"meta"}, "At the surface")),
      !dead && run && run.status === "active"
        ? h("button", {class:"iconbtn", title:"Abandon run", onclick: () => {
            if(confirmDialog(`Abandon the current run (floor ${run.floor})? ${ch.name} returns to the surface fully rested; the next descent starts at floor 1.`)){
              restartRun(ch);
            }
          }}, icon("restart", 16))
        : null,
      dead
        ? h("button", {class:"iconbtn", title:"Resurrect", onclick: () => {
            const tithe = Math.floor(ch.equipment.gold / 2);
            if(confirmDialog(`Carry ${ch.name} to the temple for resurrection? The clergy take half your gold as tithe (${tithe} gp).`)){
              ch.equipment.gold -= tithe;
              ch.status = "alive";
              ch.conditions = [];
              ch.deathSaves = {s:0, f:0};
              ch.exhaustion = 0;
              C.longRest(ch);
              clearRun(ch.id);
              S.current = ch;
              saveNow();
              sfx("level-up");
              renderRoster();
            }
          }}, icon("sun", 16))
        : null,
      dead
        ? h("button", {class:"iconbtn", onclick: () => { if(confirmDialog(`Lay ${ch.name} to rest (delete)?`)){ deleteCharacter(ch.id); renderRoster(); } }}, icon("grave", 16))
        : h("button", {class:"iconbtn", onclick: () => { if(confirmDialog(`Delete ${ch.name}? This cannot be undone.`)){ deleteCharacter(ch.id); renderRoster(); } }}, icon("x", 16))));
  });
  body.append(h("button", {class:"btn primary", onclick: () => startBuilder(onCharacterBuilt)}, icon("plus"), "New hero"));
  body.append(settingsCard());
  showBar("");
}

function settingsCard(){
  const p = audioPrefs();
  const prefs = getJSON("prefs", {});
  return h("div", {class:"card"},
    h("h2", {}, "Settings"),
    h("div", {class:"btnrow"},
      h("button", {class:"btn small" + (p.sfx ? " primary" : ""), onclick: e => { setAudioPref("sfx", !audioPrefs().sfx); renderRoster(); }}, icon(p.sfx ? "volume" : "volumeOff", 16), p.sfx ? "Sound on" : "Sound off"),
      h("button", {class:"btn small" + (p.music ? " primary" : ""), onclick: e => { setAudioPref("music", !audioPrefs().music); if(audioPrefs().music) startMusic("town"); else stopMusic(); renderRoster(); }}, icon("music", 16), p.music ? "Music on" : "Music off"),
      h("button", {class:"btn small", onclick: () => {
        document.body.classList.toggle("light");
        prefs.light = document.body.classList.contains("light");
        setJSON("prefs", { ...getJSON("prefs", {}), light: prefs.light });
      }}, icon("moon", 16), "Theme")),
    p.music ? h("div", {},
      h("label", {}, "Music track"),
      h("div", {class:"btnrow"},
        ...[["auto","Auto"],["town","Feast"],["dungeon","Ossuary"],["combat","Chasm"],["boss","Armies"]].map(([k, lbl]) =>
          h("button", {class:"btn small" + ((p.track || "auto") === k ? " primary" : ""),
            onclick: () => { setAudioPref("track", k); renderRoster(); }}, lbl))),
      h("p", {class:"muted", style:"margin-top:2px"}, "Auto matches the music to the scene; picking a track plays it everywhere.")) : null,
    h("p", {class:"muted"}, `v${VERSION} · offline-ready · your heroes live in this device's browser storage`));
}

function onCharacterBuilt(ch){
  S.current = ch;
  S.chars.unshift(ch);
  saveNow();
  enterGame(ch);
}

/* Abandon the current run: the hero climbs out, rests fully, and the next descent starts at floor 1. */
function restartRun(ch, { revive = false } = {}){
  if(revive) ch.status = "alive";
  ch.conditions = [];
  ch.deathSaves = {s:0, f:0};
  ch.exhaustion = 0;
  C.longRest(ch);
  clearRun(ch.id);
  S.current = ch;
  saveNow();
  enterGame(ch);
}

/* ---- game flow ---- */
function enterGame(ch){
  S.current = ch;
  let run = loadRun(ch.id);
  if(!run || run.status !== "active"){
    run = D.newRun(ch);
    S.run = run;
    saveNow();
  } else {
    S.run = run;
  }
  showScreen("screen-game");
  if(run.combat && !CB.combatOver(run.combat)){
    // Mid-combat refresh: resume exactly where we left off.
    startCombatUI(run.combat, ch, run.floor, onCombatEnd);
    $("game-title").textContent = `Floor ${run.floor} · Room ${run.roomIndex}`;
    return;
  }
  if(run.room && !run.room.resolved) renderRoom();
  else renderCorridor();
}

function hud(){
  $("game-title").textContent = `Floor ${S.run.floor} · ${S.current.name}`;
  const pips = clear($("room-pips"));
  for(let i = 1; i <= ROOMS_PER_FLOOR; i++){
    pips.append(h("span", {class:"pip" + (i < S.run.roomIndex ? " done" : i === S.run.roomIndex ? " cur" : "")}));
  }
}

/* Corridor: between rooms — the "press on" screen (also handles level-up gate). */
function renderCorridor(){
  teardownCombatUI();
  startMusic("dungeon");
  const ch = S.current, run = S.run;
  hud();
  const area = clear($("combat-area"));
  clear(logEl());
  if(levelForXP(ch.xp) > ch.level){ renderLevelUp(area); return; }
  const nextIsLast = run.roomIndex + 1 >= ROOMS_PER_FLOOR;
  area.append(h("div", {class:"card center"},
    h("div", {class:"bigicon"}, bigIcon("candle")),
    h("p", {class:"flavor"}, run.roomIndex === 0
      ? (run.floor === 1 ? "Torch in hand, you stand at the dungeon mouth. The dark swallows the stairs below." : `Floor ${run.floor}. The air is colder here.`)
      : "The corridor stretches on, quiet for now."),
    h("p", {class:"muted"}, `Room ${run.roomIndex} of ${ROOMS_PER_FLOOR} cleared on this floor.` + (nextIsLast ? (run.floor >= FLOORS ? " The boss lair is next." : " The stairs down are next — guarded.") : "")),
  ));
  area.append(statusStrip());
  area.append(h("div", {class:"log"}, logEl()));
  const bar = clear($("actionbar")); showBar("actionbar");
  const mainBar = () => {
    clear(bar);
    bar.append(h("button", {class:"btn primary", onclick: () => { sfx("door"); D.nextRoom(S.run, ch); queueSave(); renderRoom(); }},
      icon(nextIsLast ? (run.floor >= FLOORS ? "crown" : "stairs") : "door"),
      nextIsLast ? (run.floor >= FLOORS ? "Enter the boss lair" : "Approach the stairs") : "Open the next door"));
    const castable = D.castableOutOfCombat(ch);
    if(castable.length) bar.append(h("button", {class:"btn", onclick: castBar}, icon("sparkle"), "Cast a spell"));
    bar.append(h("button", {class:"btn", onclick: () => openSheet(ch)}, icon("scroll"), "Character sheet"));
    bar.append(h("button", {class:"btn", onclick: () => { saveNow(); renderRoster(); showScreen("screen-roster"); }}, icon("arrowUp"), "Retreat to the surface"));
    bar.append(h("button", {class:"btn", onclick: () => {
      if(confirmDialog(`Abandon this run (floor ${run.floor})? You return to the surface fully rested and start over at floor 1. XP, gold, and loot are kept.`)){
        sfx("stairs");
        restartRun(ch);
      }
    }}, icon("restart"), "Abandon run — start over"));
  };
  const castBar = () => {
    clear(bar);
    D.castableOutOfCombat(ch).forEach(({n, mech, opt, label}) => {
      const s = mech.spell;
      const already = mech.buff === "mageArmor" && (ch.effects || []).some(b => b.buff === "mageArmor");
      bar.append(h("button", {class:"btn primary", disabled: already ? "" : null, onclick: () => {
        const r = D.castUtility(ch, n, opt, S.run);
        r.events.forEach(e => { if(e.t === "sfx") sfx(e.name); });
        renderEvents(logEl(), r.events);
        queueSave();
        mainBar();
      }}, label || `${n}${s.level ? ` (L${s.level})` : " (cantrip)"}${already ? " — active" : ""}`));
    });
    bar.append(h("button", {class:"btn", onclick: mainBar}, "Cancel"));
  };
  mainBar();
}

function statusStrip(){
  const ch = S.current;
  return h("div", {class:"card"},
    h("div", {class:"charcard", onclick: () => openSheet(ch)},
      h("div", {class:"info"},
        h("div", {class:"nm"}, `${ch.name} · Lv ${ch.level}`),
        h("div", {class:"hpbar"}, h("div", {class:"fill" + (ch.hp.cur/ch.hp.max <= .25 ? " crit" : ch.hp.cur/ch.hp.max <= .55 ? " hurt" : ""), style:`width:${Math.max(0, 100*ch.hp.cur/Math.max(1, ch.hp.max))}%`})),
        h("div", {class:"meta"}, `${ch.hp.cur}/${ch.hp.max} HP · AC ${C.armorClass(ch)} · ${ch.equipment.gold} gp · XP ${ch.xp}${XP_TABLE[ch.level] != null ? "/" + XP_TABLE[ch.level] : ""}`))));
}

function renderRoom(){
  const ch = S.current, run = S.run, room = run.room;
  hud();
  teardownCombatUI();
  const area = clear($("combat-area"));
  clear(logEl());
  const bar = clear($("actionbar")); showBar("actionbar");
  const log = logEl();

  if(room.type === "combat" || room.type === "stairs" || room.type === "boss"){
    area.append(h("div", {class:"card center"},
      h("div", {class:"bigicon"}, bigIcon(room.type === "boss" ? "crown" : "swords")),
      h("p", {class:"flavor"}, room.flavor),
      h("p", {}, room.monsters.map(m => m.name).join(", ") + " — " + (room.monsters[0].flavor || ""))));
    area.append(statusStrip());
    bar.append(h("button", {class:"btn primary", onclick: () => {
      const st = D.enterCombat(run, ch);
      if(run.pendingBless){ st.playerBuffs.push({buff:"bless", label:"Blessed (shrine)", conc:false}); run.pendingBless = false; }
      queueSave();
      startCombatUI(st, ch, run.floor, onCombatEnd);
    }}, icon("swords"), "Fight"));
    bar.append(h("button", {class:"btn", onclick: () => openSheet(ch)}, icon("scroll"), "Sheet"));
    return;
  }
  if(room.type === "trap"){ renderTrapRoom(area, bar, log); return; }
  if(room.type === "treasure"){ renderTreasureRoom(area, bar, log); return; }
  if(room.type === "rest"){ renderRestRoom(area, bar, log); return; }
  if(room.type === "event"){ renderEventRoom(area, bar, log); return; }
  // empty fallback
  room.resolved = true;
  renderCorridor();
}

function afterRoomResolved(){
  const run = S.run, ch = S.current;
  saveNow();
  if(run.status === "dead" || ch.status === "dead"){ renderDeath(); return; }
  const status = D.advanceAfterRoom(run, ch);
  saveNow();
  if(status === "won"){ renderVictory(); return; }
  if(run.floor !== run._lastFloorShown && run.roomIndex === 0){ sfx("stairs"); }
  run._lastFloorShown = run.floor;
  renderCorridor();
}

function contBar(bar, label = "Press on"){
  clear(bar);
  bar.append(h("button", {class:"btn primary", onclick: afterRoomResolved}, icon("arrowRight"), label));
  bar.append(h("button", {class:"btn", onclick: () => openSheet(S.current)}, icon("scroll"), "Sheet"));
}

function renderTrapRoom(area, bar, log){
  const ch = S.current, run = S.run, room = run.room, trap = room.trap;
  area.append(h("div", {class:"card center"},
    h("div", {class:"bigicon"}, bigIcon("skull")),
    h("p", {class:"flavor"}, trap.text),
    room.detected ? h("p", {}, h("span", {class:"badge"}, `You sense danger: ${trap.name}`)) :
      h("p", {class:"muted"}, "Something feels wrong about this room…")));
  area.append(statusStrip());
  area.append(h("div", {class:"log"}, log));
  const act = (action) => {
    const r = D.trapAct(run, ch, action);
    r.events.forEach(e => { if(e.t === "sfx") sfx(e.name); });
    renderEvents(log, r.events);
    queueSave();
    if(room.resolved){
      if(run.status === "dead"){ setTimeout(renderDeath, 900); return; }
      contBar(bar);
    } else if(room.trapState === "detected" || room.trapState === "unfound"){
      renderTrapBar();
    }
  };
  const renderTrapBar = () => {
    clear(bar);
    if(room.trapState === "detected"){
      bar.append(h("button", {class:"btn primary", onclick: () => act("disarm")}, icon("gear"), `Disarm (${trap.disarmSkill})`));
      bar.append(h("button", {class:"btn", onclick: () => act("careful")}, icon("foot"), "Edge past carefully"));
    } else if(room.trapState === "unfound"){
      bar.append(h("button", {class:"btn primary", onclick: () => act("barge")}, icon("foot"), "Chance it"));
    } else {
      bar.append(h("button", {class:"btn primary", onclick: () => act("search")}, icon("eye"), "Search the room"));
      bar.append(h("button", {class:"btn", onclick: () => act("barge")}, icon("foot"), "Stride through"));
    }
  };
  renderTrapBar();
}

function renderTreasureRoom(area, bar, log){
  const ch = S.current, run = S.run, room = run.room;
  area.append(h("div", {class:"card center"},
    h("div", {class:"bigicon"}, bigIcon("chest")),
    h("p", {class:"flavor"}, room.flavor)));
  area.append(statusStrip());
  area.append(h("div", {class:"log"}, log));
  clear(bar);
  bar.append(h("button", {class:"btn primary", onclick: () => {
    const r = D.openChest(run, ch);
    r.events.forEach(e => { if(e.t === "sfx") sfx(e.name); });
    renderEvents(log, r.events);
    queueSave();
    if(run.status === "dead"){ setTimeout(renderDeath, 900); return; }
    if(room.resolved) contBar(bar);
    else bar.querySelector("button").append(" (again)");
  }}, icon("chest"), "Open the chest"));
  bar.append(h("button", {class:"btn", onclick: () => { room.resolved = true; afterRoomResolved(); }}, icon("arrowRight"), "Leave it — press on"));
}

function renderRestRoom(area, bar, log){
  const ch = S.current, run = S.run, room = run.room;
  area.append(h("div", {class:"card center"},
    h("div", {class:"bigicon"}, bigIcon("fire")),
    h("p", {class:"flavor"}, room.flavor),
    h("p", {class:"muted"}, `Hit dice: ${ch.hp.hitDiceCur}/${ch.hp.hitDiceMax} · Long rest ${run.longRestUsedThisFloor ? "already taken this floor" : "available (1/floor)"}`)));
  area.append(statusStrip());
  area.append(h("div", {class:"log"}, log));
  const doRest = (fn) => {
    const r = fn();
    r.events.forEach(e => { if(e.t === "sfx") sfx(e.name); });
    renderEvents(log, r.events);
    queueSave();
    if(r.ambush){
      room.type = "combat";
      room.monsters = [];
      const st = ambushCombat(run, ch);
      startCombatUI(st, ch, run.floor, onCombatEnd);
      return;
    }
    if(room.resolved) contBar(bar);
  };
  clear(bar);
  const spend = Math.min(2, ch.hp.hitDiceCur) || 1;
  bar.append(h("button", {class:"btn primary", disabled: ch.hp.hitDiceCur <= 0 ? "" : null,
    onclick: () => doRest(() => D.shortRest(run, ch, spend))}, icon("fire"), `Short rest (spend ${spend} Hit ${spend === 1 ? "Die" : "Dice"})`));
  bar.append(h("button", {class:"btn", disabled: run.longRestUsedThisFloor ? "" : null,
    onclick: () => doRest(() => D.longRestHere(run, ch))}, icon("bed"), "Long rest (full recovery)"));
  bar.append(h("button", {class:"btn", onclick: () => { room.resolved = true; afterRoomResolved(); }}, icon("arrowRight"), "Keep moving"));
}

function ambushCombat(run, ch){
  const monsters = D.buildAmbush(run, ch);
  run.room.monsters = monsters;
  run.combat = CB.startCombat(ch, monsters, { surprise:true, label:"Ambush!" });
  queueSave();
  return run.combat;
}

function renderEventRoom(area, bar, log){
  const ch = S.current, run = S.run, room = run.room, ev = room.event;
  area.append(h("div", {class:"card center"},
    h("div", {class:"bigicon"}, bigIcon("web")),
    h("h2", {}, ev.name),
    h("p", {class:"flavor"}, ev.text)));
  area.append(statusStrip());
  area.append(h("div", {class:"log"}, log));
  clear(bar);
  ev.choices.forEach(c => {
    bar.append(h("button", {class:"btn" + (c.key === "skip" ? "" : " primary"), onclick: () => {
      const r = D.eventChoose(run, ch, c.key);
      r.events.forEach(e => { if(e.t === "sfx") sfx(e.name); });
      renderEvents(log, r.events);
      queueSave();
      if(run.status === "dead"){ setTimeout(renderDeath, 900); return; }
      contBar(bar);
    }}, c.label + (c.cost ? ` (${c.cost} gp)` : "")));
  });
}

function onCombatEnd(st){
  const run = S.run, ch = S.current;
  const outcome = D.resolveCombat(run, ch);
  saveNow();
  teardownCombatUI();
  if(outcome === "defeat"){ renderDeath(); return; }
  if(outcome === "victory" && run.room.reward){
    const r = run.room.reward;
    const log = logEl();
    const bits = [`+${r.gold} gp`];
    if(r.potion) bits.push(r.potion);
    if(r.magic) bits.push(r.magic + "!");
    renderEvents(log, [{t:"log", text:`Spoils: ${bits.join(" · ")}`}]);
  }
  afterRoomResolved();
}

/* ---- level up ---- */
function renderLevelUp(area){
  const ch = S.current;
  const newLevel = ch.level + 1;
  const cls = idx().classByName.get(ch.class.toLowerCase());
  sfx("level-up");
  startMusic("town");
  const card = h("div", {class:"card"},
    h("h2", {}, h("span", {style:"display:inline-flex;align-items:center;gap:8px"}, icon("sparkle", 20), `Level ${newLevel}`)),
    h("p", {class:"muted"}, `${ch.name} grows stronger.`));
  const state = { hpMode:"avg", asi:[], subclass:"", newSpells:[], newCantrips:[] };

  // HP
  const hd = cls?.hd || 8;
  card.append(h("p", {}, h("b", {}, "Hit points:")));
  const hpRow = h("div", {class:"btnrow"});
  const avgGain = Math.floor(hd/2) + 1;
  hpRow.append(h("button", {class:"btn small primary", id:"hp-avg"}, `Take average (+${avgGain})`),
    h("button", {class:"btn small", id:"hp-roll"}, `Roll d${hd}`));
  card.append(hpRow);
  const hpNote = h("p", {class:"muted"}, "");
  card.append(hpNote);
  hpRow.children[0].addEventListener("click", () => { state.hpMode = "avg"; state.hpRoll = null; hpNote.textContent = ""; mark(); });
  hpRow.children[1].addEventListener("click", () => {
    state.hpMode = "roll"; state.hpRoll = rollDie(hd);
    sfx("roll");
    hpNote.textContent = `You rolled a ${state.hpRoll}.`; mark();
  });
  function mark(){
    hpRow.children[0].classList.toggle("primary", state.hpMode === "avg");
    hpRow.children[1].classList.toggle("primary", state.hpMode === "roll");
  }

  // Subclass at its level
  if(cls && cls.subclassLevel === newLevel && !ch.subclass && (cls.subclasses || []).length){
    card.append(h("p", {}, h("b", {}, cls.subclassTitle + ":")));
    const row = h("div", {class:"btnrow", style:"flex-wrap:wrap"});
    cls.subclasses.slice(0, 10).forEach(sc => {
      const nm = typeof sc === "string" ? sc : sc.name;
      const b = h("button", {class:"btn small", onclick: () => { state.subclass = nm; [...row.children].forEach(x => x.classList.remove("primary")); b.classList.add("primary"); }}, nm);
      row.append(b);
    });
    card.append(row);
  }

  // ASI at ASI levels
  const isASI = (cls?.features || []).some(f => /^ability score improvement$/i.test(f.name) && f.level === newLevel);
  if(isASI){
    card.append(h("p", {}, h("b", {}, "Ability Score Improvement — pick two +1s (or the same twice):")));
    const row = h("div", {class:"btnrow", style:"flex-wrap:wrap"});
    ABILITIES.forEach(([k]) => {
      const b = h("button", {class:"btn small", onclick: () => {
        if(state.asi.length >= 2) state.asi.shift();
        state.asi.push(k);
        [...row.children].forEach(x => x.classList.remove("primary"));
        state.asi.forEach(a => { const el = [...row.children].find(x => x.textContent.startsWith(a.toUpperCase())); if(el) el.classList.add("primary"); });
        row.nextSibling.textContent = state.asi.length ? `+1 ${state.asi.map(a => a.toUpperCase()).join(", +1 ")}` : "";
      }}, k.toUpperCase());
      row.append(b);
    });
    card.append(row, h("p", {class:"muted"}, ""));
  }

  // New spells
  if(C.isCaster(ch)){
    const after = { ...ch, level:newLevel };
    const canN = C.cantripsAllowed(after) - (ch.spells.known.filter(n => (idx().spellByName.get(n.toLowerCase())||{}).level === 0).length);
    const spN = C.spellsAllowed(after) - (ch.spells.known.filter(n => (idx().spellByName.get(n.toLowerCase())||{}).level > 0).length);
    const maxLvl = C.highestSlotLevel(after) || 1;
    const list = classSpellList(cls.name);
    if(canN > 0){
      card.append(h("p", {}, h("b", {}, `New cantrips (${canN}):`)));
      list.filter(e => e.level === 0 && !ch.spells.known.includes(e.name)).forEach(e =>
        card.append(pickSpell(e, state.newCantrips, canN)));
    }
    if(spN > 0){
      card.append(h("p", {}, h("b", {}, `New spells (up to ${spN}, up to level ${maxLvl}):`)));
      list.filter(e => e.level >= 1 && e.level <= maxLvl && !ch.spells.known.includes(e.name)).forEach(e =>
        card.append(pickSpell(e, state.newSpells, spN)));
    }
  }

  card.append(h("button", {class:"btn primary", style:"margin-top:10px", onclick: () => {
    if(state.subclass) ch.subclass = state.subclass;
    state.asi.forEach(k => ch.bonuses.asi[k] = (ch.bonuses.asi[k] || 0) + 1);
    ch.hp.mode = state.hpMode === "roll" ? "roll" : ch.hp.mode;
    C.applyLevelUp(ch, { hpRoll: state.hpRoll });
    ch.spells.known.push(...state.newCantrips, ...state.newSpells);
    if(/rogue/i.test(ch.class) && ch.level === 6) ch.profs.expertise.push(...ch.profs.skills.filter(s => !ch.profs.expertise.includes(s)).slice(0, 2));
    saveNow();
    sfx("victory");
    renderCorridor();
  }}, icon("check"), "Confirm level up"));
  area.append(card);
  clear($("actionbar"));
  function pickSpell(e, arr, cap){
    const el = h("div", {class:"choice", onclick: () => {
      const i = arr.indexOf(e.name);
      if(i >= 0){ arr.splice(i, 1); el.classList.remove("sel"); }
      else if(arr.length < cap){ arr.push(e.name); el.classList.add("sel"); }
    }},
      h("div", {class:"t"}, `${e.name} ${e.level ? "(L" + e.level + ")" : "(cantrip)"}`),
      h("div", {class:"d"}, (e.spell.text || "").slice(0, 80) + "…"));
    return el;
  }
}

/* ---- end screens ---- */
function renderDeath(){
  const ch = S.current, run = S.run;
  stopMusic(); sfx("death");
  teardownCombatUI();
  showScreen("screen-end");
  const body = clear($("end-body"));
  body.append(
    h("div", {class:"bigicon center", style:"color:var(--bad);margin-top:36px"}, bigIcon("skull", 72)),
    h("h1", {class:"title-hero", style:"color:var(--bad)"}, "You have fallen"),
    h("p", {class:"subtitle"}, `${ch.name} — Level ${ch.level} ${ch.race} ${ch.class}`),
    h("div", {class:"card"},
      h("div", {class:"sheetrow"}, h("span", {class:"k"}, "Floor reached"), h("span", {class:"v"}, run ? run.floor : 1)),
      h("div", {class:"sheetrow"}, h("span", {class:"k"}, "Monsters slain"), h("span", {class:"v"}, run ? run.kills : 0)),
      h("div", {class:"sheetrow"}, h("span", {class:"k"}, "XP earned"), h("span", {class:"v"}, run ? run.xpEarned : 0)),
      h("div", {class:"sheetrow"}, h("span", {class:"k"}, "Gold at death"), h("span", {class:"v"}, ch.equipment.gold + " gp"))),
    h("button", {class:"btn primary", onclick: () => { sfx("level-up"); restartRun(ch, { revive:true }); }},
      icon("restart"), "Rise again — restart from floor 1"),
    h("p", {class:"muted center"}, "Your hero wakes at the surface, fully rested, keeping XP, gold, and loot."),
    h("button", {class:"btn", onclick: () => { clearRun(ch.id); saveNow(); renderRoster(); showScreen("screen-roster"); }},
      icon("grave"), "Accept death — return to the roster"));
  if(run) run.status = "dead";
  saveNow();
}

function renderVictory(){
  const ch = S.current, run = S.run;
  sfx("victory"); startMusic("town");
  teardownCombatUI();
  showScreen("screen-end");
  const body = clear($("end-body"));
  body.append(
    h("div", {class:"bigicon center", style:"color:var(--accent);margin-top:36px"}, bigIcon("trophy", 72)),
    h("h1", {class:"title-hero"}, "The depths are conquered!"),
    h("p", {class:"subtitle"}, `${ch.name} emerges into daylight, breathing hard, rich and alive.`),
    h("div", {class:"card"},
      h("div", {class:"sheetrow"}, h("span", {class:"k"}, "Final level"), h("span", {class:"v"}, ch.level)),
      h("div", {class:"sheetrow"}, h("span", {class:"k"}, "Monsters slain"), h("span", {class:"v"}, run.kills)),
      h("div", {class:"sheetrow"}, h("span", {class:"k"}, "XP earned"), h("span", {class:"v"}, run.xpEarned)),
      h("div", {class:"sheetrow"}, h("span", {class:"k"}, "Gold"), h("span", {class:"v"}, ch.equipment.gold + " gp"))),
    h("button", {class:"btn primary", onclick: () => { clearRun(ch.id); saveNow(); renderRoster(); showScreen("screen-roster"); }}, icon("swords"), "Rest — then descend again"));
  saveNow();
}

function stopMusicIfCombat(){ /* roster gets town music from callers */ }

boot();
