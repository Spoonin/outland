// D-085: store-layer stockpile ceiling for food/water (D-056 housing precedent — a structure
// defines capacity, the STORE clamps orders against it, the engine itself never checks this).

import { describe, it, expect } from 'vitest';
import { ColonyStore, type KV } from './colonyStore';
import { defaultColonyParams } from '../engine';

function memKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('ColonyStore food/water capacity ceiling (D-085)', () => {
  it('maxFoodStock() is exactly baseFoodCapacity with nothing built or in stock', () => {
    const store = new ColonyStore(defaultColonyParams(), memKV());
    expect(store.maxFoodStock()).toBe(store.status().foodCapacityTotal);
    expect(store.status().foodCapacityTotal).toBe(10_000_000); // current default (D-085, recalibrated)
  });

  it('setRes(\'food\', …) clamps to the ceiling instead of silently accepting an over-cap draft', () => {
    const store = new ColonyStore(defaultColonyParams(), memKV());
    const cap = store.maxFoodStock();
    store.setRes('food', cap + 500_000); // ask for more than fits
    expect(store.resQty('food')).toBe(cap); // clamped, not the requested amount
    store.setRes('food', cap - 1); // comfortably under — no clamping needed
    expect(store.resQty('food')).toBe(cap - 1);
  });

  it('water is clamped the same way, independently of food', () => {
    const store = new ColonyStore(defaultColonyParams(), memKV());
    const cap = store.maxWaterStock();
    store.setRes('water', cap + 1_000_000);
    expect(store.resQty('water')).toBe(cap);
  });

  it('queuing a food_silo build raises maxFoodStock() by its foodCapacity, before it even lands', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 1 }), memKV());
    // establish Mars presence + enough steel/glass to build a food_silo (mat_steel:4000, mat_glass:3000)
    store.setRes('steel', 5_000);
    store.setRes('glass', 4_000);
    store.commit(); // ship
    store.commit(); // land materials
    const before = store.maxFoodStock();
    store.addBuild('food_silo');
    // queued (not yet built) — maxFoodStock() already credits it, same as maxColonists() credits
    // queued housing (D-056 precedent)
    expect(store.maxFoodStock()).toBe(before + 300_000);
  });

  it('a BUILT food_silo permanently raises the ceiling', () => {
    const store = new ColonyStore(defaultColonyParams({ pop0: 1000, startStockWindows: 1 }), memKV());
    store.setRes('steel', 5_000);
    store.setRes('glass', 4_000);
    store.commit();
    store.commit();
    const before = store.maxFoodStock();
    store.addBuild('food_silo');
    store.commit(); // builds this window (money-free local build, D-054)
    expect(store.builtCount('food_silo')).toBe(1);
    expect(store.maxFoodStock()).toBeGreaterThanOrEqual(before + 300_000 * 0.99); // spoilage/consumption noise aside, the +300000 capacity is there
  });
});
