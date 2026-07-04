/* ============================================================
   Shared definition of the golden-baseline matrix, used by both
   the baseline generator script and the locking spec so the two
   can never drift apart.

   The RPGGen capture threads ONE rng through a fixed call
   sequence per seed, so it locks both each generator's output
   and the cross-call draw ordering.
   ============================================================ */
import { mulberry32 } from './dungeon';
import type { DungeonMode } from './dungeon-types';
import { RPGGen } from './rpg-gen';

export const BASELINE_DUNGEON_SEEDS: readonly number[] =
  [0, 1, 2, 7, 42, 1337, 31337, 424242, 0xc0ffee, 987654321];
export const BASELINE_DUNGEON_LEVELS: readonly number[] = [1, 2, 3, 4, 5, 6];
export const BASELINE_DUNGEON_MODES: readonly DungeonMode[] = ['empty', 'full', 'detailed'];

export const BASELINE_RPGGEN_SEEDS: readonly number[] =
  [1, 2, 3, 5, 8, 13, 21, 42, 99, 1234, 31337, 0xc0ffee];

export const dungeonBaselineKey = (seed: number, level: number, mode: DungeonMode): string =>
  `${seed}/${level}/${mode}`;

/** Fixed generator call sequence sharing one rng — any draw-order drift shows up. */
export const captureRpgGenSequence = (seed: number): unknown[] => {
  const rng = mulberry32(seed);
  const context = RPGGen.context(rng);
  return [
    context.genre, context.theme, context.tone,
    RPGGen.randomItem(rng, context),
    RPGGen.randomLocation(rng, context),
    RPGGen.randomMonster(rng, context),
    RPGGen.randomName(rng, context),
    RPGGen.randomTrap(rng, context),
    RPGGen.randomMood(rng),
    RPGGen.randomActivity(rng, context),
    RPGGen.randomAnimal(rng, context),
    RPGGen.toneAdj(rng, context, 'place'),
    RPGGen.toneDesc(rng, context, 'monster'),
    RPGGen.randomTitle(rng, context, 'female'),
    RPGGen.randomName(rng, context),
    RPGGen.randomItem(rng, context),
  ];
};
