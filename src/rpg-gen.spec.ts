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
    const pool = RPGGen.monsterPool(context, true).map((monsterEntry) => monsterEntry.n);
    const monster = RPGGen.randomMonster(mulberry32(99), context);
    // randomMonster may decorate with mood/action, so check the base name is present
    expect(monster).toBeTruthy();
    const matchesSomeBase = pool.some((name) =>
      String(monster).toLowerCase().includes(name.toLowerCase()),
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

/* ------------------------------------------------------------------
   M9-lib gap closure: randomName / randomTitle / decorate / tone
   helpers / isVermin / monsterPool. Uses purpose-built sources via
   createRPGGen so pools are small enough for exact assertions.
   ------------------------------------------------------------------ */
import { createRPGGen, isVermin } from './rpg-gen';
import type { ContentSource } from './content-types';

function namingSource(): ContentSource {
  return {
    monsters: { fantasy: [{ n: 'Gronk' }] },
    names: {
      given: [
        { n: 'Fantasia', g: 'female', theme: 'generic', genre: 'fantasy' },
        { n: 'Fantasio', g: 'male', theme: 'generic', genre: 'fantasy' },
        { n: 'Modernia', g: 'female', theme: 'generic', genre: 'modern' },
        { n: 'Modernus', g: 'male', theme: 'generic', genre: 'modern' },
      ],
      surname: [
        { n: 'Fantberg', genre: 'fantasy' },
        { n: 'Modberg', genre: 'modern' },
      ],
    },
    titles: [
      { title: 'Dame', category: 'nobility', theme: 'generic', gender: 'female', placement: 'before' },
      { title: 'the Bold', category: 'epithet', theme: 'generic', gender: 'neutral', placement: 'after' },
      { title: 'Herr', category: 'courtesy', theme: 'unreachable-theme', gender: 'male', placement: 'before' },
    ],
    tones: {},
    loot: {},
    places: {},
    moods: [],
    activities: {},
    traps: {},
  };
}

describe('randomName — pool filtering and composition', () => {
  const engine = createRPGGen(namingSource());
  const fantasy: RPGContext = { genre: 'fantasy', theme: null, tone: null };

  it('draws given names and surnames only from the active genre (or generic)', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const name = engine.randomName(mulberry32(seed), fantasy);
      expect(name).toBeTruthy();
      expect(name).toMatch(/Fantasia|Fantasio/);
      expect(name).not.toMatch(/Modernia|Modernus|Modberg/);
    }
  });

  it('attaches a surname on some seeds but not all (the ~40% chance path)', () => {
    const withSurname = new Set<boolean>();
    for (let seed = 1; seed <= 120; seed++) {
      const name = engine.randomName(mulberry32(seed), fantasy) as string;
      withSurname.add(name.includes('Fantberg'));
    }
    expect(withSurname).toEqual(new Set([true, false]));
  });

  it('places a before-title before the name and an after-title after it', () => {
    let beforeSeen = false, afterSeen = false;
    for (let seed = 1; seed <= 400; seed++) {
      const name = engine.randomName(mulberry32(seed), fantasy) as string;
      if (name.includes('Dame')) {
        expect(name.startsWith('Dame ')).toBe(true);
        beforeSeen = true;
      }
      if (name.includes('the Bold')) {
        expect(name.endsWith(' the Bold')).toBe(true);
        afterSeen = true;
      }
      expect(name).not.toMatch(/Herr/); // theme never matches (see themePool quirk)
    }
    expect(beforeSeen).toBe(true);
    expect(afterSeen).toBe(true);
  });

  it('gender-matches titles: "Dame" only ever decorates female given names', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const name = engine.randomName(mulberry32(seed), fantasy) as string;
      if (name.includes('Dame')) expect(name).toMatch(/Fantasia/);
    }
  });

  it('returns null when the source has no given names', () => {
    const empty = createRPGGen({ ...namingSource(), names: { given: [], surname: [] } });
    expect(empty.randomName(mulberry32(1), fantasy)).toBeNull();
  });
});

describe('randomTitle — theme and gender filtering', () => {
  const engine = createRPGGen(namingSource());
  const fantasy: RPGContext = { genre: 'fantasy', theme: null, tone: null };

  it('returns only generic-theme titles matching the gender (or neutral)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const femaleTitle = engine.randomTitle(mulberry32(seed), fantasy, 'female');
      expect(femaleTitle).not.toBeNull();
      expect(['Dame', 'the Bold']).toContain(femaleTitle!.title);
      const maleTitle = engine.randomTitle(mulberry32(seed), fantasy, 'male');
      expect(maleTitle).not.toBeNull();
      // 'Dame' is female-only and 'Herr' has an unmatchable theme
      expect(maleTitle!.title).toBe('the Bold');
    }
  });

  it('returns null when nothing matches', () => {
    const engineWithoutTitles = createRPGGen({ ...namingSource(), titles: [] });
    expect(engineWithoutTitles.randomTitle(mulberry32(1), fantasy, 'female')).toBeNull();
  });
});

describe('decorate (via randomLocation/randomItem) — adjective before, description after', () => {
  function tonedSource(placeTone: { adj?: string[]; desc?: string[] }): ContentSource {
    return {
      ...namingSource(),
      tones: { moody: { place: placeTone, item: { adj: ['glittering'] } } },
      places: { fantasy: ['keep'] },
      loot: { fantasy: { trinkets: ['ring'] } },
    };
  }
  const moodyFantasy: RPGContext = { genre: 'fantasy', theme: null, tone: 'moody' };

  it('puts a tone adjective BEFORE the base, capitalized', () => {
    const engine = createRPGGen(tonedSource({ adj: ['gloomy'] }));
    const decorated = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      decorated.add(engine.randomLocation(mulberry32(seed), moodyFantasy) as string);
    }
    expect(decorated.has('Gloomy keep')).toBe(true);
    expect([...decorated].every((location) => location === 'keep' || location === 'Gloomy keep')).toBe(true);
  });

  it('puts a tone description AFTER the base', () => {
    const engine = createRPGGen(tonedSource({ desc: ['shrouded in fog'] }));
    const decorated = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      decorated.add(engine.randomLocation(mulberry32(seed), moodyFantasy) as string);
    }
    expect(decorated.has('keep shrouded in fog')).toBe(true);
    expect([...decorated].every((location) => location === 'keep' || location === 'keep shrouded in fog')).toBe(true);
  });

  it('items only ever take adjectives (before), never trailing descriptions', () => {
    const engine = createRPGGen(tonedSource({ adj: ['gloomy'], desc: ['shrouded in fog'] }));
    const items = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      items.add(engine.randomItem(mulberry32(seed), moodyFantasy) as string);
    }
    expect(items.has('Glittering ring')).toBe(true);
    expect([...items].every((item) => item === 'ring' || item === 'Glittering ring')).toBe(true);
  });
});

describe('toneAdj / toneDesc', () => {
  const source: ContentSource = {
    ...namingSource(),
    tones: { moody: { place: { adj: ['gloomy'] }, sound: { desc: ['a distant drip'] } } },
  };
  const engine = createRPGGen(source);
  const moodyContext: RPGContext = { genre: 'fantasy', theme: null, tone: 'moody' };

  it('returns a pool entry when the category has the requested kind', () => {
    expect(engine.toneAdj(mulberry32(3), moodyContext, 'place')).toBe('gloomy');
    expect(engine.toneDesc(mulberry32(3), moodyContext, 'sound')).toBe('a distant drip');
  });

  it('returns null for the missing kind, a missing category, or no active tone', () => {
    expect(engine.toneDesc(mulberry32(3), moodyContext, 'place')).toBeNull();
    expect(engine.toneAdj(mulberry32(3), moodyContext, 'sound')).toBeNull();
    expect(engine.toneAdj(mulberry32(3), moodyContext, 'building')).toBeNull();
    expect(engine.toneAdj(mulberry32(3), { ...moodyContext, tone: null }, 'place')).toBeNull();
    expect(engine.toneAdj(mulberry32(3), { ...moodyContext, tone: 'no-such-tone' }, 'place')).toBeNull();
  });
});

describe('isVermin — word-level matching with plural stripping', () => {
  it.each([
    ['Rat', true],
    ['Giant Rats', true],
    ['Cave Spider', true],
    ['spider-queen', true],
    ['Hawk', false],
    ['Deer', false],
    ['Ratcatcher', false],   // 'ratcatcher' is one word, not 'rat'
    ['', false],
  ])('%s -> %s', (name, expected) => {
    expect(isVermin(name)).toBe(expected);
  });
});

describe('monsterPool — animal filtering', () => {
  const source: ContentSource = {
    ...namingSource(),
    monsters: {
      fantasy: [
        { n: 'Troll' },
        { n: 'Giant Rat', a: 1 },
        { n: 'Hawk', a: 1 },
      ],
      generic: [{ n: 'Bandit' }],
    },
  };
  const engine = createRPGGen(source);
  const fantasy: RPGContext = { genre: 'fantasy', theme: null, tone: null };

  it('excludes non-vermin animals from the dungeon pool but keeps vermin', () => {
    const pool = engine.monsterPool(fantasy, false).map((monsterEntry) => monsterEntry.n);
    expect(pool).toEqual(['Troll', 'Giant Rat', 'Bandit']);
  });

  it('includes all animals when requested', () => {
    const pool = engine.monsterPool(fantasy, true).map((monsterEntry) => monsterEntry.n);
    expect(pool).toEqual(['Troll', 'Giant Rat', 'Hawk', 'Bandit']);
  });
});
