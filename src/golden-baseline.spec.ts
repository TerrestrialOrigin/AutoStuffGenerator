/* ============================================================
   Determinism lock (design.md D7).

   Asserts the library reproduces, byte-for-byte, the seeded
   output captured in src/__fixtures__/golden-baseline.json by
   scripts/generate-golden-baseline.ts at a known-good revision.

   If this fails, a refactor changed the RNG draw order or the
   generated output. That is a defect unless the change EXPLICITLY
   intends a behavioral shift — in which case regenerate the
   baseline (see the script header) and flag downstream consumers
   whose seed-derived fixtures must be regenerated too.
   ============================================================ */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASELINE_DUNGEON_LEVELS,
  BASELINE_DUNGEON_MODES,
  BASELINE_DUNGEON_SEEDS,
  BASELINE_RPGGEN_SEEDS,
  captureRpgGenSequence,
  dungeonBaselineKey,
} from './golden-baseline-matrix';
import { generateDungeon } from './dungeon';

interface GoldenBaseline {
  dungeonHashes: Record<string, string>;
  rpgGenSequences: Record<string, unknown[]>;
}

const baseline: GoldenBaseline = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'golden-baseline.json'), 'utf8'),
);

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('golden baseline — dungeon output is byte-identical to the locked revision', () => {
  const expectedCombos = BASELINE_DUNGEON_SEEDS.length * BASELINE_DUNGEON_LEVELS.length * BASELINE_DUNGEON_MODES.length;

  it(`covers the full ${expectedCombos}-combo matrix`, () => {
    expect(Object.keys(baseline.dungeonHashes).length).toBe(expectedCombos);
  });

  it.each(
    BASELINE_DUNGEON_SEEDS.flatMap((seed) =>
      BASELINE_DUNGEON_LEVELS.flatMap((level) =>
        BASELINE_DUNGEON_MODES.map((mode) => [seed, level, mode] as const))),
  )('seed %d / level %d / mode %s', (seed, level, mode) => {
    const hash = sha256(JSON.stringify(generateDungeon(seed, level, mode)));
    expect(hash).toBe(baseline.dungeonHashes[dungeonBaselineKey(seed, level, mode)]);
  });
});

describe('golden baseline — RPGGen sequences reproduce the locked revision', () => {
  it.each(BASELINE_RPGGEN_SEEDS.map((seed) => [seed] as const))('seed %d', (seed) => {
    expect(captureRpgGenSequence(seed)).toEqual(baseline.rpgGenSequences[String(seed)]);
  });
});
