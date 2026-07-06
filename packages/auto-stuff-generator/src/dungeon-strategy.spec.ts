import {
  defaultDungeonStrategy,
  generateDungeon,
  type DungeonStrategy,
  type FloorGrid,
  type InternalRoom,
} from './dungeon';
import type { DungeonMarker } from './dungeon-types';

/** A fixed two-room layout on the level-3 grid (23x25). */
function fixedRoomStep(): DungeonStrategy['placeRooms'] {
  return (spec) => {
    const rooms: InternalRoom[] = [
      { gridX: 2, gridY: 2, width: 4, height: 4, centerX: 4, centerY: 4, id: 0 },
      { gridX: 15, gridY: 18, width: 5, height: 4, centerX: 17, centerY: 20, id: 1 },
    ];
    const floor: FloorGrid = Array.from({ length: spec.gridHeight }, () => new Array<number>(spec.gridWidth).fill(0));
    for (const room of rooms) {
      for (let y = room.gridY; y < room.gridY + room.height; y++) { const floorRow = floor[y]; if (floorRow) for (let x = room.gridX; x < room.gridX + room.width; x++) floorRow[x] = 1; }
    }
    return { rooms, floor };
  };
}

describe('DungeonStrategy — custom steps are used by generateDungeon', () => {
  it('uses a custom room-placement step verbatim', () => {
    const strategy: DungeonStrategy = { ...defaultDungeonStrategy, placeRooms: fixedRoomStep() };
    const dungeon = generateDungeon(123, 3, 'full', strategy);
    expect(dungeon.rooms).toEqual([
      { gridX: 2, gridY: 2, width: 4, height: 4, id: 0 },
      { gridX: 15, gridY: 18, width: 5, height: 4, id: 1 },
    ]);
  });

  it('spread-partial override keeps every other step on the default algorithm', () => {
    const strategy: DungeonStrategy = { ...defaultDungeonStrategy, placeRooms: fixedRoomStep() };
    const dungeon = generateDungeon(123, 3, 'full', strategy);
    // default corridor step ran: the two fixed rooms are connected on the visible floor
    expect(dungeon.markers.some((marker) => marker.type === 'entrance')).toBe(true);
    expect(dungeon.markers.some((marker) => marker.type === 'boss')).toBe(true);
    // default naming ran: stock name/flavor fields are present
    expect(dungeon.name).toBeTruthy();
    expect(dungeon.flavor).toBeTruthy();
    // corridor cells beyond the two rooms were carved by the default step
    const openCellCount = dungeon.floor.flat().filter((cell) => cell === 1).length;
    expect(openCellCount).toBeGreaterThan(4 * 4 + 5 * 4);
  });

  it('a custom enrichment step replaces detailed-mode enrichment', () => {
    const strategy: DungeonStrategy = {
      ...defaultDungeonStrategy,
      enrichMarkers: (markers) => {
        markers.forEach((marker) => { marker.label = 'CUSTOM'; });
      },
    };
    const dungeon = generateDungeon(9, 3, 'detailed', strategy);
    expect(dungeon.markers.length).toBeGreaterThan(0);
    expect(dungeon.markers.every((marker) => marker.label === 'CUSTOM')).toBe(true);
  });

  it('omitting the strategy argument uses the default algorithm unchanged', () => {
    expect(generateDungeon(555, 2, 'full')).toEqual(generateDungeon(555, 2, 'full', defaultDungeonStrategy));
  });
});

describe('marker kinds — unknown kinds pass through enrichment untouched', () => {
  it('leaves a consumer-defined marker kind unmodified in detailed mode', () => {
    const customMarker: DungeonMarker = { type: 'other', gridX: 1, gridY: 1, note: 'left alone' };
    const strategy: DungeonStrategy = {
      ...defaultDungeonStrategy,
      placeMarkers: (rooms, surface, random) => {
        const markers = defaultDungeonStrategy.placeMarkers(rooms, surface, random);
        markers.push(customMarker);
        return markers;
      },
    };
    const dungeon = generateDungeon(77, 3, 'detailed', strategy);
    const passedThrough = dungeon.markers.find((marker) => marker.type === 'other');
    expect(passedThrough).toEqual({ type: 'other', gridX: 1, gridY: 1, note: 'left alone' });
    expect(passedThrough?.sequence).toBeUndefined();
    expect(passedThrough?.label).toBeUndefined();
    // known kinds around it were still enriched and sequenced
    expect(dungeon.markers.some((marker) => marker.type === 'monster' && marker.label && marker.sequence != null)).toBe(true);
  });

  it('accepts consumer-defined kind strings at compile time', () => {
    const marker: DungeonMarker = { type: 'other', gridX: 0, gridY: 0 };
    expect(marker.type).toBe('other');
  });
});
