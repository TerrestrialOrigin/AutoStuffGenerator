/* ============================================================
   auto-stuff-text-gen — default TextGenerator implementation.

   Self-contained tone-driven text generation: adjectives,
   descriptions, location names, and flavor sentences (e.g.
   "Hallways where wind howls."). Implements the `TextGenerator`
   contract from auto-stuff-generator and depends ONLY on that
   contracts package — never on a sibling implementation.

   DETERMINISM: every helper draws a fixed number of times from the
   supplied RandomNumberGenerator (via the shared rng helpers), so
   identical seeds yield identical text. This is the extracted, canonical
   copy of the built-in engine's text logic; it MUST stay byte-identical
   to it (locked by the equivalence spec).
   ============================================================ */
import {
  capitalizeFirst,
  chance,
  pick,
  type ContentSource,
  type GenerationContext,
  type RandomNumberGenerator,
  type TextGenerator,
  type ToneCategory,
} from 'auto-stuff-generator';

/** The content slice a TextGenerator reads: tone phrase pools and per-genre places. */
export type TextContentSource = Pick<ContentSource, 'tones' | 'places'>;

/** Build a TextGenerator bound to the given tones/places content slice. */
export const createTextGenerator = (source: TextContentSource): TextGenerator => {
  const toneCategory = (context: GenerationContext, categoryName: string): ToneCategory | undefined =>
    context.tone ? source.tones[context.tone]?.[categoryName] : undefined;

  /* attach a tone descriptor: adjective goes BEFORE, description goes AFTER.
     Items ONLY ever take an adjective — never a description — so an item whose
     tone lacks adjectives is returned undecorated. */
  const decorate = (random: RandomNumberGenerator | undefined, base: string, categoryName: string, context: GenerationContext): string => {
    const category = toneCategory(context, categoryName);
    if (!category) return base;
    const hasDescriptions = !!(category.descriptions && category.descriptions.length);
    const useAdjective = !!(category.adjectives && category.adjectives.length)
      && (categoryName === 'item' || !hasDescriptions || chance(random, 0.55));
    if (useAdjective) return capitalizeFirst(pick(random, category.adjectives) ?? '') + ' ' + base; // adjective BEFORE
    if (hasDescriptions && categoryName !== 'item') return base + ' ' + pick(random, category.descriptions); // description AFTER (never for items)
    return base;
  };

  const generateAdjective = (random: RandomNumberGenerator, context: GenerationContext, categoryName: string): string | null => {
    const category = toneCategory(context, categoryName);
    if (!category || !category.adjectives || !category.adjectives.length) return null;
    return pick(random, category.adjectives);
  };

  const generateDescription = (random: RandomNumberGenerator, context: GenerationContext, categoryName: string): string | null => {
    const category = toneCategory(context, categoryName);
    if (!category || !category.descriptions || !category.descriptions.length) return null;
    return pick(random, category.descriptions);
  };

  const generateLocation = (random: RandomNumberGenerator, context: GenerationContext): string | null => {
    let base = pick(random, source.places[context.genre] || []);
    if (!base) return null;
    if (chance(random, 0.70)) base = decorate(random, base, 'place', context); // ~70% get a descriptor/adjective
    return base;
  };

  /* one tone-flavored sentence for a place — e.g. "Hallways where wind howls." */
  const generateFlavorSentence = (random: RandomNumberGenerator, context: GenerationContext): string | null => {
    const flavorCategory = pick(random, ['place', 'sound', 'building']) ?? 'place';
    const description = generateDescription(random, context, flavorCategory)
      || generateDescription(random, context, 'place');
    return description ? capitalizeFirst(description) + '.' : null;
  };

  return { generateAdjective, generateDescription, generateLocation, generateFlavorSentence };
};
