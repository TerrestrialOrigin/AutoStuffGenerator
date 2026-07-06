/* ============================================================
   Built-in default generator implementations.

   Each object below adapts the existing content engine
   (defaultContentGenerator) / dungeon function to a plugin
   contract, and is declared `satisfies <Interface>` so the
   compiler proves the contracts fit the real engine. These are
   thin, transitional adapters: the changes that extract each
   generator into its own package re-point the delegation target
   without changing the contract or the default's behavior.
   ============================================================ */
import { generateDungeon } from './dungeon';
import { defaultContentGenerator } from './rpg-gen';
import { capitalizeFirst, pick } from './rng-utils';
import type {
  DungeonGenerator,
  LootGenerator,
  MonsterGenerator,
  NameGenerator,
  TextGenerator,
} from './generator-contracts';

/** Default TextGenerator — tone adjectives/descriptions, location names, flavor sentences. */
export const defaultTextGenerator = {
  generateAdjective: (random, context, category) => defaultContentGenerator.toneAdjective(random, context, category),
  generateDescription: (random, context, category) => defaultContentGenerator.toneDescription(random, context, category),
  generateLocation: (random, context) => defaultContentGenerator.randomLocation(random, context),
  // Draw order matches the dungeon generator's former inline flavor block exactly:
  // pick one flavor category (1 draw), then a place/sound/building description
  // falling back to 'place' — the golden baseline locks this ordering.
  generateFlavorSentence: (random, context) => {
    const flavorCategory = pick(random, ['place', 'sound', 'building']) ?? 'place';
    const description = defaultContentGenerator.toneDescription(random, context, flavorCategory)
      || defaultContentGenerator.toneDescription(random, context, 'place');
    return description ? capitalizeFirst(description) + '.' : null;
  },
} satisfies TextGenerator;

/** Default NameGenerator — given/full names, titles, stock dungeon names, and the theme enumeration. */
export const defaultNameGenerator = {
  generateFullName: (random, context) => defaultContentGenerator.randomName(random, context),
  generateTitle: (random, context, gender) => defaultContentGenerator.randomTitle(random, context, gender),
  generateGivenName: (random, context) => defaultContentGenerator.randomGivenName(random, context),
  // The default composition is genre-agnostic; the engine method takes no context.
  generateDungeonName: (random) => defaultContentGenerator.randomDungeonName(random),
  availableThemes: () => defaultContentGenerator.themePool(),
} satisfies NameGenerator;

/** Default MonsterGenerator — creatures and the eligible creature pool. */
export const defaultMonsterGenerator = {
  generateMonster: (random, context) => defaultContentGenerator.randomMonster(random, context),
  monsterPool: (context, includeAnimals) => defaultContentGenerator.monsterPool(context, includeAnimals),
} satisfies MonsterGenerator;

/** Default LootGenerator — loot items and traps. */
export const defaultLootGenerator = {
  generateLoot: (random, context) => defaultContentGenerator.randomItem(random, context),
  generateTrap: (random, context) => defaultContentGenerator.randomTrap(random, context),
} satisfies LootGenerator;

/** Default DungeonGenerator — the built-in procedural dungeon function. */
export const defaultDungeonGenerator = {
  generateDungeon: (seed, level, mode) => generateDungeon(seed, level, mode),
} satisfies DungeonGenerator;
