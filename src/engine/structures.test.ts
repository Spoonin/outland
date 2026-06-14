import { describe, it, expect } from 'vitest';
import { energyGeneration, resolveColonyEnergy, structureFlows } from './structures';

describe('structures — energy & production (D-044)', () => {
  it('generation sums power plants', () => {
    expect(energyGeneration({ solar_plant: 2 })).toBe(200); // 2 × 100
    expect(energyGeneration({ nuclear_plant: 1 })).toBe(500);
  });

  it('life-support has priority over factories under shortage', () => {
    // gen 100; life-support 60 (prio 0), farm draws 80 (prio 1)
    const r = resolveColonyEnergy({ solar_plant: 1, farm: 1 }, 60);
    expect(r.served['lifesupport']).toBe(1); // fully served first
    expect(r.served['farm']).toBeCloseTo(0.5, 5); // 40 of 80 left → half
    expect(r.deficit).toBe(40);
  });

  it('brownout scales drawing-structure output', () => {
    const r = resolveColonyEnergy({ solar_plant: 1, farm: 1 }, 60); // farm at 0.5
    const f = structureFlows({ solar_plant: 1, farm: 1 }, r.served);
    expect(f.production.food).toBeCloseTo(80000 * 0.5, 0); // half power → half food
    expect(f.consumption.water).toBeCloseTo(20000 * 0.5, 0);
  });

  it('full power → full output', () => {
    const r = resolveColonyEnergy({ nuclear_plant: 1, waste_pad: 1, farm: 1 }, 50);
    const f = structureFlows({ nuclear_plant: 1, farm: 1 }, r.served);
    expect(f.production.food).toBe(80000);
  });
});
