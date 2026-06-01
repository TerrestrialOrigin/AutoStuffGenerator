/* ============================================================
   RPG-GEN — reusable random content generator.
   Reads the data registered on the imported RPG object (loot/tones/
   places/monsters/moods/activities/titles/names) and exposes RPGGen.

   Every generator takes an optional rng (a 0..1 function — pass a
   seeded one for reproducibility; defaults to Math.random) and a
   context from RPGGen.context(rng). The context fixes one genre, an
   optional theme and a tone for the whole dungeon so results stay
   coherent (no Count Jacob meeting Imam Josh).
   ============================================================ */
import { RPG } from './data';

// Loose alias — the engine treats every data bucket as untyped JSON.
type Any = any;

export type RNG = () => number;

export interface RPGContext {
  genre: string;
  theme: string | null;
  tone: string | null;
}

const D: Any = RPG;

const GENRES = ['fantasy', 'sci-fi', 'modern', 'horror'];

function rnd(r?: RNG): number { return (typeof r === 'function') ? r() : Math.random(); }
function pick(r: RNG | undefined, a: Any[]): Any { return (a && a.length) ? a[Math.floor(rnd(r) * a.length)] : null; }
function chance(r: RNG | undefined, p: number): boolean { return rnd(r) < p; }
function cap(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function genreArr(map: Any, genre: string): Any[] {            // genre pool merged with any "generic" pool
  if (!map) return [];
  return (map[genre] || []).concat(map.generic || []);
}
// dungeon-appropriate vermin (allowed as regular monsters, never bosses); other animals are excluded from dungeon gen
const VERMIN: Record<string, number> = { rat:1, spider:1, snake:1, bat:1, scorpion:1, centipede:1, serpent:1, viper:1, cobra:1, python:1, worm:1, leech:1, slug:1, toad:1, beetle:1, roach:1, cockroach:1, maggot:1, adder:1, mamba:1, rattlesnake:1 };
function isVermin(name: string): boolean {
  return String(name).toLowerCase().split(/[^a-z]+/).some(function (w) { return !!(w && (VERMIN[w] || VERMIN[w.replace(/s$/, '')])); });
}
function monsterPool(ctx: RPGContext, includeAnimals: boolean): Any[] {
  return genreArr(D.monsters, ctx.genre).filter(function (m: Any) { return !m.a || includeAnimals || isVermin(m.n || m); });
}

function themePool(genre: string): string[] {
  const given = (D.names && D.names.given) || {};
  let list = Object.keys(given).filter(function (t) { return t !== 'generic' && t !== 'modern'; });
  if (genre === 'modern' && given.modern) list = list.concat('modern');
  return list;
}

/* one coherent context for a whole dungeon */
function context(r?: RNG): RPGContext {
  const genre = pick(r, GENRES);
  const theme = chance(r, 0.15) ? pick(r, themePool(genre)) : null;   // ~15% themed
  const tones = D.tones ? Object.keys(D.tones) : [];
  const tone = pick(r, tones);
  return { genre, theme, tone };
}

/* attach a tone descriptor: adjective goes BEFORE, description goes AFTER */
function decorate(r: RNG | undefined, base: string, cat: string, ctx: RPGContext): string {
  const t = D.tones && ctx.tone && D.tones[ctx.tone] && D.tones[ctx.tone][cat];
  if (!t) return base;
  const useAdj = (t.adj && t.adj.length) && (cat === 'item' || !(t.desc && t.desc.length) || chance(r, 0.55));
  if (useAdj) return cap(pick(r, t.adj)) + ' ' + base;                      // adjective BEFORE (items only ever use adjectives)
  if (t.desc && t.desc.length) return base + ' ' + pick(r, t.desc);         // description AFTER
  return base;
}

/* ---- items / loot ---- */
function randomItem(r?: RNG, ctx?: RPGContext): string | null {
  ctx = ctx || context(r);
  const g = D.loot && D.loot[ctx.genre]; if (!g) return null;
  const cats = Object.keys(g);
  let base = pick(r, g[pick(r, cats)]);
  if (base && chance(r, 0.40)) base = decorate(r, base, 'item', ctx);   // ~40% get a descriptor/adjective
  return base;
}

/* ---- places / locations ---- */
function randomLocation(r?: RNG, ctx?: RPGContext): string | null {
  ctx = ctx || context(r);
  let base = pick(r, (D.places && D.places[ctx.genre]) || []);
  if (!base) return null;
  if (chance(r, 0.70)) base = decorate(r, base, 'place', ctx);          // ~70% get a descriptor/adjective
  return base;
}

/* ---- monsters ---- */
function randomMonster(r?: RNG, ctx?: RPGContext): string | null {
  ctx = ctx || context(r);
  const m = pick(r, monsterPool(ctx, false));   // proper monsters + dungeon vermin; no stray deer/hawks
  if (!m) return null;
  const base = m.n || m;
  if (m.a) return base;                                                 // animals: no mood/action (a hawk can't sharpen a knife)
  const mood = chance(r, 0.20) ? pick(r, D.moods || []) : null;          // ~20% a mood
  const action = chance(r, 0.20) ? pick(r, genreArr(D.activities, ctx.genre)) : null; // ~20% an action
  let out = base;
  if (mood) out = cap(String(mood).toLowerCase()) + ' ' + out;        // mood before:  "Happy Troll"
  if (action) out = out + ', ' + String(action).toLowerCase();          // action after: "Happy Troll, cleaning a sword"
  return cap(out);
}
/* any animal for the genre (kept for future outdoor/wilderness generation; not used in dungeons) */
function randomAnimal(r?: RNG, ctx?: RPGContext): string | null {
  ctx = ctx || context(r);
  const a = genreArr(D.monsters, ctx.genre).filter(function (m: Any) { return m.a; });
  const m = pick(r, a);
  return m ? (m.n || m) : null;
}

/* ---- names (people) ---- */
function randomTitle(r: RNG | undefined, ctx: RPGContext, gender: string): Any {
  const all: Any[] = D.titles || [];
  const ok = all.filter(function (t) {
    const themeOK = (t.theme === 'generic') || (ctx.theme && t.theme === ctx.theme);
    const genderOK = (t.gender === gender) || (t.gender === 'neutral');
    return themeOK && genderOK;
  });
  return ok.length ? pick(r, ok) : null;
}
function randomName(r?: RNG, ctx?: RPGContext): string | null {
  ctx = ctx || context(r);
  const given: Any[] = (D.names && D.names.given) || [];
  if (!given.length) return null;
  const gender = chance(r, 0.5) ? 'male' : 'female';
  function pool(strict: boolean): Any[] {
    return given.filter(function (x) {
      if (x.g !== gender) return false;
      const genreOK = x.genre === 'generic' || x.genre === ctx!.genre;
      const themeOK = x.theme === 'generic' || (ctx!.theme && x.theme === ctx!.theme);
      return strict ? (genreOK && themeOK) : genreOK;
    });
  }
  const first = pick(r, pool(true)) || pick(r, pool(false)) || pick(r, given);
  if (!first) return null;
  let name: string = first.n;
  const sns: Any[] = (D.names.surname || []).filter(function (s: Any) { return s.genre === 'generic' || s.genre === ctx!.genre; });
  if (sns.length && chance(r, 0.40)) { const s = pick(r, sns); if (s) name += ' ' + s.n; }
  if (chance(r, 0.20)) {                                                 // ~20% get a title (theme-matched)
    const t = randomTitle(r, ctx, gender);
    if (t) name = (t.placement === 'after') ? (name + ' ' + t.title) : (t.title + ' ' + name);
  }
  return name;
}

function randomMood(r?: RNG): string | null { return pick(r, D.moods || []); }
function randomActivity(r?: RNG, ctx?: RPGContext): string | null { ctx = ctx || context(r); return pick(r, genreArr(D.activities, ctx.genre)); }

/* a raw tone descriptor phrase for a category ('place','sound','monster','item','building','person') */
function toneDesc(r: RNG | undefined, ctx: RPGContext, cat: string): string | null {
  const t = D.tones && ctx.tone && D.tones[ctx.tone] && D.tones[ctx.tone][cat];
  if (!t || !t.desc || !t.desc.length) return null;
  return pick(r, t.desc);
}
function toneAdj(r: RNG | undefined, ctx: RPGContext, cat: string): string | null {
  const t = D.tones && ctx.tone && D.tones[ctx.tone] && D.tones[ctx.tone][cat];
  if (!t || !t.adj || !t.adj.length) return null;
  return pick(r, t.adj);
}

/* ---- traps ---- */
function randomTrap(r?: RNG, ctx?: RPGContext): string | null {
  ctx = ctx || context(r);
  return pick(r, genreArr(D.traps, ctx.genre));
}

export const RPGGen = {
  context,
  randomItem,
  randomLocation,
  randomMonster,
  randomName,
  randomTitle,
  randomTrap,
  toneDesc,
  toneAdj,
  randomMood,
  randomActivity,
  randomAnimal,
  monsterPool,
  genres: GENRES,
};

export type RPGGenType = typeof RPGGen;
