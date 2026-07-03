// Storyteller: escalating event generator (D-063). Chance ≈0 during bootstrap, rising with the
// window number; at most one event per window; nothing is telegraphed — the chronicle (D-061)
// reports what just happened, never a forecast. Balance numbers live in data/events.csv (D-058).

import type { Rng } from './types';
import type { ResourceKind } from './resources';
import { parseCsv, num } from '../data/csv';
import eventsCsv from '../data/events.csv?raw';

export type EventEffect = 'energy' | 'subsidy' | 'delay' | 'price' | 'farm' | 'epidemic';

export interface EventSpec {
  id: string;
  name: string;
  icon: string;
  effect: EventEffect;
  minMag: number;
  maxMag: number;
  minDur: number;
  maxDur: number;
  coveredMag: number; // epidemic only — mortality fraction when medbay+pharma cover it
  pharmaCost: number; // epidemic only — one-time pharma kg/colonist consumed when covered
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
  }));
}

export const EVENTS: readonly EventSpec[] = loadEvents();
export const EVENT_BY_ID: Readonly<Record<string, EventSpec>> = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

/** Which resource category a price_spike hits — picked at random when that event fires. */
export const PRICE_CATEGORIES: readonly ResourceKind[][] = [
  ['food', 'water', 'o2', 'n2'],
  ['steel', 'metals', 'polymers', 'glass', 'spares'],
  ['pharma', 'chips', 'catalyst'],
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
  covered?: boolean; // epidemic only
  deaths?: number; // epidemic only
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
