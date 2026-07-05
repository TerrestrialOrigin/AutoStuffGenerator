import { chance, pick, randomFrom, randomIndex, randomInt, shuffleInPlace, capitalizeFirst, type RNG } from './rng-utils';

/** An rng that counts its draws and yields a fixed cycle of values. */
function countingRng(values: number[] = [0.5]): { rng: RNG; draws: () => number } {
  let drawCount = 0;
  const rng = () => values[drawCount++ % values.length] ?? 0; // values is non-empty; index is always in range
  return { rng, draws: () => drawCount };
}

describe('rng-utils — draw-count contract (determinism depends on these)', () => {
  it('pick draws exactly once for a non-empty list', () => {
    const { rng, draws } = countingRng();
    pick(rng, ['a', 'b', 'c']);
    expect(draws()).toBe(1);
  });

  it('pick draws zero times and returns null for empty or missing lists', () => {
    const { rng, draws } = countingRng();
    expect(pick(rng, [])).toBeNull();
    expect(pick(rng, null)).toBeNull();
    expect(pick(rng, undefined)).toBeNull();
    expect(draws()).toBe(0);
  });

  it('chance draws exactly once', () => {
    const { rng, draws } = countingRng([0.3]);
    expect(chance(rng, 0.5)).toBe(true);
    expect(chance(rng, 0.2)).toBe(false);
    expect(draws()).toBe(2);
  });

  it('randomInt draws exactly once and spans the inclusive range', () => {
    const { rng, draws } = countingRng([0, 0.999]);
    expect(randomInt(rng, 2, 5)).toBe(2);
    expect(randomInt(rng, 2, 5)).toBe(5);
    expect(draws()).toBe(2);
  });

  it('randomIndex draws exactly once', () => {
    const { rng, draws } = countingRng([0.999]);
    expect(randomIndex(rng, 4)).toBe(3);
    expect(draws()).toBe(1);
  });

  it('shuffleInPlace draws length-1 times and keeps the same members', () => {
    const { rng, draws } = countingRng([0.1, 0.7, 0.4, 0.9]);
    const list = [1, 2, 3, 4, 5];
    const shuffled = shuffleInPlace(rng, list);
    expect(shuffled).toBe(list); // mutates in place
    expect(draws()).toBe(4);
    expect([...shuffled].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('shuffleInPlace draws zero times for lists shorter than two', () => {
    const { rng, draws } = countingRng();
    shuffleInPlace(rng, []);
    shuffleInPlace(rng, [1]);
    expect(draws()).toBe(0);
  });
});

describe('rng-utils — value behavior', () => {
  it('randomFrom uses the supplied rng and falls back to Math.random', () => {
    expect(randomFrom(() => 0.25)).toBe(0.25);
    const fallback = randomFrom();
    expect(fallback).toBeGreaterThanOrEqual(0);
    expect(fallback).toBeLessThan(1);
  });

  it('pick returns the element the draw selects', () => {
    expect(pick(() => 0, ['first', 'second'])).toBe('first');
    expect(pick(() => 0.99, ['first', 'second'])).toBe('second');
  });

  it('capitalizeFirst upper-cases only the first character and passes empty text through', () => {
    expect(capitalizeFirst('troll king')).toBe('Troll king');
    expect(capitalizeFirst('')).toBe('');
  });
});
