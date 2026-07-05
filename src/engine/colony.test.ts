import { describe, it, expect } from 'vitest';
import {
  newColony,
  defaultColonyParams,
  previewOrder,
  priceMult,
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
  // D-083: "self-sufficient" now includes DEMOGRAPHY — without a medbay + pharma the founders
  // simply age out (~windows 10–18) with no births to replace them, and no amount of food/O₂
  // keeps a colony of corpses alive. Capacity is sized for the population wave to ~230 heads
  // (births compound while the founder cohort is still alive), medbay beds cover baseline illness.
  s.built = { solar_plant: 7, farm: 2, water_recycler: 5, o2_generator: 7, medbay: 1 };
  s.condition = Object.fromEntries(Object.keys(s.built).map((id) => [id, 1]));
  s.stocks.spares = 1_000_000; // upkeep fully covered — no wear over any lookahead
  s.stocks.pharma = 200_000; // births gate + illness treatment doses over the whole lookahead
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
  it('mandatory pad maintenance alone never blocks a genuinely empty order — no soft-lock (D-079)', () => {
    // playtest-4 found a real permanent soft-lock: an over-built pad fleet (D-038's own "idle
    // capital" trap) plus 60 windows of compounding inflation (D-076) pushed mandatory maintenance
    // above the ENTIRE window subsidy — even an empty order ("just let time pass") was rejected as
    // overBudget, freezing the colony forever with no possible feasible order. Reproduced here with
    // a deterministic 100%/window inflation (not the random 1-7% range) so the blowup is exact.
    const s = newColony(defaultColonyParams({ pop0: 1000, inflationMin: 1, inflationMax: 1 }));
    s.window = 20; // mult = 2^20 ≈ 1.05M — maintenance on the default 5 classic pads now dwarfs M
    const empty = previewOrder(s, emptyOrder());
    expect(empty.total).toBeGreaterThan(empty.budget); // maintenance alone already exceeds the subsidy
    expect(empty.overBudget).toBe(false); // ...but a pure skip must still be feasible

    // a real cargo request that ALSO doesn't fit is still correctly blocked — unchanged behavior
    const withCargo = previewOrder(s, ord({ resources: { food: 1_000_000 } }));
    expect(withCargo.overBudget).toBe(true);
  });

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

  it('inflation is rolled fresh per window within [inflationMin, inflationMax], not a flat rate (D-076)', () => {
    const s = newColony(defaultColonyParams({ inflationMin: 0.01, inflationMax: 0.07 }));
    expect(priceMult(s)).toBe(1); // window 0 — no elapsed windows, no inflation yet
    let prevMult = 1;
    const stepRates: number[] = [];
    for (let w = 1; w <= 15; w++) {
      s.window = w;
      const mult = priceMult(s);
      const stepRate = mult / prevMult - 1;
      expect(stepRate).toBeGreaterThanOrEqual(0.01 - 1e-9); // never below the floor
      expect(stepRate).toBeLessThanOrEqual(0.07 + 1e-9); // never above the ceiling
      stepRates.push(stepRate);
      prevMult = mult;
    }
    // not literally flat 3% (or any other constant) — real per-window variation
    expect(new Set(stepRates.map((r) => r.toFixed(6))).size).toBeGreaterThan(1);
  });

  it('priceMult is a pure function of (seed, window) — fast-forwarding by setting s.window still works', () => {
    const a = newColony(defaultColonyParams({ seed: 42 }));
    const b = newColony(defaultColonyParams({ seed: 42 }));
    a.window = 7;
    b.window = 7;
    expect(priceMult(a)).toBe(priceMult(b)); // same seed+window, computed independently → identical
  });

  it('a different seed rolls different per-window inflation (not the same sequence for everyone)', () => {
    const a = newColony(defaultColonyParams({ seed: 1 }));
    const b = newColony(defaultColonyParams({ seed: 2 }));
    a.window = 10;
    b.window = 10;
    expect(priceMult(a)).not.toBe(priceMult(b));
  });
});

describe('commit window — transit lag, consumption, runway, mortality', () => {
  it('a window with ruinous mandatory pad maintenance still advances on an empty order (D-079)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, inflationMin: 1, inflationMax: 1 }));
    s.window = 20;
    const before = s.window;
    const r = commitWindow(s, emptyOrder());
    expect(s.window).toBe(before + 1); // time passes — never permanently stuck
    expect(r.capped).toBe(false);
  });

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

  it('refuses nuclear_plant below its minPop, even with the waste_pad prereq standing (D-074)', () => {
    const s = newColony(defaultColonyParams({ pop0: 20, startStockWindows: 5 })); // a 20-person outpost
    s.built = { waste_pad: 1 };
    s.condition = { waste_pad: 1 };
    s.stocks.steel = 200_000;
    s.stocks.metals = 100_000;
    const r = commitWindow(s, emptyOrder(), ['nuclear_plant']);
    expect(r.built).toEqual([]); // pop 20 < minPop 100 → infeasible
    expect(s.built['nuclear_plant']).toBeUndefined();
  });

  describe('structure demolition (D-081)', () => {
    it('tears down one unit, recycles a fraction of its build materials, reports it', () => {
      const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }));
      s.built = { solar_plant: 1 };
      s.condition = { solar_plant: 1 };
      const r = commitWindow(s, emptyOrder(), [], ['solar_plant']);
      expect(s.built.solar_plant).toBe(0);
      expect(r.demolished).toEqual(['solar_plant']);
      // solar_plant buildMaterials: steel 5000, glass 2000 (structures.csv); recycleFrac 0.6
      expect(s.stocks.steel).toBeCloseTo(5000 * 0.6, 0);
      expect(s.stocks.glass).toBeCloseTo(2000 * 0.6, 0);
    });

    it("nuclear_plant recycles far less (10%) — a reactor complex isn't as salvageable", () => {
      const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }));
      s.built = { waste_pad: 1, nuclear_plant: 1 };
      s.condition = { waste_pad: 1, nuclear_plant: 1 };
      commitWindow(s, emptyOrder(), [], ['nuclear_plant']);
      expect(s.built.nuclear_plant).toBe(0);
      // nuclear_plant buildMaterials: steel 20000, metals 5000; recycleFrac 0.1
      expect(s.stocks.steel).toBeCloseTo(20_000 * 0.1, 0);
      expect(s.stocks.metals).toBeCloseTo(5_000 * 0.1, 0);
    });

    it('cannot demolish more units than exist — extra requests are a silent no-op, not an error', () => {
      const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 }));
      s.built = { farm: 1 };
      s.condition = { farm: 1 };
      const r = commitWindow(s, emptyOrder(), [], ['farm', 'farm', 'farm']); // only 1 owned
      expect(s.built.farm).toBe(0); // the one that existed is gone
      expect(r.demolished).toEqual(['farm']); // only ONE actually happened
    });

    it('demolition draws on the SAME shared labor pool as ongoing crew — throttles other output if short (D-075)', () => {
      // nuclear_plant demolishCrew=50; with only 10 colonists around, demolishing it this window
      // strains the labor pool hard enough to throttle a completely unrelated structure's output too
      const withDemolition = newColony(defaultColonyParams({ pop0: 10, startStockWindows: 5 }));
      withDemolition.built = { waste_pad: 1, nuclear_plant: 1, solar_plant: 1 };
      withDemolition.condition = { waste_pad: 1, nuclear_plant: 1, solar_plant: 1 };
      withDemolition.stocks.spares = 1_000_000;
      const rDemolished = commitWindow(withDemolition, emptyOrder(), [], ['nuclear_plant']);
      // laborNeed = ongoing (waste_pad 1 + solar_plant 1 = 2) + one-time demolishCrew 50 = 52; pop 10
      expect(rDemolished.energyGen).toBeCloseTo(100 * (10 / 52), 0); // solar's rated 100 × laborRatio

      const noDemolition = newColony(defaultColonyParams({ pop0: 10, startStockWindows: 5 }));
      noDemolition.built = { waste_pad: 1, solar_plant: 1 }; // same ongoing crew, no reactor to tear down
      noDemolition.condition = { waste_pad: 1, solar_plant: 1 };
      noDemolition.stocks.spares = 1_000_000;
      const rControl = commitWindow(noDemolition, emptyOrder());
      expect(rControl.energyGen).toBeCloseTo(100, 0); // ongoing demand (2) ≪ pop 10 → no throttle at all
      expect(rDemolished.energyGen).toBeLessThan(rControl.energyGen); // the demolition surge is the difference
    });

    it('demolishing base_block/habitat costs no labor at all — passive shells, nothing to pull off', () => {
      const s = newColony(defaultColonyParams({ pop0: 0, startStockWindows: 5 }));
      s.built = { base_block: 1 };
      s.condition = { base_block: 1 };
      const r = commitWindow(s, emptyOrder(), [], ['base_block']);
      expect(s.built.base_block).toBe(0);
      expect(r.demolished).toEqual(['base_block']);
    });

    it('demolition is money-free — never blocked by budget, unlike Earth cargo (D-054/081)', () => {
      const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5, M: 1 })); // absurdly tiny budget
      s.built = { solar_plant: 1 };
      s.condition = { solar_plant: 1 };
      const pv = previewOrder(s, emptyOrder());
      expect(pv.overBudget).toBe(false); // demolish isn't even part of the Earth order/budget at all
      const r = commitWindow(s, emptyOrder(), [], ['solar_plant']);
      expect(r.demolished).toEqual(['solar_plant']);
    });
  });

  it('an established colony (pop ≥ minPop) with the prereq standing can build the reactor (D-074)', () => {
    const s = newColony(defaultColonyParams({ pop0: 200, startStockWindows: 5 }));
    s.built = { waste_pad: 1 };
    s.condition = { waste_pad: 1 };
    s.stocks.steel = 200_000;
    s.stocks.metals = 100_000;
    const r = commitWindow(s, emptyOrder(), ['nuclear_plant']);
    expect(r.built).toEqual(['nuclear_plant']);
    expect(s.built['nuclear_plant']).toBe(1);
  });

  it('a reactor out of fuel does not generate rated power — fuel gates ITS OWN share, not the whole grid (D-074)', () => {
    const withFuel = newColony(defaultColonyParams({ pop0: 200, startStockWindows: 5 }));
    withFuel.built = { solar_plant: 1, nuclear_plant: 1 };
    withFuel.condition = { solar_plant: 1, nuclear_plant: 1 };
    withFuel.stocks.spares = 1_000_000; // full ЗИП coverage — isolate from wear, not what this checks
    withFuel.stocks.fuel = 1_000_000; // plenty
    const rFed = commitWindow(withFuel, emptyOrder());
    expect(rFed.energyGen).toBeCloseTo(600, 0); // solar 100 + nuclear 500, both full rate

    const noFuel = newColony(defaultColonyParams({ pop0: 200, startStockWindows: 5 }));
    noFuel.built = { solar_plant: 1, nuclear_plant: 1 };
    noFuel.condition = { solar_plant: 1, nuclear_plant: 1 };
    noFuel.stocks.spares = 1_000_000;
    noFuel.stocks.fuel = 0; // reactor has nothing to burn
    const rStarved = commitWindow(noFuel, emptyOrder());
    expect(rStarved.energyGen).toBeCloseTo(100, 0); // solar keeps generating — only nuclear's share drops
  });

  it('partial fuel throttles the reactor proportionally, and it only draws what it actually got', () => {
    const s = newColony(defaultColonyParams({ pop0: 200, startStockWindows: 5 }));
    s.built = { nuclear_plant: 1 };
    s.condition = { nuclear_plant: 1 };
    s.stocks.spares = 1_000_000;
    s.stocks.fuel = 1_500; // half of the 3,000/window it wants
    const r = commitWindow(s, emptyOrder());
    expect(r.energyGen).toBeCloseTo(250, 0); // 500 rated × 0.5 fuel ratio
    expect(s.stocks.fuel).toBeCloseTo(0, 0); // drew exactly what was on hand, nothing left owed
  });

  it('an understaffed colony throttles EVERY structure proportionally, not just the short-handed one (D-075)', () => {
    // 1 solar_plant (opsCrew 1) + 1 nuclear_plant (opsCrew 10) = 11 needed; pop 11 → full staffing
    // (illnessProb 0: one unlucky sick colonist would silently thin the able-bodied pool, D-083)
    const staffed = newColony(defaultColonyParams({ pop0: 11, startStockWindows: 5, illnessProb: 0 }));
    staffed.built = { solar_plant: 1, nuclear_plant: 1 };
    staffed.condition = { solar_plant: 1, nuclear_plant: 1 };
    staffed.stocks.spares = 1_000_000;
    staffed.stocks.fuel = 1_000_000;
    const rFull = commitWindow(staffed, emptyOrder());
    expect(rFull.energyGen).toBeCloseTo(600, 0); // solar 100 + nuclear 500, fully staffed

    // a mass-casualty event thins pop to 5 mid-game — labor demand (11) now exceeds headcount,
    // and BOTH structures lose the same fraction of output (a colony-wide pinch, not "who gets fired")
    const thinned = newColony(defaultColonyParams({ pop0: 11, startStockWindows: 5, illnessProb: 0 }));
    thinned.built = { solar_plant: 1, nuclear_plant: 1 };
    thinned.condition = { solar_plant: 1, nuclear_plant: 1 };
    thinned.stocks.spares = 1_000_000;
    thinned.stocks.fuel = 1_000_000;
    thinned.colonists = thinned.colonists.slice(0, 5); // individuals now (D-083), not a scalar
    thinned.pop = thinned.colonists.length; // 5 of the 11 needed → laborRatio 5/11
    const rThin = commitWindow(thinned, emptyOrder());
    expect(rThin.energyGen).toBeCloseTo(600 * (5 / 11), 0); // BOTH plants' share cut equally
  });

  it('pop===0 with structures already built is "not colonized yet", not a labor collapse (D-075)', () => {
    // Mars builds aren't gated on colonists physically standing there THIS window (Tsiolkovsky
    // lag) — a robotically pre-deployed solar_plant sitting at pop 0 must not read as understaffed
    // just because 0/anything(>0) would otherwise divide out to a full blackout.
    const s = newColony(defaultColonyParams({ pop0: 0, startStockWindows: 5 }));
    s.built = { solar_plant: 1 }; // opsCrew 1, but nobody has landed yet
    s.condition = { solar_plant: 1 };
    s.stocks.spares = 1_000_000; // full ЗИП coverage — isolate from wear, not what this checks
    const r = commitWindow(s, emptyOrder());
    expect(r.energyGen).toBeCloseTo(100, 0); // full rate, not zeroed by the (0 pop / 1 needed) ratio
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

  describe('pad decommissioning (D-080, cost corrected D-082)', () => {
    it('scrapping reduces the fleet and CHARGES a net cost — never a refund (D-082)', () => {
      const s = newColony(defaultColonyParams({ pop0: 1000 }));
      expect(s.fleet.pads.classic).toBe(5); // startPads default
      const pv = previewOrder(s, ord({ padsToScrap: { classic: 2, refuel: 0 } }));
      expect(pv.padScrapCost).toBeCloseTo(2 * 1.5e8 * 0.2, 0); // 2 pads × window-0 capex × 20% net cost
      commitWindow(s, ord({ padsToScrap: { classic: 2, refuel: 0 } }));
      expect(s.fleet.pads.classic).toBe(3);
    });

    it('cannot scrap more pads than are actually owned — clamped, no negative fleet', () => {
      const s = newColony(defaultColonyParams({ pop0: 1000 }));
      commitWindow(s, ord({ padsToScrap: { classic: 99, refuel: 0 } }));
      expect(s.fleet.pads.classic).toBe(0); // clamped at what existed, never negative
    });

    it('building and scrapping in the SAME order price independently, not netted against each other', () => {
      const s = newColony(defaultColonyParams({ pop0: 1000 }));
      // build 1 (capex charged) + scrap 3 (cost charged) — net fleet change is -2, but both money
      // flows must be real: capex for the 1 built, decommission cost for the 3 scrapped, not
      // "net -2, nothing changes hands" (which would make the 1 built pad free)
      const pv = previewOrder(s, ord({ padsToBuild: { classic: 1, refuel: 0 }, padsToScrap: { classic: 3, refuel: 0 } }));
      expect(pv.padCapex).toBeCloseTo(1.5e8, 0); // capex for the 1 built, priced off the real count
      expect(pv.padScrapCost).toBeCloseTo(3 * 1.5e8 * 0.2, 0); // cost for all 3 scrapped, not net
      commitWindow(s, ord({ padsToBuild: { classic: 1, refuel: 0 }, padsToScrap: { classic: 3, refuel: 0 } }));
      expect(s.fleet.pads.classic).toBe(3); // 5 + 1 − 3
    });

    it('a pure scrap order (no other spend) never blocks on budget — same exemption as mandatory maintenance (D-079)', () => {
      const s = newColony(defaultColonyParams({ pop0: 1000, M: 1 })); // an absurdly tiny budget
      const pv = previewOrder(s, ord({ padsToScrap: { classic: 5, refuel: 0 } }));
      expect(pv.padScrapCost).toBeGreaterThan(0); // a REAL cost, not waived...
      expect(pv.overBudget).toBe(false); // ...but exempt from blocking, same principle as D-079's
      // maintenance exemption — otherwise an extreme D-079 scenario could make the escape valve
      // itself unaffordable, since scrap cost scales with the same inflated capex as the ruinous maintenance
      commitWindow(s, ord({ padsToScrap: { classic: 5, refuel: 0 } }));
      expect(s.fleet.pads.classic).toBe(0);
    });

    it('scrapped pads stop costing maintenance the SAME window they are scrapped', () => {
      const s = newColony(defaultColonyParams({ pop0: 1000 }));
      const before = previewOrder(s, emptyOrder()).launchTotal;
      const afterScrap = previewOrder(s, ord({ padsToScrap: { classic: 5, refuel: 0 } })).launchTotal;
      expect(afterScrap).toBeLessThan(before); // maintenance on the future (post-scrap) fleet, not today's
    });
  });

  it('cannot unlock R&D before any colonist has ever landed on Mars — the whole order is rejected (D-077)', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 })); // pop0 defaults to 0
    expect(s.everHadPop).toBe(false);
    const r = commitWindow(s, ord({ unlockRefuel: true, resources: { food: 1000 } }));
    expect(s.fleet.refuelStage).toBe(0); // not bought
    expect(r.spent).toBe(0); // nothing charged — the whole order was rejected, not just the R&D line
    expect(r.landed.stocks.food ?? 0).toBe(0); // the food in the SAME order didn't ship either
  });

  it('R&D unlocks the window after the first colonist actually lands (not just gets ordered)', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    s.built = { habitat: 1 };
    s.condition = { habitat: 1 };
    commitWindow(s, ord({ colonists: 10 })); // ships — not landed yet, everHadPop still false
    expect(s.everHadPop).toBe(false);
    commitWindow(s, ord({ unlockRefuel: true })); // same window they'd land — still blocked (order checked pre-landing)
    expect(s.fleet.refuelStage).toBe(0);
    expect(s.everHadPop).toBe(true); // they landed THIS window
    commitWindow(s, ord({ unlockRefuel: true })); // next window — now allowed
    expect(s.fleet.refuelStage).toBe(1);
  });

  it('nothing ships alone before population is ever established — the whole order is rejected (D-078)', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 })); // pop0 defaults to 0
    expect(s.everHadPop).toBe(false);
    const r = commitWindow(s, ord({ resources: { steel: 20_000 } })); // resources alone, no colonists
    expect(r.spent).toBe(0); // whole order rejected, not silently ignored
    expect(r.landed.stocks.steel ?? 0).toBe(0);
    expect(s.stocks.steel).toBe(0); // nothing accumulated on Mars either
  });

  it('cargo ships fine once colonists are included in the SAME order (D-078)', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    s.built = { habitat: 1 };
    s.condition = { habitat: 1 };
    const r = commitWindow(s, ord({ colonists: 10, resources: { steel: 20_000 } }));
    expect(r.spent).toBeGreaterThan(0); // the order actually shipped
  });

  it('cargo ships fine alone once population has EVER been established, even much later (D-078)', () => {
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 })); // already established
    const r = commitWindow(s, ord({ resources: { steel: 20_000 } })); // no colonists this window
    expect(r.spent).toBeGreaterThan(0);
  });

  it('building pads alone before population is ever established is also rejected (D-078)', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    const r = commitWindow(s, ord({ padsToBuild: { classic: 1, refuel: 0 } }));
    expect(r.spent).toBe(0);
    expect(s.fleet.pads.classic).toBe(5); // startPads default — unchanged, nothing bought
  });

  it('importing a structure alone before population is ever established is also rejected (D-078)', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    const r = commitWindow(s, ord({ structures: { habitat: 1 } })); // no colonists in this manifest
    expect(r.spent).toBe(0);
    expect(s.built.habitat ?? 0).toBe(0);
  });

  it('a colonist-only order (no other cargo) is never blocked by the bootstrap gate (D-078)', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    s.built = { habitat: 1 };
    s.condition = { habitat: 1 };
    const r = commitWindow(s, ord({ colonists: 5 })); // nothing else in the manifest
    expect(r.spent).toBeGreaterThan(0);
  });

  it('a genuinely empty order is never blocked by the bootstrap gate (D-078)', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    const r = commitWindow(s, emptyOrder()); // skip the window — always legal, pop or not
    expect(r.mortality).toBe(0);
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

// D-084: condition is per-TYPE, not per-unit — a fresh build/import DILUTES the type's average
// rather than inheriting it wholesale, and spares ordered BEYOND upkeep buy real repair. Every
// fixture below pins s.stocks.spares to EXACTLY the post-action upkeep (surplus 0) unless the
// test is specifically about surplus/repair, so wear/repair never contaminates the number being
// checked — solar_plant's upkeepSpares is 300/unit (structures.csv), a stable single-type anchor.
describe('wear repair (D-084)', () => {
  it('a fresh LOCAL build dilutes the type\'s condition (weighted average), not inherits it', () => {
    const s = newColony(defaultColonyParams({ pop0: 0 }));
    s.built = { solar_plant: 1 };
    s.condition = { solar_plant: 0.4 };
    s.stocks.steel = 5000; // solar_plant's buildMaterials (structures.csv)
    s.stocks.glass = 2000;
    s.stocks.spares = 600; // upkeep AFTER build = 2×300 — exact break-even, no wear/repair noise
    commitWindow(s, emptyOrder(), ['solar_plant']);
    expect(s.built.solar_plant).toBe(2);
    expect(s.condition.solar_plant).toBeCloseTo((0.4 * 1 + 1 * 1) / 2, 10); // 0.7
  });

  it('an IMPORT landing dilutes the same way, n units at once', () => {
    const s = newColony(defaultColonyParams({ pop0: 0 }));
    s.built = { solar_plant: 2 };
    s.condition = { solar_plant: 0.5 };
    s.everHadPop = true; // skip the D-078 bootstrap gate — not what this test is about
    s.stocks.spares = 600; // this window's upkeep (2 units) — exact break-even
    const order = { ...emptyOrder(), structures: { solar_plant: 2 } };
    commitWindow(s, order); // ships — condition untouched (still 2 units, break-even)
    expect(s.condition.solar_plant).toBeCloseTo(0.5, 10);
    s.stocks.spares = 1200; // NEXT window's upkeep once landed (4 units) — exact break-even again
    commitWindow(s, emptyOrder()); // lands — the 2 fresh units dilute in
    expect(s.built.solar_plant).toBe(4);
    expect(s.condition.solar_plant).toBeCloseTo((0.5 * 2 + 1 * 2) / 4, 10); // 0.75
  });

  it('the first-ever unit of a type still starts at full condition', () => {
    const s = newColony(defaultColonyParams({ pop0: 0 }));
    s.stocks.steel = 5000;
    s.stocks.glass = 2000;
    s.stocks.spares = 300; // this window's upkeep (1 fresh unit) — exact break-even
    commitWindow(s, emptyOrder(), ['solar_plant']);
    expect(s.condition.solar_plant).toBe(1);
  });

  it('spares ordered beyond upkeep repair the fleet, proportional to the surplus (capped at one extra upkeep)', () => {
    const s = newColony(defaultColonyParams({ pop0: 0 }));
    s.built = { solar_plant: 1 }; // upkeep 300
    s.condition = { solar_plant: 0.5 };
    s.stocks.spares = 600; // upkeep (300) + exactly one more upkeep's worth of surplus (300)
    const r = commitWindow(s, emptyOrder());
    expect(r.repairSpentKg).toBe(300);
    expect(s.condition.solar_plant).toBeCloseTo(0.5 + s.p.repairRate, 10); // 0.54 by default
    expect(s.stocks.spares).toBeCloseTo(0, 10); // upkeep + repair both drawn from stock
  });

  it('a surplus with nothing worn spends only on upkeep — no repair, no waste', () => {
    const s = newColony(defaultColonyParams({ pop0: 0 }));
    s.built = { solar_plant: 1 };
    s.condition = { solar_plant: 1 }; // fully healthy
    s.stocks.spares = 600; // same surplus as the previous test, but nothing to repair
    const r = commitWindow(s, emptyOrder());
    expect(r.repairSpentKg).toBe(0);
    expect(s.condition.solar_plant).toBe(1);
    expect(s.stocks.spares).toBeCloseTo(300, 10); // only upkeep drawn — the surplus is untouched
  });

  it('autoSpares\' own floor (exactly upkeep, zero surplus) never triggers repair by itself', () => {
    const s = newColony(defaultColonyParams({ pop0: 0 }));
    s.built = { solar_plant: 1 };
    s.condition = { solar_plant: 0.5 }; // worn — but there's no surplus to spend on it
    s.stocks.spares = 300; // exactly upkeep, the autoSpares (D-070) break-even floor
    const r = commitWindow(s, emptyOrder());
    expect(r.repairSpentKg).toBe(0);
    expect(s.condition.solar_plant).toBe(0.5); // unchanged — no decay (coverage 1), no repair (no surplus)
  });

  it('surplus far beyond upkeep still caps repair spend at one extra upkeep\'s worth', () => {
    const s = newColony(defaultColonyParams({ pop0: 0 }));
    s.built = { solar_plant: 1 }; // upkeep 300
    s.condition = { solar_plant: 0.3 };
    s.stocks.spares = 1200; // upkeep (300) + a 900 surplus — 3× the repair cap
    const r = commitWindow(s, emptyOrder());
    expect(r.repairSpentKg).toBe(300); // capped, not the full 900 surplus
    expect(s.condition.solar_plant).toBeCloseTo(0.3 + s.p.repairRate, 10); // 0.34
    expect(s.stocks.spares).toBeCloseTo(600, 10); // 1200 − (300 upkeep + 300 repair) — excess untouched
  });

  it('repair never pushes condition past 1 (clamped)', () => {
    const s = newColony(defaultColonyParams({ pop0: 0 }));
    s.built = { solar_plant: 1 };
    s.condition = { solar_plant: 0.99 };
    s.stocks.spares = 600; // upkeep + one full repair cap's worth of surplus
    const r = commitWindow(s, emptyOrder());
    expect(r.repairSpentKg).toBe(300); // the repair budget is still spent...
    expect(s.condition.solar_plant).toBe(1); // ...but the GAIN clamps, doesn't overshoot
  });

  it('repair is colony-wide, like laborRatio (D-075) — one type\'s surplus lifts every built type at once', () => {
    const s = newColony(defaultColonyParams({ pop0: 0 }));
    s.built = { solar_plant: 1, farm: 1 }; // upkeep 300 + 400 = 700
    s.condition = { solar_plant: 0.4, farm: 0.6 };
    s.stocks.spares = 1400; // upkeep (700) + exactly one more upkeep's worth (700)
    const r = commitWindow(s, emptyOrder());
    expect(r.repairSpentKg).toBe(700);
    const gain = s.p.repairRate; // spend/upkeep == 1 → the full rate
    expect(s.condition.solar_plant).toBeCloseTo(0.4 + gain, 10);
    expect(s.condition.farm).toBeCloseTo(0.6 + gain, 10);
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
    const s = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5 })); // Mars presence (D-078)
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
    const s = newColony(defaultColonyParams({ pop0: 1000, seed, ...ALWAYS_FIRE })); // Mars presence (D-078)
    const r1 = commitWindow(s, ord({ resources: { food: 50_000 } })); // ships, but skip fires
    expect(r1.event?.id).toBe('skip_window');
    s.p.eventChanceCap = 0;
    const r2 = commitWindow(s, emptyOrder()); // would normally land here
    expect(r2.landed.stocks.food ?? 0).toBe(0);
    const r3 = commitWindow(s, emptyOrder());
    expect(r3.landed.stocks.food).toBe(50_000); // arrives one window late, undiminished
  });

  it('epidemic spikes the illness probability; beds+pharma treat, the untreated are doomed (D-083)', () => {
    const seed = seedForEvent('epidemic');

    // no beds, no pharma: everyone who falls sick under the spiked probability is doomed and dies
    // at the START of next window, attributed as `illness` (the epidemic owns its window's sick)
    const uncovered = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    uncovered.built = { solar_plant: 3 };
    uncovered.condition = { solar_plant: 1 };
    const rUncovered = commitWindow(uncovered, emptyOrder());
    expect(rUncovered.event?.id).toBe('epidemic');
    expect(rUncovered.event?.covered).toBe(false);
    expect(rUncovered.event?.sickened).toBeGreaterThan(0);
    expect(rUncovered.event?.treated).toBe(0);
    expect(rUncovered.event?.deaths).toBe(rUncovered.event?.sickened); // all doomed
    expect(rUncovered.sick).toBe(rUncovered.event?.sickened); // still alive at window's end
    uncovered.p.eventChanceCap = 0; // isolate: no second event while the doomed die
    const rNext = commitWindow(uncovered, emptyOrder());
    expect(rNext.mortalityBreakdown.illness).toBe(rUncovered.event?.deaths);

    // enough beds (40 medbays × 5) + pharma: everyone sick is treated, the cure roll saves ~half —
    // same seed → the same people fall sick, so the two runs differ only in the medicine
    const covered = newColony(defaultColonyParams({ pop0: 1000, startStockWindows: 5, seed, ...ALWAYS_FIRE }));
    covered.built = { solar_plant: 3, medbay: 40 };
    covered.condition = { solar_plant: 1, medbay: 1 };
    covered.stocks.pharma = 100_000;
    const rCovered = commitWindow(covered, emptyOrder());
    expect(rCovered.event?.id).toBe('epidemic');
    expect(rCovered.event?.sickened).toBe(rUncovered.event?.sickened);
    expect(rCovered.event?.treated).toBe(rCovered.event?.sickened);
    expect(rCovered.event?.covered).toBe(true);
    expect(rCovered.event?.deaths!).toBeLessThan(rUncovered.event?.deaths!); // cureProb bites
    expect(covered.stocks.pharma).toBeLessThan(100_000); // a dose per treated case
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

  it('a subsidy-bearing milestone permanently raises the budget, once, not on later windows (D-076)', () => {
    const s = newColony(defaultColonyParams({ pop0: 150, startStockWindows: 5 }));
    const baseM = s.p.M;
    expect(s.subsidyBonus).toBe(0);
    expect(previewOrder(s, emptyOrder()).budget).toBe(baseM); // untouched before the milestone
    const r = commitWindow(s, emptyOrder());
    expect(r.milestones).toContain('pop_100');
    expect(s.subsidyBonus).toBe(3.0e9); // pop_100's bonus (colony.ts MILESTONES table)
    expect(previewOrder(s, emptyOrder()).budget).toBe(baseM + 3.0e9);
    const before = s.subsidyBonus;
    commitWindow(s, emptyOrder()); // still pop ≥ 100 — must NOT add the bonus again
    expect(s.subsidyBonus).toBe(before);
  });

  it('first_landing/first_birth/event_survived carry no subsidy bonus — only genuine-scale milestones do', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    s.built = { habitat: 1 };
    s.condition = { habitat: 1 };
    commitWindow(s, ord({ colonists: 10 }));
    const r = commitWindow(s, emptyOrder()); // lands → first_landing
    expect(r.milestones).toContain('first_landing');
    expect(s.subsidyBonus).toBe(0);
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
    const s = newColony(defaultColonyParams({ pop0: 1000 })); // Mars presence required first (D-077)
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
