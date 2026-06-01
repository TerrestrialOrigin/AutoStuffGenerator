/* ============================================================
   Public types for the dungeon generator.

   These describe the serializable object returned by
   generateDungeon(). The generator implementation
   (dungeon.ts) is loose, untyped JS ported verbatim from the
   original app; this file is the typed public contract so
   consumers get real types from the published declarations.
   ============================================================ */

/** A random-number generator returning a value in [0, 1). */
export type RNG = () => number;

/**
 * How much content the generator places:
 * - `empty`    — map geometry only (no markers, no secrets)
 * - `full`     — map + markers (entrance/exit/monsters/treasure/traps/secrets)
 * - `detailed` — `full` plus named/classified foes, hoards and traps drawn
 *                from the random-content lists and the chosen tone
 */
export type DungeonMode = 'empty' | 'full' | 'detailed';

/** Grid dimensions and the pixel size of a single cell. */
export interface DungeonGrid {
  gw: number;
  gh: number;
  cell: number;
}

/** A rectangular room placed on the grid. */
export interface DungeonRoom {
  x: number;
  y: number;
  w: number;
  h: number;
  id: number;
}

/** A point of interest on the map (entrance, monster, treasure, trap, …). */
export interface DungeonMarker {
  type: string;
  x: number;
  y: number;
  dir?: string;
  room?: number;
  label?: string;
  note?: string;
  seq?: number;
  ref?: string;
}

/** A straight secret-passage centerline, in cell coordinates. */
export interface DungeonSecretPath {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A hidden room reachable only via a secret passage. */
export interface DungeonSecretRoom {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/** Summary counts shown in the dungeon's tally panel. */
export interface DungeonTally {
  rooms: number;
  foes: number;
  traps: number;
  loot: number;
  secret: number;
}

/**
 * A self-contained, JSON-serializable dungeon. This is the single source
 * of truth — it can be rendered, downloaded, and re-opened. It contains no
 * functions or DOM references.
 */
export interface DungeonResult {
  version: number;
  seed: number;
  level: number;
  name: string;
  depth: string;
  flavor: string;
  genre: string | null;
  tone: string | null;
  grid: DungeonGrid;
  rooms: DungeonRoom[];
  floor: number[][];
  markers: DungeonMarker[];
  secretPaths: DungeonSecretPath[];
  secretRooms: DungeonSecretRoom[];
  secretFloor: number[][] | null;
  tally: DungeonTally;
}
