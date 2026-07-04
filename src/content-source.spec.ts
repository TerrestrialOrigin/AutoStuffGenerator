import type { ContentSource } from './content-types';
import { RPG } from './data';
import { mulberry32 } from './dungeon';
import { createRPGGen, RPGGen, type RPGContext } from './rpg-gen';

/** A minimal source whose every string is disjoint from the built-in data. */
function customSource(): ContentSource {
  return {
    monsters: {
      fantasy: [{ n: 'Zorbulon' }, { n: 'Vexling' }, { n: 'Snarfblat' }],
      generic: [{ n: 'Quibberjaw' }],
    },
    names: {
      given: [
        { n: 'Xantippa', g: 'female', theme: 'generic', genre: 'generic' },
        { n: 'Borvexus', g: 'male', theme: 'generic', genre: 'generic' },
      ],
      surname: [{ n: 'Zumblefog', genre: 'generic' }],
    },
    titles: [
      { title: 'Grand Zibbler', category: 'custom', theme: 'generic', gender: 'neutral', placement: 'before' },
    ],
    tones: {
      zesty: { place: { adj: ['zibberish'], desc: ['dripping with zest'] } },
    },
    loot: { fantasy: { oddities: ['Wobbly Sprocket', 'Glimmering Doohickey'] } },
    places: { fantasy: ['Zorp Cavern', 'Vex Hollow'] },
    moods: ['Zonked'],
    activities: { generic: ['zibbling quietly'] },
    traps: { fantasy: ['Zapper Snare'] },
  };
}

function fantasyContext(): RPGContext {
  return { genre: 'fantasy', theme: null, tone: null };
}

const builtInMonsterNames = new Set(
  Object.values(RPG.monsters).flat().map((monsterEntry) => monsterEntry.n.toLowerCase()),
);

describe('createRPGGen — custom source changes output (seam mutation check)', () => {
  it('draws monsters only from the custom pool, never the built-in data', () => {
    const engine = createRPGGen(customSource());
    const customNames = ['zorbulon', 'vexling', 'snarfblat', 'quibberjaw'];
    for (let seed = 1; seed <= 50; seed++) {
      const monster = engine.randomMonster(mulberry32(seed), fantasyContext());
      expect(monster).toBeTruthy();
      const monsterText = String(monster).toLowerCase();
      expect(customNames.some((name) => monsterText.includes(name))).toBe(true);
      for (const builtInName of builtInMonsterNames) {
        // guard against decorated output smuggling a built-in base name in
        expect(monsterText.startsWith(builtInName)).toBe(false);
      }
    }
  });

  it('draws items, places, traps and names only from the custom pools', () => {
    const engine = createRPGGen(customSource());
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed);
      const context = fantasyContext();
      expect(engine.randomItem(rng, context)).toMatch(/Sprocket|Doohickey/);
      expect(engine.randomLocation(rng, context)).toMatch(/Zorp Cavern|Vex Hollow/);
      expect(engine.randomTrap(rng, context)).toBe('Zapper Snare');
      expect(engine.randomName(rng, context)).toMatch(/^(Grand Zibbler )?(Xantippa|Borvexus)( Zumblefog)?( Grand Zibbler)?$/);
    }
  });

  it('builds contexts from the custom tone table', () => {
    const engine = createRPGGen(customSource());
    for (let seed = 1; seed <= 10; seed++) {
      expect(engine.context(mulberry32(seed)).tone).toBe('zesty');
    }
  });
});

describe('createRPGGen — default source preserved', () => {
  it('RPGGen and createRPGGen() produce identical seeded output', () => {
    const defaulted = createRPGGen();
    for (const seed of [1, 42, 31337]) {
      expect(defaulted.context(mulberry32(seed))).toEqual(RPGGen.context(mulberry32(seed)));
      const context = RPGGen.context(mulberry32(seed));
      expect(defaulted.randomMonster(mulberry32(seed), context)).toEqual(RPGGen.randomMonster(mulberry32(seed), context));
      expect(defaulted.randomName(mulberry32(seed), context)).toEqual(RPGGen.randomName(mulberry32(seed), context));
      expect(defaulted.randomItem(mulberry32(seed), context)).toEqual(RPGGen.randomItem(mulberry32(seed), context));
    }
  });
});

describe('createRPGGen — empty custom pools degrade gracefully', () => {
  it('returns null (and never throws) when the active genre has no content', () => {
    const emptySource: ContentSource = {
      monsters: {},
      names: { given: [], surname: [] },
      titles: [],
      tones: {},
      loot: {},
      places: {},
      moods: [],
      activities: {},
      traps: {},
    };
    const engine = createRPGGen(emptySource);
    const rng = mulberry32(7);
    const context = fantasyContext();
    expect(engine.randomMonster(rng, context)).toBeNull();
    expect(engine.randomItem(rng, context)).toBeNull();
    expect(engine.randomLocation(rng, context)).toBeNull();
    expect(engine.randomName(rng, context)).toBeNull();
    expect(engine.randomTrap(rng, context)).toBeNull();
    expect(engine.randomMood(rng)).toBeNull();
    expect(engine.randomActivity(rng, context)).toBeNull();
    expect(engine.randomAnimal(rng, context)).toBeNull();
    expect(engine.randomTitle(rng, context, 'female')).toBeNull();
    expect(engine.toneAdj(rng, context, 'place')).toBeNull();
    expect(engine.toneDesc(rng, context, 'place')).toBeNull();
    expect(() => engine.context(rng)).not.toThrow();
  });
});

describe('ContentSource — malformed sources are rejected at compile time', () => {
  it('flags a missing required field on a source entry', () => {
    const malformed = {
      ...customSource(),
      // @ts-expect-error — a monster entry must carry its display name `n`
      monsters: { fantasy: [{ a: 1 }] },
    } satisfies ContentSource;
    expect(malformed).toBeDefined();
  });

  it('flags a missing content bucket', () => {
    const source = customSource();
    const withoutTraps: Omit<ContentSource, 'traps'> = {
      monsters: source.monsters,
      names: source.names,
      titles: source.titles,
      tones: source.tones,
      loot: source.loot,
      places: source.places,
      moods: source.moods,
      activities: source.activities,
    };
    // @ts-expect-error — every bucket is required; ContentSource without traps must not compile
    const malformed: ContentSource = withoutTraps;
    expect(malformed).toBeDefined();
  });
});
