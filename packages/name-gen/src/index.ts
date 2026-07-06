/* ============================================================
   auto-stuff-name-gen — public API.

   The default `NameGenerator` implementation (given/full person
   names, titles, stock dungeon names, theme enumeration) plus the
   factory to bind it to a custom names/titles content slice.
   Implements the `NameGenerator` contract from auto-stuff-generator.
   ============================================================ */
import { defaultContent } from 'auto-stuff-generator';
import { createNameGenerator } from './name-generator';

export { createNameGenerator } from './name-generator';
export type { NameContentSource } from './name-generator';

/** The default NameGenerator bound to the built-in names/titles content. */
export const defaultNameGenerator = createNameGenerator(defaultContent);
