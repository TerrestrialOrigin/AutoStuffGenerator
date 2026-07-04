/* ============================================================
   auto-stuff-generator — public API.

   Random-content generation for RPGs and similar: a coherent
   content engine (RPGGen) plus a headless procedural dungeon
   generator. All generation is DOM-free and accepts an optional
   seeded RNG for reproducibility.
   ============================================================ */

// Random-content engine + its types
export { createRPGGen, isVermin, RPGGen } from './rpg-gen';
export type { RNG, RPGContext, RPGGenType } from './rpg-gen';

// Typed contract for the content the engine draws from (inject via createRPGGen)
export type {
  ContentSource,
  GenreMap,
  GivenNameEntry,
  MonsterEntry,
  NamesTable,
  SurnameEntry,
  TitleEntry,
  ToneCategory,
  ToneTable,
} from './content-types';

// Aggregated data buckets (the built-in default ContentSource)
export { RPG } from './data';
export type { RPGData } from './data';

// Procedural dungeon generator + seeded RNG factory + strategy seam
export { defaultDungeonStrategy, generateDungeon, mulberry32 } from './dungeon';
export type { CarveSurface, DungeonStrategy, FloorGrid, GenerationRandom, InternalRoom, ResolvedLevelSpec, SecretFeatures } from './dungeon';

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
  KnownMarkerType,
} from './dungeon-types';
