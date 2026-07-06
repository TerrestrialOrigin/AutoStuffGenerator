import type { ContentSource } from '../content-types';
import { activities } from './activities';
import { loot } from './loot';
import { monsters } from './monsters';
import { moods } from './moods';
import { names } from './names';
import { places } from './places';
import { titles } from './titles';
import { tones } from './tones';
import { traps } from './traps';

export const defaultContent = {
  activities,
  loot,
  monsters,
  moods,
  names,
  places,
  titles,
  tones,
  traps,
} satisfies ContentSource;

export type ContentData = typeof defaultContent;
