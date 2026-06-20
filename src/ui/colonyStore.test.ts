import { describe, it, expect } from 'vitest';
import { ColonyStore, type KV } from './colonyStore';
import { defaultColonyParams } from '../engine';

function memKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('ColonyStore (v2 Earth ordering)', () => {
  it('draft → preview reflects ordered goods', () => {
    const store = new ColonyStore(defaultColonyParams(), memKV());
    store.setRes('food', 100_000);
    const pv = store.preview();
    expect(pv.mass).toBeCloseTo(110_000, 0); // food tare 0.1
    expect(pv.total).toBeGreaterThan(0);
  });

  it('commit advances a window, lands the convoy next window, clears draft', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    store.setRes('food', 60_000);
    store.commit();
    expect(store.status().window).toBe(1);
    expect(store.resQty('food')).toBe(0); // draft cleared
    store.commit(); // convoy lands
    expect(store.lastReport()?.landed.stocks.food).toBe(60_000);
  });

  it('status exposes live life-support cover (the tactile balance)', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 2 }), memKV());
    const cover = store.status().cover;
    const food = cover.find((c) => c.kind === 'food')!;
    expect(food.windows).toBeCloseTo(2, 1); // ~2 windows of food at start
  });

  it('Mars build queue feeds the commit plan and builds structures', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    // need materials in stock to build — order them, land them first
    store.setRes('steel', 50_000);
    store.setRes('glass', 50_000);
    store.commit(); // ship materials
    store.commit(); // they land
    store.addBuild('solar_plant');
    expect(store.buildQueue()).toContain('solar_plant');
    expect(store.plan().feasible).toBe(true); // materials in stock, prereq ok, money-free build
    store.commit();
    expect(store.builtCount('solar_plant')).toBe(1);
    expect(store.buildQueue().length).toBe(0); // queue cleared after commit
  });

  it('plan flags missing prerequisite (nuclear needs waste pad)', () => {
    const store = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), memKV());
    store.addBuild('nuclear_plant');
    expect(store.plan().prereqMissing).toContain('nuclear_plant');
    expect(store.plan().feasible).toBe(false);
  });

  it('autosaves and reloads', () => {
    const kv = memKV();
    const a = new ColonyStore(defaultColonyParams({ startStockWindows: 5 }), kv);
    a.setRes('water', 50_000);
    a.commit();
    const b = new ColonyStore(undefined, kv);
    expect(b.status().window).toBe(1);
  });
});
