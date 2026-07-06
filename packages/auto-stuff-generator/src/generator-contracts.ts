/* ============================================================
   Generator plugin contracts — the abstract interfaces every
   generator implementation codes to.

   This is the nucleus of the future contracts package: a third
   party can implement any interface below (e.g. their own
   MonsterGenerator) and inject it wherever that contract is
   expected, with no dependency on the built-in implementations.

   DETERMINISM CONTRACT: every method that produces randomized
   output takes a RandomNumberGenerator and MUST draw randomness
   ONLY from it (never Math.random or ambient state), so identical
   seeds yield identical output.

   These interfaces are intentionally NARROW — each method maps to a
   real, currently-reachable capability derived from actual call
   sites. Additional methods (e.g. flavor-sentence composition, name
   decoration, theme enumeration) are introduced in the changes that
   extract and build their owning implementation package, so the
   contract never advertises surface no implementation yet backs.
   ============================================================ */
import type { MonsterEntry, TitleEntry } from './content-types';
import type { DungeonMode, DungeonResult } from './dungeon-types';
import type { GenerationContext } from './rpg-gen';
import type { RandomNumberGenerator } from './rng-utils';

/** Tone-driven text: adjectives, descriptions, location names, and flavor sentences. */
export interface TextGenerator {
  /** A tone-appropriate adjective for a category (`place`, `monster`, …), or `null`. */
  generateAdjective(random: RandomNumberGenerator, context: GenerationContext, category: string): string | null;
  /** A tone-appropriate trailing description for a category, or `null`. */
  generateDescription(random: RandomNumberGenerator, context: GenerationContext, category: string): string | null;
  /** A place/location name for the context's genre, optionally decorated, or `null`. */
  generateLocation(random: RandomNumberGenerator, context: GenerationContext): string | null;
  /**
   * A single tone-flavored sentence describing a place — e.g. "Hallways where wind
   * howls." — capitalized and period-terminated, or `null` when the tone has no
   * matching place/sound/building description. Draws only from `random`.
   */
  generateFlavorSentence(random: RandomNumberGenerator, context: GenerationContext): string | null;
}

/** People names and titles. */
export interface NameGenerator {
  /** A full person name (given, optional surname, optional title), or `null`. */
  generateFullName(random: RandomNumberGenerator, context: GenerationContext): string | null;
  /** A theme- and gender-appropriate title, or `null` when none matches. */
  generateTitle(random: RandomNumberGenerator, context: GenerationContext, gender: string): TitleEntry | null;
}

/** Creatures and the creature pool for a context. */
export interface MonsterGenerator {
  /** A monster for the context's genre (optionally moody/active), or `null`. */
  generateMonster(random: RandomNumberGenerator, context: GenerationContext): string | null;
  /** The monster entries eligible for the context (animals included only when requested/vermin). */
  monsterPool(context: GenerationContext, includeAnimals: boolean): MonsterEntry[];
}

/** Hazards and rewards: loot items and traps. */
export interface LootGenerator {
  /** A loot item for the context's genre, optionally decorated, or `null`. */
  generateLoot(random: RandomNumberGenerator, context: GenerationContext): string | null;
  /** A trap for the context's genre, or `null`. */
  generateTrap(random: RandomNumberGenerator, context: GenerationContext): string | null;
}

/** The procedural dungeon generator itself. */
export interface DungeonGenerator {
  /**
   * Generate a self-contained, serializable dungeon for a seed.
   * `level` defaults to a mid value; `mode` defaults to `full`.
   * (The injected-generators `options` form arrives when wiring flips
   * in the dungeon-generator extraction — this shape matches how
   * consumers call it today.)
   */
  generateDungeon(seed: number, level?: number, mode?: DungeonMode): DungeonResult;
}
