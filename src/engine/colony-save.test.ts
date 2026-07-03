import { describe, it, expect } from 'vitest';
import { serializeColony, loadColony, hydrateColony, SAVE_VERSION } from './colony-save';
import { newColony, defaultColonyParams, commitWindow, emptyOrder } from './colony';

const P = defaultColonyParams();

describe('save backward-compat (D-051)', () => {
  it('round-trips a played colony', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    commitWindow(s, emptyOrder());
    commitWindow(s, { ...emptyOrder(), unlockRefuel: true }); // buys R&D stage 1 (D-068)
    const raw = JSON.stringify(serializeColony(s));
    const back = loadColony(raw, P)!;
    expect(back).not.toBeNull();
    expect(back.window).toBe(s.window);
    expect(back.pop).toBeCloseTo(s.pop, 6);
    expect(back.fleet.refuelStage).toBe(1);
    expect(back.stocks.food).toBeCloseTo(s.stocks.food, 6);
  });

  it('migrates a v3 save: the old single refuel unlock maps onto the staged ladder (D-068)', () => {
    const v3 = (refuelUnlocked: boolean) =>
      JSON.stringify({
        v: 3,
        window: 6,
        pop: 40,
        everHadPop: true,
        stocks: { food: 10_000 },
        inTransit: { stocks: {}, colonists: 0 },
        fleet: { pads: { classic: 5, refuel: 1 }, refuelUnlocked },
        built: { base_block: 2 },
        condition: {},
        rngState: 7,
      });
    const withUnlock = loadColony(v3(true), P)!;
    expect(withUnlock.fleet.refuelStage).toBe(2); // owned capability was single-stage-era = full ladder
    const withoutUnlock = loadColony(v3(false), P)!;
    expect(withoutUnlock.fleet.refuelStage).toBe(0);
  });

  it('persists only dynamic state — config is reconstructed from defaults', () => {
    const s = newColony(P);
    const save = serializeColony(s) as unknown as Record<string, unknown>;
    expect(save).not.toHaveProperty('p'); // no catalog/launch/params persisted
    expect(save.v).toBe(SAVE_VERSION);
  });

  it('forward-compat: a save missing a (newly added) resource hydrates it to default', () => {
    const s = newColony(P);
    const save = serializeColony(s);
    delete (save.stocks as Record<string, number>).chips; // simulate an older save w/o hi-tech
    const back = hydrateColony(save, P);
    expect(back.stocks.chips).toBe(0); // self-filled from fresh colony
  });

  it('migrates a legacy v2 save (fleet.pads was a number, params embedded)', () => {
    const legacy = JSON.stringify({
      v: 2,
      state: {
        window: 4,
        pop: 1200,
        stocks: { food: 50000, water: 90000 }, // old 9-resource set, no hi-tech
        inTransit: { stocks: {}, colonists: 0 },
        fleet: { pads: 7 }, // ← old shape: a number
        built: { solar_plant: 2 },
        rngState: 42,
      },
    });
    const back = loadColony(legacy, P)!;
    expect(back).not.toBeNull();
    expect(back.window).toBe(4);
    expect(back.fleet.pads.classic).toBe(7); // number → classic
    expect(back.fleet.pads.refuel).toBe(0);
    expect(back.stocks.pharma).toBe(0); // hi-tech self-filled
    expect(back.built.solar_plant).toBe(2);
  });

  it('round-trips the chronicle (D-061)', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    commitWindow(s, emptyOrder());
    commitWindow(s, emptyOrder());
    const back = loadColony(JSON.stringify(serializeColony(s)), P)!;
    expect(back.chronicle.length).toBe(2);
    expect(back.chronicle[0]!.window).toBe(1);
    expect(back.chronicle[1]!.window).toBe(2);
  });

  it('an older save without a chronicle field hydrates to an empty one (back-compat)', () => {
    const s = newColony(P);
    const save = serializeColony(s);
    delete save.chronicle;
    const back = hydrateColony(save, P);
    expect(back.chronicle).toEqual([]);
  });

  it('round-trips storyteller state — activeEffects, holdTransit, lastEvent (D-063)', () => {
    const s = newColony(defaultColonyParams({ seed: 1, startStockWindows: 5 }));
    s.activeEffects = [{ id: 'dust_storm', effect: 'energy', mag: 0.5, windowsLeft: 2 }];
    s.holdTransit = { stocks: { ...s.stocks, food: 1000 }, colonists: 3, structures: { habitat: 1 } };
    s.lastEvent = { id: 'dust_storm', window: 1 };
    const back = loadColony(JSON.stringify(serializeColony(s)), P)!;
    expect(back.activeEffects).toEqual(s.activeEffects);
    expect(back.holdTransit).toEqual(s.holdTransit);
    expect(back.lastEvent).toEqual(s.lastEvent);
  });

  it('an older save without storyteller fields hydrates to empty defaults (back-compat)', () => {
    const s = newColony(P);
    const save = serializeColony(s);
    delete save.activeEffects;
    delete save.holdTransit;
    delete save.lastEvent;
    const back = hydrateColony(save, P);
    expect(back.activeEffects).toEqual([]);
    expect(back.holdTransit).toBeNull();
    expect(back.lastEvent).toBeNull();
  });

  it('garbage / unknown version → null (graceful new game, never throws)', () => {
    expect(loadColony('not json', P)).toBeNull();
    expect(loadColony(JSON.stringify({ v: 999 }), P)).toBeNull();
    expect(loadColony(JSON.stringify({ v: 3 }), P)).toBeNull(); // missing fields → invalid
  });
});
