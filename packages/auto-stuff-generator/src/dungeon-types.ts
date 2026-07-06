/* ============================================================
   Public types for the dungeon generator.

   These describe the serializable object returned by
   generateDungeon(): the typed public contract so consumers get
   real types from the published declarations.
   ============================================================ */

/** A random-number generator returning a value in [0, 1) — canonical declaration in rng-utils. */
export type { RandomNumberGenerator } from './rng-utils';

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
  width: number;
  height: number;
  cellSize: number;
}

/** A rectangular room placed on the grid. */
export interface DungeonRoom {
  gridX: number;
  gridY: number;
  width: number;
  height: number;
  id: number;
}

/** The marker kinds the generator itself places and knows how to enrich. */
export type KnownMarkerType = 'entrance' | 'exit' | 'boss' | 'monster' | 'treasure' | 'trap' | 'secret';

/** A point of interest on the map (entrance, monster, treasure, trap, …). */
export interface DungeonMarker {
  /**
   * Marker kind. `(string & {})` keeps arbitrary consumer-defined kinds
   * (e.g. an editor's `'other'`) assignable while still autocompleting
   * and narrowing the known kinds.
   */
  type: KnownMarkerType | (string & {});
  gridX: number;
  gridY: number;
  direction?: string;
  roomId?: number;
  label?: string;
  note?: string;
  sequence?: number;
  referenceLabel?: string;
}

/** A straight secret-passage centerline, in cell coordinates. */
export interface DungeonSecretPath {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/** A hidden room reachable only via a secret passage. */
export interface DungeonSecretRoom {
  gridX: number;
  gridY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
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
