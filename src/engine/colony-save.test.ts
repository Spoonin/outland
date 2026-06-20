import { describe, it, expect } from 'vitest';
import { serializeColony, loadColony, hydrateColony, SAVE_VERSION } from './colony-save';
import { newColony, defaultColonyParams, commitWindow, emptyOrder } from './colony';

const P = defaultColonyParams();

describe('save backward-compat (D-051)', () => {
  it('round-trips a played colony', () => {
    const s = newColony(defaultColonyParams({ startStockWindows: 5 }));
    commitWindow(s, emptyOrder());
    commitWindow(s, { ...emptyOrder(), unlockRefuel: true });
    const raw = JSON.stringify(serializeColony(s));
    const back = loadColony(raw, P)!;
    expect(back).not.toBeNull();
    expect(back.window).toBe(s.window);
    expect(back.pop).toBeCloseTo(s.pop, 6);
    expect(back.fleet.refuelUnlocked).toBe(true);
    expect(back.stocks.food).toBeCloseTo(s.stocks.food, 6);
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

  it('garbage / unknown version → null (graceful new game, never throws)', () => {
    expect(loadColony('not json', P)).toBeNull();
    expect(loadColony(JSON.stringify({ v: 999 }), P)).toBeNull();
    expect(loadColony(JSON.stringify({ v: 3 }), P)).toBeNull(); // missing fields → invalid
  });
});
