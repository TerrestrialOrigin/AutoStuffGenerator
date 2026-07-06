/* ============================================================
   Content generator — reusable random content engine.

   createContentGenerator(source) builds a content engine over any
   ContentSource (loot/tones/places/monsters/moods/activities/
   titles/names); the exported defaultContentGenerator is that
   engine bound to the built-in defaultContent data.

   Every generator takes an optional random-number generator (a
   0..1 function — pass a seeded one for reproducibility; defaults
   to Math.random) and a context from context(random). The context
   fixes one genre, an optional theme and a tone for the whole
   dungeon so results stay coherent (no Count Jacob meeting Imam
   Josh).

   DETERMINISM: helpers draw from the generator in a fixed order and
   count (see rng-utils). Any edit that changes when a draw happens
   changes every seeded output — the golden-baseline spec locks this.
   ============================================================ */
import type { ContentSource, MonsterEntry, TitleEntry, ToneCategory } from './content-types';
import { defaultContent } from './data';
import { capitalizeFirst, chance, pick, type RandomNumberGenerator } from './rng-utils';

/** A random-number generator returning a value in [0, 1) — canonical declaration in rng-utils. */
export type { RandomNumberGenerator } from './rng-utils';

export interface GenerationContext {
  genre: string;
  theme: string | null;
  tone: string | null;
}

const GENRES = ['fantasy', 'sci-fi', 'modern', 'horror'] as const;

/** The genre's pool merged with any shared "generic" pool. */
const genrePool = <EntryType>(map: Partial<Record<string, EntryType[]>>, genre: string): EntryType[] =>
  (map[genre] || []).concat(map.generic || []);

// dungeon-appropriate vermin (allowed as regular monsters, never bosses); other animals are excluded from dungeon gen
const VERMIN: Record<string, number> = { rat:1, spider:1, snake:1, bat:1, scorpion:1, centipede:1, serpent:1, viper:1, cobra:1, python:1, worm:1, leech:1, slug:1, toad:1, beetle:1, roach:1, cockroach:1, maggot:1, adder:1, mamba:1, rattlesnake:1 };
export const isVermin = (name: string): boolean =>
  String(name).toLowerCase().split(/[^a-z]+/).some((word) => !!(word && (VERMIN[word] || VERMIN[word.replace(/s$/, '')])));

/** Build a content engine bound to the given source (default: built-in defaultContent data). */
export const createContentGenerator = (source: ContentSource = defaultContent) => {
  const monsterPool = (context: GenerationContext, includeAnimals: boolean): MonsterEntry[] =>
    genrePool(source.monsters, context.genre).filter((monster) => !monster.isAnimal || includeAnimals || isVermin(monster.name));

  /* The distinct real cultural themes present in the name data, excluding the
     always-matching 'generic' pool. (`theme` is a value on each entry, NOT a
     key: `names.given` is an array, so Object.keys would yield array indices.) */
  const themePool = (): string[] =>
    [...new Set(source.names.given.map((nameEntry) => nameEntry.theme))].filter((theme) => theme !== 'generic');

  /* one coherent context for a whole dungeon */
  const context = (random?: RandomNumberGenerator): GenerationContext => {
    const genre = pick(random, GENRES) ?? GENRES[0]; // GENRES is non-empty; fallback never fires
    const theme = chance(random, 0.15) ? pick(random, themePool()) : null;   // ~15% themed
    const tone = pick(random, Object.keys(source.tones));
    return { genre, theme, tone };
  };

  // Alias so a generator whose own `context` parameter shadows the factory can
  // still fall back to building a fresh context when none is passed.
  const makeContext = context;

  const toneCategory = (context: GenerationContext, categoryName: string): ToneCategory | undefined =>
    context.tone ? source.tones[context.tone]?.[categoryName] : undefined;

  /* attach a tone descriptor: adjective goes BEFORE, description goes AFTER.
     Items ONLY ever take an adjective — never a description — so an item whose
     tone lacks adjectives is returned undecorated (the `categoryName !== 'item'`
     guard on the description branch enforces this rule for every content source). */
  const decorate = (random: RandomNumberGenerator | undefined, base: string, categoryName: string, context: GenerationContext): string => {
    const category = toneCategory(context, categoryName);
    if (!category) return base;
    const hasDescriptions = !!(category.descriptions && category.descriptions.length);
    const useAdjective = !!(category.adjectives && category.adjectives.length)
      && (categoryName === 'item' || !hasDescriptions || chance(random, 0.55));
    if (useAdjective) return capitalizeFirst(pick(random, category.adjectives) ?? '') + ' ' + base; // adjective BEFORE (items only ever use adjectives)
    if (hasDescriptions && categoryName !== 'item') return base + ' ' + pick(random, category.descriptions); // description AFTER (never for items)
    return base;
  };

  /* ---- items / loot ---- */
  const randomItem = (random?: RandomNumberGenerator, maybeContext?: GenerationContext): string | null => {
    const context = maybeContext || makeContext(random);
    const genreLoot = source.loot[context.genre];
    if (!genreLoot) return null;
    const categoryName = pick(random, Object.keys(genreLoot));
    let base = categoryName ? pick(random, genreLoot[categoryName]) : null;
    if (base && chance(random, 0.40)) base = decorate(random, base, 'item', context);   // ~40% get a descriptor/adjective
    return base;
  };

  /* ---- places / locations ---- */
  const randomLocation = (random?: RandomNumberGenerator, maybeContext?: GenerationContext): string | null => {
    const context = maybeContext || makeContext(random);
    let base = pick(random, source.places[context.genre] || []);
    if (!base) return null;
    if (chance(random, 0.70)) base = decorate(random, base, 'place', context);          // ~70% get a descriptor/adjective
    return base;
  };

  /* ---- monsters ---- */
  const randomMonster = (random?: RandomNumberGenerator, maybeContext?: GenerationContext): string | null => {
    const context = maybeContext || makeContext(random);
    const monster = pick(random, monsterPool(context, false));   // proper monsters + dungeon vermin; no stray deer/hawks
    if (!monster) return null;
    if (monster.isAnimal) return monster.name;                                // animals: no mood/action (a hawk can't sharpen a knife)
    const mood = chance(random, 0.20) ? pick(random, source.moods) : null;          // ~20% a mood
    const action = chance(random, 0.20) ? pick(random, genrePool(source.activities, context.genre)) : null; // ~20% an action
    let described = monster.name;
    if (mood) described = capitalizeFirst(String(mood).toLowerCase()) + ' ' + described;  // mood before:  "Happy Troll"
    if (action) described = described + ', ' + String(action).toLowerCase();              // action after: "Happy Troll, cleaning a sword"
    return capitalizeFirst(described);
  };

  /* any animal for the genre (kept for future outdoor/wilderness generation; not used in dungeons) */
  const randomAnimal = (random?: RandomNumberGenerator, maybeContext?: GenerationContext): string | null => {
    const context = maybeContext || makeContext(random);
    const animals = genrePool(source.monsters, context.genre).filter((monster) => monster.isAnimal);
    const animal = pick(random, animals);
    return animal ? animal.name : null;
  };

  /* ---- names (people) ---- */
  const randomTitle = (random: RandomNumberGenerator | undefined, context: GenerationContext, gender: string): TitleEntry | null => {
    const matching = source.titles.filter((titleEntry) => {
      const themeMatches = (titleEntry.theme === 'generic') || (!!context.theme && titleEntry.theme === context.theme);
      const genderMatches = (titleEntry.gender === gender) || (titleEntry.gender === 'neutral');
      return themeMatches && genderMatches;
    });
    return matching.length ? pick(random, matching) : null;
  };

  const randomName = (random?: RandomNumberGenerator, maybeContext?: GenerationContext): string | null => {
    const context = maybeContext || makeContext(random);
    const given = source.names.given;
    if (!given.length) return null;
    const gender = chance(random, 0.5) ? 'male' : 'female';
    const pool = (strictTheme: boolean) =>
      given.filter((nameEntry) => {
        if (nameEntry.gender !== gender) return false;
        const genreMatches = nameEntry.genre === 'generic' || nameEntry.genre === context.genre;
        const themeMatches = nameEntry.theme === 'generic' || (!!context.theme && nameEntry.theme === context.theme);
        return strictTheme ? (genreMatches && themeMatches) : genreMatches;
      });
    const first = pick(random, pool(true)) || pick(random, pool(false)) || pick(random, given);
    if (!first) return null;
    let name: string = first.name;
    const surnames = source.names.surname.filter((surnameEntry) =>
      surnameEntry.genre === 'generic' || surnameEntry.genre === context.genre);
    if (surnames.length && chance(random, 0.40)) {
      const surname = pick(random, surnames);
      if (surname) name += ' ' + surname.name;
    }
    if (chance(random, 0.20)) {                                                 // ~20% get a title (theme-matched)
      const title = randomTitle(random, context, gender);
      if (title) name = (title.placement === 'after') ? (name + ' ' + title.title) : (title.title + ' ' + name);
    }
    return name;
  };

  const randomMood = (random?: RandomNumberGenerator): string | null => pick(random, source.moods);
  const randomActivity = (random?: RandomNumberGenerator, maybeContext?: GenerationContext): string | null => {
    const context = maybeContext || makeContext(random);
    return pick(random, genrePool(source.activities, context.genre));
  };

  /* a raw tone descriptor phrase for a category ('place','sound','monster','item','building','person') */
  const toneDescription = (random: RandomNumberGenerator | undefined, context: GenerationContext, categoryName: string): string | null => {
    const category = toneCategory(context, categoryName);
    if (!category || !category.descriptions || !category.descriptions.length) return null;
    return pick(random, category.descriptions);
  };
  const toneAdjective = (random: RandomNumberGenerator | undefined, context: GenerationContext, categoryName: string): string | null => {
    const category = toneCategory(context, categoryName);
    if (!category || !category.adjectives || !category.adjectives.length) return null;
    return pick(random, category.adjectives);
  };

  /* ---- traps ---- */
  const randomTrap = (random?: RandomNumberGenerator, maybeContext?: GenerationContext): string | null => {
    const context = maybeContext || makeContext(random);
    return pick(random, genrePool(source.traps, context.genre));
  };

  return {
    context,
    randomItem,
    randomLocation,
    randomMonster,
    randomName,
    randomTitle,
    randomTrap,
    toneDescription,
    toneAdjective,
    randomMood,
    randomActivity,
    randomAnimal,
    monsterPool,
    genres: GENRES,
  };
};

/** The content engine bound to the built-in defaultContent data. */
export const defaultContentGenerator = createContentGenerator();

export type ContentGeneratorType = typeof defaultContentGenerator;
