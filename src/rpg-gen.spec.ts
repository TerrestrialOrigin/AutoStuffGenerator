import { RPGGen } from './rpg-gen';
import { mulberry32 } from './dungeon';
import type { RPGContext } from './rpg-gen';

/* A fantasy context is convenient for asserting pool membership: its
   monster/loot/places pools are densely populated in the data. */
function fantasyContext(): RPGContext {
  return { genre: 'fantasy', theme: null, tone: null };
}

describe('RPGGen — determinism', () => {
  it('produces identical output for two RNGs seeded the same', () => {
    const first = RPGGen.randomMonster(mulberry32(12345), fantasyContext());
    const second = RPGGen.randomMonster(mulberry32(12345), fantasyContext());
    expect(first).toEqual(second);
  });

  it('uses Math.random and does not throw when no RNG is supplied', () => {
    expect(() => RPGGen.randomItem()).not.toThrow();
    expect(() => RPGGen.context()).not.toThrow();
  });
});

describe('RPGGen — context', () => {
  it('exposes the supported genres', () => {
    expect(RPGGen.genres).toEqual(['fantasy', 'sci-fi', 'modern', 'horror']);
  });

  it('builds a context whose genre is one of the supported genres', () => {
    const context = RPGGen.context(mulberry32(7));
    expect(RPGGen.genres).toContain(context.genre);
  });
});

describe('RPGGen — pool membership and graceful empty pools', () => {
  it('returns a monster drawn from the active genre pool', () => {
    const context = fantasyContext();
    const pool = RPGGen.monsterPool(context, true).map((m) => (m.n || m));
    const monster = RPGGen.randomMonster(mulberry32(99), context);
    // randomMonster may decorate with mood/action, so check the base name is present
    expect(monster).toBeTruthy();
    const matchesSomeBase = pool.some((name: string) =>
      String(monster).toLowerCase().includes(String(name).toLowerCase()),
    );
    expect(matchesSomeBase).toBe(true);
  });

  it('returns null when a category pool is empty for the active genre', () => {
    // a context pointing at a non-existent genre has empty pools everywhere
    const emptyContext: RPGContext = { genre: '__no_such_genre__', theme: null, tone: null };
    expect(RPGGen.randomItem(mulberry32(1), emptyContext)).toBeNull();
    expect(RPGGen.randomLocation(mulberry32(1), emptyContext)).toBeNull();
    expect(RPGGen.randomTrap(mulberry32(1), emptyContext)).toBeNull();
  });
});

describe('RPGGen — headless', () => {
  it('runs with no DOM globals referenced', () => {
    // jest testEnvironment is "node": document/window are undefined here.
    expect(typeof document).toBe('undefined');
    expect(() => {
      const context = RPGGen.context(mulberry32(3));
      RPGGen.randomName(mulberry32(3), context);
      RPGGen.randomMonster(mulberry32(3), context);
      RPGGen.randomItem(mulberry32(3), context);
    }).not.toThrow();
  });
});
