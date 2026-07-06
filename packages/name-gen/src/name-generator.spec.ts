import {
  defaultContent,
  defaultContentGenerator,
  mulberry32,
  type GenerationContext,
  type NameGenerator,
} from 'auto-stuff-generator';
import { createNameGenerator, defaultNameGenerator, type NameContentSource } from './index';

const BASELINE_SEEDS = [1, 2, 3, 5, 8, 13, 21, 42, 99, 1234, 31337, 0xc0ffee];

function context(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return { genre: 'fantasy', theme: null, tone: null, ...overrides };
}

function customSource(): NameContentSource {
  return {
    names: {
      given: [
        { name: 'Fantasia', gender: 'female', theme: 'generic', genre: 'fantasy' },
        { name: 'Fantasio', gender: 'male', theme: 'generic', genre: 'fantasy' },
        { name: 'Brigid', gender: 'female', theme: 'celtic', genre: 'fantasy' },
        { name: 'Modernus', gender: 'male', theme: 'generic', genre: 'modern' },
      ],
      surname: [
        { name: 'Fantberg', genre: 'fantasy' },
        { name: 'Modberg', genre: 'modern' },
      ],
      dungeonNamePrefixes: ['The Improbable'],
      dungeonNameSuffixes: ['Snorkelry'],
    },
    titles: [
      { title: 'Dame', category: 'nobility', theme: 'generic', gender: 'female', placement: 'before' },
      { title: 'the Bold', category: 'epithet', theme: 'generic', gender: 'neutral', placement: 'after' },
      { title: 'Ard Rí', category: 'nobility', theme: 'celtic', gender: 'neutral', placement: 'before' },
    ],
  };
}

describe('createNameGenerator / defaultNameGenerator — behavior', () => {
  it('produces a full name from the built-in data', () => {
    expect(typeof defaultNameGenerator.generateFullName(mulberry32(2), context())).toBe('string');
  });

  it('draws given names only from the active genre pools, bare of surname/title', () => {
    const names = createNameGenerator(customSource());
    for (let seed = 1; seed <= 120; seed++) {
      expect(names.generateGivenName(mulberry32(seed), context())).toMatch(/^(Fantasia|Fantasio)$/);
    }
  });

  it('genre-filters surnames and gender-matches titles in full names', () => {
    const names = createNameGenerator(customSource());
    let surnameSeen = false;
    for (let seed = 1; seed <= 400; seed++) {
      const fullName = names.generateFullName(mulberry32(seed), context()) as string;
      expect(fullName).not.toMatch(/Modernus|Modberg/); // wrong-genre pools never leak
      if (fullName.includes('Fantberg')) surnameSeen = true;
      if (fullName.includes('Dame')) expect(fullName).toMatch(/Fantasia/); // female-only title
    }
    expect(surnameSeen).toBe(true); // the ~40% surname path actually occurs
  });

  it('theme-matches titles: a themed context can resolve its theme-only title', () => {
    const names = createNameGenerator(customSource());
    const celtic = context({ theme: 'celtic' });
    let celticTitleSeen = false;
    for (let seed = 1; seed <= 200; seed++) {
      const title = names.generateTitle(mulberry32(seed), celtic, 'female');
      if (title?.title === 'Ard Rí') celticTitleSeen = true;
      expect(title === null || typeof title.title === 'string').toBe(true);
    }
    expect(celticTitleSeen).toBe(true);
    // An unthemed context never resolves the celtic-only title.
    for (let seed = 1; seed <= 200; seed++) {
      expect(names.generateTitle(mulberry32(seed), context(), 'female')?.title).not.toBe('Ard Rí');
    }
  });

  it('composes the stock dungeon name from the fragment pools', () => {
    const names = createNameGenerator(customSource());
    expect(names.generateDungeonName(mulberry32(1), context())).toBe('The Improbable Snorkelry');
  });

  it('returns null from every generator when the pools are empty', () => {
    const empty = createNameGenerator({
      names: { given: [], surname: [], dungeonNamePrefixes: [], dungeonNameSuffixes: [] },
      titles: [],
    });
    expect(empty.generateFullName(mulberry32(1), context())).toBeNull();
    expect(empty.generateGivenName(mulberry32(1), context())).toBeNull();
    expect(empty.generateTitle(mulberry32(1), context(), 'female')).toBeNull();
    expect(empty.generateDungeonName(mulberry32(1), context())).toBeNull();
    expect(empty.availableThemes()).toEqual([]);
  });

  it('is deterministic for the same seed and context', () => {
    for (const seed of BASELINE_SEEDS) {
      expect(defaultNameGenerator.generateFullName(mulberry32(seed), context()))
        .toEqual(defaultNameGenerator.generateFullName(mulberry32(seed), context()));
    }
  });
});

describe('createNameGenerator — usable strictly through the NameGenerator interface (conformance)', () => {
  it('the default is assignable to NameGenerator and only interface methods are needed', () => {
    const names: NameGenerator = defaultNameGenerator;
    const ctx = context();
    expect(() => names.generateFullName(mulberry32(1), ctx)).not.toThrow();
    expect(() => names.generateTitle(mulberry32(1), ctx, 'male')).not.toThrow();
    expect(() => names.generateGivenName(mulberry32(1), ctx)).not.toThrow();
    expect(() => names.generateDungeonName(mulberry32(1), ctx)).not.toThrow();
    expect(() => names.availableThemes()).not.toThrow();
  });
});

/* DB-1 theme-validity lock (this package's own guard): availableThemes must
   yield REAL cultural theme names. The regression it locks out: enumerating
   the keys of the given-name ARRAY yields numeric indices ('0'…'137'), which
   match no entry's theme, silently breaking themed names and titles. */
describe('availableThemes — DB-1 theme-validity lock', () => {
  it('every theme is a real theme name, generic excluded, known themes present', () => {
    const themes = defaultNameGenerator.availableThemes();
    expect(themes.length).toBeGreaterThan(0);
    expect(themes).toContain('french'); // a known real theme in the built-in data
    expect(themes).not.toContain('generic');
    for (const theme of themes) {
      expect(theme).not.toMatch(/^\d+$/); // an array index like '0' / '137' is the bug
      expect(defaultContent.names.given.some((nameEntry) => nameEntry.theme === theme)).toBe(true);
    }
  });
});

/* Equivalence lock (design D6): the extracted default reproduces the built-in
   engine's name output byte-for-byte, so Change 15 can swap the dungeon's default
   wiring from the built-in engine to this package with no seeded-output change. */
describe('equivalence — extracted default reproduces the built-in engine name output', () => {
  it('full/given/title/dungeon-name/themes match the built-in over the baseline seeds', () => {
    for (const seed of BASELINE_SEEDS) {
      const ctx = defaultContentGenerator.context(mulberry32(seed));
      expect(defaultNameGenerator.generateFullName(mulberry32(seed), ctx))
        .toEqual(defaultContentGenerator.randomName(mulberry32(seed), ctx));
      expect(defaultNameGenerator.generateGivenName(mulberry32(seed), ctx))
        .toEqual(defaultContentGenerator.randomGivenName(mulberry32(seed), ctx));
      expect(defaultNameGenerator.generateTitle(mulberry32(seed), ctx, 'female'))
        .toEqual(defaultContentGenerator.randomTitle(mulberry32(seed), ctx, 'female'));
      expect(defaultNameGenerator.generateTitle(mulberry32(seed), ctx, 'male'))
        .toEqual(defaultContentGenerator.randomTitle(mulberry32(seed), ctx, 'male'));
      expect(defaultNameGenerator.generateDungeonName(mulberry32(seed), ctx))
        .toEqual(defaultContentGenerator.randomDungeonName(mulberry32(seed)));
    }
    expect(defaultNameGenerator.availableThemes()).toEqual(defaultContentGenerator.themePool());
  });
});
