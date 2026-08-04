# ⚔ Dungeon Crawler — a D&D 5e roguelike PWA

A room-by-room dungeon crawler built on the D&D 5e rules, playable one-handed on a phone,
installable as an app, and fully offline once loaded. Built as a companion to
[dnd-character-sheet](https://github.com/BaesTheorem/dnd-character-sheet), whose dice engine,
conditions kernel, storage layer, and 5e dataset it reuses.

**Play it:** https://baestheorem.github.io/dnd-dungeon-crawler/

## Install on iPhone

1. Open the link above in **Safari**.
2. Tap the **Share** button → **Add to Home Screen**.
3. Launch from the home screen icon — it runs standalone, portrait-locked, and works in
   airplane mode after the first load. Your heroes are saved on-device (IndexedDB) and survive
   force-quits and restarts.
4. Sound starts after your first tap (an iOS rule). Music and SFX toggles are in Settings on
   the roster screen.

## The game

- **Full 5e character builder** — point buy / standard array / rolled stats, all races,
  13 classes, backgrounds, skill picks, real starting-equipment choices, and spell selection
  drawn from the complete dataset (1,300+ monsters, 510 spells).
- **The descent** — 5 floors × 5 rooms. Fights, traps, treasure, rest sites, and strange
  encounters, with a guarded stairway on every floor and a boss at the bottom.
- **Real 5e combat** — initiative, attack rolls vs AC, advantage/disadvantage from the
  conditions engine, saving throws, crits (dice doubled, not modifiers), sneak attack,
  fighting styles, Second Wind / Action Surge / Channel Divinity, spell slots with upcasting,
  concentration checks, and death saves.
- **XP and level-ups** between rooms: HP (average or roll), ASIs, subclasses, new spells.
- **Music & SFX** — real soundtrack per mode (menu / dungeon / combat / boss) with sound
  effects synthesized by the Web Audio API. Music by Kevin MacLeod (incompetech.com),
  licensed under [Creative Commons: By Attribution 4.0](https://creativecommons.org/licenses/by/4.0/):
  "Master of the Feast", "Ossuary 5 - Rest", "Crossing the Chasm", "Five Armies".

### House rules (deliberate, for solo play)

- At 0 HP the enemy leaves you for dead: you roll death saves alone instead of being
  finished off. Stabilizing puts you back up at 1 HP but forfeits the room's reward.
- Healing potions are a bonus action.
- Fleeing is an Athletics/Acrobatics check (DC 10 + floor); failing costs your turn.
- Trap deaths are final — no death saves at the bottom of a pit.
- The four "core" classes (Fighter, Rogue, Wizard, Cleric) have their signature features
  automated. The other nine are fully playable — correct HP, saves, slots, and spell
  lists — with their features shown as reference text on the sheet.

## Development

No build step — plain ES modules. Serve the repo root and go:

```
python3 -m http.server 8000     # ES modules don't run over file://
node --test tests/              # engine test suite (dice, rules, combat, dungeon)
git config core.hooksPath .githooks   # once per clone: version/cache stamping
```

Deploys to GitHub Pages on every push to `main` (`.github/workflows/pages.yml`).

This is a personal-use hobby project.
