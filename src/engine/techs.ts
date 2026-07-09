// V8 advanced-tech tree (colony-sim.md §9, roadmap-2 Block C; content since D-089/P1). Row shape:
// (id, name, icon, cost, prereqTech, prereqStructure, minPop, effect, magnitude, notes). techMods()
// below folds every OWNED tech's effect into one neutral-by-default bundle — with an empty/absent
// tech (unowned, or a stale id from an older save), every multiplier here stays a no-op, which is
// what techs.test.ts's "empty tree" tests pin for the pre-P1 baseline.

import { parseCsv, num } from '../data/csv';
import techsCsv from '../data/techs.csv?raw';

export type TechEffect =
  | 'opsCrewMult' // multiplies laborDemand (D-075) — robots/automation
  | 'cureProb' // adds to D-083's cureProb (medical unlocks)
  | 'lifeExpectancyBonus' // adds to D-083's lifeExpectancy (medical unlocks)
  | 'repairRateMult' // multiplies D-084's repairRate (robo-repair)
  | 'unlockStructure' // gates a structures.csv row behind this tech (e.g. fusion)
  | 'refuelStage3' // reserve rung beyond D-068's two-stage refuel ladder
  | 'none'; // D-089: a pure gate — the tech's only effect is structures.csv's OWN `techGate`
  // column pointing back at this id (D-088); nothing for techMods() to fold in. Used by every P1
  // tech (isru_extraction/electrolysis/regolith_metallurgy) — see D-088 "Альтернативы" for why
  // `unlockStructure`/`prereqStructure`'s double-duty was rejected as the gating mechanism.

export interface TechSpec {
  id: string;
  name: string;
  icon: string;
  cost: number; // money, priced like the R&D ladder (D-068) — inflation-adjusted at purchase time
  prereqTech?: string; // another tech's id that must already be bought
  prereqStructure?: string; // a structures.csv id that must already be built
  minPop?: number; // D-074-style population gate
  effect: TechEffect;
  magnitude: number; // meaning depends on `effect` — see TechEffect
  notes?: string;
}

function loadTechs(): TechSpec[] {
  return parseCsv(techsCsv).map((row): TechSpec => {
    const t: TechSpec = {
      id: row.id!,
      name: row.name!,
      icon: row.icon!,
      cost: num(row.cost),
      effect: row.effect as TechEffect,
      magnitude: num(row.magnitude),
    };
    if (row.prereqTech) t.prereqTech = row.prereqTech;
    if (row.prereqStructure) t.prereqStructure = row.prereqStructure;
    if (row.minPop) t.minPop = num(row.minPop);
    if (row.notes) t.notes = row.notes;
    return t;
  });
}

export const TECHS: readonly TechSpec[] = loadTechs();
export const TECH_BY_ID: Readonly<Record<string, TechSpec>> = Object.fromEntries(TECHS.map((t) => [t.id, t]));

/** Colony-wide modifiers folded from every bought tech (roadmap-2 scaffold) — one neutral bundle
 * when `techs` is empty, so commitWindow's existing math is untouched until content exists. */
export interface TechMods {
  opsCrewMult: number; // laborDemand multiplier (D-075)
  cureProbBonus: number; // added to D-083's cureProb
  lifeExpectancyBonus: number; // added to D-083's lifeExpectancy
  repairRateMult: number; // D-084's repairRate multiplier
  unlockedStructures: ReadonlySet<string>;
}

export function techMods(techs: readonly string[]): TechMods {
  let opsCrewMult = 1;
  let cureProbBonus = 0;
  let lifeExpectancyBonus = 0;
  let repairRateMult = 1;
  const unlockedStructures = new Set<string>();
  for (const id of techs) {
    const t = TECH_BY_ID[id];
    if (!t) continue;
    switch (t.effect) {
      case 'opsCrewMult':
        opsCrewMult *= t.magnitude;
        break;
      case 'cureProb':
        cureProbBonus += t.magnitude;
        break;
      case 'lifeExpectancyBonus':
        lifeExpectancyBonus += t.magnitude;
        break;
      case 'repairRateMult':
        repairRateMult *= t.magnitude;
        break;
      case 'unlockStructure':
        if (t.prereqStructure) unlockedStructures.add(t.prereqStructure);
        break;
      case 'refuelStage3':
        break; // reserve — no gameplay hook yet (D-067/068)
      case 'none':
        break; // D-089: pure techGate, nothing to fold in
    }
  }
  return { opsCrewMult, cureProbBonus, lifeExpectancyBonus, repairRateMult, unlockedStructures };
}

/** Whether `id` can be bought right now (roadmap-2 scaffold) — same shape as the R&D ladder's own
 * gates (D-077's everHadPop, D-074-style minPop), plus a tech prerequisite. Doesn't check cost or
 * "already bought" — callers combine this with the usual budget/feasibility checks. */
export function techBuyable(
  id: string,
  owned: readonly string[],
  built: Readonly<Record<string, number>>,
  pop: number,
  everHadPop: boolean,
): boolean {
  const t = TECH_BY_ID[id];
  if (!t) return false;
  if (owned.includes(id)) return false;
  if (!everHadPop) return false; // D-077: no campaign without Mars presence
  if (t.prereqTech && !owned.includes(t.prereqTech)) return false;
  if (t.prereqStructure && (built[t.prereqStructure] ?? 0) <= 0) return false;
  if (t.minPop && pop < t.minPop) return false;
  return true;
}
