/* Conditions & exhaustion rules kernel — ported from dnd-character-sheet.
   Works for the player and monsters alike: pass the combatant's active condition keys.
   eff.disadv/adv target the bearer's OWN d20 rolls: 'attack' (all attacks), 'check' (ability checks incl.
   initiative), 'save', 'save:str'…, 'skill:<name>'. speed:0|'half'. autofail: saves that auto-fail.
   incap: can't take actions/reactions. Rules text is paraphrased (copyright-clean, from the donor). */

export const CONDITIONS = [
  {k:'blinded', name:'Blinded', eff:{disadv:['attack','skill:perception']}},
  {k:'charmed', name:'Charmed', eff:{}},
  {k:'deafened', name:'Deafened', eff:{}},
  {k:'frightened', name:'Frightened', eff:{disadv:['check','attack']}},
  {k:'grappled', name:'Grappled', eff:{speed:0}},
  {k:'incapacitated', name:'Incapacitated', eff:{incap:true}},
  {k:'invisible', name:'Invisible', eff:{adv:['attack']}},
  {k:'paralyzed', name:'Paralyzed', eff:{incap:true, speed:0, autofail:['str','dex']}},
  {k:'petrified', name:'Petrified', eff:{incap:true, speed:0, autofail:['str','dex']}},
  {k:'poisoned', name:'Poisoned', eff:{disadv:['attack','check']}},
  {k:'prone', name:'Prone', eff:{disadv:['attack'], speed:'half'}},
  {k:'restrained', name:'Restrained', eff:{speed:0, disadv:['attack','save:dex']}},
  {k:'stunned', name:'Stunned', eff:{incap:true, speed:0, autofail:['str','dex']}},
  {k:'unconscious', name:'Unconscious', eff:{incap:true, speed:0, autofail:['str','dex']}},
];

export const CONDITION_BY_KEY = Object.fromEntries(CONDITIONS.map(c => [c.k, c]));

export const EXHAUSTION_STAGES = [
  "Disadvantage on ability checks.",
  "Speed halved.",
  "Disadvantage on attack rolls and saving throws.",
  "Hit point maximum halved.",
  "Speed reduced to 0.",
  "Death.",
];

/* Aggregate active conditions + exhaustion into one effect set.
   active: iterable of condition keys; exhaustion: 0–6. */
export function condEffects(active, exhaustion = 0){
  const out = {disadv:new Set(), adv:new Set(), speedZero:false, speedHalf:false, hpHalf:false, incap:false};
  const set = new Set(active || []);
  CONDITIONS.forEach(c => { if(!set.has(c.k)) return; const e = c.eff;
    (e.disadv||[]).forEach(t => out.disadv.add(t));
    (e.adv||[]).forEach(t => out.adv.add(t));
    (e.autofail||[]).forEach(a => out.disadv.add('save:'+a));
    if(e.speed === 0) out.speedZero = true; else if(e.speed === 'half') out.speedHalf = true;
    if(e.incap) out.incap = true;
  });
  const ex = Math.max(0, Math.min(6, exhaustion|0));
  if(ex>=1) out.disadv.add('check');
  if(ex>=2) out.speedHalf = true;
  if(ex>=3){ out.disadv.add('attack'); out.disadv.add('save'); }
  if(ex>=4) out.hpHalf = true;
  if(ex>=5) out.speedZero = true;
  return out;
}

/* adv & disadv cancel. keys e.g. ['attack'] or ['save','save:dex'] → 'adv' | 'disadv' | null */
export function advFor(eff, keys){
  let a=false, d=false;
  keys.forEach(k => { if(eff.adv.has(k)) a=true; if(eff.disadv.has(k)) d=true; });
  if(a&&d) return null;
  return a?'adv':(d?'disadv':null);
}

/* Combine two adv states (e.g. condition-derived + situational): any adv + any disadv cancel. */
export function combineAdv(...states){
  let a=false, d=false;
  states.forEach(s => { if(s==='adv') a=true; else if(s==='disadv') d=true; });
  if(a&&d) return null;
  return a?'adv':(d?'disadv':null);
}

/* Saves that automatically fail for a bearer with these conditions (str/dex from paralyzed etc.). */
export function autofails(active){
  const set = new Set(active || []); const out = new Set();
  CONDITIONS.forEach(c => { if(set.has(c.k)) (c.eff.autofail||[]).forEach(a => out.add(a)); });
  return out;
}
