/* ============================================================
   Typed contract for the content the RPGGen engine draws from.

   The short field names (`n`, `g`, `a`) are the SERIALIZED DATA
   SCHEMA shared by all existing content files and any external
   content a consumer supplies — renaming them would break that
   data, so each carries a doc comment instead. Engine-level code
   uses full names.
   ============================================================ */

/** Content pools keyed by genre (plus an optional shared `generic` pool). */
export type GenreMap<EntryType> = Partial<Record<string, EntryType[]>>;

export interface MonsterEntry {
  /** Display name of the creature. */
  n: string;
  /** Truthy when the entry is an animal (excluded from dungeon spawns unless vermin). */
  a?: number | boolean;
}

export interface GivenNameEntry {
  /** The given name itself. */
  n: string;
  /** Gender the name is used for. */
  g: 'male' | 'female';
  /** Cultural theme pool (`generic` matches every context). */
  theme: string;
  /** Genre pool (`generic` matches every context). */
  genre: string;
}

export interface SurnameEntry {
  /** The surname itself. */
  n: string;
  /** Genre pool (`generic` matches every context). */
  genre: string;
}

export interface NamesTable {
  given: GivenNameEntry[];
  surname: SurnameEntry[];
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
  adj?: string[];
  desc?: string[];
}

/** One tone's phrase pools, keyed by category (`place`, `sound`, `monster`, `item`, `building`, `person`). */
export type ToneTable = Partial<Record<string, ToneCategory>>;

/**
 * Everything the content engine reads. Pass a custom source to
 * `createRPGGen` to swap content; spread the built-in `RPG` object to
 * customize a single bucket: `createRPGGen({ ...RPG, monsters: mine })`.
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
