/* ============================================================
   AUTO-DUNGEON — procedural generator (headless, data-only).

   generateDungeon(seed, level, mode) -> a self-contained DungeonResult
   JSON object. No DOM, no rendering, no side effects beyond the RNG.

   The generator is a pipeline of pure steps over explicit state:
   placeRooms -> carveCorridors -> placeMarkers -> carveSecrets ->
   enrichDetailed -> pickNameAndFlavor.
   ============================================================ */
import { defaultContent } from './data';
import { defaultContentGenerator, type GenerationContext } from './rpg-gen';
import { defaultTextGenerator } from './default-generators';
import type { TextGenerator } from './generator-contracts';
import type { GenreMap, MonsterEntry } from './content-types';
import type {
  DungeonMarker,
  DungeonMode,
  DungeonResult,
  DungeonSecretPath,
  DungeonSecretRoom,
  KnownMarkerType,
  RandomNumberGenerator,
} from './dungeon-types';
import { capitalizeFirst, randomIndex, randomInt, shuffleInPlace } from './rng-utils';

/* ---------------- seeded RNG (mulberry32) ---------------- */
export function mulberry32(state: number): () => number {
  return function () {
    state |= 0; state = state + 0x6D2B79F5 | 0;
    let mixed = Math.imul(state ^ state >>> 15, 1 | state);
    mixed = mixed + Math.imul(mixed ^ mixed >>> 7, 61 | mixed) ^ mixed;
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------------- tuning constants ---------------- */

/** Pixel size of a single grid cell in the rendered map. */
const CELL_PIXELS = 24;

/** Floor-grid sentinels: rock (unwalkable) vs open (carved) cells. */
const FLOOR_ROCK = 0;
const FLOOR_OPEN = 1;

const MIN_LEVEL = 1;
const MAX_LEVEL = 6;
const DEFAULT_LEVEL = 3;

interface LevelSpecEntry {
  gridWidth: number;
  gridHeight: number;
  rooms: [number, number];
  roomWidthRange: [number, number];
  roomHeightRange: [number, number];
  secretMax: number;
}

export interface ResolvedLevelSpec extends LevelSpecEntry {
  level: number;
}

/* complexity levels — grid scales with level so the map always fills
   the same page area; rooms (and secrets) grow with level. */
const LEVEL_SPECS: Record<number, LevelSpecEntry> = {
  1: { gridWidth: 14, gridHeight: 15, rooms: [1, 3], roomWidthRange: [4, 7], roomHeightRange: [4, 6], secretMax: 1 },
  2: { gridWidth: 18, gridHeight: 20, rooms: [4, 6], roomWidthRange: [3, 6], roomHeightRange: [3, 5], secretMax: 1 },
  3: { gridWidth: 23, gridHeight: 25, rooms: [7, 10], roomWidthRange: [3, 6], roomHeightRange: [3, 5], secretMax: 2 },
  4: { gridWidth: 28, gridHeight: 30, rooms: [11, 14], roomWidthRange: [3, 5], roomHeightRange: [3, 5], secretMax: 3 },
  5: { gridWidth: 33, gridHeight: 36, rooms: [15, 19], roomWidthRange: [3, 5], roomHeightRange: [2, 4], secretMax: 4 },
  6: { gridWidth: 38, gridHeight: 41, rooms: [20, 26], roomWidthRange: [2, 5], roomHeightRange: [2, 4], secretMax: 5 }
};

/** Room-placement rejection sampling: overall floor and per-room try budget. */
const MIN_PLACEMENT_TRIES = 800;
const PLACEMENT_TRIES_PER_ROOM = 250;

/** Extra (non-MST) corridor loops carved after the spanning tree. */
const EXTRA_CORRIDOR_MIN = 1;
const EXTRA_CORRIDOR_MAX = 2;

/** Marker-placement probabilities and floors. */
const BOSS_TREASURE_CHANCE = 0.85;
const ROOM_MONSTER_CHANCE = 0.62;
const ROOM_TREASURE_CHANCE = 0.30;
const MIN_MONSTERS = 2;
const MIN_TREASURES = 1;
const TRAP_COUNT_MIN = 2;
const TRAP_COUNT_MAX = 4;

/** Secret-feature tuning. */
const LOW_LEVEL_MAX = 2;
const LOW_LEVEL_SECRET_CHANCE = 0.4;
const SECRET_ROOM_FIRST_CHANCE = 0.55;
const SECRET_ROOM_PLACEMENT_TRIES = 300;
const SECRET_ROOM_SIZE_MIN = 2;
const SECRET_ROOM_SIZE_MAX = 4;
const SECRET_GUARD_CHANCE = 0.5;
const SECRET_GUARD_BOSS_CHANCE = 1 / 3;
const SECRET_SHORTCUT_NEAREST_POOL = 3;

/** Detailed-mode enrichment probabilities. */
const DIFFICULTY_EASY_THRESHOLD = 0.30;   // 30% easy
const DIFFICULTY_MEDIUM_THRESHOLD = 0.80; // next 50% medium, rest hard
const MONSTER_DESCRIPTION_CHANCE = 0.30;
const BOSS_NAMED_CHANCE = 0.5;
const BOSS_DESCRIPTION_CHANCE = 0.45;
const TONE_ADJECTIVE_CHANCE = 0.5;
const TREASURE_EXTRA_ITEM_CHANCE = 0.55;
const TREASURE_MONEY_CHANCE = 0.6;
const FANTASY_GOLD_CHANCE = 0.45;
const FANTASY_SILVER_CHANCE = 0.6;
const FANTASY_COPPER_CHANCE = 0.7;

/** Fallback dungeon-name fragments when no generated location is available. */
const DUNGEON_NAME_PREFIXES = ['The Sunken', 'The Forgotten', 'The Shattered', 'The Black', 'The Hollow', 'The Buried'];
const DUNGEON_NAME_SUFFIXES = ['Vaults', 'Catacombs', 'Warrens', 'Crypts', 'Halls', 'Tombs'];
const DEPTH_NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

/* allowed content modes; anything else falls back to 'full' */
const VALID_MODES: ReadonlySet<string> = new Set(['empty', 'full', 'detailed']);

/* ---------------- internal shapes ---------------- */

interface GridPoint {
  gridX: number;
  gridY: number;
}

export interface GridRect {
  gridX: number;
  gridY: number;
  width: number;
  height: number;
}

interface CenteredRect extends GridRect {
  centerX: number;
  centerY: number;
}

export interface InternalRoom extends CenteredRect {
  id: number;
}

export type FloorGrid = number[][];

/** Mutable carving surface shared by corridor and entrance/exit carving. */
export interface CarveSurface {
  floor: FloorGrid;
  corridorCells: Record<number, boolean>;
  gridWidth: number;
  gridHeight: number;
}

interface TunnelCandidate {
  cells: GridPoint[];
  length: number;
  line: DungeonSecretPath;
}

/** Everything the secret-feature steps read and write. */
interface SecretCarving {
  rooms: InternalRoom[];
  floor: FloorGrid;
  connectedPairs: Record<string, boolean>;
  markers: DungeonMarker[];
  random: GenerationRandom;
  gridWidth: number;
  gridHeight: number;
  secretFloor: FloorGrid;
  secretPaths: DungeonSecretPath[];
  secretRooms: DungeonSecretRoom[];
}

/** Marker-placement working state (one marker per cell via usedCells). */
interface MarkerPlacement {
  markers: DungeonMarker[];
  usedCells: Record<number, boolean>;
  gridWidth: number;
  random: GenerationRandom;
}

/** Seed-derived randomness helpers; every step draws through this bundle. */
export interface GenerationRandom {
  next: RandomNumberGenerator;
  intBetween(min: number, max: number): number;
  index(length: number): number;
  // Draws once even for an empty list (then yields undefined) — callers guard.
  pickFrom<ItemType>(list: ItemType[]): ItemType | undefined;
  chance(probability: number): boolean;
  shuffleInPlace<ItemType extends NonNullable<unknown>>(list: ItemType[]): ItemType[];
}

export const createGenerationRandom = (seed: number): GenerationRandom => {
  const next = mulberry32(seed);
  return {
    next,
    intBetween: (min, max) => randomInt(next, min, max),
    index: (length) => randomIndex(next, length),
    // NOTE: unlike rng-utils' pick, this draws once even for an empty list
    // (yielding undefined) — callers guard, and draw order must not change.
    pickFrom: (list) => list[randomIndex(next, list.length)],
    chance: (probability) => next() < probability,
    shuffleInPlace: (list) => shuffleInPlace(next, list),
  };
};

/* ---------------- shared grid helpers ---------------- */

export const createLevelSpec = (requestedLevel?: number): ResolvedLevelSpec => {
  const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, ((requestedLevel ?? 0) | 0) || DEFAULT_LEVEL));
  const entry = LEVEL_SPECS[level];
  if (!entry) throw new Error(`no level spec for level ${level}`); // unreachable: level is clamped to [MIN_LEVEL, MAX_LEVEL]
  return { ...entry, level };
};

const cellKey = (column: number, row: number, gridWidth: number): number => row * gridWidth + column;

const createRockGrid = (gridWidth: number, gridHeight: number): FloorGrid => {
  const grid: FloorGrid = [];
  for (let row = 0; row < gridHeight; row++) grid.push(new Array<number>(gridWidth).fill(FLOOR_ROCK));
  return grid;
};

/** True when the rects overlap or touch (kept 1 cell apart on placement). */
const rectanglesTouch = (rectA: GridRect, rectB: GridRect): boolean =>
  rectA.gridX - 1 < rectB.gridX + rectB.width && rectA.gridX + rectA.width + 1 > rectB.gridX &&
  rectA.gridY - 1 < rectB.gridY + rectB.height && rectA.gridY + rectA.height + 1 > rectB.gridY;

const distanceBetween = (rectA: CenteredRect, rectB: CenteredRect): number => {
  const deltaX = rectA.centerX - rectB.centerX, deltaY = rectA.centerY - rectB.centerY;
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
};

const carveHorizontal = (surface: CarveSurface, columnStart: number, columnEnd: number, row: number): void => {
  const floorRow = surface.floor[row];
  if (!floorRow) return; // rows in [0, gridHeight) always exist
  const start = Math.min(columnStart, columnEnd), end = Math.max(columnStart, columnEnd);
  for (let column = start; column <= end; column++) {
    if (floorRow[column] === FLOOR_ROCK) {
      floorRow[column] = FLOOR_OPEN;
      surface.corridorCells[cellKey(column, row, surface.gridWidth)] = true;
    }
  }
};

const carveVertical = (surface: CarveSurface, rowStart: number, rowEnd: number, column: number): void => {
  const start = Math.min(rowStart, rowEnd), end = Math.max(rowStart, rowEnd);
  for (let row = start; row <= end; row++) {
    const floorRow = surface.floor[row];
    if (!floorRow) continue; // rows in [0, gridHeight) always exist
    if (floorRow[column] === FLOOR_ROCK) {
      floorRow[column] = FLOOR_OPEN;
      surface.corridorCells[cellKey(column, row, surface.gridWidth)] = true;
    }
  }
};

/* ---------------- step 1: rooms ---------------- */

export const placeRooms = (spec: ResolvedLevelSpec, random: GenerationRandom): { rooms: InternalRoom[]; floor: FloorGrid } => {
  const gridWidth = spec.gridWidth, gridHeight = spec.gridHeight;
  const floor = createRockGrid(gridWidth, gridHeight);
  const rooms: InternalRoom[] = [];
  const overlapsExisting = (candidate: GridRect): boolean => {
    if (candidate.gridX < 1 || candidate.gridY < 1 || candidate.gridX + candidate.width > gridWidth - 1 || candidate.gridY + candidate.height > gridHeight - 1) return true;
    return rooms.some((existing) => rectanglesTouch(candidate, existing));
  };
  const targetRoomCount = random.intBetween(spec.rooms[0], spec.rooms[1]);
  const maxTries = Math.max(MIN_PLACEMENT_TRIES, targetRoomCount * PLACEMENT_TRIES_PER_ROOM);
  let tries = 0;
  while (rooms.length < targetRoomCount && tries < maxTries) {
    tries++;
    const roomWidth = random.intBetween(spec.roomWidthRange[0], spec.roomWidthRange[1]);
    const roomHeight = random.intBetween(spec.roomHeightRange[0], spec.roomHeightRange[1]);
    const gridX = random.intBetween(1, gridWidth - roomWidth - 1);
    const gridY = random.intBetween(1, gridHeight - roomHeight - 1);
    const candidate: GridRect = { gridX, gridY, width: roomWidth, height: roomHeight };
    if (overlapsExisting(candidate)) continue;
    rooms.push({
      ...candidate,
      centerX: Math.floor(candidate.gridX + candidate.width / 2),
      centerY: Math.floor(candidate.gridY + candidate.height / 2),
      id: rooms.length,
    });
  }
  rooms.forEach((room) => {
    for (let row = room.gridY; row < room.gridY + room.height; row++) {
      const floorRow = floor[row];
      if (!floorRow) continue; // room rects are placed within grid bounds
      for (let column = room.gridX; column < room.gridX + room.width; column++) floorRow[column] = FLOOR_OPEN;
    }
  });
  return { rooms, floor };
};

/* ---------------- step 2: corridors (Prim MST + a couple loops) ---------------- */

const pairKey = (firstId: number, secondId: number): string =>
  Math.min(firstId, secondId) + '-' + Math.max(firstId, secondId);

const carveCorridors = (rooms: InternalRoom[], surface: CarveSurface, random: GenerationRandom): Record<string, boolean> => {
  const connectedPairs: Record<string, boolean> = {};
  const connectRooms = (roomA: InternalRoom, roomB: InternalRoom): void => {
    if (random.chance(0.5)) {
      carveHorizontal(surface, roomA.centerX, roomB.centerX, roomA.centerY);
      carveVertical(surface, roomA.centerY, roomB.centerY, roomB.centerX);
    } else {
      carveVertical(surface, roomA.centerY, roomB.centerY, roomA.centerX);
      carveHorizontal(surface, roomA.centerX, roomB.centerX, roomB.centerY);
    }
    connectedPairs[pairKey(roomA.id, roomB.id)] = true;
  };
  if (rooms.length <= 1) return connectedPairs;

  const connectedIndices = [0];
  const remainingIndices: number[] = [];
  for (let i = 1; i < rooms.length; i++) remainingIndices.push(i);
  while (remainingIndices.length) {
    let bestEdge: { distance: number; from: number; to: number; remainingSlot: number } | null = null;
    for (let i = 0; i < connectedIndices.length; i++) {
      const fromIndex = connectedIndices[i];
      const fromRoom = fromIndex === undefined ? undefined : rooms[fromIndex];
      if (fromIndex === undefined || !fromRoom) continue; // loop indices are in range
      for (let j = 0; j < remainingIndices.length; j++) {
        const toIndex = remainingIndices[j];
        const toRoom = toIndex === undefined ? undefined : rooms[toIndex];
        if (toIndex === undefined || !toRoom) continue;
        const distance = distanceBetween(fromRoom, toRoom);
        if (!bestEdge || distance < bestEdge.distance) bestEdge = { distance, from: fromIndex, to: toIndex, remainingSlot: j };
      }
    }
    if (!bestEdge) break; // unreachable: both index lists are non-empty
    const bestFromRoom = rooms[bestEdge.from], bestToRoom = rooms[bestEdge.to];
    if (!bestFromRoom || !bestToRoom) break; // unreachable: indices come from the loops above
    connectRooms(bestFromRoom, bestToRoom);
    connectedIndices.push(bestEdge.to);
    remainingIndices.splice(bestEdge.remainingSlot, 1);
  }
  const extraLoopCount = random.intBetween(EXTRA_CORRIDOR_MIN, EXTRA_CORRIDOR_MAX);
  for (let i = 0; i < extraLoopCount; i++) {
    const firstIndex = random.index(rooms.length), secondIndex = random.index(rooms.length);
    const firstRoom = rooms[firstIndex], secondRoom = rooms[secondIndex];
    if (firstIndex !== secondIndex && firstRoom && secondRoom) connectRooms(firstRoom, secondRoom);
  }
  return connectedPairs;
};

/* ---------------- step 3: markers ---------------- */

const countMarkersOfType = (markers: DungeonMarker[], markerType: string): number =>
  markers.filter((marker) => marker.type === markerType).length;

const pickFreeCell = (placement: MarkerPlacement, room: InternalRoom): GridPoint => {
  const cells: GridPoint[] = [];
  for (let row = room.gridY; row < room.gridY + room.height; row++) for (let column = room.gridX; column < room.gridX + room.width; column++) {
    if (!placement.usedCells[cellKey(column, row, placement.gridWidth)]) cells.push({ gridX: column, gridY: row });
  }
  const cell = (cells.length ? placement.random.pickFrom(cells) : undefined) ?? { gridX: room.centerX, gridY: room.centerY };
  placement.usedCells[cellKey(cell.gridX, cell.gridY, placement.gridWidth)] = true;
  return cell;
};

const placeMarkerIn = (placement: MarkerPlacement, room: InternalRoom, markerType: string): void => {
  const cell = pickFreeCell(placement, room);
  placement.markers.push({ type: markerType, gridX: cell.gridX, gridY: cell.gridY, roomId: room.id });
};

const distanceToEdge = (room: InternalRoom, gridWidth: number, gridHeight: number): number =>
  Math.min(room.centerX, gridWidth - 1 - room.centerX, room.centerY, gridHeight - 1 - room.centerY);

/** Carve a corridor from the room's center to the nearest map edge. */
const carveCorridorToEdge = (surface: CarveSurface, room: InternalRoom): { gridX: number; gridY: number; direction: string } => {
  const distanceLeft = room.centerX, distanceRight = surface.gridWidth - 1 - room.centerX;
  const distanceTop = room.centerY, distanceBottom = surface.gridHeight - 1 - room.centerY;
  const nearest = Math.min(distanceLeft, distanceRight, distanceTop, distanceBottom);
  if (nearest === distanceTop) { carveVertical(surface, 0, room.centerY, room.centerX); return { gridX: room.centerX, gridY: 0, direction: 'down' }; }
  if (nearest === distanceBottom) { carveVertical(surface, room.centerY, surface.gridHeight - 1, room.centerX); return { gridX: room.centerX, gridY: surface.gridHeight - 1, direction: 'up' }; }
  if (nearest === distanceLeft) { carveHorizontal(surface, 0, room.centerX, room.centerY); return { gridX: 0, gridY: room.centerY, direction: 'right' }; }
  carveHorizontal(surface, room.centerX, surface.gridWidth - 1, room.centerY);
  return { gridX: surface.gridWidth - 1, gridY: room.centerY, direction: 'left' };
};

/** Entrance/exit, boss + hoard, per-room spawns, minimum back-fill, traps. */
const placeMarkers = (rooms: InternalRoom[], surface: CarveSurface, random: GenerationRandom): DungeonMarker[] => {
  const placement: MarkerPlacement = { markers: [], usedCells: {}, gridWidth: surface.gridWidth, random };
  const { markers } = placement;

  const entranceRoom = rooms.slice().sort((roomA, roomB) =>
    distanceToEdge(roomA, surface.gridWidth, surface.gridHeight) - distanceToEdge(roomB, surface.gridWidth, surface.gridHeight))[0];
  if (!entranceRoom) return markers; // no rooms → no markers to place
  const entranceCell = carveCorridorToEdge(surface, entranceRoom);
  markers.push({ type: 'entrance', gridX: entranceCell.gridX, gridY: entranceCell.gridY, direction: entranceCell.direction });

  // rooms is non-empty here (entranceRoom exists), so the fallbacks never fire.
  let bossRoom = rooms.slice().sort((roomA, roomB) => distanceBetween(roomB, entranceRoom) - distanceBetween(roomA, entranceRoom))[0] ?? entranceRoom;
  if (bossRoom === entranceRoom && rooms.length > 1) bossRoom = rooms[1] ?? bossRoom;
  placeMarkerIn(placement, bossRoom, 'boss');
  if (random.chance(BOSS_TREASURE_CHANCE)) placeMarkerIn(placement, bossRoom, 'treasure');
  const exitCell = carveCorridorToEdge(surface, bossRoom);
  markers.push({ type: 'exit', gridX: exitCell.gridX, gridY: exitCell.gridY, direction: exitCell.direction });

  const otherRooms = rooms.filter((room) => room !== entranceRoom && room !== bossRoom);
  otherRooms.forEach((room) => {
    if (random.chance(ROOM_MONSTER_CHANCE)) placeMarkerIn(placement, room, 'monster');
    if (random.chance(ROOM_TREASURE_CHANCE)) placeMarkerIn(placement, room, 'treasure');
  });
  const backfillRooms = random.shuffleInPlace(otherRooms.slice());
  let backfillIndex = 0;
  while (countMarkersOfType(markers, 'monster') < MIN_MONSTERS && backfillIndex < backfillRooms.length) {
    const backfillRoom = backfillRooms[backfillIndex++]; // index guarded by the while condition
    if (backfillRoom) placeMarkerIn(placement, backfillRoom, 'monster');
  }
  const firstBackfillRoom = backfillRooms[0];
  if (countMarkersOfType(markers, 'treasure') < MIN_TREASURES && firstBackfillRoom) placeMarkerIn(placement, firstBackfillRoom, 'treasure');

  const corridorCellList: GridPoint[] = Object.keys(surface.corridorCells).map((key) => {
    const numericKey = +key;
    return { gridX: numericKey % surface.gridWidth, gridY: Math.floor(numericKey / surface.gridWidth) };
  });
  random.shuffleInPlace(corridorCellList)
    .slice(0, random.intBetween(TRAP_COUNT_MIN, TRAP_COUNT_MAX))
    .forEach((cell) => { markers.push({ type: 'trap', gridX: cell.gridX, gridY: cell.gridY }); });

  return markers;
};

/* ---------------- step 4: secrets (DM-only; ~1/3 of dungeons have any) ----
   A secret passage is a STRAIGHT tunnel bored through solid rock
   (only empty, non-corridor cells) between two rooms — so it never
   lies on a visible route. A secret room is reachable ONLY this way. */

const findHorizontalTunnel = (floor: FloorGrid, rectA: GridRect, rectB: GridRect): TunnelCandidate | null => {
  // their row ranges overlap, rock columns lie between them
  const overlapTop = Math.max(rectA.gridY, rectB.gridY), overlapBottom = Math.min(rectA.gridY + rectA.height, rectB.gridY + rectB.height) - 1;
  if (overlapTop > overlapBottom) return null;
  const leftRect = rectA.gridX < rectB.gridX ? rectA : rectB, rightRect = rectA.gridX < rectB.gridX ? rectB : rectA;
  const tunnelStartColumn = leftRect.gridX + leftRect.width, tunnelEndColumn = rightRect.gridX - 1;
  if (tunnelStartColumn > tunnelEndColumn) return null;
  const candidateRows: number[] = [];
  for (let row = overlapTop; row <= overlapBottom; row++) candidateRows.push(row);
  const middleRow = (overlapTop + overlapBottom) / 2;
  candidateRows.sort((rowA, rowB) => Math.abs(rowA - middleRow) - Math.abs(rowB - middleRow));
  for (const row of candidateRows) {
    let clear = true;
    for (let column = tunnelStartColumn; column <= tunnelEndColumn; column++) { if (floor[row]?.[column] === FLOOR_OPEN) { clear = false; break; } }
    if (!clear) continue;
    const cells: GridPoint[] = [];
    for (let column = tunnelStartColumn; column <= tunnelEndColumn; column++) cells.push({ gridX: column, gridY: row });
    return { cells, length: cells.length, line: { startX: leftRect.gridX + leftRect.width - 1, startY: row, endX: rightRect.gridX, endY: row } };
  }
  return null;
};

const findVerticalTunnel = (floor: FloorGrid, rectA: GridRect, rectB: GridRect): TunnelCandidate | null => {
  // their column ranges overlap, rock rows lie between them
  const overlapLeft = Math.max(rectA.gridX, rectB.gridX), overlapRight = Math.min(rectA.gridX + rectA.width, rectB.gridX + rectB.width) - 1;
  if (overlapLeft > overlapRight) return null;
  const topRect = rectA.gridY < rectB.gridY ? rectA : rectB, bottomRect = rectA.gridY < rectB.gridY ? rectB : rectA;
  const tunnelStartRow = topRect.gridY + topRect.height, tunnelEndRow = bottomRect.gridY - 1;
  if (tunnelStartRow > tunnelEndRow) return null;
  const candidateColumns: number[] = [];
  for (let column = overlapLeft; column <= overlapRight; column++) candidateColumns.push(column);
  const middleColumn = (overlapLeft + overlapRight) / 2;
  candidateColumns.sort((columnA, columnB) => Math.abs(columnA - middleColumn) - Math.abs(columnB - middleColumn));
  for (const column of candidateColumns) {
    let clear = true;
    for (let row = tunnelStartRow; row <= tunnelEndRow; row++) { if (floor[row]?.[column] === FLOOR_OPEN) { clear = false; break; } }
    if (!clear) continue;
    const cells: GridPoint[] = [];
    for (let row = tunnelStartRow; row <= tunnelEndRow; row++) cells.push({ gridX: column, gridY: row });
    return { cells, length: cells.length, line: { startX: column, startY: topRect.gridY + topRect.height - 1, endX: column, endY: bottomRect.gridY } };
  }
  return null;
};

/* Find a clear, straight 1-wide tunnel through ROCK between rects A and B.
   Prefers the shorter of the horizontal/vertical option (cell coords). */
export const findStraightTunnel = (floor: FloorGrid, rectA: GridRect, rectB: GridRect): TunnelCandidate | null => {
  const candidates: TunnelCandidate[] = [];
  const horizontal = findHorizontalTunnel(floor, rectA, rectB);
  if (horizontal) candidates.push(horizontal);
  const vertical = findVerticalTunnel(floor, rectA, rectB);
  if (vertical) candidates.push(vertical);
  if (!candidates.length) return null;
  candidates.sort((candidateA, candidateB) => candidateA.length - candidateB.length);
  return candidates[0] ?? null; // candidates is non-empty here
};

const commitTunnel = (carving: SecretCarving, tunnel: TunnelCandidate): void => {
  tunnel.cells.forEach((cell) => { const secretRow = carving.secretFloor[cell.gridY]; if (secretRow) secretRow[cell.gridX] = FLOOR_OPEN; });
  carving.secretPaths.push({ startX: tunnel.line.startX, startY: tunnel.line.startY, endX: tunnel.line.endX, endY: tunnel.line.endY });
  const middleCell = tunnel.cells[Math.floor((tunnel.cells.length - 1) / 2)] || { gridX: tunnel.line.startX, gridY: tunnel.line.startY };
  carving.markers.push({ type: 'secret', gridX: middleCell.gridX, gridY: middleCell.gridY });
};

/* hidden shortcut: link two UNCONNECTED rooms with a clear rock tunnel */
const addSecretShortcut = (carving: SecretCarving): boolean => {
  const { rooms } = carving;
  if (rooms.length < 3) return false;
  const candidates: TunnelCandidate[] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const roomI = rooms[i], roomJ = rooms[j];
    if (!roomI || !roomJ) continue; // i, j are in range
    if (carving.connectedPairs[pairKey(roomI.id, roomJ.id)]) continue;
    const tunnel = findStraightTunnel(carving.floor, roomI, roomJ);
    if (tunnel) candidates.push(tunnel);
  }
  if (!candidates.length) return false;
  candidates.sort((candidateA, candidateB) => candidateA.length - candidateB.length);
  const chosen = candidates[carving.random.index(Math.min(SECRET_SHORTCUT_NEAREST_POOL, candidates.length))];
  if (chosen) commitTunnel(carving, chosen); // index is within candidates
  return true;
};

const rectIsFree = (carving: SecretCarving, candidate: GridRect): boolean => {
  if (candidate.gridX < 1 || candidate.gridY < 1 || candidate.gridX + candidate.width > carving.gridWidth - 1 || candidate.gridY + candidate.height > carving.gridHeight - 1) return false;
  const allRooms: GridRect[] = [...carving.rooms, ...carving.secretRooms];
  if (allRooms.some((existing) => rectanglesTouch(candidate, existing))) return false;
  for (let row = candidate.gridY; row < candidate.gridY + candidate.height; row++) for (let column = candidate.gridX; column < candidate.gridX + candidate.width; column++) {
    if (carving.floor[row]?.[column] === FLOOR_OPEN) return false;
  }
  return true;
};

/* a secret room in solid rock, reached ONLY by a clear straight tunnel */
const addSecretRoom = (carving: SecretCarving): boolean => {
  const { random } = carving;
  for (let attempt = 0; attempt < SECRET_ROOM_PLACEMENT_TRIES; attempt++) {
    const roomWidth = random.intBetween(SECRET_ROOM_SIZE_MIN, SECRET_ROOM_SIZE_MAX);
    const roomHeight = random.intBetween(SECRET_ROOM_SIZE_MIN, SECRET_ROOM_SIZE_MAX);
    const gridX = random.intBetween(1, carving.gridWidth - roomWidth - 1);
    const gridY = random.intBetween(1, carving.gridHeight - roomHeight - 1);
    const rect: GridRect = { gridX, gridY, width: roomWidth, height: roomHeight };
    if (!rectIsFree(carving, rect)) continue;
    const candidate: CenteredRect = {
      ...rect,
      centerX: Math.floor(rect.gridX + rect.width / 2),
      centerY: Math.floor(rect.gridY + rect.height / 2),
    };
    const nearestRooms = carving.rooms.slice().sort((roomA, roomB) => distanceBetween(roomA, candidate) - distanceBetween(roomB, candidate));
    let tunnel: TunnelCandidate | null = null;
    for (const room of nearestRooms) { tunnel = findStraightTunnel(carving.floor, candidate, room); if (tunnel) break; }
    if (!tunnel) continue;
    for (let cellRow = candidate.gridY; cellRow < candidate.gridY + candidate.height; cellRow++) {
      const secretRow = carving.secretFloor[cellRow];
      if (!secretRow) continue; // secret rooms are placed within grid bounds
      for (let cellColumn = candidate.gridX; cellColumn < candidate.gridX + candidate.width; cellColumn++) secretRow[cellColumn] = FLOOR_OPEN;
    }
    carving.secretRooms.push({ gridX: candidate.gridX, gridY: candidate.gridY, width: candidate.width, height: candidate.height, centerX: candidate.centerX, centerY: candidate.centerY });
    commitTunnel(carving, tunnel);
    // a secret room always hides a hoard; ~half the time something guards it
    carving.markers.push({ type: 'treasure', gridX: candidate.centerX, gridY: candidate.centerY });
    if (random.chance(SECRET_GUARD_CHANCE)) {
      const guard = random.chance(SECRET_GUARD_BOSS_CHANCE) ? 'boss' : 'monster'; // sometimes an EXTRA boss, else a normal monster
      const guardColumn = (candidate.gridX === candidate.centerX) ? candidate.gridX + candidate.width - 1 : candidate.gridX; // a cell apart from the hoard
      const guardRow = (candidate.gridY === candidate.centerY) ? candidate.gridY + candidate.height - 1 : candidate.gridY;
      carving.markers.push({ type: guard, gridX: guardColumn, gridY: guardRow });
    }
    return true;
  }
  return false;
};

/** Secret-feature count scales with complexity (occasional at low levels). */
const carveSecrets = (
  rooms: InternalRoom[],
  floor: FloorGrid,
  connectedPairs: Record<string, boolean>,
  spec: ResolvedLevelSpec,
  markers: DungeonMarker[],
  random: GenerationRandom,
): { secretPaths: DungeonSecretPath[]; secretRooms: DungeonSecretRoom[]; secretFloor: FloorGrid } => {
  const carving: SecretCarving = {
    rooms,
    floor,
    connectedPairs,
    markers,
    random,
    gridWidth: spec.gridWidth,
    gridHeight: spec.gridHeight,
    secretFloor: createRockGrid(spec.gridWidth, spec.gridHeight),
    secretPaths: [],
    secretRooms: [],
  };
  let secretFeatureCount: number;
  if (spec.level <= LOW_LEVEL_MAX) { secretFeatureCount = random.chance(LOW_LEVEL_SECRET_CHANCE) ? 1 : 0; }
  else { secretFeatureCount = 1 + random.index(spec.secretMax); }
  for (let i = 0; i < secretFeatureCount; i++) {
    if (random.chance(SECRET_ROOM_FIRST_CHANCE)) { if (!addSecretRoom(carving)) addSecretShortcut(carving); }
    else { if (!addSecretShortcut(carving)) addSecretRoom(carving); }
  }
  return { secretPaths: carving.secretPaths, secretRooms: carving.secretRooms, secretFloor: carving.secretFloor };
};

/* ---------------- step 5: detailed-mode enrichment ---------------- */

const pickDifficulty = (random: GenerationRandom): string => {
  const roll = random.next();
  return roll < DIFFICULTY_EASY_THRESHOLD ? 'Easy' : (roll < DIFFICULTY_MEDIUM_THRESHOLD ? 'Medium' : 'Hard');
};

const describeMoney = (genre: string, random: GenerationRandom): string => {
  if (genre === 'fantasy') {
    const parts: string[] = [];
    if (random.chance(FANTASY_GOLD_CHANCE)) parts.push(random.intBetween(1, 9) + ' gold');
    if (random.chance(FANTASY_SILVER_CHANCE)) parts.push(random.intBetween(1, 15) + ' silver');
    if (random.chance(FANTASY_COPPER_CHANCE)) parts.push(random.intBetween(2, 30) + ' copper');
    if (!parts.length) parts.push(random.intBetween(2, 30) + ' copper');
    return 'Coins: ' + parts.join(', ');
  }
  if (genre === 'sci-fi') return 'Credits (money): ' + random.intBetween(10, 500);
  return 'Money: ' + random.intBetween(5, 200);
};

const enrichMonsterMarker = (marker: DungeonMarker, context: GenerationContext, textGenerator: TextGenerator, random: GenerationRandom): void => {
  marker.label = defaultContentGenerator.randomMonster(random.next, context) || 'Monster';
  marker.note = '(' + pickDifficulty(random).toLowerCase() + ')';
  if (random.chance(MONSTER_DESCRIPTION_CHANCE)) {
    const description = random.chance(TONE_ADJECTIVE_CHANCE)
      ? textGenerator.generateAdjective(random.next, context, 'monster')
      : textGenerator.generateDescription(random.next, context, 'monster');
    if (description) marker.note += ' ' + capitalizeFirst(description) + '.';
  }
};

const enrichBossMarker = (marker: DungeonMarker, context: GenerationContext, bossCreaturePool: MonsterEntry[], textGenerator: TextGenerator, random: GenerationRandom): void => {
  const bossName = defaultContentGenerator.randomName(random.next, context);
  const creatureEntry = random.pickFrom(bossCreaturePool);
  const creatureName = (creatureEntry && creatureEntry.name) || 'Beast';
  const useName = !!bossName && random.chance(BOSS_NAMED_CHANCE);
  marker.label = useName && bossName ? bossName : creatureName; // a named villain OR a creature, never "Name the Creature"
  marker.note = '(boss)';
  const bossCategory = useName ? 'person' : 'monster';
  if (random.chance(BOSS_DESCRIPTION_CHANCE)) {
    const description = random.chance(TONE_ADJECTIVE_CHANCE)
      ? textGenerator.generateAdjective(random.next, context, bossCategory)
      : textGenerator.generateDescription(random.next, context, bossCategory);
    if (description) marker.note += ' ' + capitalizeFirst(description) + '.';
  }
};

const enrichTreasureMarker = (marker: DungeonMarker, context: GenerationContext, random: GenerationRandom): void => {
  marker.label = 'Treasure';
  const parts: Array<string | null> = [defaultContentGenerator.randomItem(random.next, context) || 'a trinket'];
  if (random.chance(TREASURE_EXTRA_ITEM_CHANCE)) parts.push(defaultContentGenerator.randomItem(random.next, context));
  if (random.chance(TREASURE_MONEY_CHANCE)) parts.push(describeMoney(context.genre, random));
  marker.note = parts.filter(Boolean).join(', ') + '.';
};

const enrichTrapMarker = (marker: DungeonMarker, context: GenerationContext, random: GenerationRandom): void => {
  marker.label = defaultContentGenerator.randomTrap(random.next, context) || 'Trap';
  marker.note = '';
};

/* 'detailed' mode: name & classify every foe, hoard and trap from the random
   lists. Enrichment is a per-kind lookup: markers of kinds without an enricher
   (including consumer-defined kinds) pass through untouched and draw nothing. */
const enrichDetailed = (markers: DungeonMarker[], context: GenerationContext, textGenerator: TextGenerator, random: GenerationRandom): void => {
  const monstersByGenre: GenreMap<MonsterEntry> = defaultContent.monsters;
  const bossCreaturePool = (monstersByGenre[context.genre] || []).concat(monstersByGenre.generic || [])
    .filter((monster) => !monster.isAnimal); // bosses are never animals
  const enrichersByKind: Partial<Record<KnownMarkerType, (marker: DungeonMarker) => void>> = {
    monster: (marker) => enrichMonsterMarker(marker, context, textGenerator, random),
    boss: (marker) => enrichBossMarker(marker, context, bossCreaturePool, textGenerator, random),
    treasure: (marker) => enrichTreasureMarker(marker, context, random),
    trap: (marker) => enrichTrapMarker(marker, context, random),
  };
  let sequenceNumber = 0;
  markers.forEach((marker) => {
    const enrich = enrichersByKind[marker.type as KnownMarkerType];
    if (!enrich) return;
    enrich(marker);
    marker.sequence = sequenceNumber++;
  });
};

/* ---------------- step 6: name & flavor ---------------- */

const pickNameAndFlavor = (context: GenerationContext | null, textGenerator: TextGenerator, random: GenerationRandom): { name: string | null; flavor: string | null } => {
  if (!context) return { name: null, flavor: null };
  let name: string | null = null;
  const location = textGenerator.generateLocation(random.next, context);
  if (location) name = (/^the\b/i.test(location) ? '' : 'The ') + location;
  const flavor = textGenerator.generateFlavorSentence(random.next, context);
  return { name, flavor };
};

/* ---------------- swappable strategy seam ---------------- */

/** What the secret-carving step yields (never null; the orchestrator decides whether to keep it). */
export interface SecretFeatures {
  secretPaths: DungeonSecretPath[];
  secretRooms: DungeonSecretRoom[];
  secretFloor: FloorGrid;
}

/**
 * The generation pipeline as a swappable interface. Each step owns its
 * documented invariants — generateDungeon does not re-validate geometry:
 * - `placeRooms`: rooms in-bounds, pairwise non-touching, carved into the returned floor.
 * - `carveCorridors`: mutates `surface` so every room is reachable; returns the connected room-id pairs.
 * - `placeMarkers`: markers land on open (or here-carved) cells; may carve entrance/exit corridors on `surface`.
 * - `carveSecrets`: secret geometry only in ROCK cells of `floor`, recorded solely on the returned secret grid.
 * - `enrichMarkers`: mutates markers in place (labels/notes/sequence); unknown kinds untouched.
 * - `pickNameAndFlavor`: pure; null fields fall back to the generator's stock name/flavor.
 *
 * Customize a single step by spreading the default:
 * `generateDungeon(seed, level, mode, { ...defaultDungeonStrategy, placeRooms: mine })`.
 */
export interface DungeonStrategy {
  placeRooms(spec: ResolvedLevelSpec, random: GenerationRandom): { rooms: InternalRoom[]; floor: FloorGrid };
  carveCorridors(rooms: InternalRoom[], surface: CarveSurface, random: GenerationRandom): Record<string, boolean>;
  placeMarkers(rooms: InternalRoom[], surface: CarveSurface, random: GenerationRandom): DungeonMarker[];
  carveSecrets(
    rooms: InternalRoom[],
    floor: FloorGrid,
    connectedPairs: Record<string, boolean>,
    spec: ResolvedLevelSpec,
    markers: DungeonMarker[],
    random: GenerationRandom,
  ): SecretFeatures;
  enrichMarkers(markers: DungeonMarker[], context: GenerationContext, textGenerator: TextGenerator, random: GenerationRandom): void;
  pickNameAndFlavor(context: GenerationContext | null, textGenerator: TextGenerator, random: GenerationRandom): { name: string | null; flavor: string | null };
}

/** The built-in algorithm — spread it to override individual steps. */
export const defaultDungeonStrategy: DungeonStrategy = {
  placeRooms,
  carveCorridors,
  placeMarkers,
  carveSecrets,
  enrichMarkers: enrichDetailed,
  pickNameAndFlavor,
};

/* ============================================================
   GENERATION  ->  returns a plain JSON-able dungeon object
   ============================================================ */
export function generateDungeon(
  seed: number,
  level?: number,
  mode?: DungeonMode,
  strategy: DungeonStrategy = defaultDungeonStrategy,
  textGenerator: TextGenerator = defaultTextGenerator,
): DungeonResult {
  // input robustness: a non-finite seed becomes a deterministic default (0);
  // an unknown/missing mode becomes 'full'; level is clamped in createLevelSpec.
  const safeSeed = (typeof seed === 'number' && isFinite(seed)) ? (seed >>> 0) : 0;
  const safeMode: DungeonMode = (mode && VALID_MODES.has(mode)) ? mode : 'full';
  const spec = createLevelSpec(level);
  const random = createGenerationRandom(safeSeed);

  const { rooms, floor } = strategy.placeRooms(spec, random);
  const surface: CarveSurface = { floor, corridorCells: {}, gridWidth: spec.gridWidth, gridHeight: spec.gridHeight };
  const connectedPairs = strategy.carveCorridors(rooms, surface, random);

  const markers: DungeonMarker[] = safeMode !== 'empty' ? strategy.placeMarkers(rooms, surface, random) : [];
  const { secretPaths, secretRooms, secretFloor } = safeMode !== 'empty'
    ? strategy.carveSecrets(rooms, floor, connectedPairs, spec, markers, random)
    : { secretPaths: [], secretRooms: [], secretFloor: createRockGrid(spec.gridWidth, spec.gridHeight) };

  const contentContext: GenerationContext | null = defaultContentGenerator ? defaultContentGenerator.context(random.next) : null;
  if (safeMode === 'detailed' && contentContext) strategy.enrichMarkers(markers, contentContext, textGenerator, random);
  const { name, flavor } = strategy.pickNameAndFlavor(contentContext, textGenerator, random);

  const result: DungeonResult = {
    version: 1,
    seed: safeSeed,
    level: spec.level,
    name: name || ((random.pickFrom(DUNGEON_NAME_PREFIXES) ?? '') + ' ' + (random.pickFrom(DUNGEON_NAME_SUFFIXES) ?? '')),
    depth: DEPTH_NUMERALS[random.intBetween(0, DEPTH_NUMERALS.length - 1)] ?? '',
    flavor: flavor || 'Beyond the torchlight, the map runs dark.',
    genre: (safeMode === 'detailed' && contentContext) ? contentContext.genre : null,
    tone: (safeMode === 'detailed' && contentContext) ? contentContext.tone : null,
    grid: { width: spec.gridWidth, height: spec.gridHeight, cellSize: CELL_PIXELS },
    rooms: rooms.map((room) => ({ gridX: room.gridX, gridY: room.gridY, width: room.width, height: room.height, id: room.id })),
    floor,
    markers,
    secretPaths,
    secretRooms,
    secretFloor: (secretPaths.length || secretRooms.length) ? secretFloor : null,
    tally: {
      rooms: rooms.length,
      foes: countMarkersOfType(markers, 'monster') + countMarkersOfType(markers, 'boss'),
      traps: countMarkersOfType(markers, 'trap'),
      loot: countMarkersOfType(markers, 'treasure'),
      secret: secretPaths.length
    }
  };
  return result;
}
