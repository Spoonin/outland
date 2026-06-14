import { describe, it, expect } from 'vitest';
import { newState, step } from './sim';
import { serializeState, deserializeState } from './persist';
import { defaultParams } from './types';

describe('serialize/deserialize GameState (Phase 6)', () => {
  it('round-trips through JSON and continues identically (events ON, RNG preserved)', () => {
    const a = newState(defaultParams({ seed: 7 }));
    for (let i = 0; i < 8; i++) step(a);

    // serialize → JSON string → parse → deserialize
    const json = JSON.stringify(serializeState(a));
    const b = deserializeState(JSON.parse(json));

    // restored snapshot matches
    expect(b.window).toBe(a.window);
    expect(b.pop).toBe(a.pop);
    expect(b.fusion).toBe(a.fusion);
    expect(b.launchK).toBe(a.launchK);
    expect(b.localized).toEqual(a.localized);

    // and future windows diverge identically (RNG continuity)
    const ra = step(a);
    const rb = step(b);
    expect(rb.autonomy).toBeCloseTo(ra.autonomy, 10);
    expect(rb.F).toBeCloseTo(ra.F, 4);
    expect(rb.events).toEqual(ra.events);
  });

  it('deep-copies records (no shared mutable state)', () => {
    const a = newState(defaultParams());
    const b = deserializeState(serializeState(a));
    b.localized['water'] = true;
    expect(a.localized['water']).toBe(false);
  });
});
