import { generateDungeon, mulberry32 } from './dungeon';

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
    const roundTripped = JSON.parse(JSON.stringify(dungeon));
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
    expect(high.grid.gw).toBeGreaterThan(low.grid.gw);
    expect(high.grid.gh).toBeGreaterThan(low.grid.gh);
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

describe('generateDungeon — headless', () => {
  it('runs with no DOM globals referenced', () => {
    expect(typeof document).toBe('undefined');
    expect(() => generateDungeon(mulberry32(1)() * 0xffffffff, 3, 'detailed')).not.toThrow();
  });
});
