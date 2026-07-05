/* ============================================================
   RPG-GEN — reusable random content generator.

   createRPGGen(source) builds a content engine over any
   ContentSource (loot/tones/places/monsters/moods/activities/
   titles/names); the exported RPGGen is that engine bound to the
   built-in RPG data.

   Every generator takes an optional rng (a 0..1 function — pass a
   seeded one for reproducibility; defaults to Math.random) and a
   context from context(rng). The context fixes one genre, an
   optional theme and a tone for the whole dungeon so results stay
   coherent (no Count Jacob meeting Imam Josh).

   DETERMINISM: helpers draw from the rng in a fixed order and
   count (see rng-utils). Any edit that changes when a draw happens
   changes every seeded output — the golden-baseline spec locks this.
   ============================================================ */
import type { ContentSource, MonsterEntry, TitleEntry, ToneCategory } from './content-types';
import { RPG } from './data';
import { capitalizeFirst, chance, pick, type RNG } from './rng-utils';

/** A random-number generator returning a value in [0, 1) — canonical declaration in rng-utils. */
export type { RNG } from './rng-utils';

export interface RPGContext {
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

/** Build a content engine bound to the given source (default: built-in RPG data). */
export const createRPGGen = (source: ContentSource = RPG) => {
  const monsterPool = (ctx: RPGContext, includeAnimals: boolean): MonsterEntry[] =>
    genrePool(source.monsters, ctx.genre).filter((monster) => !monster.a || includeAnimals || isVermin(monster.n));

  /* FIXME(theme-pool): `names.given` is an ARRAY, so these keys are numeric
     index strings, not theme names — a "themed" context therefore almost never
     matches an entry's `theme`. Preserved verbatim (including the key filter)
     because fixing it changes every seeded output; see golden-baseline.spec.ts.
     Track as its own future bug-fix change. */
  const themePool = (): string[] =>
    Object.keys(source.names.given).filter((key) => key !== 'generic' && key !== 'modern');

  /* one coherent context for a whole dungeon */
  const context = (rng?: RNG): RPGContext => {
    const genre = pick(rng, GENRES) ?? GENRES[0]; // GENRES is non-empty; fallback never fires
    const theme = chance(rng, 0.15) ? pick(rng, themePool()) : null;   // ~15% themed
    const tone = pick(rng, Object.keys(source.tones));
    return { genre, theme, tone };
  };

  const toneCategory = (ctx: RPGContext, categoryName: string): ToneCategory | undefined =>
    ctx.tone ? source.tones[ctx.tone]?.[categoryName] : undefined;

  /* attach a tone descriptor: adjective goes BEFORE, description goes AFTER */
  const decorate = (rng: RNG | undefined, base: string, categoryName: string, ctx: RPGContext): string => {
    const category = toneCategory(ctx, categoryName);
    if (!category) return base;
    const hasDescriptions = !!(category.desc && category.desc.length);
    const useAdjective = !!(category.adj && category.adj.length)
      && (categoryName === 'item' || !hasDescriptions || chance(rng, 0.55));
    if (useAdjective) return capitalizeFirst(pick(rng, category.adj) ?? '') + ' ' + base; // adjective BEFORE (items only ever use adjectives)
    if (hasDescriptions) return base + ' ' + pick(rng, category.desc);                    // description AFTER
    return base;
  };

  /* ---- items / loot ---- */
  const randomItem = (rng?: RNG, maybeContext?: RPGContext): string | null => {
    const ctx = maybeContext || context(rng);
    const genreLoot = source.loot[ctx.genre];
    if (!genreLoot) return null;
    const categoryName = pick(rng, Object.keys(genreLoot));
    let base = categoryName ? pick(rng, genreLoot[categoryName]) : null;
    if (base && chance(rng, 0.40)) base = decorate(rng, base, 'item', ctx);   // ~40% get a descriptor/adjective
    return base;
  };

  /* ---- places / locations ---- */
  const randomLocation = (rng?: RNG, maybeContext?: RPGContext): string | null => {
    const ctx = maybeContext || context(rng);
    let base = pick(rng, source.places[ctx.genre] || []);
    if (!base) return null;
    if (chance(rng, 0.70)) base = decorate(rng, base, 'place', ctx);          // ~70% get a descriptor/adjective
    return base;
  };

  /* ---- monsters ---- */
  const randomMonster = (rng?: RNG, maybeContext?: RPGContext): string | null => {
    const ctx = maybeContext || context(rng);
    const monster = pick(rng, monsterPool(ctx, false));   // proper monsters + dungeon vermin; no stray deer/hawks
    if (!monster) return null;
    if (monster.a) return monster.n;                                          // animals: no mood/action (a hawk can't sharpen a knife)
    const mood = chance(rng, 0.20) ? pick(rng, source.moods) : null;          // ~20% a mood
    const action = chance(rng, 0.20) ? pick(rng, genrePool(source.activities, ctx.genre)) : null; // ~20% an action
    let described = monster.n;
    if (mood) described = capitalizeFirst(String(mood).toLowerCase()) + ' ' + described;  // mood before:  "Happy Troll"
    if (action) described = described + ', ' + String(action).toLowerCase();              // action after: "Happy Troll, cleaning a sword"
    return capitalizeFirst(described);
  };

  /* any animal for the genre (kept for future outdoor/wilderness generation; not used in dungeons) */
  const randomAnimal = (rng?: RNG, maybeContext?: RPGContext): string | null => {
    const ctx = maybeContext || context(rng);
    const animals = genrePool(source.monsters, ctx.genre).filter((monster) => monster.a);
    const animal = pick(rng, animals);
    return animal ? animal.n : null;
  };

  /* ---- names (people) ---- */
  const randomTitle = (rng: RNG | undefined, ctx: RPGContext, gender: string): TitleEntry | null => {
    const matching = source.titles.filter((titleEntry) => {
      const themeMatches = (titleEntry.theme === 'generic') || (!!ctx.theme && titleEntry.theme === ctx.theme);
      const genderMatches = (titleEntry.gender === gender) || (titleEntry.gender === 'neutral');
      return themeMatches && genderMatches;
    });
    return matching.length ? pick(rng, matching) : null;
  };

  const randomName = (rng?: RNG, maybeContext?: RPGContext): string | null => {
    const ctx = maybeContext || context(rng);
    const given = source.names.given;
    if (!given.length) return null;
    const gender = chance(rng, 0.5) ? 'male' : 'female';
    const pool = (strictTheme: boolean) =>
      given.filter((nameEntry) => {
        if (nameEntry.g !== gender) return false;
        const genreMatches = nameEntry.genre === 'generic' || nameEntry.genre === ctx.genre;
        const themeMatches = nameEntry.theme === 'generic' || (!!ctx.theme && nameEntry.theme === ctx.theme);
        return strictTheme ? (genreMatches && themeMatches) : genreMatches;
      });
    const first = pick(rng, pool(true)) || pick(rng, pool(false)) || pick(rng, given);
    if (!first) return null;
    let name: string = first.n;
    const surnames = source.names.surname.filter((surnameEntry) =>
      surnameEntry.genre === 'generic' || surnameEntry.genre === ctx.genre);
    if (surnames.length && chance(rng, 0.40)) {
      const surname = pick(rng, surnames);
      if (surname) name += ' ' + surname.n;
    }
    if (chance(rng, 0.20)) {                                                 // ~20% get a title (theme-matched)
      const title = randomTitle(rng, ctx, gender);
      if (title) name = (title.placement === 'after') ? (name + ' ' + title.title) : (title.title + ' ' + name);
    }
    return name;
  };

  const randomMood = (rng?: RNG): string | null => pick(rng, source.moods);
  const randomActivity = (rng?: RNG, maybeContext?: RPGContext): string | null => {
    const ctx = maybeContext || context(rng);
    return pick(rng, genrePool(source.activities, ctx.genre));
  };

  /* a raw tone descriptor phrase for a category ('place','sound','monster','item','building','person') */
  const toneDesc = (rng: RNG | undefined, ctx: RPGContext, categoryName: string): string | null => {
    const category = toneCategory(ctx, categoryName);
    if (!category || !category.desc || !category.desc.length) return null;
    return pick(rng, category.desc);
  };
  const toneAdj = (rng: RNG | undefined, ctx: RPGContext, categoryName: string): string | null => {
    const category = toneCategory(ctx, categoryName);
    if (!category || !category.adj || !category.adj.length) return null;
    return pick(rng, category.adj);
  };

  /* ---- traps ---- */
  const randomTrap = (rng?: RNG, maybeContext?: RPGContext): string | null => {
    const ctx = maybeContext || context(rng);
    return pick(rng, genrePool(source.traps, ctx.genre));
  };

  return {
    context,
    randomItem,
    randomLocation,
    randomMonster,
    randomName,
    randomTitle,
    randomTrap,
    toneDesc,
    toneAdj,
    randomMood,
    randomActivity,
    randomAnimal,
    monsterPool,
    genres: GENRES,
  };
};

/** The content engine bound to the built-in RPG data. */
export const RPGGen = createRPGGen();

export type RPGGenType = typeof RPGGen;
