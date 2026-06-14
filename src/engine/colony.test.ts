import { describe, it, expect } from 'vitest';
import {
  newColony,
  defaultColonyParams,
  previewOrder,
  commitWindow,
  consumption,
  type EarthOrder,
} from './colony';

const emptyOrder: EarthOrder = { resources: {}, padsToBuild: 0, colonists: 0 };

describe('colony v2 — consumption & startup (D-042/colony-sim)', () => {
  it('life-support consumption scales with population', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const c = consumption(s);
    expect(c.food).toBe(50 * 1000);
    expect(c.water).toBe(100 * 1000);
    expect(c.steel).toBeUndefined(); // not life-support
  });

  it('seeds a startStockWindows buffer', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 1 }));
    expect(s.stocks.food).toBe(50 * 1000); // ~1 window of food
  });
});

describe('order preview (manifest math)', () => {
  it('sums goods cost+mass, flags over-throughput', () => {
    const s = newColony(defaultColonyParams());
    const pv = previewOrder(s, { resources: { food: 100_000 }, padsToBuild: 0, colonists: 0 });
    expect(pv.mass).toBe(100_000);
    expect(pv.goodsCost).toBeGreaterThan(0);
    // 5 pads × 5 × 16800 = 420k kg throughput → 100k ok
    expect(pv.capped).toBe(false);
  });

  it('flags capped when convoy exceeds throughput', () => {
    const s = newColony(defaultColonyParams());
    const pv = previewOrder(s, { resources: { water: 5_000_000 }, padsToBuild: 0, colonists: 0 });
    expect(pv.capped).toBe(true); // 5M > 420k throughput
  });

  it('building pads raises throughput in the preview', () => {
    const s = newColony(defaultColonyParams());
    const base = previewOrder(s, emptyOrder).throughput;
    const more = previewOrder(s, { resources: {}, padsToBuild: 5, colonists: 0 }).throughput;
    expect(more).toBeGreaterThan(base);
  });

  it('inflation raises costs over time', () => {
    const s = newColony(defaultColonyParams());
    const order: EarthOrder = { resources: { food: 100_000 }, padsToBuild: 0, colonists: 0 };
    const t0 = previewOrder(s, order).goodsCost;
    s.window = 10;
    const t10 = previewOrder(s, order).goodsCost;
    expect(t10).toBeGreaterThan(t0);
  });
});

describe('commit window — transit lag, consumption, runway, mortality', () => {
  it('ordered goods land the NEXT window (Tsiolkovsky lag)', () => {
    const s = newColony(defaultColonyParams());
    const before = s.stocks.food;
    commitWindow(s, { resources: { food: 200_000 }, padsToBuild: 0, colonists: 0 });
    // window 1: consumed food, nothing landed yet (order in transit)
    expect(s.stocks.food).toBeLessThan(before);
    const r2 = commitWindow(s, emptyOrder);
    // window 2: the 200k food convoy lands
    expect(r2.landed.stocks.food).toBe(200_000);
  });

  it('colonists arrive after the lag and grow population', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 })); // well-fed: isolate colonist mechanic
    const p0 = s.pop;
    commitWindow(s, { resources: {}, padsToBuild: 0, colonists: 50 });
    expect(s.pop).toBeCloseTo(p0, 0); // not yet (in transit), minus any mortality
    commitWindow(s, emptyOrder);
    expect(s.pop).toBeGreaterThan(p0 - 1); // colonists landed
  });

  it('runway falls as stocks deplete without resupply (thesis seed)', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 2 }));
    const r1 = commitWindow(s, emptyOrder);
    const r2 = commitWindow(s, emptyOrder);
    expect(r2.runway).toBeLessThan(r1.runway); // depleting → runway shrinks
  });

  it('starvation when life-support runs dry → mortality → collapse', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 0.3 }));
    let collapsed = false;
    for (let i = 0; i < 10 && !collapsed; i++) collapsed = commitWindow(s, emptyOrder).collapsed;
    expect(collapsed).toBe(true);
  });
});
