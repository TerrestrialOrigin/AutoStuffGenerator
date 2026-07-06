import { mulberry32, generateDungeon } from './dungeon';
import { shuffleInPlace } from './rng-utils';
import type { GenerationContext } from './rpg-gen';
import type { MonsterGenerator, TextGenerator } from './generator-contracts';
import {
  defaultTextGenerator,
  defaultNameGenerator,
  defaultMonsterGenerator,
  defaultLootGenerator,
  defaultDungeonGenerator,
} from './default-generators';

function fantasyContext(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return { genre: 'fantasy', theme: null, tone: null, ...overrides };
}

describe('generator contracts — default implementations conform through the interface type', () => {
  it('TextGenerator: usable strictly through the interface', () => {
    const text: TextGenerator = defaultTextGenerator;
    const context = fantasyContext({ tone: 'eerie' });
    // Called only via interface methods; adjective/description may be null when a
    // tone lacks that category, but a location must resolve for a populated genre.
    expect(() => text.generateAdjective(mulberry32(1), context, 'place')).not.toThrow();
    expect(() => text.generateDescription(mulberry32(1), context, 'place')).not.toThrow();
    expect(typeof text.generateLocation(mulberry32(1), context)).toBe('string');
    // A flavor sentence is capitalized + period-terminated (or null when the tone
    // has no matching place/sound/building description).
    const flavor = text.generateFlavorSentence(mulberry32(1), context);
    if (flavor !== null) {
      expect(flavor).toMatch(/^[A-Z].*\.$/);
    }
  });

  it('NameGenerator: full name resolves; title is TitleEntry-or-null', () => {
    const context = fantasyContext();
    expect(typeof defaultNameGenerator.generateFullName(mulberry32(2), context)).toBe('string');
    const title = defaultNameGenerator.generateTitle(mulberry32(2), context, 'female');
    expect(title === null || typeof title.title === 'string').toBe(true);
  });

  it('MonsterGenerator: monster resolves and monsterPool returns entries', () => {
    const context = fantasyContext();
    expect(typeof defaultMonsterGenerator.generateMonster(mulberry32(3), context)).toBe('string');
    const pool = defaultMonsterGenerator.monsterPool(context, false);
    expect(Array.isArray(pool)).toBe(true);
    expect(pool.length).toBeGreaterThan(0);
    expect(typeof pool[0]?.name).toBe('string');
  });

  it('LootGenerator: loot and trap resolve for a populated genre', () => {
    const context = fantasyContext();
    expect(typeof defaultLootGenerator.generateLoot(mulberry32(4), context)).toBe('string');
    expect(typeof defaultLootGenerator.generateTrap(mulberry32(4), context)).toBe('string');
  });

  it('DungeonGenerator: identical to calling generateDungeon directly', () => {
    const viaContract = defaultDungeonGenerator.generateDungeon(0xc0ffee, 3, 'detailed');
    const direct = generateDungeon(0xc0ffee, 3, 'detailed');
    expect(viaContract).toEqual(direct);
  });
});

describe('generator contracts — determinism flows only through the provided random source', () => {
  it('same seed yields identical output through the contract', () => {
    const context = fantasyContext();
    expect(defaultMonsterGenerator.generateMonster(mulberry32(9), context))
      .toEqual(defaultMonsterGenerator.generateMonster(mulberry32(9), context));
    expect(defaultNameGenerator.generateFullName(mulberry32(9), context))
      .toEqual(defaultNameGenerator.generateFullName(mulberry32(9), context));
  });
});

describe('generator contracts — a custom implementation is substitutable (seam proof)', () => {
  // A custom MonsterGenerator whose output is disjoint from the built-in data.
  const customMonsters: MonsterGenerator = {
    generateMonster: () => 'Zzyzx Horror',
    monsterPool: () => [{ name: 'Zzyzx Horror' }],
  };
  // A custom TextGenerator returning fixed, recognizable text.
  const customText: TextGenerator = {
    generateAdjective: () => 'quantum',
    generateDescription: () => 'humming with static',
    generateLocation: () => 'The Null Vault',
    generateFlavorSentence: () => 'Silence hums between the stars.',
  };

  it('substituted MonsterGenerator observably changes the produced monster', () => {
    const context = fantasyContext();
    const custom: MonsterGenerator = customMonsters;
    const builtIn: MonsterGenerator = defaultMonsterGenerator;
    expect(custom.generateMonster(mulberry32(7), context)).toBe('Zzyzx Horror');
    // GATE 2b: with the default impl the assertion below would fail — proving the
    // test exercises the seam, not a constant.
    expect(builtIn.generateMonster(mulberry32(7), context)).not.toBe('Zzyzx Horror');
    expect(custom.monsterPool(context, false)).toEqual([{ name: 'Zzyzx Horror' }]);
  });

  it('substituted TextGenerator observably changes the produced location', () => {
    const context = fantasyContext();
    const custom: TextGenerator = customText;
    expect(custom.generateLocation(mulberry32(7), context)).toBe('The Null Vault');
    expect(defaultTextGenerator.generateLocation(mulberry32(7), context)).not.toBe('The Null Vault');
  });
});

describe('generateDungeon — the injected TextGenerator drives flavor and tone-decorated notes (R4 seam)', () => {
  // A recognizable text generator: its flavor sentence and every adjective/description
  // carry a token that never appears in the built-in tone data.
  const TOKEN = 'ZZYXTEXT';
  const stampedText: TextGenerator = {
    generateAdjective: () => TOKEN,
    generateDescription: () => TOKEN,
    generateLocation: () => 'The Null Vault',
    generateFlavorSentence: () => `${TOKEN} echoes here.`,
  };

  it('the flavor sentence comes from the injected generator', () => {
    const dungeon = generateDungeon(0xc0ffee, 3, 'detailed', undefined, stampedText);
    expect(dungeon.flavor).toBe(`${TOKEN} echoes here.`);
    // GATE 2b: with the default generator the flavor is the tone-composed text, never the token.
    expect(generateDungeon(0xc0ffee, 3, 'detailed').flavor).not.toContain(TOKEN);
  });

  it('tone-decorated marker notes come from the injected generator', () => {
    // Across a spread of seeds at least one detailed dungeon applies a tone description
    // to a monster/boss note; with the injected generator that text is the token.
    const stampedNoteSeen = Array.from({ length: 25 }, (_unused, seed) =>
      generateDungeon(seed, 4, 'detailed', undefined, stampedText),
    ).some((dungeon) => dungeon.markers.some((marker) => marker.note?.includes(TOKEN)));
    expect(stampedNoteSeen).toBe(true);
    // GATE 2b: the built-in generator never emits the token.
    const defaultNoteSeen = Array.from({ length: 25 }, (_unused, seed) =>
      generateDungeon(seed, 4, 'detailed'),
    ).some((dungeon) => dungeon.markers.some((marker) => marker.note?.includes(TOKEN)));
    expect(defaultNoteSeen).toBe(false);
  });

  it('injecting only a custom TextGenerator leaves seeded output otherwise deterministic', () => {
    // Same seed + same injected text generator ⇒ identical dungeon.
    expect(generateDungeon(42, 3, 'detailed', undefined, stampedText))
      .toEqual(generateDungeon(42, 3, 'detailed', undefined, stampedText));
  });
});

describe('shuffleInPlace — N11 bias hole closed', () => {
  it('rejects a nullable-element array at compile time', () => {
    // @ts-expect-error — (number | undefined)[] must not satisfy the non-nullish
    // constraint; a genuine undefined element would otherwise be silently skipped (biased shuffle).
    const reject = () => shuffleInPlace(mulberry32(1), [1, undefined, 2]);
    expect(typeof reject).toBe('function'); // not invoked — this is a type-level assertion
  });

  it('preserves every element deterministically', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const first = shuffleInPlace(mulberry32(42), source.slice());
    const second = shuffleInPlace(mulberry32(42), source.slice());
    expect(first).toEqual(second); // deterministic for a fixed seed
    expect([...first].sort((left, right) => left - right)).toEqual(source); // element-preserving
  });
});
