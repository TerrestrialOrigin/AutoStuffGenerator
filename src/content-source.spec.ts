import type { ContentSource } from './content-types';
import { defaultContent } from './data';
import { mulberry32 } from './dungeon';
import { createContentGenerator, defaultContentGenerator, type GenerationContext } from './rpg-gen';

/** A minimal source whose every string is disjoint from the built-in data. */
function customSource(): ContentSource {
  return {
    monsters: {
      fantasy: [{ name: 'Zorbulon' }, { name: 'Vexling' }, { name: 'Snarfblat' }],
      generic: [{ name: 'Quibberjaw' }],
    },
    names: {
      given: [
        { name: 'Xantippa', gender: 'female', theme: 'generic', genre: 'generic' },
        { name: 'Borvexus', gender: 'male', theme: 'generic', genre: 'generic' },
      ],
      surname: [{ name: 'Zumblefog', genre: 'generic' }],
    },
    titles: [
      { title: 'Grand Zibbler', category: 'custom', theme: 'generic', gender: 'neutral', placement: 'before' },
    ],
    tones: {
      zesty: { place: { adjectives: ['zibberish'], descriptions: ['dripping with zest'] } },
    },
    loot: { fantasy: { oddities: ['Wobbly Sprocket', 'Glimmering Doohickey'] } },
    places: { fantasy: ['Zorp Cavern', 'Vex Hollow'] },
    moods: ['Zonked'],
    activities: { generic: ['zibbling quietly'] },
    traps: { fantasy: ['Zapper Snare'] },
  };
}

function fantasyContext(): GenerationContext {
  return { genre: 'fantasy', theme: null, tone: null };
}

const builtInMonsterNames = new Set(
  Object.values(defaultContent.monsters).flat().map((monsterEntry) => monsterEntry.name.toLowerCase()),
);

describe('createContentGenerator — custom source changes output (seam mutation check)', () => {
  it('draws monsters only from the custom pool, never the built-in data', () => {
    const engine = createContentGenerator(customSource());
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
    const engine = createContentGenerator(customSource());
    for (let seed = 1; seed <= 30; seed++) {
      const random = mulberry32(seed);
      const context = fantasyContext();
      expect(engine.randomItem(random, context)).toMatch(/Sprocket|Doohickey/);
      expect(engine.randomLocation(random, context)).toMatch(/Zorp Cavern|Vex Hollow/);
      expect(engine.randomTrap(random, context)).toBe('Zapper Snare');
      expect(engine.randomName(random, context)).toMatch(/^(Grand Zibbler )?(Xantippa|Borvexus)( Zumblefog)?( Grand Zibbler)?$/);
    }
  });

  it('builds contexts from the custom tone table', () => {
    const engine = createContentGenerator(customSource());
    for (let seed = 1; seed <= 10; seed++) {
      expect(engine.context(mulberry32(seed)).tone).toBe('zesty');
    }
  });
});

describe('createContentGenerator — default source preserved', () => {
  it('defaultContentGenerator and createContentGenerator() produce identical seeded output', () => {
    const defaulted = createContentGenerator();
    for (const seed of [1, 42, 31337]) {
      expect(defaulted.context(mulberry32(seed))).toEqual(defaultContentGenerator.context(mulberry32(seed)));
      const context = defaultContentGenerator.context(mulberry32(seed));
      expect(defaulted.randomMonster(mulberry32(seed), context)).toEqual(defaultContentGenerator.randomMonster(mulberry32(seed), context));
      expect(defaulted.randomName(mulberry32(seed), context)).toEqual(defaultContentGenerator.randomName(mulberry32(seed), context));
      expect(defaulted.randomItem(mulberry32(seed), context)).toEqual(defaultContentGenerator.randomItem(mulberry32(seed), context));
    }
  });
});

describe('createContentGenerator — empty custom pools degrade gracefully', () => {
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
    const engine = createContentGenerator(emptySource);
    const random = mulberry32(7);
    const context = fantasyContext();
    expect(engine.randomMonster(random, context)).toBeNull();
    expect(engine.randomItem(random, context)).toBeNull();
    expect(engine.randomLocation(random, context)).toBeNull();
    expect(engine.randomName(random, context)).toBeNull();
    expect(engine.randomTrap(random, context)).toBeNull();
    expect(engine.randomMood(random)).toBeNull();
    expect(engine.randomActivity(random, context)).toBeNull();
    expect(engine.randomAnimal(random, context)).toBeNull();
    expect(engine.randomTitle(random, context, 'female')).toBeNull();
    expect(engine.toneAdjective(random, context, 'place')).toBeNull();
    expect(engine.toneDescription(random, context, 'place')).toBeNull();
    expect(() => engine.context(random)).not.toThrow();
  });
});

describe('ContentSource — malformed sources are rejected at compile time', () => {
  it('flags a missing required field on a source entry', () => {
    const malformed = {
      ...customSource(),
      // @ts-expect-error — a monster entry must carry its display name `name`
      monsters: { fantasy: [{ isAnimal: 1 }] },
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
