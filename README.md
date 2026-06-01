# auto-stuff-generator

Headless random-content generator for RPGs and similar tools. Two pieces:

- **`RPGGen`** — a coherent random-content engine. Pick a context (one genre,
  an optional theme and tone) and generate thematically-consistent items,
  locations, monsters, names, titles, traps, moods and activities.
- **`generateDungeon`** — a seeded procedural dungeon generator that returns a
  self-contained, JSON-serializable dungeon (rooms, corridors, markers, secret
  passages/rooms, tally). No rendering, no DOM — the result is pure data you can
  render, save, or re-open however you like.

Every generator accepts an optional RNG (`() => number` in `[0, 1)`). Pass a
seeded one (via the exported `mulberry32(seed)`) for reproducible output, or
omit it to use `Math.random`.

## Install

```bash
npm install auto-stuff-generator
```

## Usage

```ts
import { generateDungeon, RPGGen, mulberry32 } from 'auto-stuff-generator';

// Reproducible dungeon: same seed + level + mode => identical result
const dungeon = generateDungeon(0xC0FFEE, 4, 'detailed');
console.log(dungeon.name, dungeon.tally);

// Coherent one-off content
const rng = mulberry32(42);
const context = RPGGen.context(rng);
console.log(RPGGen.randomMonster(rng, context));
console.log(RPGGen.randomName(rng, context));
```

`generateDungeon(seed, level?, mode?)`:
- `seed` — number; a non-finite value falls back to a deterministic default.
- `level` — `1`–`6` (clamped); higher levels yield larger, more complex maps.
- `mode` — `'empty'` (geometry only), `'full'` (default; markers), or
  `'detailed'` (named/classified foes, hoards and traps).

## Development

```bash
npm install      # install dependencies
npm run dev      # type-check + bundle + lint, in watch mode
npm run test     # run the jest suite
npm run build    # lint + type-check + test + bundle + emit type declarations
```
