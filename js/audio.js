/* Procedural audio: Web Audio SFX + a generative ambient music loop. Zero binary assets.
   iOS Safari requires a user gesture before audio can play: initAudio() is bound to the first
   touch/click; every call before that safely no-ops. */

import { getJSON, setJSON } from "./storage.js";

let ctx = null;
let sfxGain = null, musicGain = null;
let prefs = { sfx: true, music: true, sfxVol: 0.7, musicVol: 0.35 };

export function loadAudioPrefs(){
  const p = getJSON("prefs", {});
  if(p.audio) prefs = { ...prefs, ...p.audio };
}
export function saveAudioPrefs(){
  const p = getJSON("prefs", {});
  p.audio = prefs;
  setJSON("prefs", p);
}
export function audioPrefs(){ return prefs; }
export function setAudioPref(key, val){
  prefs[key] = val;
  saveAudioPrefs();
  if(musicGain) musicGain.gain.value = prefs.music ? prefs.musicVol : 0;
  if(sfxGain) sfxGain.gain.value = prefs.sfx ? prefs.sfxVol : 0;
  if(key === "music" || key === "musicVol"){ if(prefs.music) ensureMusic(); }
}

/* iOS quirks handled here:
   - The context may only be created/resumed inside a user gesture, and iOS re-suspends ("interrupted")
     it whenever the PWA is backgrounded or a call comes in — so initAudio() is safe to call on EVERY
     gesture, not just the first.
   - Web Audio alone is muted by the ring/silent hardware switch. Looping a silent <audio> element
     (started from a gesture) promotes the page to a "playback" audio session, which un-gates Web
     Audio even with the switch on — the standard workaround. */
let _silentEl = null;
const SILENT_WAV = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";
function unlockSilentSession(){
  try{
    if(!_silentEl){
      _silentEl = document.createElement("audio");
      _silentEl.src = SILENT_WAV;
      _silentEl.loop = true;
      _silentEl.volume = 0.01;
      _silentEl.setAttribute("playsinline", "");
      _silentEl.setAttribute("aria-hidden", "true");
      document.body.appendChild(_silentEl);
    }
    if(_silentEl.paused) _silentEl.play().catch(() => {});
  }catch(e){}
}

export function initAudio(){
  unlockSilentSession();
  if(ctx){
    if(ctx.state !== "running") ctx.resume().then(() => { if(_wantMusic && !musicRunning()) startMusic(_wantMusic); }).catch(() => {});
    else if(_wantMusic && !musicRunning()) startMusic(_wantMusic);
    return;
  }
  try{
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }catch(e){ return; }
  sfxGain = ctx.createGain(); sfxGain.gain.value = prefs.sfx ? prefs.sfxVol : 0; sfxGain.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = prefs.music ? prefs.musicVol : 0; musicGain.connect(ctx.destination);
  if(ctx.state !== "running") ctx.resume().catch(() => {});
  ctx.onstatechange = () => { if(ctx.state === "running" && _wantMusic && !musicRunning()) startMusic(_wantMusic); };
  if(_wantMusic) startMusic(_wantMusic);
}
export function audioReady(){ return !!ctx && ctx.state !== "suspended"; }
function musicRunning(){ return !!_music; }

/* ---- SFX synthesis primitives ---- */
function env(node, t0, a, d, peak = 1){
  node.gain.setValueAtTime(0.0001, t0);
  node.gain.exponentialRampToValueAtTime(peak, t0 + a);
  node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}
function tone(freq, type, t0, a, d, peak = 0.5, slideTo = null){
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + a + d);
  env(g, t0, a, d, peak);
  o.connect(g); g.connect(sfxGain);
  o.start(t0); o.stop(t0 + a + d + 0.05);
}
function noise(t0, a, d, peak = 0.4, freq = 1200, q = 1){
  const len = Math.ceil(ctx.sampleRate * (a + d + 0.05));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for(let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); env(g, t0, a, d, peak);
  src.connect(f); f.connect(g); g.connect(sfxGain);
  src.start(t0); src.stop(t0 + a + d + 0.05);
}

/* ---- SFX library ---- */
const SFX = {
  "ui-tap":       t => tone(660, "square", t, 0.005, 0.05, 0.12),
  "roll":         t => { for(let i=0;i<4;i++) noise(t + i*0.05, 0.005, 0.04, 0.18, 2400 + Math.random()*800, 3); },
  "hit":          t => { noise(t, 0.005, 0.12, 0.5, 900, 1.5); tone(180, "square", t, 0.005, 0.1, 0.3, 80); },
  "spell-hit":    t => { tone(880, "sawtooth", t, 0.01, 0.25, 0.25, 220); noise(t, 0.01, 0.2, 0.25, 2000, 2); },
  "crit":         t => { noise(t, 0.005, 0.18, 0.6, 700, 1); tone(140, "square", t, 0.005, 0.2, 0.4, 60);
                          tone(1320, "triangle", t + 0.1, 0.01, 0.3, 0.25, 1980); },
  "miss":         t => noise(t, 0.02, 0.15, 0.25, 3000, 4),
  "monster-miss": t => noise(t, 0.02, 0.12, 0.2, 2400, 4),
  "damage-taken": t => { tone(220, "sawtooth", t, 0.005, 0.22, 0.4, 90); noise(t, 0.005, 0.12, 0.3, 500, 1); },
  "heal":         t => [523, 659, 784].forEach((f, i) => tone(f, "sine", t + i*0.09, 0.02, 0.28, 0.28)),
  "spell":        t => tone(440, "sine", t, 0.05, 0.3, 0.22, 880),
  "treasure":     t => [784, 988, 1175, 1568].forEach((f, i) => tone(f, "triangle", t + i*0.07, 0.01, 0.22, 0.25)),
  "trap":         t => { tone(400, "square", t, 0.005, 0.08, 0.3, 120); noise(t + 0.04, 0.005, 0.25, 0.4, 800, 1); },
  "level-up":     t => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, "triangle", t + i*0.1, 0.02, 0.35, 0.3)),
  "kill":         t => { tone(300, "sawtooth", t, 0.01, 0.35, 0.35, 50); noise(t, 0.01, 0.3, 0.3, 400, 1); },
  "down":         t => tone(400, "sawtooth", t, 0.02, 0.7, 0.4, 55),
  "death":        t => { [330, 311, 294, 262].forEach((f, i) => tone(f, "sawtooth", t + i*0.35, 0.03, 0.4, 0.3)); },
  "victory":      t => [523, 659, 784, 1047].forEach((f, i) => tone(f, "triangle", t + i*0.12, 0.02, 0.4, 0.3)),
  "door":         t => { tone(90, "sawtooth", t, 0.02, 0.5, 0.35, 60); noise(t + 0.05, 0.05, 0.4, 0.15, 300, 1); },
  "stairs":       t => [392, 330, 262].forEach((f, i) => tone(f, "sine", t + i*0.15, 0.02, 0.35, 0.25)),
};

export function sfx(name){
  if(!ctx || !prefs.sfx) return;
  if(ctx.state !== "running"){ ctx.resume().catch(() => {}); return; }
  const fn = SFX[name];
  if(fn) try{ fn(ctx.currentTime + 0.01); }catch(e){}
}

/* ---- generative music ----
   Slow minor-key pad: scheduled chord drones + occasional low pulse. Modes shift the root/tempo. */
const MODES = {
  dungeon: { root: 110.00, chords: [[0,3,7],[0,5,8],[-2,3,7],[0,3,10]], step: 4.0, pulse: 0.10 },
  combat:  { root: 130.81, chords: [[0,3,7],[-2,2,7],[1,4,8],[0,3,7]],  step: 2.2, pulse: 0.35 },
  boss:    { root:  98.00, chords: [[0,3,7],[0,1,7],[-1,3,6],[0,3,7]],  step: 2.0, pulse: 0.5  },
  town:    { root: 146.83, chords: [[0,4,7],[0,5,9],[-3,4,7],[0,4,7]],  step: 4.5, pulse: 0.0  },
};
let _music = null, _wantMusic = null;

function scheduleChord(mode, when, chordIdx){
  const m = MODES[mode];
  const semis = m.chords[chordIdx % m.chords.length];
  semis.forEach((s, i) => {
    const f = m.root * Math.pow(2, s / 12) * (i === 0 ? 1 : 1);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = i === 0 ? "triangle" : "sine";
    o.frequency.value = f * (i === 2 ? 2 : 1);
    const dur = m.step * 1.15;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.16 / (i + 1), when + m.step * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(musicGain);
    o.start(when); o.stop(when + dur + 0.1);
  });
  if(m.pulse > 0 && Math.random() < m.pulse){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = m.root / 2;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.3, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);
    o.connect(g); g.connect(musicGain);
    o.start(when); o.stop(when + 0.6);
  }
}

function ensureMusic(){ if(_wantMusic && !_music) startMusic(_wantMusic); }

export function startMusic(mode){
  _wantMusic = mode;
  if(!ctx || !prefs.music) return;
  stopMusicNow();
  const m = MODES[mode] || MODES.dungeon;
  let chord = 0;
  let nextAt = ctx.currentTime + 0.1;
  const timer = setInterval(() => {
    if(!ctx || !prefs.music) return;
    while(nextAt < ctx.currentTime + 2 * m.step){       // lookahead scheduling
      scheduleChord(mode, nextAt, chord++);
      nextAt += m.step;
    }
  }, 500);
  scheduleChord(mode, nextAt, chord++); nextAt += m.step;
  _music = { mode, timer };
}
function stopMusicNow(){ if(_music){ clearInterval(_music.timer); _music = null; } }
export function stopMusic(){ _wantMusic = null; stopMusicNow(); }
export function musicMode(){ return _music ? _music.mode : null; }
