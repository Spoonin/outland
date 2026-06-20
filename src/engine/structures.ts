// Mars structures (v2, D-044 / colony-sim.md §6). Built on Mars from money + local materials;
// each window they generate/draw energy and produce/consume resources. Energy is allocated by
// priority (resolveEnergy) and brownout scales a structure's output. Starter roster here; the
// full content set (medblocks/schools/labs/factories + black-node deps) lands in V5.

import { resolveEnergy, type Stocks, type ResourceKind, type EnergyDemand } from './resources';

export interface Structure {
  id: string;
  name: string;
  icon: string;
  capex: number; // money to build
  buildMaterials: Partial<Stocks>; // local materials consumed at build (ISRU/landed)
  energy: number; // +generation / −draw per window
  energyPriority: number; // for draws: 0 life-support, 1 farms, 2 factories
  produces: Partial<Stocks>; // per window at full power
  consumes: Partial<Stocks>; // per window (besides energy)
  prereq?: string; // structure id that must exist first (e.g. nuclear → waste pad)
}

export const STRUCTURES: readonly Structure[] = [
  { id: 'solar_plant', name: 'Солнечная электростанция', icon: '☀️', capex: 2e9, buildMaterials: { steel: 5000, glass: 2000 }, energy: 100, energyPriority: 2, produces: {}, consumes: {} },
  { id: 'waste_pad', name: 'Площадка отходов', icon: '☢️', capex: 1e9, buildMaterials: { steel: 3000 }, energy: 0, energyPriority: 2, produces: {}, consumes: {} },
  { id: 'nuclear_plant', name: 'Ядерная электростанция', icon: '⚛️', capex: 1e10, buildMaterials: { steel: 20000, metals: 5000 }, energy: 500, energyPriority: 2, produces: {}, consumes: {}, prereq: 'waste_pad' },
  { id: 'farm', name: 'Ферма / теплица', icon: '🌱', capex: 3e9, buildMaterials: { steel: 4000, glass: 5000 }, energy: -80, energyPriority: 1, produces: { food: 80000 }, consumes: { water: 20000 } },
  { id: 'water_recycler', name: 'ЖО: рециклинг воды', icon: '💧', capex: 2e9, buildMaterials: { steel: 2000, polymers: 1000 }, energy: -30, energyPriority: 0, produces: { water: 40000 }, consumes: {} },
  { id: 'o2_generator', name: 'ЖО: генератор O₂ (MOXIE)', icon: '🫧', capex: 2e9, buildMaterials: { steel: 2000 }, energy: -40, energyPriority: 0, produces: { o2: 15000 }, consumes: {} },
  // localization factories: cut bulk imports — but polymer_plant forever pulls catalyst (hi-tech wall)
  { id: 'steel_plant', name: 'Металлургия (сталь)', icon: '🏭', capex: 4e9, buildMaterials: { metals: 2000 }, energy: -60, energyPriority: 2, produces: { steel: 40000 }, consumes: {} },
  { id: 'glass_plant', name: 'Стекло/керамика', icon: '🪟', capex: 3e9, buildMaterials: { steel: 2000 }, energy: -40, energyPriority: 2, produces: { glass: 25000 }, consumes: {} },
  { id: 'polymer_plant', name: 'Полимеры (ФТ)', icon: '🧪', capex: 4e9, buildMaterials: { steel: 3000 }, energy: -50, energyPriority: 2, produces: { polymers: 18000 }, consumes: { catalyst: 300 } },
  // hi-tech consumers: permanent import floor of pharma/chips (D-046 "Earth leg")
  { id: 'medbay', name: 'Медблок (→ рождения)', icon: '🏥', capex: 5e9, buildMaterials: { steel: 2000, glass: 2000 }, energy: -30, energyPriority: 0, produces: {}, consumes: { pharma: 120 } },
  { id: 'rnd_lab', name: 'RnD-лаборатория', icon: '🔬', capex: 6e9, buildMaterials: { steel: 3000, glass: 2000 }, energy: -50, energyPriority: 2, produces: {}, consumes: { chips: 200 } },
];

export const STRUCT_BY_ID: Readonly<Record<string, Structure>> = Object.fromEntries(
  STRUCTURES.map((s) => [s.id, s]),
);

export type BuiltCounts = Record<string, number>;

/** Total energy generation from built structures. */
export function energyGeneration(built: BuiltCounts): number {
  let g = 0;
  for (const s of STRUCTURES) if (s.energy > 0) g += s.energy * (built[s.id] ?? 0);
  return g;
}

export interface EnergyResolution {
  generation: number;
  served: Record<string, number>; // fraction served per demand name ('lifesupport' + structure ids)
  deficit: number;
}

/** Resolve the colony's energy: life-support (pop) at priority 0, plus each drawing structure. */
export function resolveColonyEnergy(
  built: BuiltCounts,
  lifeSupportDemand: number,
): EnergyResolution {
  const demands: EnergyDemand[] = [{ name: 'lifesupport', priority: 0, demand: lifeSupportDemand }];
  for (const s of STRUCTURES) {
    const n = built[s.id] ?? 0;
    if (n > 0 && s.energy < 0) demands.push({ name: s.id, priority: s.energyPriority, demand: -s.energy * n });
  }
  const r = resolveEnergy(energyGeneration(built), demands);
  return { generation: r.generation, served: r.served, deficit: r.deficit };
}

/**
 * Aggregate structure production/consumption. Run fraction = energy served × input availability:
 * a structure short of a consumed input (e.g. polymer_plant without imported catalyst) browns out
 * proportionally — the hi-tech import wall (D-045/D-046). `avail` = stock+arrivals per resource;
 * omitted → inputs assumed unlimited (energy-only, used by unit tests).
 */
export function structureFlows(
  built: BuiltCounts,
  served: Record<string, number>,
  avail?: Partial<Stocks>,
): { production: Partial<Stocks>; consumption: Partial<Stocks> } {
  const add = (acc: Partial<Stocks>, r: ResourceKind, v: number) => (acc[r] = (acc[r] ?? 0) + v);
  const energyPower = (s: Structure): number => (s.energy < 0 ? (served[s.id] ?? 0) : 1);

  // pass 1: energy-scaled desired consumption per resource → availability ratio
  const desired: Partial<Stocks> = {};
  for (const s of STRUCTURES) {
    const n = built[s.id] ?? 0;
    if (n <= 0) continue;
    const power = energyPower(s);
    for (const r of Object.keys(s.consumes) as ResourceKind[]) add(desired, r, (s.consumes[r] ?? 0) * n * power);
  }
  const ratio = (r: ResourceKind): number => {
    if (!avail) return 1;
    const d = desired[r] ?? 0;
    if (d <= 0) return 1;
    const a = avail[r] ?? 0;
    return a >= d ? 1 : a / d;
  };

  // pass 2: run fraction = energy × min(input availability), scale production & consumption
  const production: Partial<Stocks> = {};
  const consumption: Partial<Stocks> = {};
  for (const s of STRUCTURES) {
    const n = built[s.id] ?? 0;
    if (n <= 0) continue;
    let inputCap = 1;
    for (const r of Object.keys(s.consumes) as ResourceKind[]) inputCap = Math.min(inputCap, ratio(r));
    const runFrac = energyPower(s) * inputCap;
    for (const r of Object.keys(s.produces) as ResourceKind[]) add(production, r, (s.produces[r] ?? 0) * n * runFrac);
    for (const r of Object.keys(s.consumes) as ResourceKind[]) add(consumption, r, (s.consumes[r] ?? 0) * n * runFrac);
  }
  return { production, consumption };
}
