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

`generateDungeon(seed, level?, mode?, strategy?)`:
- `seed` — number; a non-finite value falls back to a deterministic default.
- `level` — `1`–`6` (clamped); higher levels yield larger, more complex maps.
- `mode` — `'empty'` (geometry only), `'full'` (default; markers), or
  `'detailed'` (named/classified foes, hoards and traps).
- `strategy` — optional `DungeonStrategy` overriding pipeline steps (defaults
  to the built-in algorithm).

## Custom content (`ContentSource`)

The content engine reads from a typed `ContentSource` (monsters, names,
titles, tones, loot, places, moods, activities, traps). `RPGGen` is the engine
bound to the built-in data; build one over your own content with
`createRPGGen`, spreading the built-in `RPG` object to replace just one bucket:

```ts
import { createRPGGen, RPG, mulberry32 } from 'auto-stuff-generator';

const myGen = createRPGGen({
  ...RPG,
  monsters: { fantasy: [{ n: 'Gloom Weasel' }], generic: [] },
});
console.log(myGen.randomMonster(mulberry32(7), myGen.context(mulberry32(7))));
```

The engine passes content strings through verbatim — escape them yourself if
you render generated text into HTML.

## Custom dungeon algorithms (`DungeonStrategy`)

The dungeon pipeline (room placement, corridor carving, marker placement,
secret carving, enrichment, naming) is a swappable interface. Override a
single step by spreading the exported default:

```ts
import { defaultDungeonStrategy, generateDungeon } from 'auto-stuff-generator';

const dungeon = generateDungeon(42, 3, 'full', {
  ...defaultDungeonStrategy,
  placeRooms: myRoomPlacer, // must uphold the invariants documented on DungeonStrategy
});
```

Markers use the `KnownMarkerType` union (`entrance`, `exit`, `boss`,
`monster`, `treasure`, `trap`, `secret`); consumer-defined kind strings remain
assignable and pass through enrichment untouched.

## Development

```bash
npm install      # install dependencies
npm run dev      # type-check + bundle + lint, in watch mode
npm run test     # run the jest suite
npm run build    # lint + type-check + test + bundle + emit type declarations
```
