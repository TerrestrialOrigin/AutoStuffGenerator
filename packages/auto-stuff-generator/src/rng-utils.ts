/* ============================================================
   Shared RNG utilities used by both engines (dungeon + content).

   DETERMINISM CONTRACT: every helper consumes a FIXED number of
   draws from the supplied generator (documented per helper).
   Changing a helper's draw count changes every seeded output
   downstream — the golden-baseline spec will fail if that happens.
   ============================================================ */

/** A random-number generator returning a value in [0, 1). */
export type RandomNumberGenerator = () => number;

/** One draw from `random`, falling back to `Math.random` when none is supplied. */
export const randomFrom = (random?: RandomNumberGenerator): number =>
  (typeof random === 'function') ? random() : Math.random();

/**
 * A uniformly random element, or `null` for an empty/missing list.
 * Draws: exactly 1 when the list is non-empty, 0 otherwise.
 */
export const pick = <ItemType>(random: RandomNumberGenerator | undefined, list: readonly ItemType[] | null | undefined): ItemType | null =>
  (list && list.length) ? (list[Math.floor(randomFrom(random) * list.length)] ?? null) : null;

/** True with probability `probability`. Draws: exactly 1. */
export const chance = (random: RandomNumberGenerator | undefined, probability: number): boolean =>
  randomFrom(random) < probability;

/** A uniform integer in [min, max] inclusive. Draws: exactly 1. */
export const randomInt = (random: RandomNumberGenerator, min: number, max: number): number =>
  min + Math.floor(random() * (max - min + 1));

/** A uniform index into a list of `length` items. Draws: exactly 1. */
export const randomIndex = (random: RandomNumberGenerator, length: number): number =>
  Math.floor(random() * length);

/**
 * Fisher–Yates shuffle, mutating and returning `list`. Draws: length - 1 (0 for length < 2).
 *
 * `ItemType extends NonNullable<unknown>` (non-nullish, primitives included) forbids a
 * `(T | undefined)[]` input: a genuine `undefined` element could otherwise hit the in-range
 * guard below and be silently skipped, biasing the shuffle. With the constraint, elements are
 * never `undefined`, so the guard is provably dead (it only satisfies noUncheckedIndexedAccess).
 */
export const shuffleInPlace = <ItemType extends NonNullable<unknown>>(random: RandomNumberGenerator, list: ItemType[]): ItemType[] => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomIndex(random, i + 1);
    const atI = list[i];
    const atJ = list[j];
    // 0 <= j <= i < length, so both reads are in range and (given ItemType extends {})
    // never undefined; this guard is unreachable and exists only for noUncheckedIndexedAccess.
    if (atI === undefined || atJ === undefined) continue;
    list[i] = atJ;
    list[j] = atI;
  }
  return list;
};

/** The text with its first character upper-cased (empty text unchanged). Draws: 0. */
export const capitalizeFirst = (text: string): string =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
