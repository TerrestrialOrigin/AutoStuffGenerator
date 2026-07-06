/* ============================================================
   auto-stuff-name-gen — default NameGenerator implementation.

   Self-contained person/dungeon naming: given names from
   genre/theme pools, full names (given + optional surname +
   optional title), theme- and gender-filtered titles, stock
   dungeon names ("The Sunken Vaults"), and the real-theme
   enumeration. Implements the `NameGenerator` contract from
   auto-stuff-generator and depends ONLY on that contracts
   package — never on a sibling implementation.

   DETERMINISM: every helper draws a fixed number of times from the
   supplied RandomNumberGenerator (via the shared rng helpers), so
   identical seeds yield identical names. This is the extracted,
   canonical copy of the built-in engine's name logic; it MUST stay
   byte-identical to it (locked by the equivalence spec).
   ============================================================ */
import {
  chance,
  pick,
  type ContentSource,
  type GenerationContext,
  type GivenNameEntry,
  type NameGenerator,
  type RandomNumberGenerator,
  type TitleEntry,
} from 'auto-stuff-generator';

/** The content slice a NameGenerator reads: the names table and the title pool. */
export type NameContentSource = Pick<ContentSource, 'names' | 'titles'>;

/** Composition probabilities — identical to the built-in engine's inline values. */
const MALE_GIVEN_NAME_CHANCE = 0.5;
const SURNAME_CHANCE = 0.40;
const TITLE_CHANCE = 0.20;

/** Build a NameGenerator bound to the given names/titles content slice. */
export const createNameGenerator = (source: NameContentSource): NameGenerator => {
  /* The themed given-name pick shared by the full-name and given-name paths.
     Draw order: strict genre+theme pool, then genre-only pool, then the whole
     table — one pick draw per non-empty attempted pool. */
  const pickGivenNameEntry = (random: RandomNumberGenerator, context: GenerationContext, gender: string): GivenNameEntry | null => {
    const given = source.names.given;
    const pool = (strictTheme: boolean) =>
      given.filter((nameEntry) => {
        if (nameEntry.gender !== gender) return false;
        const genreMatches = nameEntry.genre === 'generic' || nameEntry.genre === context.genre;
        const themeMatches = nameEntry.theme === 'generic' || (!!context.theme && nameEntry.theme === context.theme);
        return strictTheme ? (genreMatches && themeMatches) : genreMatches;
      });
    return pick(random, pool(true)) || pick(random, pool(false)) || pick(random, given);
  };

  const generateTitle = (random: RandomNumberGenerator, context: GenerationContext, gender: string): TitleEntry | null => {
    const matching = source.titles.filter((titleEntry) => {
      const themeMatches = (titleEntry.theme === 'generic') || (!!context.theme && titleEntry.theme === context.theme);
      const genderMatches = (titleEntry.gender === gender) || (titleEntry.gender === 'neutral');
      return themeMatches && genderMatches;
    });
    return matching.length ? pick(random, matching) : null;
  };

  const generateGivenName = (random: RandomNumberGenerator, context: GenerationContext): string | null => {
    if (!source.names.given.length) return null;
    const gender = chance(random, MALE_GIVEN_NAME_CHANCE) ? 'male' : 'female';
    const entry = pickGivenNameEntry(random, context, gender);
    return entry ? entry.name : null;
  };

  const generateFullName = (random: RandomNumberGenerator, context: GenerationContext): string | null => {
    const given = source.names.given;
    if (!given.length) return null;
    const gender = chance(random, MALE_GIVEN_NAME_CHANCE) ? 'male' : 'female';
    const first = pickGivenNameEntry(random, context, gender);
    if (!first) return null;
    let name: string = first.name;
    const surnames = source.names.surname.filter((surnameEntry) =>
      surnameEntry.genre === 'generic' || surnameEntry.genre === context.genre);
    if (surnames.length && chance(random, SURNAME_CHANCE)) {
      const surname = pick(random, surnames);
      if (surname) name += ' ' + surname.name;
    }
    if (chance(random, TITLE_CHANCE)) {                                        // ~20% get a title (theme-matched)
      const title = generateTitle(random, context, gender);
      if (title) name = (title.placement === 'after') ? (name + ' ' + title.title) : (title.title + ' ' + name);
    }
    return name;
  };

  /* a stock dungeon name from the names table's fragment pools, e.g. "The Sunken Vaults";
     one pick draw per non-empty pool, null when both pools are empty. The contract passes a
     context so custom implementations can be genre-aware; this default composition is
     genre-agnostic, so the narrower signature still satisfies `NameGenerator`. */
  const generateDungeonName = (random: RandomNumberGenerator): string | null => {
    const prefix = pick(random, source.names.dungeonNamePrefixes);
    const suffix = pick(random, source.names.dungeonNameSuffixes);
    if (prefix === null && suffix === null) return null;
    return (prefix ?? '') + ' ' + (suffix ?? '');
  };

  /* The distinct real cultural themes present in the given-name data, excluding the
     always-matching 'generic' sentinel. (`theme` is a value on each entry, NOT a key —
     the DB-1 lesson: enumerating keys of the array yields numeric indices.) */
  const availableThemes = (): string[] =>
    [...new Set(source.names.given.map((nameEntry) => nameEntry.theme))].filter((theme) => theme !== 'generic');

  return { generateFullName, generateTitle, generateGivenName, generateDungeonName, availableThemes };
};
