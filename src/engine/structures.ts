// Mars structures (v2, D-044 / colony-sim.md §6). Built on Mars from money + local materials;
// each window they generate/draw energy and produce/consume resources. Output scales by energy
// (priority brownout), input availability (hi-tech wall, D-050) AND condition (wear, V6/D-052):
// a structure left unmaintained (no spares) degrades → produces less → cascade.

import { resolveEnergy, type Stocks, type ResourceKind, type EnergyDemand } from './resources';

export interface Structure {
  id: string;
  name: string;
  icon: string;
  capex: number; // money to build
  buildMaterials: Partial<Stocks>; // local materials consumed at build (ISRU/landed)
  energy: number; // +generation / −draw per window (at full condition)
  energyPriority: number; // for draws: 0 life-support, 1 farms, 2 factories
  produces: Partial<Stocks>; // per window at full power
  consumes: Partial<Stocks>; // per window (besides energy)
  upkeepSpares: number; // spares/window to hold condition (V6); unmet → degradation
  housing?: number; // colonists this structure can house (habitat); absent → 0
  n2Leak?: number; // kg N₂ leaked per unit per window (pressurized volume, V7); absent → 0
  prereq?: string; // structure id that must exist first (e.g. nuclear → waste pad)
}

export const STRUCTURES: readonly Structure[] = [
  { id: 'solar_plant', name: 'Солнечная электростанция', icon: '☀️', capex: 2e9, buildMaterials: { steel: 5000, glass: 2000 }, energy: 100, energyPriority: 2, produces: {}, consumes: {}, upkeepSpares: 300 },
  { id: 'waste_pad', name: 'Площадка отходов', icon: '☢️', capex: 1e9, buildMaterials: { steel: 3000 }, energy: 0, energyPriority: 2, produces: {}, consumes: {}, upkeepSpares: 50 },
  { id: 'nuclear_plant', name: 'Ядерная электростанция', icon: '⚛️', capex: 1e10, buildMaterials: { steel: 20000, metals: 5000 }, energy: 500, energyPriority: 2, produces: {}, consumes: {}, upkeepSpares: 1500, prereq: 'waste_pad' },
  { id: 'farm', name: 'Ферма / теплица', icon: '🌱', capex: 3e9, buildMaterials: { steel: 4000, glass: 5000 }, energy: -80, energyPriority: 1, produces: { food: 80000 }, consumes: { water: 20000 }, upkeepSpares: 400 },
  { id: 'water_recycler', name: 'ЖО: рециклинг воды', icon: '💧', capex: 2e9, buildMaterials: { steel: 2000, polymers: 1000 }, energy: -30, energyPriority: 0, produces: { water: 40000 }, consumes: {}, upkeepSpares: 350 },
  { id: 'o2_generator', name: 'ЖО: генератор O₂ (MOXIE)', icon: '🫧', capex: 2e9, buildMaterials: { steel: 2000 }, energy: -40, energyPriority: 0, produces: { o2: 15000 }, consumes: {}, upkeepSpares: 350 },
  // localization factories: cut bulk imports — but polymer_plant forever pulls catalyst (hi-tech wall)
  { id: 'steel_plant', name: 'Металлургия (сталь)', icon: '🏭', capex: 4e9, buildMaterials: { metals: 2000 }, energy: -60, energyPriority: 2, produces: { steel: 40000 }, consumes: {}, upkeepSpares: 600 },
  { id: 'glass_plant', name: 'Стекло/керамика', icon: '🪟', capex: 3e9, buildMaterials: { steel: 2000 }, energy: -40, energyPriority: 2, produces: { glass: 25000 }, consumes: {}, upkeepSpares: 400 },
  { id: 'polymer_plant', name: 'Полимеры (ФТ)', icon: '🧪', capex: 4e9, buildMaterials: { steel: 3000 }, energy: -50, energyPriority: 2, produces: { polymers: 18000 }, consumes: { catalyst: 300 }, upkeepSpares: 500 },
  // hi-tech consumers: permanent import floor of pharma/chips (D-046 "Earth leg")
  { id: 'medbay', name: 'Медблок (→ рождения)', icon: '🏥', capex: 5e9, buildMaterials: { steel: 2000, glass: 2000 }, energy: -30, energyPriority: 0, produces: {}, consumes: { pharma: 120 }, upkeepSpares: 400 },
  { id: 'rnd_lab', name: 'RnD-лаборатория', icon: '🔬', capex: 6e9, buildMaterials: { steel: 3000, glass: 2000 }, energy: -50, energyPriority: 2, produces: {}, consumes: { chips: 200 }, upkeepSpares: 500 },
  // V7: atmosphere/BIOS — housing, N₂ structural leak, N₂ ISRU, bio O₂ regeneration (D-048)
  { id: 'habitat', name: 'Жилой модуль', icon: '🏠', capex: 3e9, buildMaterials: { steel: 6000, glass: 4000, polymers: 1000 }, energy: -15, energyPriority: 0, produces: {}, consumes: {}, upkeepSpares: 350, housing: 200, n2Leak: 500 },
  { id: 'n2_concentrator', name: 'Концентратор N₂ (ISRU)', icon: '🫧', capex: 2.5e9, buildMaterials: { steel: 3000 }, energy: -70, energyPriority: 1, produces: { n2: 10000 }, consumes: {}, upkeepSpares: 400 },
  { id: 'algae_bioreactor', name: 'Биореактор (водоросли)', icon: '🌿', capex: 3e9, buildMaterials: { steel: 2000, glass: 3000, polymers: 500 }, energy: -30, energyPriority: 1, produces: { o2: 15000 }, consumes: { water: 8000 }, upkeepSpares: 500 },
];

export const STRUCT_BY_ID: Readonly<Record<string, Structure>> = Object.fromEntries(
  STRUCTURES.map((s) => [s.id, s]),
);

export type BuiltCounts = Record<string, number>;
/** Per-structure-type condition 0..1 (V6). Missing → treated as 1 (full). */
export type Condition = Record<string, number>;

const condOf = (c: Condition | undefined, id: string): number => {
  const v = c?.[id];
  return v === undefined ? 1 : Math.max(0, Math.min(1, v));
};

/** Total energy generation from built power plants, scaled by condition (V6). */
export function energyGeneration(built: BuiltCounts, condition?: Condition): number {
  let g = 0;
  for (const s of STRUCTURES) if (s.energy > 0) g += s.energy * (built[s.id] ?? 0) * condOf(condition, s.id);
  return g;
}

export interface EnergyResolution {
  generation: number;
  served: Record<string, number>;
  deficit: number;
}

/** Resolve colony energy: life-support (priority 0) + each drawing structure (demand scaled by condition). */
export function resolveColonyEnergy(
  built: BuiltCounts,
  lifeSupportDemand: number,
  condition?: Condition,
): EnergyResolution {
  const demands: EnergyDemand[] = [{ name: 'lifesupport', priority: 0, demand: lifeSupportDemand }];
  for (const s of STRUCTURES) {
    const n = built[s.id] ?? 0;
    if (n > 0 && s.energy < 0) demands.push({ name: s.id, priority: s.energyPriority, demand: -s.energy * n * condOf(condition, s.id) });
  }
  const r = resolveEnergy(energyGeneration(built, condition), demands);
  return { generation: r.generation, served: r.served, deficit: r.deficit };
}

/**
 * Aggregate structure production/consumption. Run fraction = condition × energy served × input
 * availability. Condition (V6) and input availability (D-050) both throttle output → cascades.
 */
export function structureFlows(
  built: BuiltCounts,
  served: Record<string, number>,
  avail?: Partial<Stocks>,
  condition?: Condition,
): { production: Partial<Stocks>; consumption: Partial<Stocks> } {
  const add = (acc: Partial<Stocks>, r: ResourceKind, v: number) => (acc[r] = (acc[r] ?? 0) + v);
  const energyPower = (s: Structure): number => (s.energy < 0 ? (served[s.id] ?? 0) : 1);

  // pass 1: desired consumption per resource (condition × energy scaled) → availability ratio
  const desired: Partial<Stocks> = {};
  for (const s of STRUCTURES) {
    const n = built[s.id] ?? 0;
    if (n <= 0) continue;
    const base = n * energyPower(s) * condOf(condition, s.id);
    for (const r of Object.keys(s.consumes) as ResourceKind[]) add(desired, r, (s.consumes[r] ?? 0) * base);
  }
  const ratio = (r: ResourceKind): number => {
    if (!avail) return 1;
    const d = desired[r] ?? 0;
    if (d <= 0) return 1;
    const a = avail[r] ?? 0;
    return a >= d ? 1 : a / d;
  };

  // pass 2: runFrac = condition × energy × min(input availability)
  const production: Partial<Stocks> = {};
  const consumption: Partial<Stocks> = {};
  for (const s of STRUCTURES) {
    const n = built[s.id] ?? 0;
    if (n <= 0) continue;
    let inputCap = 1;
    for (const r of Object.keys(s.consumes) as ResourceKind[]) inputCap = Math.min(inputCap, ratio(r));
    const runFrac = condOf(condition, s.id) * energyPower(s) * inputCap;
    for (const r of Object.keys(s.produces) as ResourceKind[]) add(production, r, (s.produces[r] ?? 0) * n * runFrac);
    for (const r of Object.keys(s.consumes) as ResourceKind[]) add(consumption, r, (s.consumes[r] ?? 0) * n * runFrac);
  }
  return { production, consumption };
}

/** Spares/window needed to hold all built structures at full condition (V6). */
export function spareUpkeep(built: BuiltCounts): number {
  let u = 0;
  for (const s of STRUCTURES) u += (built[s.id] ?? 0) * s.upkeepSpares;
  return u;
}

/** Total colonist housing slots from all built habitat structures (V7). */
export function housingCapacity(built: BuiltCounts): number {
  let total = 0;
  for (const s of STRUCTURES) total += (s.housing ?? 0) * (built[s.id] ?? 0);
  return total;
}

/** Total N₂ leaked per window from pressurized hull volume of built structures (V7). */
export function structuralN2Leak(built: BuiltCounts): number {
  let total = 0;
  for (const s of STRUCTURES) total += (s.n2Leak ?? 0) * (built[s.id] ?? 0);
  return total;
}
