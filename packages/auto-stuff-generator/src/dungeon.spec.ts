import {
  createGenerationRandom,
  createLevelSpec,
  findStraightTunnel,
  generateDungeon,
  mulberry32,
  placeRooms,
  type FloorGrid,
} from './dungeon';
import type { DungeonResult } from './dungeon-types';

/** Cells reachable from (startX, startY) via 4-neighbor moves over open cells. */
function floodFill(
  isOpen: (x: number, y: number) => boolean,
  gridWidth: number,
  gridHeight: number,
  startX: number,
  startY: number,
): Set<number> {
  const visited = new Set<number>([startY * gridWidth + startX]);
  const queue: Array<[number, number]> = [[startX, startY]];
  const neighborOffsets: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length) {
    const [x, y] = queue.pop() as [number, number];
    for (const [offsetX, offsetY] of neighborOffsets) {
      const nextX = x + offsetX, nextY = y + offsetY;
      if (nextX < 0 || nextY < 0 || nextX >= gridWidth || nextY >= gridHeight) continue;
      const key = nextY * gridWidth + nextX;
      if (visited.has(key) || !isOpen(nextX, nextY)) continue;
      visited.add(key);
      queue.push([nextX, nextY]);
    }
  }
  return visited;
}

function firstOpenCell(dungeon: DungeonResult): [number, number] | null {
  for (let y = 0; y < dungeon.grid.height; y++) for (let x = 0; x < dungeon.grid.width; x++) {
    if (dungeon.floor[y]?.[x] === 1) return [x, y];
  }
  return null;
}

/** A spread of dungeons for invariant checks (fixed seeds — deterministic). */
function invariantSample(): DungeonResult[] {
  const sample: DungeonResult[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    for (const level of [1, 3, 6]) sample.push(generateDungeon(seed, level, 'full'));
  }
  for (let seed = 41; seed <= 50; seed++) sample.push(generateDungeon(seed, 4, 'detailed'));
  return sample;
}

describe('generateDungeon — determinism', () => {
  it('returns deeply-equal dungeons for the same seed/level/mode', () => {
    const first = generateDungeon(424242, 3, 'detailed');
    const second = generateDungeon(424242, 3, 'detailed');
    expect(first).toEqual(second);
  });

  it('returns different dungeons for different seeds', () => {
    const first = generateDungeon(1, 3, 'full');
    const second = generateDungeon(2, 3, 'full');
    expect(first).not.toEqual(second);
  });
});

describe('generateDungeon — serializable result', () => {
  it('round-trips through JSON unchanged', () => {
    const dungeon = generateDungeon(777, 4, 'detailed');
    const roundTripped = JSON.parse(JSON.stringify(dungeon)) as typeof dungeon;
    expect(roundTripped).toEqual(dungeon);
  });

  it('reports a tally consistent with its markers and secret paths', () => {
    const dungeon = generateDungeon(31337, 5, 'full');
    const countType = (type: string) =>
      dungeon.markers.filter((marker) => marker.type === type).length;
    expect(dungeon.tally.rooms).toBe(dungeon.rooms.length);
    expect(dungeon.tally.foes).toBe(countType('monster') + countType('boss'));
    expect(dungeon.tally.traps).toBe(countType('trap'));
    expect(dungeon.tally.loot).toBe(countType('treasure'));
    expect(dungeon.tally.secret).toBe(dungeon.secretPaths.length);
  });
});

describe('generateDungeon — level scaling and bounds', () => {
  it('clamps an out-of-range level into the supported range', () => {
    expect(generateDungeon(5, -10).level).toBe(1);
    expect(generateDungeon(5, 999).level).toBe(6);
  });

  it('scales grid size with level', () => {
    const low = generateDungeon(5, 1);
    const high = generateDungeon(5, 6);
    expect(high.grid.width).toBeGreaterThan(low.grid.width);
    expect(high.grid.height).toBeGreaterThan(low.grid.height);
  });
});

describe('generateDungeon — input robustness', () => {
  it('falls back to a deterministic default for a non-numeric seed', () => {
    // @ts-expect-error — exercising bad input on purpose
    const fromUndefined = generateDungeon(undefined, 3, 'full');
    const fromZero = generateDungeon(0, 3, 'full');
    expect(fromUndefined.seed).toBe(0);
    expect(fromUndefined).toEqual(fromZero);
  });

  it('falls back to a valid mode for an unknown mode', () => {
    // @ts-expect-error — exercising bad input on purpose
    const fromBogus = generateDungeon(9, 3, 'bogus-mode');
    const fromFull = generateDungeon(9, 3, 'full');
    // 'full' has no genre/tone enrichment; bogus should behave identically
    expect(fromBogus.genre).toBeNull();
    expect(fromBogus).toEqual(fromFull);
  });

  it('does not throw on missing optional arguments', () => {
    expect(() => generateDungeon(5)).not.toThrow();
  });
});

describe('generateDungeon — mode enrichment', () => {
  it('populates genre and tone in detailed mode', () => {
    const dungeon = generateDungeon(2024, 4, 'detailed');
    expect(dungeon.genre).not.toBeNull();
    expect(dungeon.tone).not.toBeNull();
    const labelled = dungeon.markers.some((marker) => !!marker.label);
    expect(labelled).toBe(true);
  });

  it('omits genre/tone enrichment in non-detailed mode', () => {
    const dungeon = generateDungeon(2024, 4, 'full');
    expect(dungeon.genre).toBeNull();
    expect(dungeon.tone).toBeNull();
  });

  it('places no markers in empty mode', () => {
    const dungeon = generateDungeon(2024, 4, 'empty');
    expect(dungeon.markers.length).toBe(0);
    expect(dungeon.tally.foes).toBe(0);
  });
});

describe('generateDungeon — back-fill room selection is seed-randomized', () => {
  /**
   * Replicates finding M2 (dead shuffle): the minimum-monster back-fill loop
   * must draw rooms in a seed-shuffled order, not in room-creation order.
   * We reconstruct which rooms are "others" (neither entrance room nor boss
   * room) exactly the way the generator selects them, then compare how often
   * the FIRST vs the LAST of those rooms ends up holding a monster across
   * many seeds. The random 0.62-per-room pass is symmetric, and a working
   * shuffle keeps back-fill symmetric too — so the two rates must be close.
   * With the dead shuffle, every back-filled monster lands in the first
   * rooms, skewing the first-room rate far above the last-room rate.
   */
  it('does not always back-fill the first rooms in filter order', () => {
    const seedCount = 500;
    let dungeonsMeasured = 0;
    let firstRoomMonsterCount = 0;
    let lastRoomMonsterCount = 0;

    for (let seed = 1; seed <= seedCount; seed++) {
      const dungeon = generateDungeon(seed, 2, 'full');
      const roomsWithCenters = dungeon.rooms.map((room) => ({
        ...room,
        centerX: Math.floor(room.gridX + room.width / 2),
        centerY: Math.floor(room.gridY + room.height / 2),
      }));
      const { width: gridWidth, height: gridHeight } = dungeon.grid;
      const edgeDistance = (room: (typeof roomsWithCenters)[number]) =>
        Math.min(
          room.centerX,
          gridWidth - 1 - room.centerX,
          room.centerY,
          gridHeight - 1 - room.centerY,
        );
      // Mirror the generator: entrance room = closest to an edge (stable sort).
      const entranceRoom = roomsWithCenters
        .slice()
        .sort((first, second) => edgeDistance(first) - edgeDistance(second))[0];
      if (!entranceRoom) continue;
      // The main boss marker is placed via a room and carries its room id.
      const bossMarker = dungeon.markers.find(
        (marker) => marker.type === 'boss' && marker.roomId != null,
      );
      if (!bossMarker) continue;
      const otherRooms = roomsWithCenters.filter(
        (room) => room.id !== entranceRoom.id && room.id !== bossMarker.roomId,
      );
      if (otherRooms.length < 2) continue;

      const roomsHoldingMonsters = new Set(
        dungeon.markers
          .filter((marker) => marker.type === 'monster' && marker.roomId != null)
          .map((marker) => marker.roomId),
      );
      dungeonsMeasured++;
      const firstOtherRoom = otherRooms[0], lastOtherRoom = otherRooms[otherRooms.length - 1];
      if (firstOtherRoom && roomsHoldingMonsters.has(firstOtherRoom.id)) firstRoomMonsterCount++;
      if (lastOtherRoom && roomsHoldingMonsters.has(lastOtherRoom.id)) lastRoomMonsterCount++;
    }

    expect(dungeonsMeasured).toBeGreaterThan(300);
    const firstRoomRate = firstRoomMonsterCount / dungeonsMeasured;
    const lastRoomRate = lastRoomMonsterCount / dungeonsMeasured;
    // Symmetric placement keeps these rates close; the dead shuffle pushes
    // every back-fill into the first room and drives the gap far higher.
    expect(Math.abs(firstRoomRate - lastRoomRate)).toBeLessThan(0.08);
  });
});

describe('generateDungeon — headless', () => {
  it('runs with no DOM globals referenced', () => {
    expect(typeof document).toBe('undefined');
    expect(() => generateDungeon(mulberry32(1)() * 0xffffffff, 3, 'detailed')).not.toThrow();
  });
});

describe('generateDungeon — structural invariants', () => {
  it('places every marker within grid bounds on an open cell', () => {
    for (const dungeon of invariantSample()) {
      const { width: gridWidth, height: gridHeight } = dungeon.grid;
      for (const marker of dungeon.markers) {
        expect(marker.gridX).toBeGreaterThanOrEqual(0);
        expect(marker.gridY).toBeGreaterThanOrEqual(0);
        expect(marker.gridX).toBeLessThan(gridWidth);
        expect(marker.gridY).toBeLessThan(gridHeight);
        const onNormalFloor = dungeon.floor[marker.gridY]?.[marker.gridX] === 1;
        const onSecretFloor = !!dungeon.secretFloor && dungeon.secretFloor[marker.gridY]?.[marker.gridX] === 1;
        expect(onNormalFloor || onSecretFloor).toBe(true);
      }
    }
  });

  it('produces a fully connected normal floor', () => {
    for (const dungeon of invariantSample()) {
      const { width: gridWidth, height: gridHeight } = dungeon.grid;
      const start = firstOpenCell(dungeon);
      expect(start).not.toBeNull();
      if (!start) continue;
      let openCellCount = 0;
      for (let y = 0; y < gridHeight; y++) for (let x = 0; x < gridWidth; x++) {
        if (dungeon.floor[y]?.[x] === 1) openCellCount++;
      }
      const reached = floodFill(
        (x, y) => dungeon.floor[y]?.[x] === 1,
        gridWidth, gridHeight, start[0], start[1],
      );
      expect(reached.size).toBe(openCellCount);
    }
  });

  it('bores secrets only through rock and connects them via secret tunnels', () => {
    let dungeonsWithSecrets = 0;
    for (const dungeon of invariantSample()) {
      if (!dungeon.secretFloor) continue;
      dungeonsWithSecrets++;
      const { width: gridWidth, height: gridHeight } = dungeon.grid;
      const secretFloor = dungeon.secretFloor;
      // carve-level isolation: no cell is both normal floor and secret floor
      for (let y = 0; y < gridHeight; y++) for (let x = 0; x < gridWidth; x++) {
        expect(dungeon.floor[y]?.[x] === 1 && secretFloor[y]?.[x] === 1).toBe(false);
      }
      // combined floor is fully connected: every secret room is reachable
      // from the normal floor once secret-tunnel cells are included
      const start = firstOpenCell(dungeon);
      expect(start).not.toBeNull();
      if (!start) continue;
      const reached = floodFill(
        (x, y) => dungeon.floor[y]?.[x] === 1 || secretFloor[y]?.[x] === 1,
        gridWidth, gridHeight, start[0], start[1],
      );
      for (const secretRoom of dungeon.secretRooms) {
        expect(reached.has(secretRoom.centerY * gridWidth + secretRoom.centerX)).toBe(true);
      }
    }
    // the sample must actually exercise the secret paths, not vacuously pass
    expect(dungeonsWithSecrets).toBeGreaterThan(10);
  });
});

describe('generation steps — direct helper contracts', () => {
  it('placeRooms produces in-bounds, non-touching rooms whose cells are carved', () => {
    const spec = createLevelSpec(4);
    const random = createGenerationRandom(20260704);
    const { rooms, floor } = placeRooms(spec, random);
    expect(rooms.length).toBeGreaterThan(0);
    for (const room of rooms) {
      expect(room.gridX).toBeGreaterThanOrEqual(1);
      expect(room.gridY).toBeGreaterThanOrEqual(1);
      expect(room.gridX + room.width).toBeLessThanOrEqual(spec.gridWidth - 1);
      expect(room.gridY + room.height).toBeLessThanOrEqual(spec.gridHeight - 1);
      for (let y = room.gridY; y < room.gridY + room.height; y++) for (let x = room.gridX; x < room.gridX + room.width; x++) {
        expect(floor[y]?.[x]).toBe(1);
      }
    }
    for (const roomA of rooms) for (const roomB of rooms) {
      if (roomA === roomB) continue;
      const separated =
        roomA.gridX + roomA.width < roomB.gridX || roomB.gridX + roomB.width < roomA.gridX ||
        roomA.gridY + roomA.height < roomB.gridY || roomB.gridY + roomB.height < roomA.gridY;
      expect(separated).toBe(true);
    }
  });

  it('findStraightTunnel returns a straight rock-only tunnel between facing rects', () => {
    // 10x7 grid; two 2x3 rooms carved with a 4-column rock gap between them
    const floor: FloorGrid = Array.from({ length: 7 }, () => new Array<number>(10).fill(0));
    const leftRoom = { gridX: 1, gridY: 2, width: 2, height: 3 };
    const rightRoom = { gridX: 7, gridY: 2, width: 2, height: 3 };
    for (const room of [leftRoom, rightRoom]) {
      for (let y = room.gridY; y < room.gridY + room.height; y++) { const floorRow = floor[y]; if (floorRow) for (let x = room.gridX; x < room.gridX + room.width; x++) floorRow[x] = 1; }
    }
    const tunnel = findStraightTunnel(floor, leftRoom, rightRoom);
    expect(tunnel).not.toBeNull();
    if (!tunnel) return;
    // every tunnel cell is rock, and the tunnel is a straight single row
    const rows = new Set(tunnel.cells.map((cell) => cell.gridY));
    expect(rows.size).toBe(1);
    for (const cell of tunnel.cells) expect(floor[cell.gridY]?.[cell.gridX]).toBe(0);
    expect(tunnel.cells.map((cell) => cell.gridX)).toEqual([3, 4, 5, 6]);
  });

  it('findStraightTunnel returns null when open floor blocks every straight line', () => {
    const floor: FloorGrid = Array.from({ length: 7 }, () => new Array<number>(10).fill(0));
    const leftRoom = { gridX: 1, gridY: 2, width: 2, height: 3 };
    const rightRoom = { gridX: 7, gridY: 2, width: 2, height: 3 };
    for (const room of [leftRoom, rightRoom]) {
      for (let y = room.gridY; y < room.gridY + room.height; y++) { const floorRow = floor[y]; if (floorRow) for (let x = room.gridX; x < room.gridX + room.width; x++) floorRow[x] = 1; }
    }
    for (let y = 0; y < 7; y++) { const floorRow = floor[y]; if (floorRow) floorRow[5] = 1; } // a corridor wall of open cells between them
    expect(findStraightTunnel(floor, leftRoom, rightRoom)).toBeNull();
  });
});

describe('generateDungeon — fixed-seed regression', () => {
  it('matches the locked output for representative seeds', () => {
    expect(generateDungeon(0xc0ffee, 3, 'full')).toMatchSnapshot();
    expect(generateDungeon(424242, 5, 'detailed')).toMatchSnapshot();
  });
});
