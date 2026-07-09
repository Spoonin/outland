// Roadmap-2: ColonyStore.demography() — age buckets + forecasts for the demography UI.
// maturingSoon needs colonists at EXACT fractional ages (14.5, 0) that gameplay can't reach
// (a newborn only ever lands on multiples of YEARS_PER_WINDOW ≈ 2.1667) — injected via the same
// save/load path the store itself persists through (serializeColony/loadColony), the only public
// way to get precise engine-state fixtures into a ColonyStore.

import { describe, it, expect } from 'vitest';
import { ColonyStore, SAVE_KEY, type KV } from './colonyStore';
import { newColony, defaultColonyParams, serializeColony, type Colonist } from '../engine';

function memKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

const healthy = (age: number): Colonist => ({ age, deathAge: age + 40, sick: false, doomed: false, radiationDose: 0 });

/** Builds a ColonyStore whose colonists are EXACTLY the given list, via save/load injection. */
function storeWithColonists(colonists: Colonist[]): ColonyStore {
  const params = defaultColonyParams();
  const s = newColony(params);
  s.colonists = colonists;
  s.pop = colonists.length;
  s.everHadPop = colonists.length > 0;
  const kv = memKV();
  kv.setItem(SAVE_KEY, JSON.stringify(serializeColony(s)));
  return new ColonyStore(undefined, kv);
}

describe('ColonyStore.demography() (roadmap-2)', () => {
  it('buckets colonists by fixed age ranges and computes the average age', () => {
    const store = storeWithColonists([healthy(10), healthy(20), healthy(40), healthy(50), healthy(60)]);
    const d = store.demography();
    expect(d.buckets).toEqual([
      { label: '0–15', count: 1 },
      { label: '16–29', count: 1 },
      { label: '30–44', count: 1 },
      { label: '45–54', count: 1 },
      { label: '55+', count: 1 },
    ]);
    expect(d.avgAge).toBe(36); // (10+20+40+50+60)/5
  });

  it('maturingSoon counts a near-adult child but not a newborn (default adultAge 16, 3-window horizon ≈6.5y)', () => {
    // 16 − 14.5 = 1.5 < 3×YEARS_PER_WINDOW (≈6.5) → counted
    // 16 − 0 = 16 ≥ 6.5 → not counted (a newborn is nowhere near maturing within the horizon)
    const store = storeWithColonists([healthy(14.5), healthy(0)]);
    expect(store.demography().maturingSoon).toBe(1);
  });

  it('an empty colony reports zero avgAge and no forecasts, without dividing by zero', () => {
    const store = storeWithColonists([]);
    const d = store.demography();
    expect(d.avgAge).toBe(0);
    expect(d.expectedOldAgeDeaths).toBe(0);
    expect(d.maturingSoon).toBe(0);
    expect(d.buckets.every((b) => b.count === 0)).toBe(true);
  });
});
