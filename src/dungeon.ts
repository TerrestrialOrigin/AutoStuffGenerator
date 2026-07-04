/* ============================================================
   AUTO-DUNGEON — procedural generator (headless, data-only).

   generateDungeon(seed, level, mode) -> a self-contained DungeonResult
   JSON object. No DOM, no rendering, no side effects beyond the RNG.

   The generator is a pipeline of pure steps over explicit state:
   placeRooms -> carveCorridors -> placeMarkers -> carveSecrets ->
   enrichDetailed -> pickNameAndFlavor.
   ============================================================ */
import { RPG } from './data';
import { RPGGen, type RPGContext } from './rpg-gen';
import type {
  DungeonMarker,
  DungeonMode,
  DungeonResult,
  DungeonSecretPath,
  DungeonSecretRoom,
  RNG,
} from './dungeon-types';

/* ---------------- seeded RNG (mulberry32) ---------------- */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
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
  gw: number;
  gh: number;
  rooms: [number, number];
  rw: [number, number];
  rh: [number, number];
  secretMax: number;
}

export interface ResolvedLevelSpec extends LevelSpecEntry {
  level: number;
}

/* complexity levels — grid scales with level so the map always fills
   the same page area; rooms (and secrets) grow with level. */
const LEVEL_SPECS: Record<number, LevelSpecEntry> = {
  1: { gw: 14, gh: 15, rooms: [1, 3], rw: [4, 7], rh: [4, 6], secretMax: 1 },
  2: { gw: 18, gh: 20, rooms: [4, 6], rw: [3, 6], rh: [3, 5], secretMax: 1 },
  3: { gw: 23, gh: 25, rooms: [7, 10], rw: [3, 6], rh: [3, 5], secretMax: 2 },
  4: { gw: 28, gh: 30, rooms: [11, 14], rw: [3, 5], rh: [3, 5], secretMax: 3 },
  5: { gw: 33, gh: 36, rooms: [15, 19], rw: [3, 5], rh: [2, 4], secretMax: 4 },
  6: { gw: 38, gh: 41, rooms: [20, 26], rw: [2, 5], rh: [2, 4], secretMax: 5 }
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
  x: number;
  y: number;
}

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CenteredRect extends GridRect {
  cx: number;
  cy: number;
}

export interface InternalRoom extends CenteredRect {
  id: number;
}

export type FloorGrid = number[][];

/** Mutable carving surface shared by corridor and entrance/exit carving. */
interface CarveSurface {
  floor: FloorGrid;
  corridorCells: Record<number, boolean>;
  gridWidth: number;
  gridHeight: number;
}

interface TunnelCandidate {
  cells: GridPoint[];
  len: number;
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
  next: RNG;
  intBetween(min: number, max: number): number;
  index(length: number): number;
  pickFrom<ItemType>(list: ItemType[]): ItemType;
  chance(probability: number): boolean;
  shuffleInPlace<ItemType>(list: ItemType[]): ItemType[];
}

export const createGenerationRandom = (seed: number): GenerationRandom => {
  const next = mulberry32(seed);
  const index = (length: number) => Math.floor(next() * length);
  return {
    next,
    intBetween: (min, max) => min + Math.floor(next() * (max - min + 1)),
    index,
    pickFrom: (list) => list[index(list.length)],
    chance: (probability) => next() < probability,
    shuffleInPlace: (list) => {
      for (let i = list.length - 1; i > 0; i--) {
        const j = index(i + 1);
        const swapped = list[i];
        list[i] = list[j];
        list[j] = swapped;
      }
      return list;
    },
  };
};

/* ---------------- shared grid helpers ---------------- */

export const createLevelSpec = (requestedLevel?: number): ResolvedLevelSpec => {
  const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, ((requestedLevel ?? 0) | 0) || DEFAULT_LEVEL));
  return { ...LEVEL_SPECS[level], level };
};

const cellKey = (x: number, y: number, gridWidth: number): number => y * gridWidth + x;

const createRockGrid = (gridWidth: number, gridHeight: number): FloorGrid => {
  const grid: FloorGrid = [];
  for (let y = 0; y < gridHeight; y++) grid.push(new Array<number>(gridWidth).fill(FLOOR_ROCK));
  return grid;
};

/** True when the rects overlap or touch (kept 1 cell apart on placement). */
const rectanglesTouch = (rectA: GridRect, rectB: GridRect): boolean =>
  rectA.x - 1 < rectB.x + rectB.w && rectA.x + rectA.w + 1 > rectB.x &&
  rectA.y - 1 < rectB.y + rectB.h && rectA.y + rectA.h + 1 > rectB.y;

const distanceBetween = (rectA: CenteredRect, rectB: CenteredRect): number => {
  const deltaX = rectA.cx - rectB.cx, deltaY = rectA.cy - rectB.cy;
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
};

const carveHorizontal = (surface: CarveSurface, xStart: number, xEnd: number, row: number): void => {
  const start = Math.min(xStart, xEnd), end = Math.max(xStart, xEnd);
  for (let x = start; x <= end; x++) {
    if (surface.floor[row][x] === FLOOR_ROCK) {
      surface.floor[row][x] = FLOOR_OPEN;
      surface.corridorCells[cellKey(x, row, surface.gridWidth)] = true;
    }
  }
};

const carveVertical = (surface: CarveSurface, yStart: number, yEnd: number, column: number): void => {
  const start = Math.min(yStart, yEnd), end = Math.max(yStart, yEnd);
  for (let y = start; y <= end; y++) {
    if (surface.floor[y][column] === FLOOR_ROCK) {
      surface.floor[y][column] = FLOOR_OPEN;
      surface.corridorCells[cellKey(column, y, surface.gridWidth)] = true;
    }
  }
};

/* ---------------- step 1: rooms ---------------- */

export const placeRooms = (spec: ResolvedLevelSpec, random: GenerationRandom): { rooms: InternalRoom[]; floor: FloorGrid } => {
  const gridWidth = spec.gw, gridHeight = spec.gh;
  const floor = createRockGrid(gridWidth, gridHeight);
  const rooms: InternalRoom[] = [];
  const overlapsExisting = (candidate: GridRect): boolean => {
    if (candidate.x < 1 || candidate.y < 1 || candidate.x + candidate.w > gridWidth - 1 || candidate.y + candidate.h > gridHeight - 1) return true;
    return rooms.some((existing) => rectanglesTouch(candidate, existing));
  };
  const targetRoomCount = random.intBetween(spec.rooms[0], spec.rooms[1]);
  const maxTries = Math.max(MIN_PLACEMENT_TRIES, targetRoomCount * PLACEMENT_TRIES_PER_ROOM);
  let tries = 0;
  while (rooms.length < targetRoomCount && tries < maxTries) {
    tries++;
    const roomWidth = random.intBetween(spec.rw[0], spec.rw[1]);
    const roomHeight = random.intBetween(spec.rh[0], spec.rh[1]);
    const x = random.intBetween(1, gridWidth - roomWidth - 1);
    const y = random.intBetween(1, gridHeight - roomHeight - 1);
    const candidate: GridRect = { x, y, w: roomWidth, h: roomHeight };
    if (overlapsExisting(candidate)) continue;
    rooms.push({
      ...candidate,
      cx: Math.floor(candidate.x + candidate.w / 2),
      cy: Math.floor(candidate.y + candidate.h / 2),
      id: rooms.length,
    });
  }
  rooms.forEach((room) => {
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) floor[y][x] = FLOOR_OPEN;
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
      carveHorizontal(surface, roomA.cx, roomB.cx, roomA.cy);
      carveVertical(surface, roomA.cy, roomB.cy, roomB.cx);
    } else {
      carveVertical(surface, roomA.cy, roomB.cy, roomA.cx);
      carveHorizontal(surface, roomA.cx, roomB.cx, roomB.cy);
    }
    connectedPairs[pairKey(roomA.id, roomB.id)] = true;
  };
  if (rooms.length <= 1) return connectedPairs;

  const connectedIndices = [0];
  const remainingIndices: number[] = [];
  for (let i = 1; i < rooms.length; i++) remainingIndices.push(i);
  while (remainingIndices.length) {
    let bestEdge: { distance: number; from: number; to: number; remainingSlot: number } | null = null;
    for (let i = 0; i < connectedIndices.length; i++) for (let j = 0; j < remainingIndices.length; j++) {
      const distance = distanceBetween(rooms[connectedIndices[i]], rooms[remainingIndices[j]]);
      if (!bestEdge || distance < bestEdge.distance) bestEdge = { distance, from: connectedIndices[i], to: remainingIndices[j], remainingSlot: j };
    }
    if (!bestEdge) break; // unreachable: both index lists are non-empty
    connectRooms(rooms[bestEdge.from], rooms[bestEdge.to]);
    connectedIndices.push(bestEdge.to);
    remainingIndices.splice(bestEdge.remainingSlot, 1);
  }
  const extraLoopCount = random.intBetween(EXTRA_CORRIDOR_MIN, EXTRA_CORRIDOR_MAX);
  for (let i = 0; i < extraLoopCount; i++) {
    const firstIndex = random.index(rooms.length), secondIndex = random.index(rooms.length);
    if (firstIndex !== secondIndex) connectRooms(rooms[firstIndex], rooms[secondIndex]);
  }
  return connectedPairs;
};

/* ---------------- step 3: markers ---------------- */

const countMarkersOfType = (markers: DungeonMarker[], markerType: string): number =>
  markers.filter((marker) => marker.type === markerType).length;

const pickFreeCell = (placement: MarkerPlacement, room: InternalRoom): GridPoint => {
  const cells: GridPoint[] = [];
  for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
    if (!placement.usedCells[cellKey(x, y, placement.gridWidth)]) cells.push({ x, y });
  }
  const cell = cells.length ? placement.random.pickFrom(cells) : { x: room.cx, y: room.cy };
  placement.usedCells[cellKey(cell.x, cell.y, placement.gridWidth)] = true;
  return cell;
};

const placeMarkerIn = (placement: MarkerPlacement, room: InternalRoom, markerType: string): void => {
  const cell = pickFreeCell(placement, room);
  placement.markers.push({ type: markerType, x: cell.x, y: cell.y, room: room.id });
};

const distanceToEdge = (room: InternalRoom, gridWidth: number, gridHeight: number): number =>
  Math.min(room.cx, gridWidth - 1 - room.cx, room.cy, gridHeight - 1 - room.cy);

/** Carve a corridor from the room's center to the nearest map edge. */
const carveCorridorToEdge = (surface: CarveSurface, room: InternalRoom): { x: number; y: number; dir: string } => {
  const distanceLeft = room.cx, distanceRight = surface.gridWidth - 1 - room.cx;
  const distanceTop = room.cy, distanceBottom = surface.gridHeight - 1 - room.cy;
  const nearest = Math.min(distanceLeft, distanceRight, distanceTop, distanceBottom);
  if (nearest === distanceTop) { carveVertical(surface, 0, room.cy, room.cx); return { x: room.cx, y: 0, dir: 'down' }; }
  if (nearest === distanceBottom) { carveVertical(surface, room.cy, surface.gridHeight - 1, room.cx); return { x: room.cx, y: surface.gridHeight - 1, dir: 'up' }; }
  if (nearest === distanceLeft) { carveHorizontal(surface, 0, room.cx, room.cy); return { x: 0, y: room.cy, dir: 'right' }; }
  carveHorizontal(surface, room.cx, surface.gridWidth - 1, room.cy);
  return { x: surface.gridWidth - 1, y: room.cy, dir: 'left' };
};

/** Entrance/exit, boss + hoard, per-room spawns, minimum back-fill, traps. */
const placeMarkers = (rooms: InternalRoom[], surface: CarveSurface, random: GenerationRandom): DungeonMarker[] => {
  const placement: MarkerPlacement = { markers: [], usedCells: {}, gridWidth: surface.gridWidth, random };
  const { markers } = placement;

  const entranceRoom = rooms.slice().sort((roomA, roomB) =>
    distanceToEdge(roomA, surface.gridWidth, surface.gridHeight) - distanceToEdge(roomB, surface.gridWidth, surface.gridHeight))[0];
  const entranceCell = carveCorridorToEdge(surface, entranceRoom);
  markers.push({ type: 'entrance', x: entranceCell.x, y: entranceCell.y, dir: entranceCell.dir });

  let bossRoom = rooms.slice().sort((roomA, roomB) => distanceBetween(roomB, entranceRoom) - distanceBetween(roomA, entranceRoom))[0];
  if (bossRoom === entranceRoom && rooms.length > 1) bossRoom = rooms[1];
  placeMarkerIn(placement, bossRoom, 'boss');
  if (random.chance(BOSS_TREASURE_CHANCE)) placeMarkerIn(placement, bossRoom, 'treasure');
  const exitCell = carveCorridorToEdge(surface, bossRoom);
  markers.push({ type: 'exit', x: exitCell.x, y: exitCell.y, dir: exitCell.dir });

  const otherRooms = rooms.filter((room) => room !== entranceRoom && room !== bossRoom);
  otherRooms.forEach((room) => {
    if (random.chance(ROOM_MONSTER_CHANCE)) placeMarkerIn(placement, room, 'monster');
    if (random.chance(ROOM_TREASURE_CHANCE)) placeMarkerIn(placement, room, 'treasure');
  });
  const backfillRooms = random.shuffleInPlace(otherRooms.slice());
  let backfillIndex = 0;
  while (countMarkersOfType(markers, 'monster') < MIN_MONSTERS && backfillIndex < backfillRooms.length) {
    placeMarkerIn(placement, backfillRooms[backfillIndex++], 'monster');
  }
  if (countMarkersOfType(markers, 'treasure') < MIN_TREASURES && backfillRooms.length) placeMarkerIn(placement, backfillRooms[0], 'treasure');

  const corridorCellList: GridPoint[] = Object.keys(surface.corridorCells).map((key) => {
    const numericKey = +key;
    return { x: numericKey % surface.gridWidth, y: Math.floor(numericKey / surface.gridWidth) };
  });
  random.shuffleInPlace(corridorCellList)
    .slice(0, random.intBetween(TRAP_COUNT_MIN, TRAP_COUNT_MAX))
    .forEach((cell) => { markers.push({ type: 'trap', x: cell.x, y: cell.y }); });

  return markers;
};

/* ---------------- step 4: secrets (DM-only; ~1/3 of dungeons have any) ----
   A secret passage is a STRAIGHT tunnel bored through solid rock
   (only empty, non-corridor cells) between two rooms — so it never
   lies on a visible route. A secret room is reachable ONLY this way. */

const findHorizontalTunnel = (floor: FloorGrid, rectA: GridRect, rectB: GridRect): TunnelCandidate | null => {
  // their row ranges overlap, rock columns lie between them
  const overlapTop = Math.max(rectA.y, rectB.y), overlapBottom = Math.min(rectA.y + rectA.h, rectB.y + rectB.h) - 1;
  if (overlapTop > overlapBottom) return null;
  const leftRect = rectA.x < rectB.x ? rectA : rectB, rightRect = rectA.x < rectB.x ? rectB : rectA;
  const tunnelStartX = leftRect.x + leftRect.w, tunnelEndX = rightRect.x - 1;
  if (tunnelStartX > tunnelEndX) return null;
  const candidateRows: number[] = [];
  for (let y = overlapTop; y <= overlapBottom; y++) candidateRows.push(y);
  const middleRow = (overlapTop + overlapBottom) / 2;
  candidateRows.sort((rowA, rowB) => Math.abs(rowA - middleRow) - Math.abs(rowB - middleRow));
  for (const row of candidateRows) {
    let clear = true;
    for (let x = tunnelStartX; x <= tunnelEndX; x++) { if (floor[row][x] === FLOOR_OPEN) { clear = false; break; } }
    if (!clear) continue;
    const cells: GridPoint[] = [];
    for (let x = tunnelStartX; x <= tunnelEndX; x++) cells.push({ x, y: row });
    return { cells, len: cells.length, line: { x1: leftRect.x + leftRect.w - 1, y1: row, x2: rightRect.x, y2: row } };
  }
  return null;
};

const findVerticalTunnel = (floor: FloorGrid, rectA: GridRect, rectB: GridRect): TunnelCandidate | null => {
  // their column ranges overlap, rock rows lie between them
  const overlapLeft = Math.max(rectA.x, rectB.x), overlapRight = Math.min(rectA.x + rectA.w, rectB.x + rectB.w) - 1;
  if (overlapLeft > overlapRight) return null;
  const topRect = rectA.y < rectB.y ? rectA : rectB, bottomRect = rectA.y < rectB.y ? rectB : rectA;
  const tunnelStartY = topRect.y + topRect.h, tunnelEndY = bottomRect.y - 1;
  if (tunnelStartY > tunnelEndY) return null;
  const candidateColumns: number[] = [];
  for (let x = overlapLeft; x <= overlapRight; x++) candidateColumns.push(x);
  const middleColumn = (overlapLeft + overlapRight) / 2;
  candidateColumns.sort((columnA, columnB) => Math.abs(columnA - middleColumn) - Math.abs(columnB - middleColumn));
  for (const column of candidateColumns) {
    let clear = true;
    for (let y = tunnelStartY; y <= tunnelEndY; y++) { if (floor[y][column] === FLOOR_OPEN) { clear = false; break; } }
    if (!clear) continue;
    const cells: GridPoint[] = [];
    for (let y = tunnelStartY; y <= tunnelEndY; y++) cells.push({ x: column, y });
    return { cells, len: cells.length, line: { x1: column, y1: topRect.y + topRect.h - 1, x2: column, y2: bottomRect.y } };
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
  candidates.sort((candidateA, candidateB) => candidateA.len - candidateB.len);
  return candidates[0];
};

const commitTunnel = (carving: SecretCarving, tunnel: TunnelCandidate): void => {
  tunnel.cells.forEach((cell) => { carving.secretFloor[cell.y][cell.x] = FLOOR_OPEN; });
  carving.secretPaths.push({ x1: tunnel.line.x1, y1: tunnel.line.y1, x2: tunnel.line.x2, y2: tunnel.line.y2 });
  const middleCell = tunnel.cells[Math.floor((tunnel.cells.length - 1) / 2)] || { x: tunnel.line.x1, y: tunnel.line.y1 };
  carving.markers.push({ type: 'secret', x: middleCell.x, y: middleCell.y });
};

/* hidden shortcut: link two UNCONNECTED rooms with a clear rock tunnel */
const addSecretShortcut = (carving: SecretCarving): boolean => {
  const { rooms } = carving;
  if (rooms.length < 3) return false;
  const candidates: TunnelCandidate[] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    if (carving.connectedPairs[pairKey(rooms[i].id, rooms[j].id)]) continue;
    const tunnel = findStraightTunnel(carving.floor, rooms[i], rooms[j]);
    if (tunnel) candidates.push(tunnel);
  }
  if (!candidates.length) return false;
  candidates.sort((candidateA, candidateB) => candidateA.len - candidateB.len);
  commitTunnel(carving, candidates[carving.random.index(Math.min(SECRET_SHORTCUT_NEAREST_POOL, candidates.length))]);
  return true;
};

const rectIsFree = (carving: SecretCarving, candidate: GridRect): boolean => {
  if (candidate.x < 1 || candidate.y < 1 || candidate.x + candidate.w > carving.gridWidth - 1 || candidate.y + candidate.h > carving.gridHeight - 1) return false;
  const allRooms: GridRect[] = [...carving.rooms, ...carving.secretRooms];
  if (allRooms.some((existing) => rectanglesTouch(candidate, existing))) return false;
  for (let y = candidate.y; y < candidate.y + candidate.h; y++) for (let x = candidate.x; x < candidate.x + candidate.w; x++) {
    if (carving.floor[y][x] === FLOOR_OPEN) return false;
  }
  return true;
};

/* a secret room in solid rock, reached ONLY by a clear straight tunnel */
const addSecretRoom = (carving: SecretCarving): boolean => {
  const { random } = carving;
  for (let attempt = 0; attempt < SECRET_ROOM_PLACEMENT_TRIES; attempt++) {
    const roomWidth = random.intBetween(SECRET_ROOM_SIZE_MIN, SECRET_ROOM_SIZE_MAX);
    const roomHeight = random.intBetween(SECRET_ROOM_SIZE_MIN, SECRET_ROOM_SIZE_MAX);
    const x = random.intBetween(1, carving.gridWidth - roomWidth - 1);
    const y = random.intBetween(1, carving.gridHeight - roomHeight - 1);
    const rect: GridRect = { x, y, w: roomWidth, h: roomHeight };
    if (!rectIsFree(carving, rect)) continue;
    const candidate: CenteredRect = {
      ...rect,
      cx: Math.floor(rect.x + rect.w / 2),
      cy: Math.floor(rect.y + rect.h / 2),
    };
    const nearestRooms = carving.rooms.slice().sort((roomA, roomB) => distanceBetween(roomA, candidate) - distanceBetween(roomB, candidate));
    let tunnel: TunnelCandidate | null = null;
    for (const room of nearestRooms) { tunnel = findStraightTunnel(carving.floor, candidate, room); if (tunnel) break; }
    if (!tunnel) continue;
    for (let cellY = candidate.y; cellY < candidate.y + candidate.h; cellY++) for (let cellX = candidate.x; cellX < candidate.x + candidate.w; cellX++) {
      carving.secretFloor[cellY][cellX] = FLOOR_OPEN;
    }
    carving.secretRooms.push({ x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h, cx: candidate.cx, cy: candidate.cy });
    commitTunnel(carving, tunnel);
    // a secret room always hides a hoard; ~half the time something guards it
    carving.markers.push({ type: 'treasure', x: candidate.cx, y: candidate.cy });
    if (random.chance(SECRET_GUARD_CHANCE)) {
      const guard = random.chance(SECRET_GUARD_BOSS_CHANCE) ? 'boss' : 'monster'; // sometimes an EXTRA boss, else a normal monster
      const guardX = (candidate.x === candidate.cx) ? candidate.x + candidate.w - 1 : candidate.x; // a cell apart from the hoard
      const guardY = (candidate.y === candidate.cy) ? candidate.y + candidate.h - 1 : candidate.y;
      carving.markers.push({ type: guard, x: guardX, y: guardY });
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
    gridWidth: spec.gw,
    gridHeight: spec.gh,
    secretFloor: createRockGrid(spec.gw, spec.gh),
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

interface MonsterEntry {
  n?: string;
  a?: unknown;
}

const capitalizeFirst = (text: string): string => text ? text.charAt(0).toUpperCase() + text.slice(1) : text;

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

const enrichMonsterMarker = (marker: DungeonMarker, context: RPGContext, random: GenerationRandom): void => {
  marker.label = RPGGen.randomMonster(random.next, context) || 'Monster';
  marker.note = '(' + pickDifficulty(random).toLowerCase() + ')';
  if (random.chance(MONSTER_DESCRIPTION_CHANCE)) {
    const description = random.chance(TONE_ADJECTIVE_CHANCE)
      ? RPGGen.toneAdj(random.next, context, 'monster')
      : RPGGen.toneDesc(random.next, context, 'monster');
    if (description) marker.note += ' ' + capitalizeFirst(description) + '.';
  }
};

const enrichBossMarker = (marker: DungeonMarker, context: RPGContext, bossCreaturePool: MonsterEntry[], random: GenerationRandom): void => {
  const bossName = RPGGen.randomName(random.next, context);
  const creatureEntry = random.pickFrom(bossCreaturePool);
  const creatureName = (creatureEntry && creatureEntry.n) || 'Beast';
  const useName = !!bossName && random.chance(BOSS_NAMED_CHANCE);
  marker.label = useName && bossName ? bossName : creatureName; // a named villain OR a creature, never "Name the Creature"
  marker.note = '(boss)';
  const bossCategory = useName ? 'person' : 'monster';
  if (random.chance(BOSS_DESCRIPTION_CHANCE)) {
    const description = random.chance(TONE_ADJECTIVE_CHANCE)
      ? RPGGen.toneAdj(random.next, context, bossCategory)
      : RPGGen.toneDesc(random.next, context, bossCategory);
    if (description) marker.note += ' ' + capitalizeFirst(description) + '.';
  }
};

const enrichTreasureMarker = (marker: DungeonMarker, context: RPGContext, random: GenerationRandom): void => {
  marker.label = 'Treasure';
  const parts: Array<string | null> = [RPGGen.randomItem(random.next, context) || 'a trinket'];
  if (random.chance(TREASURE_EXTRA_ITEM_CHANCE)) parts.push(RPGGen.randomItem(random.next, context));
  if (random.chance(TREASURE_MONEY_CHANCE)) parts.push(describeMoney(context.genre, random));
  marker.note = parts.filter(Boolean).join(', ') + '.';
};

const enrichTrapMarker = (marker: DungeonMarker, context: RPGContext, random: GenerationRandom): void => {
  marker.label = RPGGen.randomTrap(random.next, context) || 'Trap';
  marker.note = '';
};

/* 'detailed' mode: name & classify every foe, hoard and trap from the random lists */
const enrichDetailed = (markers: DungeonMarker[], context: RPGContext, random: GenerationRandom): void => {
  const monstersByGenre: Record<string, MonsterEntry[] | undefined> = RPG.monsters;
  const bossCreaturePool = (monstersByGenre[context.genre] || []).concat(monstersByGenre.generic || [])
    .filter((monster) => !monster.a); // bosses are never animals
  let sequenceNumber = 0;
  markers.forEach((marker) => {
    if (marker.type === 'monster') {
      enrichMonsterMarker(marker, context, random);
      marker.seq = sequenceNumber++;
    } else if (marker.type === 'boss') {
      enrichBossMarker(marker, context, bossCreaturePool, random);
      marker.seq = sequenceNumber++;
    } else if (marker.type === 'treasure') {
      enrichTreasureMarker(marker, context, random);
      marker.seq = sequenceNumber++;
    } else if (marker.type === 'trap') {
      enrichTrapMarker(marker, context, random);
      marker.seq = sequenceNumber++;
    }
  });
};

/* ---------------- step 6: name & flavor ---------------- */

const pickNameAndFlavor = (context: RPGContext | null, random: GenerationRandom): { name: string | null; flavor: string | null } => {
  if (!context) return { name: null, flavor: null };
  let name: string | null = null, flavor: string | null = null;
  const location = RPGGen.randomLocation(random.next, context);
  if (location) name = (/^the\b/i.test(location) ? '' : 'The ') + location;
  const flavorCategory = random.pickFrom(['place', 'sound', 'building']);
  const flavorDescription = RPGGen.toneDesc(random.next, context, flavorCategory) || RPGGen.toneDesc(random.next, context, 'place');
  if (flavorDescription) flavor = capitalizeFirst(flavorDescription) + '.';
  return { name, flavor };
};

/* ============================================================
   GENERATION  ->  returns a plain JSON-able dungeon object
   ============================================================ */
export function generateDungeon(seed: number, level?: number, mode?: DungeonMode): DungeonResult {
  // input robustness: a non-finite seed becomes a deterministic default (0);
  // an unknown/missing mode becomes 'full'; level is clamped in createLevelSpec.
  const safeSeed = (typeof seed === 'number' && isFinite(seed)) ? (seed >>> 0) : 0;
  const safeMode: DungeonMode = (mode && VALID_MODES.has(mode)) ? mode : 'full';
  const spec = createLevelSpec(level);
  const random = createGenerationRandom(safeSeed);

  const { rooms, floor } = placeRooms(spec, random);
  const surface: CarveSurface = { floor, corridorCells: {}, gridWidth: spec.gw, gridHeight: spec.gh };
  const connectedPairs = carveCorridors(rooms, surface, random);

  const markers: DungeonMarker[] = safeMode !== 'empty' ? placeMarkers(rooms, surface, random) : [];
  const { secretPaths, secretRooms, secretFloor } = safeMode !== 'empty'
    ? carveSecrets(rooms, floor, connectedPairs, spec, markers, random)
    : { secretPaths: [], secretRooms: [], secretFloor: createRockGrid(spec.gw, spec.gh) };

  const contentContext: RPGContext | null = RPGGen ? RPGGen.context(random.next) : null;
  if (safeMode === 'detailed' && contentContext) enrichDetailed(markers, contentContext, random);
  const { name, flavor } = pickNameAndFlavor(contentContext, random);

  const result: DungeonResult = {
    version: 1,
    seed: safeSeed,
    level: spec.level,
    name: name || (random.pickFrom(DUNGEON_NAME_PREFIXES) + ' ' + random.pickFrom(DUNGEON_NAME_SUFFIXES)),
    depth: DEPTH_NUMERALS[random.intBetween(0, DEPTH_NUMERALS.length - 1)],
    flavor: flavor || 'Beyond the torchlight, the map runs dark.',
    genre: (safeMode === 'detailed' && contentContext) ? contentContext.genre : null,
    tone: (safeMode === 'detailed' && contentContext) ? contentContext.tone : null,
    grid: { gw: spec.gw, gh: spec.gh, cell: CELL_PIXELS },
    rooms: rooms.map((room) => ({ x: room.x, y: room.y, w: room.w, h: room.h, id: room.id })),
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
