// Mars structures (v2, D-044 / colony-sim.md §6). Built on Mars from money + local materials;
// each window they generate/draw energy and produce/consume resources. Output scales by energy
// (priority brownout), input availability (hi-tech wall, D-050) AND condition (wear, V6/D-052):
// a structure left unmaintained (no spares) degrades → produces less → cascade.

import { resolveEnergy, RESOURCES, type Stocks, type ResourceKind, type EnergyDemand } from './resources';
import { parseCsv, num } from '../data/csv';
import structuresCsv from '../data/structures.csv?raw';

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

/** Loads the structure catalog from data/structures.csv (D-058) — a balance spreadsheet, not code. */
function loadStructures(): Structure[] {
  return parseCsv(structuresCsv).map((row): Structure => {
    const buildMaterials: Partial<Stocks> = {};
    const produces: Partial<Stocks> = {};
    const consumes: Partial<Stocks> = {};
    for (const r of RESOURCES) {
      const m = num(row[`mat_${r}`]);
      if (m) buildMaterials[r] = m;
      const p = num(row[`prod_${r}`]);
      if (p) produces[r] = p;
      const c = num(row[`cons_${r}`]);
      if (c) consumes[r] = c;
    }
    const s: Structure = {
      id: row.id,
      name: row.name,
      icon: row.icon,
      capex: num(row.capex),
      buildMaterials,
      energy: num(row.energy),
      energyPriority: num(row.energyPriority),
      produces,
      consumes,
      upkeepSpares: num(row.upkeepSpares),
    };
    if (row.housing) s.housing = num(row.housing);
    if (row.n2Leak) s.n2Leak = num(row.n2Leak);
    if (row.prereq) s.prereq = row.prereq;
    return s;
  });
}

export const STRUCTURES: readonly Structure[] = loadStructures();

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

/** Resolve colony energy: life-support (priority 0) + each drawing structure (demand scaled by condition).
 * `genMult` (D-063, dust storms) additionally scales generation before allocation. */
export function resolveColonyEnergy(
  built: BuiltCounts,
  lifeSupportDemand: number,
  condition?: Condition,
  genMult = 1,
): EnergyResolution {
  const demands: EnergyDemand[] = [{ name: 'lifesupport', priority: 0, demand: lifeSupportDemand }];
  for (const s of STRUCTURES) {
    const n = built[s.id] ?? 0;
    if (n > 0 && s.energy < 0) demands.push({ name: s.id, priority: s.energyPriority, demand: -s.energy * n * condOf(condition, s.id) });
  }
  const r = resolveEnergy(energyGeneration(built, condition) * genMult, demands);
  return { generation: r.generation, served: r.served, deficit: r.deficit };
}

/** Per-structure-type output breakdown for the chronicle (D-061): runFrac = condition × energy × inputs. */
export interface StructureDiag {
  condition: number; // 0..1
  energyFrac: number; // 0..1 power served (1 for non-drawing/producing structures)
  inputFrac: number; // 0..1 worst input-availability ratio (1 if no inputs consumed)
  runFrac: number; // condition × energyFrac × inputFrac — the actual output multiplier
}

/**
 * Aggregate structure production/consumption. Run fraction = condition × energy served × input
 * availability. Condition (V6) and input availability (D-050) both throttle output → cascades.
 * `farmMult` (D-063, blight) additionally throttles any structure that produces food.
 */
export function structureFlows(
  built: BuiltCounts,
  served: Record<string, number>,
  avail?: Partial<Stocks>,
  condition?: Condition,
  farmMult = 1,
): { production: Partial<Stocks>; consumption: Partial<Stocks>; diag: Record<string, StructureDiag> } {
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

  // pass 2: runFrac = condition × energy × min(input availability) × farm blight (food producers only)
  const production: Partial<Stocks> = {};
  const consumption: Partial<Stocks> = {};
  const diag: Record<string, StructureDiag> = {};
  for (const s of STRUCTURES) {
    const n = built[s.id] ?? 0;
    if (n <= 0) continue;
    let inputCap = 1;
    for (const r of Object.keys(s.consumes) as ResourceKind[]) inputCap = Math.min(inputCap, ratio(r));
    const isFarm = (s.produces.food ?? 0) > 0;
    const cond = condOf(condition, s.id);
    const eFrac = energyPower(s);
    const blight = isFarm ? farmMult : 1;
    const runFrac = cond * eFrac * inputCap * blight;
    diag[s.id] = { condition: cond, energyFrac: eFrac, inputFrac: inputCap * blight, runFrac };
    for (const r of Object.keys(s.produces) as ResourceKind[]) add(production, r, (s.produces[r] ?? 0) * n * runFrac);
    for (const r of Object.keys(s.consumes) as ResourceKind[]) add(consumption, r, (s.consumes[r] ?? 0) * n * runFrac);
  }
  return { production, consumption, diag };
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
