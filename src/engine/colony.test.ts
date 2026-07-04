import { describe, it, expect } from 'vitest';
import {
  newColony,
  defaultColonyParams,
  previewOrder,
  commitWindow,
  consumption,
  emptyOrder,
  bufferRunway,
  BUFFER_LOOKAHEAD,
  collapseRunway,
  COLLAPSE_LOOKAHEAD,
  type EarthOrder,
} from './colony';
import { rollEvent } from './events';
import { makeRng } from './rng';

const ord = (partial: Partial<EarthOrder>): EarthOrder => ({ ...emptyOrder(), ...partial });

/** Finds a seed that makes the storyteller fire the given event id on `window`, with a chance
 * config that always fires (used to make D-063 tests deterministic instead of asserting on luck).
 * Population only shifts the rolled magnitude, never the draw sequence, so which event the seed
 * lands on is pop-independent — pop 0 here matches any in-game pop. */
function seedForEvent(targetId: string, window = 1): number {
  const cfg = { eventStartWindow: 0, eventRampPerWindow: 1, eventChanceCap: 1, eventPopRef: 500 };
  for (let seed = 1; seed < 5000; seed++) {
    const roll = rollEvent(window, 0, cfg, undefined, makeRng(seed));
    if (roll?.spec.id === targetId) return seed;
  }
  throw new Error(`no seed found for event ${targetId}`);
}
const ALWAYS_FIRE = { eventStartWindow: 0, eventRampPerWindow: 1, eventChanceCap: 1 };

/** A colony whose local production fully covers 100 colonists at HONEST per-capita masses (D-066):
 * food 80 000 ≥ 50 000 · water 240 000 ≥ (240 000+20 000)×0.7 · O₂ 60 000 ≥ 46 200 · energy 400 ≥ 335. */
function selfSufficient100(overrides = {}): ReturnType<typeof newColony> {
  const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5, ...overrides }));
  s.built = { solar_plant: 4, farm: 1, water_recycler: 3, o2_generator: 4 };
  s.condition = Object.fromEntries(Object.keys(s.built).map((id) => [id, 1]));
  s.stocks.spares = 1_000_000; // upkeep fully covered — no wear over any lookahead
  return s;
}

describe('colony v2 — consumption & startup (D-042/colony-sim)', () => {
  it('life-support consumption scales with population (honest per-capita masses, D-066)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const c = consumption(s);
    expect(c.food).toBe(500 * 1000); // ~0.63 kg dry food/day over a ~790-day window
    expect(c.water).toBe(2400 * 1000); // ~3 kg/day potable+hygiene
    expect(c.steel).toBeUndefined(); // not life-support
  });

  it('seeds a startStockWindows buffer', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 1 }));
    expect(s.stocks.food).toBe(500 * 1000); // ~1 window of food
  });
});

describe('order preview (manifest math)', () => {
  it('sums goods cost+mass, flags over-throughput', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const pv = previewOrder(s, ord({ resources: { food: 30_000 } }));
    expect(pv.mass).toBeCloseTo(33_000, 0); // food tare 0.1
    expect(pv.goodsCost).toBeGreaterThan(0);
    // 5 pads × 5 × 3,000 = 75t starting throughput (D-067) → 33t ok
    expect(pv.capped).toBe(false);
  });

  it('gas tare adds ship mass (tank ≥ gas) but only the gas lands', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5 }));
    // o2 tare 1.0 → 20t of O₂ ships as ~40t
    const pv = previewOrder(s, ord({ resources: { o2: 20_000 } }));
    expect(pv.mass).toBeCloseTo(40_000, 0);
    // food tare 0.1 → 30t ships as 33t
    expect(previewOrder(s, ord({ resources: { food: 30_000 } })).mass).toBeCloseTo(33_000, 0);
    // only the gas lands as stock (tank is overhead)
    commitWindow(s, ord({ resources: { o2: 20_000 } }));
    const r2 = commitWindow(s, emptyOrder());
    expect(r2.landed.stocks.o2).toBe(20_000);
  });

  it('flags capped when convoy exceeds throughput', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const pv = previewOrder(s, ord({ resources: { water: 5_000_000 } }));
    expect(pv.capped).toBe(true); // 5M > 75t throughput
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
  it('preview equals charge: an order exactly at budget still ships (no hidden +1 inflation step)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const order = ord({ resources: { food: 40_000 } });
    s.p = { ...s.p, M: previewOrder(s, order).total }; // budget = the displayed price, to the dollar
    commitWindow(s, order);
    expect(s.inTransit.stocks.food).toBe(40_000); // pre-fix: repriced +3% inside commit → silently rejected
  });

  it('ordered goods land the NEXT window (Tsiolkovsky lag)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const before = s.stocks.food;
    commitWindow(s, ord({ resources: { food: 40_000 } })); // 44t ship ≤ 75t throughput (D-067)
    // window 1: consumed food, nothing landed yet (order in transit)
    expect(s.stocks.food).toBeLessThan(before);
    const r2 = commitWindow(s, emptyOrder());
    // window 2: the 40k food convoy lands
    expect(r2.landed.stocks.food).toBe(40_000);
  });

  it('colonists arrive after the lag and grow population', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000,  startStockWindows: 5 })); // well-fed: isolate colonist mechanic
    s.built.solar_plant = 1; // powered: isolate colonist-lag from unrelated energy mortality (D-060)
    s.condition.solar_plant = 1;
    const p0 = s.pop;
    commitWindow(s, ord({ colonists: 30 })); // 60t of people ≤ 75t throughput (D-067)
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

  it('refuel R&D stage 1 + building refuel pads raises throughput', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const before = previewOrder(s, emptyOrder()).throughput;
    commitWindow(s, ord({ unlockRefuel: true, padsToBuild: { classic: 0, refuel: 2 } }));
    expect(s.fleet.refuelStage).toBe(1);
    expect(s.fleet.pads.refuel).toBe(2);
    expect(previewOrder(s, emptyOrder()).throughput).toBeGreaterThan(before);
  });

  it('R&D stages buy sequentially and stop at the top of the ladder (D-068)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    const stage1Cost = previewOrder(s, ord({ unlockRefuel: true })).rndCost;
    commitWindow(s, ord({ unlockRefuel: true })); // → stage 1 (test-era: 60t campaigns)
    expect(s.fleet.refuelStage).toBe(1);
    const stage2Cost = previewOrder(s, ord({ unlockRefuel: true })).rndCost;
    expect(stage2Cost).toBeGreaterThan(0);
    expect(stage2Cost).not.toBeCloseTo(stage1Cost, -6); // a different rung, not a re-buy
    commitWindow(s, ord({ unlockRefuel: true })); // → stage 2 (serial fleet: 100t)
    expect(s.fleet.refuelStage).toBe(2);
    expect(previewOrder(s, ord({ unlockRefuel: true })).rndCost).toBe(0); // ladder complete — nothing to buy
    commitWindow(s, ord({ unlockRefuel: true }));
    expect(s.fleet.refuelStage).toBe(2); // capped
  });

  it('the R&D stage upgrades EXISTING refuel pads (better ships, same complexes)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000 }));
    commitWindow(s, ord({ unlockRefuel: true, padsToBuild: { classic: 0, refuel: 1 } }));
    const atStage1 = previewOrder(s, emptyOrder()).throughput;
    commitWindow(s, ord({ unlockRefuel: true }));
    const atStage2 = previewOrder(s, emptyOrder()).throughput;
    expect(atStage2 - atStage1).toBe(5 * (100_000 - 60_000)); // same 1 pad, stage payload 60t → 100t
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

describe('import finished structures from Earth (V8, D-057)', () => {
  it('previewOrder prices a structure import at its capex (a complex durable unit, not scrap metal)', () => {
    const s = newColony(defaultColonyParams());
    const pv = previewOrder(s, ord({ structures: { habitat: 1 } }));
    // habitat buildMaterials: steel 6000, glass 4000, polymers 1000 (shipping mass only)
    const expectMass = 6000 * (1 + s.p.catalog.steel.tare) + 4000 * (1 + s.p.catalog.glass.tare) + 1000 * (1 + s.p.catalog.polymers.tare);
    expect(pv.mass).toBeCloseTo(expectMass, 0);
    expect(pv.structCost).toBeCloseTo(3e9, 0); // habitat capex, window 0 (no inflation yet)
  });

  it('an imported structure lands built and ready — no extra local assembly window', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    s.stocks.spares = 1000; // fully covered upkeep so wear doesn't muddy this check
    commitWindow(s, ord({ structures: { habitat: 1 } })); // ship
    expect(s.built.habitat ?? 0).toBe(0); // still in transit
    const r = commitWindow(s, emptyOrder()); // land
    expect(s.built.habitat).toBe(1);
    expect(s.condition.habitat).toBe(1);
    expect(r.built).toContain('habitat');
    expect(r.housingCapacity).toBe(200); // usable the same commit it lands
  });

  it('base_block is a self-sufficient 20-person bootstrap unit (own water/O₂/N₂ production)', () => {
    const s = newColony(defaultColonyParams({ pop0: 20, startStockWindows: 0 }));
    s.built = { base_block: 1 };
    s.condition = { base_block: 1 };
    s.stocks.food = 1_000_000; // isolate the check to water/O₂/N₂ (base_block doesn't grow food)
    s.stocks.spares = 1_000; // fully covered upkeep so wear doesn't throttle this window's output
    const r = commitWindow(s, emptyOrder());
    expect(r.housingCapacity).toBe(20);
    expect(r.mortality).toBe(0); // life support fully covers its own 20 colonists
  });

  it('importing a structure with an unmet prereq makes the whole order infeasible', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    // nuclear_plant needs waste_pad, which isn't built
    const r = commitWindow(s, ord({ structures: { nuclear_plant: 1 } }));
    expect(r.spent).toBe(0); // order rejected, nothing charged
    commitWindow(s, emptyOrder()); // nothing was in transit to land
    expect(s.built.nuclear_plant ?? 0).toBe(0); // never landed
  });
});

describe('chronicle — per-window causality report (D-061)', () => {
  it('commitWindow appends its own report to state.chronicle, in order', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }));
    const r1 = commitWindow(s, emptyOrder());
    const r2 = commitWindow(s, emptyOrder());
    expect(s.chronicle.length).toBe(2);
    expect(s.chronicle[0]).toBe(r1);
    expect(s.chronicle[1]).toBe(r2);
    expect(s.chronicle[0]!.window).toBe(1);
    expect(s.chronicle[1]!.window).toBe(2);
  });

  it('names the mortality cause — worst life-support shortfall (Liebig)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 0 })); // starving immediately
    const r = commitWindow(s, emptyOrder());
    expect(r.mortality).toBeGreaterThan(0);
    const causes = Object.keys(r.mortalityBreakdown);
    expect(causes.length).toBeGreaterThan(0);
    const total = Object.values(r.mortalityBreakdown).reduce((a, n) => a + (n ?? 0), 0);
    expect(total).toBeCloseTo(r.mortality, 0);
  });

  it('names energy brownout as a separate mortality cause (D-059/D-060)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 })); // fed, but unpowered
    const r = commitWindow(s, emptyOrder());
    expect(r.mortality).toBeGreaterThan(0);
    expect(r.mortalityBreakdown.energy).toBeGreaterThan(0);
  });

  it('reports structure output diagnostics (condition × energy × inputs)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }));
    s.built = { solar_plant: 2, farm: 1 };
    s.condition = { solar_plant: 1, farm: 1 };
    s.stocks.water = 1_000_000; // isolate energy/condition from an input-availability cap
    s.stocks.spares = 1_000_000; // fully covered upkeep so wear doesn't shift condition off 1
    const r = commitWindow(s, emptyOrder());
    const d = r.structDiag.farm!;
    expect(d.condition).toBe(1);
    expect(d.runFrac).toBeCloseTo(d.condition * d.energyFrac * d.inputFrac, 5);
  });

  it('births are counted and reported', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5, birthRate: 0.1 }));
    s.built = { solar_plant: 3, medbay: 1 };
    s.condition = { solar_plant: 1, medbay: 1 };
    s.stocks.pharma = 5_000;
    const r = commitWindow(s, emptyOrder());
    expect(r.births).toBeGreaterThan(0);
  });

  it('autonomyByMass is 0 when no mass moved yet (order still in transit, no local production)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }));
    const r = commitWindow(s, ord({ resources: { food: 30_000 } })); // ships this window, lands next
    expect(r.autonomyByMass).toBe(0);
  });

  it('autonomyByMass is 1 when this window moved only local production, nothing imported', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }));
    s.built = { solar_plant: 2, farm: 1 };
    s.condition = { solar_plant: 1, farm: 1 };
    s.stocks.water = 1_000_000;
    const r = commitWindow(s, emptyOrder());
    expect(r.autonomyByMass).toBe(1);
  });

  it('autonomyByMass splits between an imported convoy landing and this window\'s local production', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }));
    s.built = { solar_plant: 2, farm: 1 };
    s.condition = { solar_plant: 1, farm: 1 };
    s.stocks.water = 6_000_000; // enough for two windows of honest 1000-pop draw — farm inputs stay full
    commitWindow(s, ord({ resources: { food: 30_000 } })); // ships (33t ≤ 75t throughput, D-067)
    const r = commitWindow(s, emptyOrder()); // convoy lands alongside local farm output
    expect(r.autonomyByMass).toBeGreaterThan(0);
    expect(r.autonomyByMass).toBeLessThan(1);
  });
});

describe('bufferRunway — honest self-sufficiency simulation (D-062)', () => {
  it('an empty colony (no colonists yet) has zero buffer', () => {
    const s = newColony(defaultColonyParams());
    expect(bufferRunway(s)).toBe(0);
  });

  it('a colony with no stock buffer and no production dies on the very first simulated window', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 0 }));
    expect(bufferRunway(s)).toBe(0); // starves immediately once imports stop
  });

  it('windows survived matches the actual first-death window under a real zero-import run', () => {
    // events off so the real replay matches the (always events-off) gauge simulation exactly
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 2, eventChanceCap: 0 }));
    const buf = bufferRunway(s);
    // replay the same zero-order sequence for real and find where mortality first appears
    let firstDeathAt = -1;
    for (let i = 1; i <= BUFFER_LOOKAHEAD; i++) {
      const r = commitWindow(s, emptyOrder());
      if (r.mortality > 0) {
        firstDeathAt = i;
        break;
      }
    }
    expect(firstDeathAt).toBeGreaterThan(0);
    expect(buf).toBe(firstDeathAt - 1); // buf windows survived cleanly before the first death
  });

  it('does not mutate the real state — it runs on a throwaway clone', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 2 }));
    const windowBefore = s.window;
    const popBefore = s.pop;
    const chronicleBefore = s.chronicle.length;
    bufferRunway(s);
    expect(s.window).toBe(windowBefore);
    expect(s.pop).toBe(popBefore);
    expect(s.chronicle.length).toBe(chronicleBefore);
  });

  it('a fully self-sufficient, powered, well-fed colony saturates at the lookahead cap', () => {
    // production > consumption on every LIFE_R resource, so this isn't just coasting on the buffer
    expect(bufferRunway(selfSufficient100())).toBe(BUFFER_LOOKAHEAD);
  });

  it('does not foresee future storyteller events — no telegraph through the gauge (D-063)', () => {
    // same colony, same seed; one config would fire events every simulated window, the other never.
    // The gauge must not differ: the counterfactual measures buffers, not upcoming luck.
    const seed = seedForEvent('epidemic');
    const base = { pop0: 1000, startStockWindows: 6, seed };
    const withStoryteller = newColony(defaultColonyParams({ ...base, ...ALWAYS_FIRE }));
    const without = newColony(defaultColonyParams({ ...base, eventChanceCap: 0 }));
    expect(bufferRunway(withStoryteller)).toBe(bufferRunway(without));
  });

  it('each real window report carries the gauge value; simulated windows never do (D-062→D-061)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 3, eventChanceCap: 0 }));
    const r = commitWindow(s, emptyOrder());
    expect(r.buffer).toBe(bufferRunway(s)); // stored = freshly measured (same committed state)
    // the gauge's own simulation must not have polluted the real chronicle
    expect(s.chronicle.length).toBe(1);
  });
});

describe('storyteller events — engine integration (D-063)', () => {
  it('a dust storm bites the SAME window it fires — the player committed blind, no telegraph', () => {
    const seed = seedForEvent('dust_storm');
    const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    s.built = { solar_plant: 2 };
    s.condition = { solar_plant: 1 };
    s.stocks.spares = 1_000_000; // upkeep fully covered — isolate from wear, not what this test checks
    const r1 = commitWindow(s, emptyOrder());
    expect(r1.event?.id).toBe('dust_storm');
    expect(r1.energyGen).toBeLessThan(200); // generation already cut this window
    expect(s.lastEvent).toEqual({ id: 'dust_storm', window: 1 });
  });

  it('a multi-window storm keeps biting the following window(s), then lifts', () => {
    const seed = seedForEvent('dust_storm');
    const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    s.built = { solar_plant: 2 };
    s.condition = { solar_plant: 1 };
    s.stocks.spares = 1_000_000;
    const r1 = commitWindow(s, emptyOrder()); // storm fires + bites
    s.p.eventChanceCap = 0; // no fresh rolls — isolate the storm's tail
    const dur = r1.event!.windows;
    for (let w = 2; w <= dur; w++) {
      expect(commitWindow(s, emptyOrder()).energyGen).toBeLessThan(200); // still raging
    }
    expect(commitWindow(s, emptyOrder()).energyGen).toBeCloseTo(200, 0); // storm over
  });

  it('subsidy_cut shrinks next window\'s effective budget', () => {
    const seed = seedForEvent('subsidy_cut');
    const s = newColony(defaultColonyParams({ seed, ...ALWAYS_FIRE }));
    const r1 = commitWindow(s, emptyOrder());
    expect(r1.event?.id).toBe('subsidy_cut');
    s.p.eventChanceCap = 0;
    const pv = previewOrder(s, emptyOrder());
    expect(pv.budget).toBeLessThan(s.p.M);
  });

  it('price_spike raises next window\'s cost for the affected category only', () => {
    const seed = seedForEvent('price_spike');
    const s = newColony(defaultColonyParams({ seed, ...ALWAYS_FIRE }));
    const r1 = commitWindow(s, emptyOrder());
    expect(r1.event?.id).toBe('price_spike');
    const r = r1.event!.category![0]!;
    const withSpike = previewOrder(s, ord({ resources: { [r]: 1000 } })).goodsCost;
    const noSpike = structuredClone(s);
    noSpike.activeEffects = [];
    const withoutSpike = previewOrder(noSpike, ord({ resources: { [r]: 1000 } })).goodsCost;
    expect(withSpike).toBeGreaterThan(withoutSpike);
  });

  it('blight cuts farm output the window it fires, leaves non-farm structures alone', () => {
    const seed = seedForEvent('blight');
    const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    s.built = { solar_plant: 2, farm: 1, steel_plant: 1 };
    s.condition = { solar_plant: 1, farm: 1, steel_plant: 1 };
    s.stocks.water = 1_000_000;
    s.stocks.spares = 1_000_000;
    const r1 = commitWindow(s, emptyOrder()); // blight fires + bites, same window
    expect(r1.event?.id).toBe('blight');
    expect(r1.structDiag.farm!.runFrac).toBeLessThan(1);
    expect(r1.structDiag.steel_plant!.runFrac).toBeCloseTo(1, 5); // blight only touches food producers
  });

  it('skip_window delays this window\'s shipment by one extra window (arrives with the next)', () => {
    const seed = seedForEvent('skip_window');
    const s = newColony(defaultColonyParams({ seed, ...ALWAYS_FIRE }));
    const r1 = commitWindow(s, ord({ resources: { food: 50_000 } })); // ships, but skip fires
    expect(r1.event?.id).toBe('skip_window');
    s.p.eventChanceCap = 0;
    const r2 = commitWindow(s, emptyOrder()); // would normally land here
    expect(r2.landed.stocks.food ?? 0).toBe(0);
    const r3 = commitWindow(s, emptyOrder());
    expect(r3.landed.stocks.food).toBe(50_000); // arrives one window late, undiminished
  });

  it('epidemic kills the uncovered; medbay+pharma coverage cuts it to a minimal rate + pharma cost', () => {
    const seed = seedForEvent('epidemic');

    const uncovered = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    uncovered.built = { solar_plant: 3 };
    uncovered.condition = { solar_plant: 1 };
    const rUncovered = commitWindow(uncovered, emptyOrder());
    expect(rUncovered.event?.id).toBe('epidemic');
    expect(rUncovered.event?.covered).toBe(false);
    expect(rUncovered.mortalityBreakdown.epidemic).toBeGreaterThan(0);

    const covered = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    covered.built = { solar_plant: 3, medbay: 1 };
    covered.condition = { solar_plant: 1, medbay: 1 };
    covered.stocks.pharma = 10_000;
    const rCovered = commitWindow(covered, emptyOrder());
    expect(rCovered.event?.id).toBe('epidemic');
    expect(rCovered.event?.covered).toBe(true);
    expect(rCovered.mortalityBreakdown.epidemic!).toBeLessThan(rUncovered.mortalityBreakdown.epidemic!);
    expect(covered.stocks.pharma).toBeLessThan(10_000); // one-time pharma draw
  });

  it('the same event cannot fire two windows in a row', () => {
    const seed = seedForEvent('dust_storm');
    const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    s.built = { solar_plant: 2 };
    s.condition = { solar_plant: 1 };
    const r1 = commitWindow(s, emptyOrder());
    expect(r1.event?.id).toBe('dust_storm');
    const r2 = commitWindow(s, emptyOrder()); // chance is still 1 (ALWAYS_FIRE) — something else must fire
    expect(r2.event).toBeDefined();
    expect(r2.event?.id).not.toBe('dust_storm');
  });
});

describe('disaster events — breach / radiation / outage / crash (D-072)', () => {
  it('hull_breach vents a fraction of the N₂ bank; zero ЗИП coverage → full uncovered deaths', () => {
    const seed = seedForEvent('hull_breach');
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    s.built = { solar_plant: 3 }; // upkeep 900/window, zero spares stock → coverage 0, patch crews empty-handed
    s.condition = { solar_plant: 1 };
    s.stocks.n2 = 100_000;
    const r = commitWindow(s, emptyOrder());
    expect(r.event?.id).toBe('hull_breach');
    expect(r.event?.coverage).toBeCloseTo(0, 5);
    expect(r.mortalityBreakdown.breach).toBeGreaterThan(0);
    expect(s.stocks.n2).toBeLessThanOrEqual(100_000 * (1 - 0.15)); // ≥ minMag vented
    expect(s.stocks.n2).toBeGreaterThanOrEqual(100_000 * (1 - 0.35)); // ≤ maxMag vented
  });

  it('hull_breach with full ЗИП coverage is patched — minimal covered mortality', () => {
    const seed = seedForEvent('hull_breach');
    const covered = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    covered.built = { solar_plant: 3 };
    covered.condition = { solar_plant: 1 };
    covered.stocks.n2 = 100_000;
    covered.stocks.spares = 1_000_000; // coverage 1 — patch kits on hand
    const r = commitWindow(covered, emptyOrder());
    expect(r.event?.id).toBe('hull_breach');
    expect(r.event?.coverage).toBeCloseTo(1, 5);
    expect(r.mortalityBreakdown.breach ?? 0).toBeLessThan(10); // coveredMag 0.004 ≈ 4 of 1000, not 40
    expect(covered.stocks.n2).toBeLessThan(100_000); // the hole still vents — cover saves people, not gas
  });

  it('hull_breach deaths grade with partial ЗИП coverage, not a binary cliff (playtest-3)', () => {
    // autoSpares floors the order at EXACT upkeep, and the 1-window shipping lag leaves a growing
    // colony sitting at ~0.85-0.95 coverage almost permanently — a >=1 cliff would treat that
    // near-miss as if no spares existed at all. Deaths must strictly decrease as coverage rises.
    const seed = seedForEvent('hull_breach');
    const upkeep = 900; // 3× solar_plant × upkeepSpares 300
    const at = (coverageFrac: number) => {
      const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
      s.built = { solar_plant: 3 };
      s.condition = { solar_plant: 1 };
      s.stocks.n2 = 100_000;
      s.stocks.spares = upkeep * coverageFrac;
      return commitWindow(s, emptyOrder());
    };
    const zero = at(0);
    const half = at(0.5);
    const full = at(1);
    expect(zero.event?.coverage).toBeCloseTo(0, 5);
    expect(half.event?.coverage).toBeCloseTo(0.5, 5);
    expect(full.event?.coverage).toBeCloseTo(1, 5);
    expect(zero.mortalityBreakdown.breach!).toBeGreaterThan(half.mortalityBreakdown.breach!);
    expect(half.mortalityBreakdown.breach!).toBeGreaterThan(full.mortalityBreakdown.breach ?? 0);
  });

  it('solar_flare throttles ALL structure output (not just farms) the same window it fires', () => {
    const seed = seedForEvent('solar_flare');
    const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    s.built = { solar_plant: 3, steel_plant: 1, medbay: 1 };
    s.condition = { solar_plant: 1, steel_plant: 1, medbay: 1 };
    s.stocks.spares = 1_000_000;
    s.stocks.pharma = 10_000;
    const r = commitWindow(s, emptyOrder());
    expect(r.event?.id).toBe('solar_flare');
    expect(r.event?.covered).toBe(true); // medbay + pharma = anti-rad meds
    expect(r.structDiag.steel_plant!.runFrac).toBeLessThanOrEqual(0.5); // mag ≥ 0.5 hits non-food producers too
    expect(r.energyGen).toBeLessThanOrEqual(150); // generation shelters as well (3×100 × ≤0.5)
  });

  it('struct_outage knocks one working structure to zero for its whole duration, then it restarts', () => {
    const seed = seedForEvent('struct_outage');
    const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    s.built = { solar_plant: 2, farm: 1 }; // farm is the only produces/consumes candidate → deterministic target
    s.condition = { solar_plant: 1, farm: 1 };
    s.stocks.water = 1_000_000;
    s.stocks.spares = 1_000_000;
    const r1 = commitWindow(s, emptyOrder());
    expect(r1.event?.id).toBe('struct_outage');
    expect(r1.event?.target).toBe('farm');
    expect(r1.structDiag.farm!.runFrac).toBe(0);
    s.p.eventChanceCap = 0; // no fresh rolls — isolate the outage's tail
    for (let w = 2; w <= r1.event!.windows; w++) {
      expect(commitWindow(s, emptyOrder()).structDiag.farm!.runFrac).toBe(0); // still down
    }
    expect(commitWindow(s, emptyOrder()).structDiag.farm!.runFrac).toBeGreaterThan(0); // back online
  });

  it('struct_outage with nothing operable built is a dud — no target, nothing breaks', () => {
    const seed = seedForEvent('struct_outage');
    const s = newColony(defaultColonyParams({ pop0: 0, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    const r = commitWindow(s, emptyOrder());
    expect(r.event?.id).toBe('struct_outage');
    expect(r.event?.target).toBeUndefined();
  });

  it('convoy_crash burns part of the landing convoy — cargo lost, colonists aboard die as `crash`', () => {
    const seed = seedForEvent('convoy_crash');
    const s = newColony(defaultColonyParams({ startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    s.built = { habitat: 1 };
    s.condition = { habitat: 1 };
    for (const r of ['food', 'water', 'o2', 'n2'] as const) s.stocks[r] = 1_000_000; // isolate crash deaths
    s.inTransit = { stocks: { ...s.inTransit.stocks, food: 100_000 }, colonists: 10, structures: {} };
    const r = commitWindow(s, emptyOrder());
    expect(r.event?.id).toBe('convoy_crash');
    expect(r.event?.deaths).toBeGreaterThan(0);
    expect(r.mortalityBreakdown.crash).toBe(r.event?.deaths);
    expect(r.mortality).toBeGreaterThanOrEqual(r.event!.deaths!); // crash deaths counted in the window's toll
    expect(r.landed.stocks.food).toBeLessThan(100_000); // part of the cargo burned on entry
    expect(r.landed.stocks.food).toBeGreaterThan(0); // mag ≤ 0.6 — part survives
    expect(s.pop).toBeGreaterThan(0);
    expect(s.pop).toBeLessThan(10); // survivors only
    expect(r.milestones).toContain('first_landing'); // someone DID land alive
    expect(r.milestones).not.toContain('zero_import'); // a crashed convoy is not independence
  });
});

describe('milestones — a checklist, never a reward (D-064)', () => {
  it('first_landing fires the window colonists actually land', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    s.built = { habitat: 1 };
    s.condition = { habitat: 1 };
    commitWindow(s, ord({ colonists: 10 })); // ships
    expect(s.milestones.first_landing).toBeUndefined();
    const r = commitWindow(s, emptyOrder()); // lands
    expect(r.milestones).toContain('first_landing');
    expect(s.milestones.first_landing).toBe(2);
  });

  it('first_birth fires the window a birth actually occurs, only once', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5, birthRate: 0.1 }));
    s.built = { solar_plant: 3, medbay: 1 };
    s.condition = { solar_plant: 1, medbay: 1 };
    s.stocks.pharma = 5_000;
    const r1 = commitWindow(s, emptyOrder());
    expect(r1.births).toBeGreaterThan(0);
    expect(r1.milestones).toContain('first_birth');
    s.stocks.pharma = 5_000; // keep feeding births
    const r2 = commitWindow(s, emptyOrder());
    expect(r2.milestones).not.toContain('first_birth'); // recorded once
    expect(s.milestones.first_birth).toBe(1);
  });

  it('pop_100 fires once population crosses 100', () => {
    const s = newColony(defaultColonyParams({ pop0: 150, startStockWindows: 5 }));
    const r = commitWindow(s, emptyOrder());
    expect(r.milestones).toContain('pop_100');
  });

  it('bulk_autonomy fires only when local production fully covers food/water/O₂/N₂', () => {
    const bare = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5 }));
    const rBefore = commitWindow(bare, emptyOrder()); // pure import — not bulk-autonomous
    expect(rBefore.milestones).not.toContain('bulk_autonomy');

    const s = selfSufficient100();
    const rAfter = commitWindow(s, emptyOrder());
    expect(rAfter.milestones).toContain('bulk_autonomy');
  });

  it('buffer_2 fires once the honest buffer gauge reaches 2 windows', () => {
    const s = selfSufficient100();
    const r = commitWindow(s, emptyOrder());
    expect(bufferRunway(s)).toBeGreaterThanOrEqual(2);
    expect(r.milestones).toContain('buffer_2');
  });

  it('event_survived fires when a deadly effect applies and nobody dies that window', () => {
    const seed = seedForEvent('dust_storm');
    const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    s.built = { solar_plant: 2 };
    s.condition = { solar_plant: 1 };
    s.stocks.spares = 1_000_000;
    const r = commitWindow(s, emptyOrder()); // storm bites this window — reserve generation absorbs it
    expect(r.event?.id).toBe('dust_storm');
    expect(r.mortality).toBe(0);
    expect(r.milestones).toContain('event_survived');
  });

  it('event_survived is NOT credited for economic events — nothing deadly applied that window', () => {
    const seed = seedForEvent('subsidy_cut');
    const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    s.built = { solar_plant: 1 };
    s.condition = { solar_plant: 1 };
    const r = commitWindow(s, emptyOrder());
    expect(r.event?.id).toBe('subsidy_cut');
    expect(r.mortality).toBe(0);
    expect(r.milestones).not.toContain('event_survived'); // a budget cut can't kill in its window
  });

  it('refuel_unlocked fires the window the R&D lands', () => {
    const s = newColony(defaultColonyParams());
    const r = commitWindow(s, ord({ unlockRefuel: true }));
    expect(r.milestones).toContain('refuel_unlocked');
  });

  it('zero_import (finale-boss) does not trivially fire on window 1 before the colony has started', () => {
    const s = newColony(defaultColonyParams());
    const r = commitWindow(s, emptyOrder()); // nothing ordered, nothing built — must NOT count as "independence"
    expect(r.milestones).not.toContain('zero_import');
  });

  it('zero_import fires once an established colony has a window landing nothing at all', () => {
    const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5 }));
    s.built = { solar_plant: 1 };
    s.condition = { solar_plant: 1 };
    s.everHadPop = true;
    const r = commitWindow(s, emptyOrder()); // established colony, orders nothing, nothing lands
    expect(r.milestones).toContain('zero_import');
  });

  it('zero_import is not credited to the supply gap a skipped convoy leaves', () => {
    const seed = seedForEvent('skip_window');
    const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    s.built = { solar_plant: 1 };
    s.condition = { solar_plant: 1 };
    const r1 = commitWindow(s, ord({ resources: { food: 50_000 } })); // skip fires — convoy held
    expect(r1.event?.id).toBe('skip_window');
    s.p.eventChanceCap = 0;
    const r2 = commitWindow(s, emptyOrder()); // the gap window: nothing lands, manifest empty
    expect(r2.landed.stocks.food ?? 0).toBe(0);
    expect(r2.milestones).not.toContain('zero_import'); // involuntary gap ≠ independence
  });

  it('zero_import is not credited to a rejected (infeasible) order', () => {
    const s = newColony(defaultColonyParams({ pop0: 100, startStockWindows: 5, eventChanceCap: 0 }));
    s.built = { solar_plant: 1 };
    s.condition = { solar_plant: 1 };
    const r1 = commitWindow(s, ord({ resources: { water: 50_000_000 } })); // over throughput → rejected
    expect(r1.spent).toBe(0);
    expect(r1.milestones).not.toContain('zero_import'); // a failed import attempt is not independence
    const r2 = commitWindow(s, ord({ resources: { food: 1_000 } })); // gap lands nothing, but player IS ordering
    expect(r2.milestones).not.toContain('zero_import');
  });

  it('milestones never re-fire once achieved — s.milestones records the FIRST window only', () => {
    const s = newColony(defaultColonyParams({ pop0: 150, startStockWindows: 5 }));
    const r1 = commitWindow(s, emptyOrder());
    expect(r1.milestones).toContain('pop_100');
    const firstWindow = s.milestones.pop_100;
    commitWindow(s, emptyOrder());
    commitWindow(s, emptyOrder());
    expect(s.milestones.pop_100).toBe(firstWindow);
  });
});

describe('collapseRunway — the debrief-only named survival runway (D-064)', () => {
  it('a colony with no buffer and no production collapses within the lookahead', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 0 }));
    const cr = collapseRunway(s);
    expect(cr).toBeLessThan(COLLAPSE_LOOKAHEAD);
    expect(cr).toBeGreaterThanOrEqual(0);
  });

  it('a fully self-sufficient colony saturates at the collapse lookahead cap', () => {
    // spares stocked for 60+ windows of upkeep — production holds over the whole lookahead
    expect(collapseRunway(selfSufficient100())).toBe(COLLAPSE_LOOKAHEAD);
  });

  it('does not mutate the real state — runs on a throwaway clone', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 2 }));
    const windowBefore = s.window;
    collapseRunway(s);
    expect(s.window).toBe(windowBefore);
  });

  it('collapseRunway ≥ bufferRunway — full collapse never comes before the first death', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 2 }));
    expect(collapseRunway(s)).toBeGreaterThanOrEqual(bufferRunway(s));
  });
});
