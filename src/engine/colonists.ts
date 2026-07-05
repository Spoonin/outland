// Per-colonist demographics (D-083): every colonist is an individual with an age, a pre-rolled
// natural-death age and an illness flag — population is the array, `s.pop` is its derived length.
// All rolls here draw from a dedicated per-window RNG stream (colonistRng), NEVER from the shared
// event stream (`s.rngState`) — same isolation pattern as windowInflationRate (D-076), so adding
// demographics doesn't shift a single storyteller/explosion roll in existing seeds.

import { makeRng } from './rng';
import type { Rng } from './types';

export interface Colonist {
  age: number; // years — advances YEARS_PER_WINDOW per committed window
  deathAge: number; // natural-death age rolled once at creation ~N(lifeExpectancy, sd) (D-083):
  // the spec's illness process alone can't produce a 60-year expectancy (0.03 × 0.5 lethality
  // ≈ 87 expected years), so old age is its own mechanism with a legible chronicle cause
  sick: boolean; // in the ACTIVE stage this window → not in the labor pool (D-075/083)
  doomed: boolean; // sick and untreated (no bed/pharma) or uncured — dies at the START of next window
}

/** Synodic window ≈ 26 months. */
export const YEARS_PER_WINDOW = 26 / 12;

/** Demographic knobs (D-083) — flat fields folded into ColonyParams. */
export interface DemographicParams {
  illnessProb: number; // chance per healthy colonist per window of falling seriously ill
  cureProb: number; // chance a TREATED (bed + pharma) colonist recovers; the rest die next window
  pharmaPerTreatment: number; // kg of pharma one treatment consumes — no pharma, no treatment
  arrivalAgeMean: number; // Earth sends 25–35-year-olds, normally distributed (D-083)
  arrivalAgeSd: number;
  arrivalAgeMin: number;
  arrivalAgeMax: number;
  lifeExpectancy: number; // mean of the pre-rolled natural-death age
  lifeExpectancySd: number;
  adultAge: number; // younger than this → not in the labor pool
}

/** Dedicated per-window RNG stream for colonist rolls — a pure function of (seed, window), mixed
 * with a different salt than windowInflationRate so the two streams never collide. */
export function colonistRng(seed: number, window: number): Rng {
  const mixed = (Math.imul((seed ^ 0x5f356495) + window, 0x9e3779b1) ^ (window * 0x85ebca6b)) >>> 0;
  return makeRng(mixed);
}

/** Standard normal via Box–Muller (2 uniform draws). */
export function sampleNormal(rng: Rng): number {
  const u = Math.max(rng.random(), 1e-12); // guard log(0)
  const v = rng.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Round x to an integer probabilistically: the fractional part is a chance for one more.
 * Keeps small-rate processes (births at 5% of a 6-person outpost) alive in expectation now that
 * population is integer people, not a fraction. */
export function probRound(x: number, rng: Rng): number {
  const base = Math.floor(x);
  return base + (rng.random() < x - base ? 1 : 0);
}

/** Natural-death age for a fresh colonist — clamped so nobody spawns already past it. */
function rollDeathAge(rng: Rng, p: DemographicParams, age: number): number {
  const rolled = p.lifeExpectancy + sampleNormal(rng) * p.lifeExpectancySd;
  return Math.max(age + YEARS_PER_WINDOW, rolled);
}

/** A colonist landing from Earth: healthy, age ~N(mean, sd) clamped to [min, max] (D-083). */
export function newArrival(rng: Rng, p: DemographicParams): Colonist {
  const age = Math.min(
    p.arrivalAgeMax,
    Math.max(p.arrivalAgeMin, p.arrivalAgeMean + sampleNormal(rng) * p.arrivalAgeSd),
  );
  return { age, deathAge: rollDeathAge(rng, p, age), sick: false, doomed: false };
}

/** A colonist born on Mars: age 0 — eats like everyone, works only from `adultAge` (≈7.4 windows). */
export function newborn(rng: Rng, p: DemographicParams): Colonist {
  return { age: 0, deathAge: rollDeathAge(rng, p, 0), sick: false, doomed: false };
}

/** Able-bodied count for the D-075 labor pool: adults not in the active stage of an illness. */
export function workforceCount(colonists: readonly Colonist[], adultAge: number): number {
  let n = 0;
  for (const c of colonists) if (!c.sick && c.age >= adultAge) n++;
  return n;
}

/** In-place Fisher–Yates shuffle — used for even-odds triage (D-083: no priority classes). */
export function shuffle<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/** Remove `n` colonists uniformly at random (shortfall/event mortality picks real victims). */
export function removeRandom(colonists: Colonist[], n: number, rng: Rng): void {
  for (let k = 0; k < n && colonists.length > 0; k++) {
    colonists.splice(Math.floor(rng.random() * colonists.length), 1);
  }
}

/** Standard normal CDF via the Abramowitz–Stegun 7.1.26 erf approximation — plenty accurate for a
 * dashboard forecast, not a scientific claim. Φ(0)=0.5, Φ(1.96)≈0.975. Exported for its own
 * accuracy test; callers normally only need expectedOldAgeDeaths below. */
export function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Statistical forecast of old-age deaths over the next `windows` — roadmap-2 demography UI
 * (D-084 sibling, D-083 data). Deliberately reads only `age` and the DISTRIBUTION parameters
 * (lifeExpectancy/lifeExpectancySd), NEVER a colonist's own pre-rolled `deathAge` — that's one
 * person's specific fate, and showing it would telegraph the future a storyteller forbids (D-063).
 * For each living colonist of age a: P(dies of old age within k windows | alive at a) =
 * (Φ((a+kΔ−μ)/σ) − Φ((a−μ)/σ)) / (1 − Φ((a−μ)/σ)), summed across the population. */
export function expectedOldAgeDeaths(
  colonists: readonly Colonist[],
  p: DemographicParams,
  windows: number,
): number {
  const mu = p.lifeExpectancy;
  const sigma = p.lifeExpectancySd;
  const delta = windows * YEARS_PER_WINDOW;
  let total = 0;
  for (const c of colonists) {
    const zNow = (c.age - mu) / sigma;
    const zFuture = (c.age + delta - mu) / sigma;
    const aliveNow = Math.max(1e-9, 1 - phi(zNow)); // conditioned on having survived to `age`
    const diesWithin = Math.max(0, phi(zFuture) - phi(zNow));
    total += diesWithin / aliveNow;
  }
  return Math.round(total * 10) / 10;
}
