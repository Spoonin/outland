import { describe, it, expect } from 'vitest';
import {
  newColony,
  defaultColonyParams,
  previewOrder,
  commitWindow,
  consumption,
  emptyOrder,
  type EarthOrder,
} from './colony';

const ord = (partial: Partial<EarthOrder>): EarthOrder => ({ ...emptyOrder(), ...partial });

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
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const pv = previewOrder(s, ord({ resources: { food: 100_000 } }));
    expect(pv.mass).toBeCloseTo(110_000, 0); // food tare 0.1
    expect(pv.goodsCost).toBeGreaterThan(0);
    // 5 pads × 5 × 16800 = 420k kg throughput → 100k ok
    expect(pv.capped).toBe(false);
  });

  it('gas tare adds ship mass (tank ≥ gas) but only the gas lands', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5 }));
    // o2 tare 1.0 → 50t of O₂ ships as ~100t
    const pv = previewOrder(s, ord({ resources: { o2: 50_000 } }));
    expect(pv.mass).toBeCloseTo(100_000, 0);
    // food tare 0.1 → 100t ships as 110t
    expect(previewOrder(s, ord({ resources: { food: 100_000 } })).mass).toBeCloseTo(110_000, 0);
    // only the gas lands as stock (tank is overhead)
    commitWindow(s, ord({ resources: { o2: 50_000 } }));
    const r2 = commitWindow(s, emptyOrder());
    expect(r2.landed.stocks.o2).toBe(50_000);
  });

  it('flags capped when convoy exceeds throughput', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const pv = previewOrder(s, ord({ resources: { water: 5_000_000 } }));
    expect(pv.capped).toBe(true); // 5M > 420k throughput
  });

  it('building pads raises throughput in the preview', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const base = previewOrder(s, emptyOrder()).throughput;
    const more = previewOrder(s, ord({ padsToBuild: { classic: 5, refuel: 0 } })).throughput;
    expect(more).toBeGreaterThan(base);
  });

  it('inflation raises costs over time', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const order: EarthOrder = ord({ resources: { food: 100_000 } });
    const t0 = previewOrder(s, order).goodsCost;
    s.window = 10;
    const t10 = previewOrder(s, order).goodsCost;
    expect(t10).toBeGreaterThan(t0);
  });
});

describe('commit window — transit lag, consumption, runway, mortality', () => {
  it('ordered goods land the NEXT window (Tsiolkovsky lag)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const before = s.stocks.food;
    commitWindow(s, ord({ resources: { food: 200_000 } }));
    // window 1: consumed food, nothing landed yet (order in transit)
    expect(s.stocks.food).toBeLessThan(before);
    const r2 = commitWindow(s, emptyOrder());
    // window 2: the 200k food convoy lands
    expect(r2.landed.stocks.food).toBe(200_000);
  });

  it('colonists arrive after the lag and grow population', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5 })); // well-fed: isolate colonist mechanic
    const p0 = s.pop;
    commitWindow(s, ord({ colonists: 50 }));
    expect(s.pop).toBeCloseTo(p0, 0); // not yet (in transit), minus any mortality
    commitWindow(s, emptyOrder());
    expect(s.pop).toBeGreaterThan(p0 - 1); // colonists landed
  });

  it('runway falls as stocks deplete without resupply (thesis seed)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 2 }));
    const r1 = commitWindow(s, emptyOrder());
    const r2 = commitWindow(s, emptyOrder());
    expect(r2.runway).toBeLessThan(r1.runway); // depleting → runway shrinks
  });

  it('starvation when life-support runs dry → mortality → collapse', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 0.3 }));
    let collapsed = false;
    for (let i = 0; i < 10 && !collapsed; i++) collapsed = commitWindow(s, emptyOrder()).collapsed;
    expect(collapsed).toBe(true);
  });
});

describe('Mars structures — build, energy, local production (V4, D-044)', () => {
  it('builds structures from money + local materials, consuming stock', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5 }));
    s.stocks.steel = 100_000; // seed materials so build is feasible
    s.stocks.glass = 100_000;
    const r = commitWindow(s, emptyOrder(), ['solar_plant', 'farm']);
    expect(r.built).toEqual(['solar_plant', 'farm']);
    expect(s.built['farm']).toBe(1);
    expect(s.stocks.steel).toBeLessThan(100_000); // materials consumed
  });

  it('refuses a structure whose prerequisite is missing (nuclear needs waste pad)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5 }));
    s.stocks.steel = 200_000;
    s.stocks.metals = 100_000;
    const r = commitWindow(s, emptyOrder(), ['nuclear_plant']); // no waste_pad
    expect(r.built).toEqual([]); // infeasible → nothing built
    expect(s.built['nuclear_plant']).toBeUndefined();
  });

  it('refuel R&D unlock + building refuel pads raises throughput', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const before = previewOrder(s, emptyOrder()).throughput;
    commitWindow(s, ord({ unlockRefuel: true, padsToBuild: { classic: 0, refuel: 2 } }));
    expect(s.fleet.refuelUnlocked).toBe(true);
    expect(s.fleet.pads.refuel).toBe(2);
    expect(previewOrder(s, emptyOrder()).throughput).toBeGreaterThan(before);
  });

  it('cannot build refuel pads before R&D unlock', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    commitWindow(s, ord({ padsToBuild: { classic: 0, refuel: 3 } })); // not unlocked
    expect(s.fleet.pads.refuel).toBe(0);
  });

  it('a guaranteed on-pad explosion loses a pad (D-043)', () => {
    const params = defaultColonyParams({ pop0: 1000,  startStockWindows: 5 });
    params.launch.classic.explodeProb = 1; // force it
    const s = newColony(params);
    const r = commitWindow(s, ord({ resources: { food: 50_000 } })); // ≥1 classic launch
    expect(r.explosions.classic).toBeGreaterThanOrEqual(1);
    expect(s.fleet.pads.classic).toBeLessThan(5);
  });

  it('hi-tech wall: polymer_plant browns out without imported catalyst, runs with it', () => {
    const params = defaultColonyParams({ pop0: 1000,  startStockWindows: 5 });
    const dry = newColony(params);
    dry.built = { solar_plant: 5, polymer_plant: 1 }; // powered, but no catalyst in stock
    const rDry = commitWindow(dry, emptyOrder());
    expect(rDry.stocks.polymers).toBe(0); // no catalyst → no local polymers

    const fed = newColony(params);
    fed.built = { solar_plant: 5, polymer_plant: 1 };
    fed.stocks.catalyst = 10_000; // imported hi-tech on hand
    const rFed = commitWindow(fed, emptyOrder());
    expect(rFed.stocks.polymers).toBeGreaterThan(0); // catalyst present → polymers produced
  });

  it('medbay + pharma enables births (D-030)', () => {
    const params = defaultColonyParams({ pop0: 1000,  startStockWindows: 5, birthRate: 0.1 });
    const s = newColony(params);
    s.built = { solar_plant: 3, medbay: 1 };
    s.stocks.pharma = 5_000;
    const p0 = s.pop;
    const r = commitWindow(s, emptyOrder());
    expect(r.pop).toBeGreaterThan(p0); // grew via births
  });

  it('no births without a medbay', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5, birthRate: 0.1 }));
    const p0 = s.pop;
    const r = commitWindow(s, emptyOrder());
    expect(r.pop).toBeLessThanOrEqual(p0); // no medbay → no growth
  });

  it('degradation: without spares condition falls and output drops (V6)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5, wearRate: 0.2 }));
    s.built = { solar_plant: 4, steel_plant: 1 };
    s.condition = { solar_plant: 1, steel_plant: 1 };
    // no spares in stock or order → coverage 0 → condition decays
    const r1 = commitWindow(s, emptyOrder());
    const steel1 = r1.stocks.steel;
    expect(r1.avgCondition).toBeLessThan(1);
    expect(r1.sparesCoverage).toBe(0);
    const r2 = commitWindow(s, emptyOrder());
    expect(r2.avgCondition).toBeLessThan(r1.avgCondition); // keeps degrading
    expect(r2.stocks.steel - steel1).toBeLessThan(steel1 - 0); // steel output shrinking as plant decays
  });

  it('spares maintenance holds condition at full (V6)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5, wearRate: 0.2 }));
    s.built = { solar_plant: 4, steel_plant: 1 };
    s.condition = { solar_plant: 1, steel_plant: 1 };
    s.stocks.spares = 1_000_000; // plenty
    const r = commitWindow(s, emptyOrder());
    expect(r.sparesCoverage).toBe(1);
    expect(r.avgCondition).toBe(1); // fully maintained → no decay
  });

  it('water now drains without a recycler (η baseline lowered, V6)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 1 }));
    const before = s.stocks.water;
    const r = commitWindow(s, emptyOrder()); // no recycler built
    // net = gross·(1−0.3) = 70% of 100k = 70k drained
    expect(before - r.stocks.water).toBeGreaterThan(60_000);
  });

  it('local food production extends the runway (autonomy climbs)', () => {
    const base = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 2 }));
    const baseRun = commitWindow(base, emptyOrder()).runway;

    const farmed = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 2 }));
    farmed.stocks.steel = 100_000;
    farmed.stocks.glass = 100_000;
    // power + farm online; farm overproduces food vs consumption → food no longer the drain
    farmed.built = { solar_plant: 2, farm: 1 };
    const farmedRun = commitWindow(farmed, emptyOrder()).runway;
    expect(farmedRun).toBeGreaterThan(baseRun);
  });
});

describe('V7: atmosphere & BIOS — housing, N₂ structural leak, concentrator (D-048)', () => {
  it('housingCapacity sums habitat slots across built structures', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5 }));
    s.built = { habitat: 3 };
    s.condition = { habitat: 1 };
    s.stocks.n2 = 100_000;
    const r = commitWindow(s, emptyOrder());
    expect(r.housingCapacity).toBe(600); // 3 × 200
  });

  it('habitat N₂ leak shows as structural cost — drains N₂ stock without import/ISRU', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5 }));
    s.built = { habitat: 2 };
    s.condition = { habitat: 1 };
    s.stocks.n2 = 10_000; // buffer
    const r = commitWindow(s, emptyOrder());
    expect(r.n2LeakKg).toBeGreaterThan(0); // 2 × 500 kg
    expect(r.stocks.n2).toBeLessThan(10_000); // drained by leak
  });

  it('N₂ shortage from habitat leak causes mortality (N₂ in LIFE_R)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5 }));
    s.built = { habitat: 3 };
    s.condition = { habitat: 1 };
    s.stocks.n2 = 0; // no N₂ — atmosphere collapses
    const r = commitWindow(s, emptyOrder());
    expect(r.mortality).toBeGreaterThan(0); // N₂ deficit → people die
  });

  it('n2_concentrator produces N₂ that covers habitat leak', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5 }));
    s.built = { solar_plant: 3, habitat: 5, n2_concentrator: 1 };
    s.condition = { solar_plant: 1, habitat: 1, n2_concentrator: 1 };
    s.stocks.n2 = 0;
    const r = commitWindow(s, emptyOrder());
    // concentrator (10000 kg) > 5 habitats × 500 kg = 2500 kg leak → surplus
    expect(r.stocks.n2).toBeGreaterThan(0);
    expect(r.deficit.n2).toBeUndefined(); // no deficit
  });

  it('housing gates births: overcrowded colony cannot grow (V7)', () => {
    const params = defaultColonyParams({ pop0: 1000,  startStockWindows: 5, birthRate: 0.1 });
    const s = newColony(params); // pop=1000
    s.built = { solar_plant: 3, medbay: 1, habitat: 3 }; // 600 slots < 1000 pop
    s.condition = { solar_plant: 1, medbay: 1, habitat: 1 };
    s.stocks.pharma = 5_000;
    s.stocks.n2 = 100_000;
    const p0 = s.pop;
    const r = commitWindow(s, emptyOrder());
    expect(r.pop).toBeLessThanOrEqual(p0); // overcrowded → births blocked
  });

  it('housing allows births when colony has room (V7)', () => {
    const params = defaultColonyParams({ pop0: 1000,  startStockWindows: 5, birthRate: 0.1 });
    const s = newColony(params); // pop=1000
    s.built = { solar_plant: 3, medbay: 1, habitat: 6 }; // 1200 slots > 1000 pop
    s.condition = { solar_plant: 1, medbay: 1, habitat: 1 };
    s.stocks.pharma = 5_000;
    s.stocks.n2 = 100_000;
    const p0 = s.pop;
    const r = commitWindow(s, emptyOrder());
    expect(r.pop).toBeGreaterThan(p0); // room available → births proceed
  });

  it('no housing built → unconstrained (backward compat: births work as before V7)', () => {
    const params = defaultColonyParams({ pop0: 1000,  startStockWindows: 5, birthRate: 0.1 });
    const s = newColony(params);
    s.built = { solar_plant: 3, medbay: 1 };
    s.stocks.pharma = 5_000;
    const p0 = s.pop;
    const r = commitWindow(s, emptyOrder());
    expect(r.housingCapacity).toBe(0); // no habitats
    expect(r.pop).toBeGreaterThan(p0); // still grows (unconstrained)
  });
});

describe('colony starts from zero — extinction & famine-blocked births (redesign)', () => {
  it('default params start with no colonists at all', () => {
    const s = newColony(defaultColonyParams());
    expect(s.pop).toBe(0);
    expect(s.everHadPop).toBe(false);
  });

  it('a colony that never had colonists does not read as collapsed', () => {
    const s = newColony(defaultColonyParams());
    const r = commitWindow(s, emptyOrder());
    expect(r.pop).toBe(0);
    expect(r.collapsed).toBe(false); // nobody ever landed — not a collapse, just an empty Mars
  });

  it('a starved colony dies out completely within a handful of windows, not asymptotically', () => {
    const s = newColony(defaultColonyParams({ pop0: 50, startStockWindows: 0 })); // zero buffer, zero resupply
    let r = commitWindow(s, emptyOrder());
    let windows = 1;
    while (!r.collapsed && windows < 10) {
      r = commitWindow(s, emptyOrder());
      windows++;
    }
    expect(r.collapsed).toBe(true);
    expect(r.pop).toBe(0); // literal extinction, not a fading fraction of a person
    expect(windows).toBeLessThan(10); // dies fast under total scarcity
  });

  it('births do not proc the same window the colony is starving (famine blocks growth)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 0, birthRate: 0.1 }));
    s.built = { medbay: 1 };
    s.stocks.pharma = 5_000;
    s.stocks.n2 = 100_000; // no housing built → N₂/housing not the binding constraint
    // no food/water/o2 in stock and none ordered → starving this window
    const r = commitWindow(s, emptyOrder());
    expect(r.mortality).toBeGreaterThan(0);
    expect(r.pop).toBeLessThan(1000); // mortality outweighs any birth proc
  });
});
