import { describe, it, expect } from 'vitest';
import { needs } from './sim';
import { mkState } from './_testutil';

describe('needs — demand = consumption + derived (D-029, SDD §6)', () => {
  it('fresh colony: demand = cons·pop (no derived, nothing localized)', () => {
    const s = mkState({ pop: 1000 });
    const nd = needs(s);
    expect(nd['water']).toBe(2000); // cons 2.0
    expect(nd['food']).toBe(1500); // cons 1.5
    expect(nd['oxygen']).toBe(1000); // cons 1.0
    expect(nd['catalyst']).toBe(0); // pure intermediate, no localized consumers
    expect(nd['fertilizer']).toBe(0); // cons 0, food not localized → no derived
  });

  it('localizing a consumer creates derived demand on its inputs', () => {
    const s = mkState({ pop: 1000 });
    s.localized['food'] = true; // food localized → loads water (0.5) and fertilizer (0.2)
    const nd = needs(s);
    expect(nd['food']).toBe(1500); // unchanged (cons-driven; nobody consumes food)
    expect(nd['fertilizer']).toBe(300); // 0.2 · need(food)=1500
    expect(nd['water']).toBe(2750); // cons 2000 + derived 0.5·1500
  });

  it('imported finished goods create no derived demand', () => {
    const s = mkState({ pop: 1000 }); // food NOT localized
    const nd = needs(s);
    expect(nd['fertilizer']).toBe(0); // food imported → no pull on fertilizer
  });
});
