import { describe, it, expect } from 'vitest';
import { serializeColony, loadColony, SAVE_VERSION } from './colony-save';
import { newColony, defaultColonyParams, commitWindow, emptyOrder } from './colony';

const P = defaultColonyParams();

describe('save/load (pre-release — no backward compatibility)', () => {
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

  it('persists only dynamic state — config is reconstructed from defaults', () => {
    const s = newColony(P);
    const save = serializeColony(s) as unknown as Record<string, unknown>;
    expect(save).not.toHaveProperty('p'); // no catalog/launch/params persisted
    expect(save.v).toBe(SAVE_VERSION);
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

  it('garbage / mismatched version → null (graceful new game, never throws)', () => {
    expect(loadColony('not json', P)).toBeNull();
    expect(loadColony(JSON.stringify({ v: 999 }), P)).toBeNull();
    expect(loadColony(JSON.stringify({ v: SAVE_VERSION - 1 }), P)).toBeNull(); // any older schema → discard
  });
});
