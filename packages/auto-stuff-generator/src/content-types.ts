/* ============================================================
   Typed contract for the content the generation engine draws from.

   Every field is a self-documenting name; the built-in content
   files and any external content a consumer supplies conform to
   these shapes.
   ============================================================ */

/** Content pools keyed by genre (plus an optional shared `generic` pool). */
export type GenreMap<EntryType> = Partial<Record<string, EntryType[]>>;

export interface MonsterEntry {
  /** Display name of the creature. */
  name: string;
  /** Truthy when the entry is an animal (excluded from dungeon spawns unless vermin). */
  isAnimal?: number | boolean;
}

export interface GivenNameEntry {
  /** The given name itself. */
  name: string;
  /** Gender the name is used for. */
  gender: 'male' | 'female';
  /** Cultural theme pool (`generic` matches every context). */
  theme: string;
  /** Genre pool (`generic` matches every context). */
  genre: string;
}

export interface SurnameEntry {
  /** The surname itself. */
  name: string;
  /** Genre pool (`generic` matches every context). */
  genre: string;
}

export interface NamesTable {
  given: GivenNameEntry[];
  surname: SurnameEntry[];
  /** Stock dungeon-name prefixes (e.g. "The Sunken"), composed with a suffix by the dungeon-name generators. */
  dungeonNamePrefixes: string[];
  /** Stock dungeon-name suffixes (e.g. "Vaults"), composed after a prefix by the dungeon-name generators. */
  dungeonNameSuffixes: string[];
}

export interface TitleEntry {
  /** The title text, e.g. "Countess". */
  title: string;
  /** Grouping such as `courtesy` or `nobility` (informational). */
  category: string;
  /** Cultural theme pool (`generic` matches every context). */
  theme: string;
  /** Gender the title applies to (`neutral` matches both). */
  gender: 'male' | 'female' | 'neutral';
  /** Whether the title goes before or after the name. */
  placement: 'before' | 'after';
}

/** Adjectives (used before a base phrase) and descriptions (appended after). */
export interface ToneCategory {
  adjectives?: string[];
  descriptions?: string[];
}

/** One tone's phrase pools, keyed by category (`place`, `sound`, `monster`, `item`, `building`, `person`). */
export type ToneTable = Partial<Record<string, ToneCategory>>;

/**
 * Everything the content engine reads. Pass a custom source to
 * `createContentGenerator` to swap content; spread the built-in
 * `defaultContent` object to customize a single bucket:
 * `createContentGenerator({ ...defaultContent, monsters: mine })`.
 *
 * SECURITY NOTE: the engine passes these strings through verbatim — it
 * makes no sanitization promise. A consumer rendering generated text
 * into HTML must escape it at the rendering boundary.
 */
export interface ContentSource {
  monsters: GenreMap<MonsterEntry>;
  names: NamesTable;
  titles: TitleEntry[];
  tones: Record<string, ToneTable>;
  loot: Partial<Record<string, Record<string, string[]>>>;
  places: GenreMap<string>;
  moods: string[];
  activities: GenreMap<string>;
  traps: GenreMap<string>;
}
