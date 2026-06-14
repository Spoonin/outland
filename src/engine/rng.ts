// Deterministic seedable RNG (mulberry32). Same seed → same sequence (D-011, replay).
// NOT Python-compatible — events-ON runs are validated statistically, not bit-exact (SDD §9).

import type { Rng } from './types';

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const random = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const choice = <T>(arr: readonly T[]): T => arr[Math.floor(random() * arr.length)]!;
  const state = (): number => a >>> 0;
  return { random, choice, state };
}

/** Reconstruct an RNG from a persisted internal state (save/load continuity). */
export function rngFromState(state: number): Rng {
  return makeRng(state >>> 0);
}
