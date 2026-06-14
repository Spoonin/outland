import { describe, it, expect } from 'vitest';
import { nodeEconomics, needs } from './sim';
import { NODES } from './graph';
import { mkState } from './_testutil';

describe('nodeEconomics — import economics & D-038 price dichotomy', () => {
  it('bulk node: shipping dominates (water, heavy/cheap)', () => {
    const s = mkState({ pop: 1000 });
    const e = nodeEconomics(s, needs(s), NODES['water']!, 1.0);
    expect(e.demandUnits).toBe(2000); // cons 2 · pop 1000
    expect(e.unitShipping).toBe(100 * 400); // mass·fuelPerKg
    expect(e.unitShipping).toBeGreaterThan(e.unitEarth * 100); // shipping ≫ intrinsic
    expect(e.fContribution).toBeCloseTo(2000 * (1 + 100 * 400), 0);
  });

  it('black node: intrinsic cost dominates (pharma, light/dear)', () => {
    const s = mkState({ pop: 1000 });
    const e = nodeEconomics(s, needs(s), NODES['pharma']!, 1.0);
    expect(e.unitEarth).toBe(2.0e8);
    expect(e.unitEarth).toBeGreaterThan(e.unitShipping * 1000); // intrinsic ≫ shipping
  });

  it('localized node imports only the maintenance tail', () => {
    const s = mkState({ pop: 1000 });
    s.localized['water'] = true;
    s.age['water'] = 1000; // tail saturated at tailMax
    const e = nodeEconomics(s, needs(s), NODES['water']!, 1.0);
    expect(e.importedUnits).toBeCloseTo(e.demandUnits * s.p.tailMax, 4);
  });

  it('inflation multiplier scales the unit price', () => {
    const s = mkState({ pop: 1000 });
    const e1 = nodeEconomics(s, needs(s), NODES['water']!, 1.0);
    const e2 = nodeEconomics(s, needs(s), NODES['water']!, 2.0);
    expect(e2.unitPrice).toBeCloseTo(e1.unitPrice * 2, 4);
  });
});
