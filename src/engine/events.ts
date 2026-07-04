// Storyteller: escalating event generator (D-063). Chance ≈0 during bootstrap, rising with the
// window number; at most one event per window; nothing is telegraphed — the chronicle (D-061)
// reports what just happened, never a forecast. Balance numbers live in data/events.csv (D-058).

import type { Rng } from './types';
import type { ResourceKind } from './resources';
import { parseCsv, num } from '../data/csv';
import eventsCsv from '../data/events.csv?raw';

// D-072 (плейтест-2 "больше событий"): breach = разгерметизация (вентит сток N₂ + жертвы, ЗИП
// прикрывает), radiation = солнечная вспышка SPE (все в укрытие: весь выпуск падает + жертвы,
// медблок прикрывает), outage = отказ узла (случайная рабочая структура встаёт), crash =
// EDL-крушение конвоя, который садится в это окно.
export type EventEffect =
  | 'energy' | 'subsidy' | 'delay' | 'price' | 'farm' | 'epidemic'
  | 'breach' | 'radiation' | 'outage' | 'crash';

export interface EventSpec {
  id: string;
  name: string;
  icon: string;
  effect: EventEffect;
  minMag: number;
  maxMag: number;
  minDur: number;
  maxDur: number;
  coveredMag: number; // epidemic/breach/radiation — mortality fraction when the cover holds
  pharmaCost: number; // epidemic/radiation — one-time pharma kg/colonist consumed when covered
  deathMag: number; // breach/radiation — uncovered mortality fraction (mag is the physical hit, not deaths)
}

function loadEvents(): EventSpec[] {
  return parseCsv(eventsCsv).map((row) => ({
    id: row.id!,
    name: row.name!,
    icon: row.icon!,
    effect: row.effect as EventEffect,
    minMag: num(row.minMag),
    maxMag: num(row.maxMag),
    minDur: num(row.minDur),
    maxDur: num(row.maxDur),
    coveredMag: num(row.coveredMag),
    pharmaCost: num(row.pharmaCost),
    deathMag: num(row.deathMag),
  }));
}

export const EVENTS: readonly EventSpec[] = loadEvents();
export const EVENT_BY_ID: Readonly<Record<string, EventSpec>> = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

/** Which resource category a price_spike hits — picked at random when that event fires. */
export const PRICE_CATEGORIES: readonly ResourceKind[][] = [
  ['food', 'water', 'o2', 'n2'],
  ['steel', 'metals', 'polymers', 'glass', 'spares'],
  ['pharma', 'chips', 'catalyst', 'fuel'],
];

/** A rolling effect from a past event, still counting down (D-063). Read at the TOP of the window
 * it applies to — so an event rolled this window is felt starting NEXT window (same timing as pad
 * explosions: decided now, reported now, takes hold once the player has committed blind). */
export interface ActiveEffect {
  id: string;
  effect: EventEffect;
  mag: number;
  windowsLeft: number;
  category?: ResourceKind[]; // price_spike only
  target?: string; // outage only — the structure type knocked out
}

/** What actually fired this window — for the chronicle (D-061) to announce. */
export interface WindowEvent {
  id: string;
  name: string;
  icon: string;
  effect: EventEffect;
  mag: number;
  windows: number;
  category?: ResourceKind[];
  covered?: boolean; // epidemic/radiation — did the cover (medbay+pharma) hold
  deaths?: number; // epidemic/breach/radiation/crash
  target?: string; // outage — the structure type that failed (undefined = nothing to fail)
  lostKg?: number; // crash — cargo mass burned on entry
  coverage?: number; // breach only — ЗИП coverage 0..1 at the moment it hit (graduated, not binary)
}

/** Escalation curve: 0 before `startWindow`, ramping linearly to `cap`. */
export function eventChance(window: number, startWindow: number, rampPerWindow: number, cap: number): number {
  if (window < startWindow) return 0;
  return Math.min(cap, (window - startWindow) * rampPerWindow);
}

export interface EventRoll {
  spec: EventSpec;
  mag: number;
  dur: number;
  category?: ResourceKind[];
}

/** Roll whether an event fires this window and, if so, which one + its rolled magnitude/duration.
 * `exclude` (the previous window's fired event id, D-063 "not twice in a row") is skipped this draw.
 * Severity scales with population (D-063): the roll's magnitude CAP lerps from minMag (tiny outpost)
 * to maxMag (pop ≥ eventPopRef) — a bigger colony draws from a harsher range. Only the magnitude
 * value depends on pop, never the number of RNG draws, so determinism per seed is unaffected. */
export function rollEvent(
  window: number,
  pop: number,
  cfg: { eventStartWindow: number; eventRampPerWindow: number; eventChanceCap: number; eventPopRef: number },
  exclude: string | undefined,
  rng: Rng,
): EventRoll | null {
  const chance = eventChance(window, cfg.eventStartWindow, cfg.eventRampPerWindow, cfg.eventChanceCap);
  if (rng.random() >= chance) return null;
  const pool = EVENTS.filter((e) => e.id !== exclude);
  const spec = rng.choice(pool);
  const popFactor = cfg.eventPopRef > 0 ? Math.min(1, Math.max(0, pop) / cfg.eventPopRef) : 1;
  const magCap = spec.minMag + (spec.maxMag - spec.minMag) * popFactor;
  const mag = spec.minMag + rng.random() * (magCap - spec.minMag);
  const dur = spec.minDur === spec.maxDur ? spec.minDur : Math.round(spec.minDur + rng.random() * (spec.maxDur - spec.minDur));
  const category = spec.effect === 'price' ? rng.choice(PRICE_CATEGORIES) : undefined;
  return { spec, mag, dur, category };
}

/** Fold a list of active effects of one kind into a single multiplier (1 = no effect); effects of
 * the same kind compound multiplicatively so an unlucky overlap degrades gracefully. */
export function effectMultiplier(effects: readonly ActiveEffect[], effect: EventEffect): number {
  let mult = 1;
  for (const e of effects) if (e.effect === effect && e.windowsLeft > 0) mult *= 1 - e.mag;
  return mult;
}

/** Price multiplier for one resource this window — product of any active price_spike effects
 * whose category includes it. */
export function priceMultFor(effects: readonly ActiveEffect[], r: ResourceKind): number {
  let mult = 1;
  for (const e of effects) {
    if (e.effect === 'price' && e.windowsLeft > 0 && e.category?.includes(r)) mult *= e.mag;
  }
  return mult;
}

/** Decrement all active effects by one window and drop expired ones (call once per commit, after
 * this window has already read them). */
export function decayEffects(effects: readonly ActiveEffect[]): ActiveEffect[] {
  return effects.map((e) => ({ ...e, windowsLeft: e.windowsLeft - 1 })).filter((e) => e.windowsLeft > 0);
}
