import {
  defaultContentGenerator,
  defaultTextGenerator as builtInTextGenerator,
  mulberry32,
  type ContentSource,
  type GenerationContext,
  type TextGenerator,
} from 'auto-stuff-generator';
import { createTextGenerator, defaultTextGenerator } from './index';

const BASELINE_SEEDS = [1, 2, 3, 5, 8, 13, 21, 42, 99, 1234, 31337, 0xc0ffee];
const CATEGORIES = ['place', 'monster', 'item', 'building', 'person', 'sound'];

function context(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return { genre: 'fantasy', theme: null, tone: 'eerie', ...overrides };
}

describe('createTextGenerator / defaultTextGenerator — behavior', () => {
  it('produces a location string for a populated genre', () => {
    expect(typeof defaultTextGenerator.generateLocation(mulberry32(7), context())).toBe('string');
  });

  it('returns null for a location when the genre has no places', () => {
    expect(defaultTextGenerator.generateLocation(mulberry32(7), context({ genre: 'no-such-genre' }))).toBeNull();
  });

  it('a flavor sentence is capitalized and period-terminated (or null)', () => {
    let sawSentence = false;
    for (const seed of BASELINE_SEEDS) {
      const flavor = defaultTextGenerator.generateFlavorSentence(mulberry32(seed), context());
      if (flavor !== null) {
        expect(flavor).toMatch(/^[A-Z].*\.$/);
        sawSentence = true;
      }
    }
    expect(sawSentence).toBe(true);
  });

  it('adjective/description are drawn from the active tone or null when absent', () => {
    const eerie = context({ tone: 'eerie' });
    expect(() => defaultTextGenerator.generateAdjective(mulberry32(1), eerie, 'place')).not.toThrow();
    // A tone that does not exist yields null for every category.
    expect(defaultTextGenerator.generateAdjective(mulberry32(1), context({ tone: 'no-such-tone' }), 'place')).toBeNull();
    expect(defaultTextGenerator.generateDescription(mulberry32(1), context({ tone: null }), 'place')).toBeNull();
  });

  it('is deterministic for the same seed and context', () => {
    for (const seed of BASELINE_SEEDS) {
      expect(defaultTextGenerator.generateFlavorSentence(mulberry32(seed), context()))
        .toEqual(defaultTextGenerator.generateFlavorSentence(mulberry32(seed), context()));
    }
  });
});

describe('createTextGenerator — usable strictly through the TextGenerator interface (conformance)', () => {
  it('the default is assignable to TextGenerator and only interface methods are needed', () => {
    const text: TextGenerator = defaultTextGenerator;
    const ctx = context();
    expect(() => text.generateAdjective(mulberry32(1), ctx, 'monster')).not.toThrow();
    expect(() => text.generateDescription(mulberry32(1), ctx, 'monster')).not.toThrow();
    expect(() => text.generateLocation(mulberry32(1), ctx)).not.toThrow();
    expect(() => text.generateFlavorSentence(mulberry32(1), ctx)).not.toThrow();
  });
});

describe('decorate — place decoration and the item-rule guard', () => {
  const alwaysFirst = () => 0; // pick → first element; chance(p) → 0 < p is always true

  it('appends a place description when the tone has one but no adjectives', () => {
    const source: Pick<ContentSource, 'tones' | 'places'> = {
      tones: { grim: { place: { descriptions: ['under a black sky'] } } },
      places: { fantasy: ['crypt'] },
    };
    expect(createTextGenerator(source).generateLocation(alwaysFirst, context({ tone: 'grim' })))
      .toBe('crypt under a black sky');
  });

  it('leaves a place undecorated when its tone has no place category', () => {
    const source: Pick<ContentSource, 'tones' | 'places'> = {
      tones: { grim: {} },
      places: { fantasy: ['crypt'] },
    };
    expect(createTextGenerator(source).generateLocation(alwaysFirst, context({ tone: 'grim' })))
      .toBe('crypt');
  });

  // NOTE: item decoration (the N11 "items only take an adjective" rule) is reachable
  // only through the loot generator's randomItem path, which lives in the contracts
  // package (auto-stuff-generator) until Change 14 — its guard is unit- and
  // mutation-tested there. TextGenerator.generateLocation only ever decorates the
  // 'place' category, so this package's decorate keeps the identical guard for
  // consistency and D5 equivalence, but the item branch is not reachable here.
});

/* Equivalence lock (design D5): the extracted default reproduces the built-in
   engine's text output byte-for-byte, so Change 15 can swap the dungeon's default
   wiring from the built-in engine to this package with no seeded-output change. */
describe('equivalence — extracted default reproduces the built-in engine text output', () => {
  it('adjective/description/location/flavor match the built-in over the baseline seeds', () => {
    for (const seed of BASELINE_SEEDS) {
      const ctx = defaultContentGenerator.context(mulberry32(seed));
      for (const category of CATEGORIES) {
        expect(defaultTextGenerator.generateAdjective(mulberry32(seed), ctx, category))
          .toEqual(defaultContentGenerator.toneAdjective(mulberry32(seed), ctx, category));
        expect(defaultTextGenerator.generateDescription(mulberry32(seed), ctx, category))
          .toEqual(defaultContentGenerator.toneDescription(mulberry32(seed), ctx, category));
      }
      expect(defaultTextGenerator.generateLocation(mulberry32(seed), ctx))
        .toEqual(defaultContentGenerator.randomLocation(mulberry32(seed), ctx));
      // Flavor composition matches the built-in default's generateFlavorSentence.
      expect(defaultTextGenerator.generateFlavorSentence(mulberry32(seed), ctx))
        .toEqual(builtInTextGenerator.generateFlavorSentence(mulberry32(seed), ctx));
    }
  });
});
