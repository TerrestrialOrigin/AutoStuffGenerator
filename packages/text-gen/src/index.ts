/* ============================================================
   auto-stuff-text-gen — public API.

   The default `TextGenerator` implementation (tone adjectives/
   descriptions, location names, flavor sentences) plus the factory
   to bind it to a custom tones/places content slice. Implements the
   `TextGenerator` contract from auto-stuff-generator.
   ============================================================ */
import { defaultContent } from 'auto-stuff-generator';
import { createTextGenerator } from './text-generator';

export { createTextGenerator } from './text-generator';
export type { TextContentSource } from './text-generator';

/** The default TextGenerator bound to the built-in tones/places content. */
export const defaultTextGenerator = createTextGenerator(defaultContent);
