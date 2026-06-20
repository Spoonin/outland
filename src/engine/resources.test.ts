import { describe, it, expect } from 'vitest';
import {
  resolveEnergy,
  applyFlows,
  runwayFromStocks,
  emptyStocks,
  RESOURCES,
} from './resources';

describe('resolveEnergy — brownout by priority (D-042, colony-sim §2)', () => {
  it('serves higher-priority (lower number) demands first', () => {
    const r = resolveEnergy(100, [
      { name: 'eclss', priority: 0, demand: 40 },
      { name: 'farms', priority: 1, demand: 40 },
      { name: 'factories', priority: 2, demand: 40 },
    ]);
    expect(r.served['eclss']).toBe(1); // fully served
    expect(r.served['farms']).toBe(1); // fully served
    expect(r.served['factories']).toBe(0.5); // only 20 of 40 left
    expect(r.deficit).toBe(20);
  });

  it('full power → everyone served, no deficit', () => {
    const r = resolveEnergy(200, [{ name: 'a', priority: 0, demand: 50 }]);
    expect(r.served['a']).toBe(1);
    expect(r.deficit).toBe(0);
  });

  it('blackout → life-support keeps priority', () => {
    const r = resolveEnergy(10, [
      { name: 'eclss', priority: 0, demand: 40 },
      { name: 'factories', priority: 2, demand: 40 },
    ]);
    expect(r.served['eclss']).toBe(0.25);
    expect(r.served['factories']).toBe(0); // nothing left
  });
});

describe('applyFlows — stock update with recycling (D-042)', () => {
  it('production + arrivals − consumption', () => {
    const s = emptyStocks(0);
    s.food = 100;
    const { stocks, deficit } = applyFlows(s, {
      production: { food: 20 },
      arrivals: { food: 10 },
      consumption: { food: 50 },
    });
    expect(stocks.food).toBe(80); // 100 + 20 + 10 − 50
    expect(deficit.food).toBeUndefined();
  });

  it('recycling η reduces net consumption (ECLSS water/O₂)', () => {
    const s = emptyStocks(0);
    s.water = 100;
    const { stocks } = applyFlows(s, { consumption: { water: 50 }, recycleEff: { water: 0.98 } });
    expect(stocks.water).toBeCloseTo(99, 6); // net consumption = 50·0.02 = 1
  });

  it('shortfall is reported and stock floors at 0', () => {
    const s = emptyStocks(0);
    s.o2 = 10;
    const { stocks, deficit } = applyFlows(s, { consumption: { o2: 30 } });
    expect(stocks.o2).toBe(0);
    expect(deficit.o2).toBe(20);
  });
});

describe('runwayFromStocks — honest survival runway (D-025/D-042)', () => {
  it('worst-covered life-support resource sets the runway (Liebig)', () => {
    const s = emptyStocks(0);
    s.food = 100; // 100/50 = 2 windows
    s.water = 30; // 30/60 = 0.5 windows  ← worst
    s.o2 = 100;
    const rw = runwayFromStocks(s, { food: 50, water: 60, o2: 10 });
    expect(rw).toBe(0.5);
  });

  it('thesis: an import-dependent life-support resource pins runway low', () => {
    // food fully imported (no local production) and stock thin → cut imports → near-zero runway
    const s = emptyStocks(0);
    s.food = 5;
    s.water = 1000;
    s.o2 = 1000;
    const rw = runwayFromStocks(s, { food: 50, water: 50, o2: 50 });
    expect(rw).toBe(0.1); // 5/50
  });

  it('recycling extends runway for recycled resources', () => {
    const s = emptyStocks(0);
    s.water = 10;
    const plain = runwayFromStocks(s, { water: 50 });
    const recycled = runwayFromStocks(s, { water: 50 }, { water: 0.9 });
    expect(recycled).toBeGreaterThan(plain);
  });
});

describe('resource set (dробный набор, D-042)', () => {
  it('tracks the granular set incl. split gases and material classes', () => {
    expect(RESOURCES).toContain('o2');
    expect(RESOURCES).toContain('n2');
    expect(RESOURCES).toContain('polymers');
    expect(RESOURCES).toContain('pharma'); // hi-tech, import-only (D-046/D-045)
    expect(RESOURCES).toContain('chips');
    expect(RESOURCES.length).toBe(12);
  });
});
