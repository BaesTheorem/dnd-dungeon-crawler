/* Hand-written game tables: dungeon structure, encounter budgets, traps, loot, events. */

export const FLOORS = 5;
export const ROOMS_PER_FLOOR = 5;

/* Per-floor tuning for a solo hero who starts at level 1 and levels as they descend.
   band: monster CR range drawn from; budget: adjusted-XP target for a normal combat room;
   eliteMult: stair-guard budget multiplier; gold: loot dice per treasure room. */
export const FLOOR_TUNING = [
  { band:[0, 0.5],   budget:100,  eliteMult:1.5, gold:"2d6",   potionChance:0.5 },
  { band:[0.125, 1], budget:225,  eliteMult:1.5, gold:"4d6",   potionChance:0.55 },
  { band:[0.25, 2],  budget:450,  eliteMult:1.5, gold:"2d6x10",potionChance:0.6 },
  { band:[0.5, 3],   budget:700,  eliteMult:1.5, gold:"4d6x10",potionChance:0.65 },
  { band:[1, 4],     budget:1100, eliteMult:1.5, gold:"6d6x10",potionChance:0.7 },
];

/* Final boss candidates by name (drawn from the bestiary; first one found wins). */
export const BOSSES = ["Young White Dragon", "Ettin", "Minotaur", "Ogre"];
export const STAIR_GUARDS = { 1:["Bugbear","Orc","Goblin"], 2:["Ogre","Bugbear","Ghoul"], 3:["Minotaur","Ogre","Wight"], 4:["Ettin","Minotaur","Troll"], 5:[] };

/* Room-type weights for rooms 1–4 of each floor (room 5 is always the stair guard / boss). */
export const ROOM_WEIGHTS = [
  ["combat",   55],
  ["trap",     12],
  ["treasure", 12],
  ["rest",     11],
  ["event",    10],
];

export const TRAPS = [
  { name:"Poison Dart Trap", detectDC:12, disarmSkill:"sleight", disarmDC:12, save:"dex", saveDC:12, dmg:"1d4 piercing; 1d6 poison", text:"Tiny holes line the walls. A pressure plate glints under the dust." },
  { name:"Pit Trap", detectDC:11, disarmSkill:"athletics", disarmDC:11, save:"dex", saveDC:11, dmg:"2d6 bludgeoning", text:"The floorboards ahead sag oddly." },
  { name:"Swinging Blade", detectDC:13, disarmSkill:"sleight", disarmDC:13, save:"dex", saveDC:13, dmg:"2d8 slashing", text:"A thin tripwire crosses the corridor at ankle height." },
  { name:"Flame Jet", detectDC:14, disarmSkill:"arcana", disarmDC:13, save:"dex", saveDC:13, dmg:"3d6 fire", text:"Scorch marks radiate from a carved dragon's mouth in the wall." },
  { name:"Collapsing Ceiling", detectDC:13, disarmSkill:"athletics", disarmDC:14, save:"dex", saveDC:13, dmg:"3d10 bludgeoning", text:"Cracked masonry groans overhead; dust trickles from a web of fissures." },
  { name:"Glyph of Frost", detectDC:15, disarmSkill:"arcana", disarmDC:14, save:"con", saveDC:13, dmg:"4d8 cold", text:"A faint blue rune glows on the flagstones." },
];

/* Events: one choice each; effect handled by the dungeon engine by key. */
export const EVENTS = [
  { key:"fountain", name:"Glowing Fountain", text:"A stone basin brims with silver water that hums faintly.",
    choices:[ {key:"drink", label:"Drink deeply", good:{heal:"2d8", chance:0.7}, bad:{dmg:"1d8 poison"}},
              {key:"skip", label:"Leave it be"} ] },
  { key:"shrine", name:"Forgotten Shrine", text:"A weathered altar to a nameless god, its offering bowl empty.",
    choices:[ {key:"offer", label:"Offer 10 gp", cost:10, good:{buff:"bless", chance:0.8}, bad:{}},
              {key:"skip", label:"Pass respectfully"} ] },
  { key:"corpse", name:"Fallen Adventurer", text:"A long-dead explorer slumps against the wall, pack still on their back.",
    choices:[ {key:"loot", label:"Search the body", good:{gold:"2d10", potion:true, chance:0.85}, bad:{trap:"Poison Dart Trap"}},
              {key:"skip", label:"Leave the dead in peace"} ] },
  { key:"mushrooms", name:"Luminous Mushrooms", text:"A patch of softly glowing fungus carpets the corner.",
    choices:[ {key:"eat", label:"Eat one", good:{heal:"1d8", chance:0.5}, bad:{dmg:"1d8 poison", condition:"poisoned"}},
              {key:"skip", label:"Step around them"} ] },
];

/* Magic loot by floor (names resolved against magicWeapons/magicItems datasets at award time). */
export const MAGIC_LOOT = {
  3: ["+1 Longsword","+1 Shortsword","+1 Battleaxe","+1 Shortbow","+1 Warhammer","+1 Dagger"],
  4: ["+1 Shield","+1 Longbow","+1 Greatsword","+1 Greataxe","+1 Rapier"],
  5: ["+2 Longsword","+2 Battleaxe","Flame Tongue Longsword","+2 Greatsword"],
};

/* Short flavor text pools. */
export const ROOM_FLAVOR = {
  combat: ["The stench hits you before the shapes in the dark do.","Bones crunch underfoot as something stirs.","Torchlight catches movement along the far wall.","The door slams behind you. You are not alone."],
  treasure: ["An iron-banded chest sits in a shaft of pale light.","A strongbox lies half-buried under rubble.","Something glitters inside a toppled sarcophagus."],
  rest: ["A defensible alcove with the ashes of an old campfire.","A quiet cell behind a door that still bolts shut.","A dry fountain room, silent and still."],
  empty: ["Dust, cobwebs, and the echo of your own footsteps.","A ransacked storeroom, picked clean long ago."],
  stairs: ["A stairway descends into deeper dark — but its keeper bars the way.","The way down is guarded."],
  boss: ["The air goes cold. Something vast breathes in the darkness ahead."],
};
