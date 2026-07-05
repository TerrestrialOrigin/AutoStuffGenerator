/* ============================================================
   Shared RNG utilities used by both engines (dungeon + content).

   DETERMINISM CONTRACT: every helper consumes a FIXED number of
   draws from the supplied rng (documented per helper). Changing a
   helper's draw count changes every seeded output downstream —
   the golden-baseline spec will fail if that happens.
   ============================================================ */

/** A random-number generator returning a value in [0, 1). */
export type RNG = () => number;

/** One draw from `rng`, falling back to `Math.random` when none is supplied. */
export const randomFrom = (rng?: RNG): number =>
  (typeof rng === 'function') ? rng() : Math.random();

/**
 * A uniformly random element, or `null` for an empty/missing list.
 * Draws: exactly 1 when the list is non-empty, 0 otherwise.
 */
export const pick = <ItemType>(rng: RNG | undefined, list: readonly ItemType[] | null | undefined): ItemType | null =>
  (list && list.length) ? (list[Math.floor(randomFrom(rng) * list.length)] ?? null) : null;

/** True with probability `probability`. Draws: exactly 1. */
export const chance = (rng: RNG | undefined, probability: number): boolean =>
  randomFrom(rng) < probability;

/** A uniform integer in [min, max] inclusive. Draws: exactly 1. */
export const randomInt = (rng: RNG, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

/** A uniform index into a list of `length` items. Draws: exactly 1. */
export const randomIndex = (rng: RNG, length: number): number =>
  Math.floor(rng() * length);

/** Fisher–Yates shuffle, mutating and returning `list`. Draws: length - 1 (0 for length < 2). */
export const shuffleInPlace = <ItemType>(rng: RNG, list: ItemType[]): ItemType[] => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomIndex(rng, i + 1);
    const atI = list[i];
    const atJ = list[j];
    // i > 0 and 0 <= j <= i < length, so both reads are in range; the guard is
    // unreachable and exists only to satisfy noUncheckedIndexedAccess.
    if (atI === undefined || atJ === undefined) continue;
    list[i] = atJ;
    list[j] = atI;
  }
  return list;
};

/** The text with its first character upper-cased (empty text unchanged). Draws: 0. */
export const capitalizeFirst = (text: string): string =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
