/* ============================================================
   Golden-baseline generator (determinism lock).

   Captures the library's seeded output as data so refactors can
   prove themselves behavior-preserving: dungeons as sha256 hashes
   of their serialized JSON across a seeds x levels x modes matrix,
   and the content engine's raw output sequences per seed.

   Run against a KNOWN-GOOD revision only, from the repo root
   (output lands relative to the current working directory):
     npx esbuild --bundle scripts/generate-golden-baseline.ts \
       --outfile=/tmp/generate-golden-baseline.cjs --format=cjs --platform=node
     node /tmp/generate-golden-baseline.cjs

   Output: src/__fixtures__/golden-baseline.json, asserted by
   src/golden-baseline.spec.ts on every test run.
   ============================================================ */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BASELINE_DUNGEON_LEVELS,
  BASELINE_DUNGEON_MODES,
  BASELINE_DUNGEON_SEEDS,
  BASELINE_CONTENT_GENERATOR_SEEDS,
  captureContentGeneratorSequence,
  dungeonBaselineKey,
} from '../src/golden-baseline-matrix';
import { generateDungeon } from '../src/dungeon';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const dungeonHashes: Record<string, string> = {};
for (const seed of BASELINE_DUNGEON_SEEDS) {
  for (const level of BASELINE_DUNGEON_LEVELS) {
    for (const mode of BASELINE_DUNGEON_MODES) {
      dungeonHashes[dungeonBaselineKey(seed, level, mode)] =
        sha256(JSON.stringify(generateDungeon(seed, level, mode)));
    }
  }
}

const contentGeneratorSequences: Record<string, unknown[]> = {};
for (const seed of BASELINE_CONTENT_GENERATOR_SEEDS) {
  contentGeneratorSequences[String(seed)] = captureContentGeneratorSequence(seed);
}

const baseline = { dungeonHashes, contentGeneratorSequences };
if (!existsSync(join(process.cwd(), 'src'))) {
  throw new Error('Run from the auto-stuff-generator repo root (no src/ directory here).');
}
const outputPath = join(process.cwd(), 'src', '__fixtures__', 'golden-baseline.json');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(baseline, null, 2) + '\n');
console.log(
  `Wrote ${Object.keys(dungeonHashes).length} dungeon hashes and ` +
  `${Object.keys(contentGeneratorSequences).length} content-generator sequences to ${outputPath}`,
);
