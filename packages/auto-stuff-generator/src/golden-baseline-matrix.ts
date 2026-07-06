/* ============================================================
   Shared definition of the golden-baseline matrix, used by both
   the baseline generator script and the locking spec so the two
   can never drift apart.

   The content-generator capture threads ONE random-number
   generator through a fixed call sequence per seed, so it locks
   both each generator's output and the cross-call draw ordering.
   ============================================================ */
import { mulberry32 } from './dungeon';
import type { DungeonMode } from './dungeon-types';
import { defaultContentGenerator } from './rpg-gen';

export const BASELINE_DUNGEON_SEEDS: readonly number[] =
  [0, 1, 2, 7, 42, 1337, 31337, 424242, 0xc0ffee, 987654321];
export const BASELINE_DUNGEON_LEVELS: readonly number[] = [1, 2, 3, 4, 5, 6];
export const BASELINE_DUNGEON_MODES: readonly DungeonMode[] = ['empty', 'full', 'detailed'];

export const BASELINE_CONTENT_GENERATOR_SEEDS: readonly number[] =
  [1, 2, 3, 5, 8, 13, 21, 42, 99, 1234, 31337, 0xc0ffee];

export const dungeonBaselineKey = (seed: number, level: number, mode: DungeonMode): string =>
  `${seed}/${level}/${mode}`;

/** Fixed generator call sequence sharing one random-number generator — any draw-order drift shows up. */
export const captureContentGeneratorSequence = (seed: number): unknown[] => {
  const random = mulberry32(seed);
  const context = defaultContentGenerator.context(random);
  return [
    context.genre, context.theme, context.tone,
    defaultContentGenerator.randomItem(random, context),
    defaultContentGenerator.randomLocation(random, context),
    defaultContentGenerator.randomMonster(random, context),
    defaultContentGenerator.randomName(random, context),
    defaultContentGenerator.randomTrap(random, context),
    defaultContentGenerator.randomMood(random),
    defaultContentGenerator.randomActivity(random, context),
    defaultContentGenerator.randomAnimal(random, context),
    defaultContentGenerator.toneAdjective(random, context, 'place'),
    defaultContentGenerator.toneDescription(random, context, 'monster'),
    defaultContentGenerator.randomTitle(random, context, 'female'),
    defaultContentGenerator.randomName(random, context),
    defaultContentGenerator.randomItem(random, context),
  ];
};
