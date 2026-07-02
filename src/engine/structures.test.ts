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

  it('diag breaks output down into condition × energy × inputs (D-061)', () => {
    const r = resolveColonyEnergy({ solar_plant: 1, farm: 1 }, 60); // farm brownout → 0.5 energyFrac
    const f = structureFlows({ solar_plant: 1, farm: 1 }, r.served, undefined, { farm: 0.8 });
    const d = f.diag.farm!;
    expect(d.condition).toBeCloseTo(0.8, 5);
    expect(d.energyFrac).toBeCloseTo(0.5, 5);
    expect(d.inputFrac).toBe(1); // no avail passed → uncapped
    expect(d.runFrac).toBeCloseTo(0.8 * 0.5, 5);
  });

  it('a blighted farm (D-063 farmMult) shows reduced inputFrac in diag, non-farm structures unaffected', () => {
    const r = resolveColonyEnergy({ solar_plant: 1, farm: 1, steel_plant: 1 }, 0);
    const f = structureFlows({ solar_plant: 1, farm: 1, steel_plant: 1 }, r.served, undefined, undefined, 0.4);
    expect(f.diag.farm!.runFrac).toBeCloseTo(f.diag.farm!.energyFrac * 0.4, 5);
    expect(f.diag.steel_plant!.inputFrac).toBe(1); // blight only touches food producers
  });
});
