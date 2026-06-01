/* ============================================================
   auto-stuff-generator — public API.

   Random-content generation for RPGs and similar: a coherent
   content engine (RPGGen) plus a headless procedural dungeon
   generator. All generation is DOM-free and accepts an optional
   seeded RNG for reproducibility.
   ============================================================ */

// Random-content engine + its types
export { RPGGen } from './rpg-gen';
export type { RNG, RPGContext, RPGGenType } from './rpg-gen';

// Aggregated data buckets (the content the engine draws from)
export { RPG } from './data';
export type { RPGData } from './data';

// Procedural dungeon generator + seeded RNG factory
export { generateDungeon, mulberry32 } from './dungeon';

// Dungeon result/value types
export type {
  DungeonMode,
  DungeonResult,
  DungeonGrid,
  DungeonRoom,
  DungeonMarker,
  DungeonSecretPath,
  DungeonSecretRoom,
  DungeonTally,
} from './dungeon-types';
