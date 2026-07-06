import { defaultContentGenerator } from './rpg-gen';
import { mulberry32 } from './dungeon';
import type { GenerationContext } from './rpg-gen';

/* A fantasy context is convenient for asserting pool membership: its
   monster/loot/places pools are densely populated in the data. */
function fantasyContext(): GenerationContext {
  return { genre: 'fantasy', theme: null, tone: null };
}

describe('defaultContentGenerator — determinism', () => {
  it('produces identical output for two RNGs seeded the same', () => {
    const first = defaultContentGenerator.randomMonster(mulberry32(12345), fantasyContext());
    const second = defaultContentGenerator.randomMonster(mulberry32(12345), fantasyContext());
    expect(first).toEqual(second);
  });

  it('uses Math.random and does not throw when no RNG is supplied', () => {
    expect(() => defaultContentGenerator.randomItem()).not.toThrow();
    expect(() => defaultContentGenerator.context()).not.toThrow();
  });
});

describe('defaultContentGenerator — context', () => {
  it('exposes the supported genres', () => {
    expect(defaultContentGenerator.genres).toEqual(['fantasy', 'sci-fi', 'modern', 'horror']);
  });

  it('builds a context whose genre is one of the supported genres', () => {
    const context = defaultContentGenerator.context(mulberry32(7));
    expect(defaultContentGenerator.genres).toContain(context.genre);
  });
});

describe('defaultContentGenerator — pool membership and graceful empty pools', () => {
  it('returns a monster drawn from the active genre pool', () => {
    const context = fantasyContext();
    const pool = defaultContentGenerator.monsterPool(context, true).map((monsterEntry) => monsterEntry.name);
    const monster = defaultContentGenerator.randomMonster(mulberry32(99), context);
    // randomMonster may decorate with mood/action, so check the base name is present
    expect(monster).toBeTruthy();
    const matchesSomeBase = pool.some((name) =>
      String(monster).toLowerCase().includes(name.toLowerCase()),
    );
    expect(matchesSomeBase).toBe(true);
  });

  it('returns null when a category pool is empty for the active genre', () => {
    // a context pointing at a non-existent genre has empty pools everywhere
    const emptyContext: GenerationContext = { genre: '__no_such_genre__', theme: null, tone: null };
    expect(defaultContentGenerator.randomItem(mulberry32(1), emptyContext)).toBeNull();
    expect(defaultContentGenerator.randomLocation(mulberry32(1), emptyContext)).toBeNull();
    expect(defaultContentGenerator.randomTrap(mulberry32(1), emptyContext)).toBeNull();
  });
});

describe('defaultContentGenerator — headless', () => {
  it('runs with no DOM globals referenced', () => {
    // jest testEnvironment is "node": document/window are undefined here.
    expect(typeof document).toBe('undefined');
    expect(() => {
      const context = defaultContentGenerator.context(mulberry32(3));
      defaultContentGenerator.randomName(mulberry32(3), context);
      defaultContentGenerator.randomMonster(mulberry32(3), context);
      defaultContentGenerator.randomItem(mulberry32(3), context);
    }).not.toThrow();
  });
});

/* ------------------------------------------------------------------
   M9-lib gap closure: randomName / randomTitle / decorate / tone
   helpers / isVermin / monsterPool. Uses purpose-built sources via
   createContentGenerator so pools are small enough for exact assertions.
   ------------------------------------------------------------------ */
import { createContentGenerator, isVermin } from './rpg-gen';
import type { ContentSource } from './content-types';

function namingSource(): ContentSource {
  return {
    monsters: { fantasy: [{ name: 'Gronk' }] },
    names: {
      given: [
        { name: 'Fantasia', gender: 'female', theme: 'generic', genre: 'fantasy' },
        { name: 'Fantasio', gender: 'male', theme: 'generic', genre: 'fantasy' },
        { name: 'Modernia', gender: 'female', theme: 'generic', genre: 'modern' },
        { name: 'Modernus', gender: 'male', theme: 'generic', genre: 'modern' },
      ],
      surname: [
        { name: 'Fantberg', genre: 'fantasy' },
        { name: 'Modberg', genre: 'modern' },
      ],
      dungeonNamePrefixes: [],
      dungeonNameSuffixes: [],
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
  const engine = createContentGenerator(namingSource());
  const fantasy: GenerationContext = { genre: 'fantasy', theme: null, tone: null };

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
    const empty = createContentGenerator({ ...namingSource(), names: { given: [], surname: [], dungeonNamePrefixes: [], dungeonNameSuffixes: [] } });
    expect(empty.randomName(mulberry32(1), fantasy)).toBeNull();
  });
});

describe('randomGivenName — the given-name slice of the full-name path', () => {
  const engine = createContentGenerator(namingSource());
  const fantasy: GenerationContext = { genre: 'fantasy', theme: null, tone: null };

  it('draws given names only from the active genre pools, with no surname or title', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const givenName = engine.randomGivenName(mulberry32(seed), fantasy);
      expect(givenName).toMatch(/^(Fantasia|Fantasio)$/); // bare given name — never Fantberg/Dame/the Bold
    }
  });

  it('matches the given-name prefix of randomName for the same seed (shared gender draw + pick chain)', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const givenName = engine.randomGivenName(mulberry32(seed), fantasy) as string;
      const fullName = engine.randomName(mulberry32(seed), fantasy) as string;
      // The full name is the given name, possibly with a surname/title around it.
      expect(fullName).toContain(givenName);
    }
  });

  it('returns null when the source has no given names', () => {
    const empty = createContentGenerator({ ...namingSource(), names: { given: [], surname: [], dungeonNamePrefixes: [], dungeonNameSuffixes: [] } });
    expect(empty.randomGivenName(mulberry32(1), fantasy)).toBeNull();
  });
});

describe('randomDungeonName — stock composition from the names-table fragment pools', () => {
  it('composes one prefix pick and one suffix pick joined with a space', () => {
    const engine = createContentGenerator({
      ...namingSource(),
      names: { given: [], surname: [], dungeonNamePrefixes: ['The Improbable'], dungeonNameSuffixes: ['Snorkelry'] },
    });
    expect(engine.randomDungeonName(mulberry32(1))).toBe('The Improbable Snorkelry');
  });

  it('draws from the built-in pools with the default content', () => {
    const engine = createContentGenerator(defaultContent);
    const name = engine.randomDungeonName(mulberry32(7)) as string;
    const words = name.split(' ');
    expect(defaultContent.names.dungeonNamePrefixes).toContain(words.slice(0, 2).join(' '));
    expect(defaultContent.names.dungeonNameSuffixes).toContain(words[words.length - 1]);
  });

  it('returns null when both fragment pools are empty', () => {
    const engine = createContentGenerator(namingSource()); // namingSource has empty fragment pools
    expect(engine.randomDungeonName(mulberry32(1))).toBeNull();
  });
});

describe('randomTitle — theme and gender filtering', () => {
  const engine = createContentGenerator(namingSource());
  const fantasy: GenerationContext = { genre: 'fantasy', theme: null, tone: null };

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
    const engineWithoutTitles = createContentGenerator({ ...namingSource(), titles: [] });
    expect(engineWithoutTitles.randomTitle(mulberry32(1), fantasy, 'female')).toBeNull();
  });
});

describe('decorate (via randomLocation/randomItem) — adjective before, description after', () => {
  function tonedSource(placeTone: { adjectives?: string[]; descriptions?: string[] }): ContentSource {
    return {
      ...namingSource(),
      tones: { moody: { place: placeTone, item: { adjectives: ['glittering'] } } },
      places: { fantasy: ['keep'] },
      loot: { fantasy: { trinkets: ['ring'] } },
    };
  }
  const moodyFantasy: GenerationContext = { genre: 'fantasy', theme: null, tone: 'moody' };

  it('puts a tone adjective BEFORE the base, capitalized', () => {
    const engine = createContentGenerator(tonedSource({ adjectives: ['gloomy'] }));
    const decorated = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      decorated.add(engine.randomLocation(mulberry32(seed), moodyFantasy) as string);
    }
    expect(decorated.has('Gloomy keep')).toBe(true);
    expect([...decorated].every((location) => location === 'keep' || location === 'Gloomy keep')).toBe(true);
  });

  it('puts a tone description AFTER the base', () => {
    const engine = createContentGenerator(tonedSource({ descriptions: ['shrouded in fog'] }));
    const decorated = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      decorated.add(engine.randomLocation(mulberry32(seed), moodyFantasy) as string);
    }
    expect(decorated.has('keep shrouded in fog')).toBe(true);
    expect([...decorated].every((location) => location === 'keep' || location === 'keep shrouded in fog')).toBe(true);
  });

  it('items only ever take adjectives (before), never trailing descriptions', () => {
    const engine = createContentGenerator(tonedSource({ adjectives: ['gloomy'], descriptions: ['shrouded in fog'] }));
    const items = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      items.add(engine.randomItem(mulberry32(seed), moodyFantasy) as string);
    }
    expect(items.has('Glittering ring')).toBe(true);
    expect([...items].every((item) => item === 'ring' || item === 'Glittering ring')).toBe(true);
  });
});

describe('toneAdjective / toneDescription', () => {
  const source: ContentSource = {
    ...namingSource(),
    tones: { moody: { place: { adjectives: ['gloomy'] }, sound: { descriptions: ['a distant drip'] } } },
  };
  const engine = createContentGenerator(source);
  const moodyContext: GenerationContext = { genre: 'fantasy', theme: null, tone: 'moody' };

  it('returns a pool entry when the category has the requested kind', () => {
    expect(engine.toneAdjective(mulberry32(3), moodyContext, 'place')).toBe('gloomy');
    expect(engine.toneDescription(mulberry32(3), moodyContext, 'sound')).toBe('a distant drip');
  });

  it('returns null for the missing kind, a missing category, or no active tone', () => {
    expect(engine.toneDescription(mulberry32(3), moodyContext, 'place')).toBeNull();
    expect(engine.toneAdjective(mulberry32(3), moodyContext, 'sound')).toBeNull();
    expect(engine.toneAdjective(mulberry32(3), moodyContext, 'building')).toBeNull();
    expect(engine.toneAdjective(mulberry32(3), { ...moodyContext, tone: null }, 'place')).toBeNull();
    expect(engine.toneAdjective(mulberry32(3), { ...moodyContext, tone: 'no-such-tone' }, 'place')).toBeNull();
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
        { name: 'Troll' },
        { name: 'Giant Rat', isAnimal: 1 },
        { name: 'Hawk', isAnimal: 1 },
      ],
      generic: [{ name: 'Bandit' }],
    },
  };
  const engine = createContentGenerator(source);
  const fantasy: GenerationContext = { genre: 'fantasy', theme: null, tone: null };

  it('excludes non-vermin animals from the dungeon pool but keeps vermin', () => {
    const pool = engine.monsterPool(fantasy, false).map((monsterEntry) => monsterEntry.name);
    expect(pool).toEqual(['Troll', 'Giant Rat', 'Bandit']);
  });

  it('includes all animals when requested', () => {
    const pool = engine.monsterPool(fantasy, true).map((monsterEntry) => monsterEntry.name);
    expect(pool).toEqual(['Troll', 'Giant Rat', 'Hawk', 'Bandit']);
  });
});

/* ------------------------------------------------------------------
   DB-1: themePool must yield REAL cultural theme names, not numeric
   array indices. A themed context (~15%) previously got context.theme
   like '137' (an index into the names.given array), which matched no
   entry's theme, so theme-strict names and theme-only titles silently
   never resolved. These tests replicate that (they FAIL against the
   Object.keys(names.given) implementation) and lock the fix.
   ------------------------------------------------------------------ */
import { defaultContent } from './data';

describe('DB-1 — themePool yields real theme names, not array indices', () => {
  /* The distinct real theme values present in the built-in name data,
     excluding the always-matching 'generic' pool. */
  const realThemes = new Set(
    defaultContent.names.given.map((nameEntry) => nameEntry.theme).filter((theme) => theme !== 'generic'),
  );

  it('every themed context selects a real theme name (never a numeric index)', () => {
    const engine = createContentGenerator(defaultContent);
    const themesSeen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const theme = engine.context(mulberry32(seed)).theme;
      if (theme === null) continue;
      themesSeen.add(theme);
      expect(theme).not.toMatch(/^\d+$/);   // an array index like '0' / '137' is the bug
      expect(realThemes.has(theme)).toBe(true);
    }
    // sanity: themed contexts actually occur across these seeds
    expect(themesSeen.size).toBeGreaterThan(0);
  });

  it('the now-public themePool() returns exactly the real themes, generic excluded', () => {
    const engine = createContentGenerator(defaultContent);
    const themes = engine.themePool();
    expect(new Set(themes)).toEqual(realThemes);
    expect(themes).not.toContain('generic');
    for (const theme of themes) expect(theme).not.toMatch(/^\d+$/); // an array index like '0' / '137' is the bug
  });

  it('a themed context can resolve a theme-matched title (not only generic fallbacks)', () => {
    /* Single real theme in the data => every themed context picks 'celtic';
       the only title is celtic-themed (no generic fallback), so it can ONLY
       appear when context.theme is the real theme 'celtic'. */
    const themedSource: ContentSource = {
      monsters: { fantasy: [{ name: 'Gronk' }] },
      names: {
        given: [
          { name: 'Generica', gender: 'female', theme: 'generic', genre: 'fantasy' },
          { name: 'Genericus', gender: 'male', theme: 'generic', genre: 'fantasy' },
          { name: 'Brigid', gender: 'female', theme: 'celtic', genre: 'fantasy' },
          { name: 'Cadogan', gender: 'male', theme: 'celtic', genre: 'fantasy' },
        ],
        surname: [],
        dungeonNamePrefixes: [],
        dungeonNameSuffixes: [],
      },
      titles: [
        { title: 'Ard Rí', category: 'nobility', theme: 'celtic', gender: 'neutral', placement: 'before' },
      ],
      tones: {}, loot: {}, places: {}, moods: [], activities: {}, traps: {},
    };
    const engine = createContentGenerator(themedSource);

    let sawCelticContext = false;
    let sawCelticTitle = false;
    for (let seed = 1; seed <= 400; seed++) {
      const context = engine.context(mulberry32(seed));
      if (context.theme === 'celtic') sawCelticContext = true;
      const title = engine.randomTitle(mulberry32(seed), context, 'female');
      if (title?.title === 'Ard Rí') sawCelticTitle = true;
    }
    expect(sawCelticContext).toBe(true);   // context selects the real theme
    expect(sawCelticTitle).toBe(true);     // and the theme-matched title actually resolves
  });
});

/* ------------------------------------------------------------------
   N11 — decorate honors "items only ever take an adjective". A tone
   whose `item` category has descriptions but NO adjectives must leave
   an item base undecorated (never appending a description), while a
   non-item category (place) still receives its description.
   ------------------------------------------------------------------ */
describe('decorate — item-adjective rule (N11)', () => {
  function itemRuleSource(): ContentSource {
    return {
      monsters: { fantasy: [{ name: 'Gronk' }] },
      names: { given: [], surname: [], dungeonNamePrefixes: [], dungeonNameSuffixes: [] },
      titles: [],
      // 'grim' item has descriptions but no adjectives; place has descriptions too.
      tones: {
        grim: {
          item: { descriptions: ['of doom'] },
          place: { descriptions: ['under a black sky'] },
        },
      },
      loot: { fantasy: { relic: ['orb'] } },
      places: { fantasy: ['crypt'] },
      moods: [],
      activities: {},
      traps: {},
    };
  }

  const engine = createContentGenerator(itemRuleSource());
  const grim: GenerationContext = { genre: 'fantasy', theme: null, tone: 'grim' };
  // Draws 0 → pick returns the first element; chance(p) → 0 < p is always true,
  // so the ~40% item-decorate and ~70% place-decorate paths both fire.
  const alwaysFirst = () => 0;

  it('leaves an item undecorated when its tone has descriptions but no adjectives', () => {
    // GATE 2b: without the `categoryName !== 'item'` guard this would be "orb of doom".
    expect(engine.randomItem(alwaysFirst, grim)).toBe('orb');
  });

  it('still appends a description for a non-item category (place)', () => {
    expect(engine.randomLocation(alwaysFirst, grim)).toBe('crypt under a black sky');
  });
});
