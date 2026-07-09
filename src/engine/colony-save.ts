// Save/load (pre-release: no backward compatibility — a version mismatch or malformed blob just
// discards to a fresh colony, never crashes). Persist ONLY dynamic state; config is always
// reconstructed from defaults on load.

import { newColony, type ColonyState, type ColonyParams, type ColonyReport, type Transit, type MilestoneId } from './colony';
import type { Colonist } from './colonists';
import { RESOURCES, type Stocks } from './resources';
import { type LaunchTech } from './logistics';
import { type ActiveEffect } from './events';

export const SAVE_VERSION = 8; // D-089 (P1): added `industryOutput` (depletion/ramp cumulative) + widened `Stocks` (regolith/hydrogen/co2)

/** The persisted shape — dynamic state only (config is rebuilt from defaults on load). */
export interface ColonySave {
  v: number;
  window: number;
  pop: number; // derived (colonists.length) — kept for cheap validity checks
  colonists: Colonist[]; // D-083: the population itself
  everHadPop: boolean;
  stocks: Stocks;
  inTransit: { stocks: Stocks; colonists: number; structures: Record<string, number> };
  fleet: { pads: Record<LaunchTech, number>; refuelStage: number };
  built: Record<string, number>;
  condition: Record<string, number>;
  rngState: number;
  chronicle: ColonyReport[];
  activeEffects: ActiveEffect[];
  holdTransit: Transit | null;
  lastEvent: { id: string; window: number } | null;
  milestones: Partial<Record<MilestoneId, number>>;
  subsidyBonus: number;
  techs: string[]; // roadmap-2/V8 scaffold — ids of bought techs (data/techs.csv), [] while empty
  industryOutput: Record<string, number>; // D-089 (P1): cumulative kg by structure type (depletion/ramp)
}

export function serializeColony(s: ColonyState): ColonySave {
  return {
    v: SAVE_VERSION,
    window: s.window,
    pop: s.pop,
    colonists: s.colonists.map((c) => ({ ...c })),
    everHadPop: s.everHadPop,
    stocks: { ...s.stocks },
    inTransit: { stocks: { ...s.inTransit.stocks }, colonists: s.inTransit.colonists, structures: { ...s.inTransit.structures } },
    fleet: { pads: { ...s.fleet.pads }, refuelStage: s.fleet.refuelStage },
    built: { ...s.built },
    condition: { ...s.condition },
    rngState: s.rngState,
    chronicle: [...s.chronicle],
    activeEffects: s.activeEffects.map((e) => ({ ...e })),
    holdTransit: s.holdTransit ? { stocks: { ...s.holdTransit.stocks }, colonists: s.holdTransit.colonists, structures: { ...s.holdTransit.structures } } : null,
    lastEvent: s.lastEvent ? { ...s.lastEvent } : null,
    milestones: { ...s.milestones },
    subsidyBonus: s.subsidyBonus,
    techs: [...s.techs],
    industryOutput: { ...s.industryOutput },
  };
}

/** Build a ColonyState from a save of the CURRENT version. */
export function hydrateColony(save: ColonySave, p: ColonyParams): ColonyState {
  const base = newColony(p);
  return {
    ...base,
    window: save.window,
    pop: save.colonists.length,
    colonists: save.colonists.map((c) => ({ ...c })),
    everHadPop: save.everHadPop,
    stocks: { ...save.stocks },
    inTransit: {
      stocks: { ...save.inTransit.stocks },
      colonists: save.inTransit.colonists,
      structures: { ...save.inTransit.structures },
    },
    fleet: { refuelStage: save.fleet.refuelStage, pads: { ...save.fleet.pads } },
    built: { ...save.built },
    condition: { ...save.condition },
    rngState: save.rngState,
    chronicle: [...save.chronicle],
    activeEffects: save.activeEffects.map((e) => ({ ...e })),
    holdTransit: save.holdTransit,
    lastEvent: save.lastEvent,
    milestones: { ...save.milestones },
    subsidyBonus: save.subsidyBonus,
    techs: [...save.techs],
    industryOutput: { ...save.industryOutput },
    p,
  };
}

/** Basic shape sanity — guards against corrupted/truncated JSON, not schema drift. */
function valid(s: ColonyState): boolean {
  return (
    RESOURCES.every((r) => typeof s.stocks[r] === 'number') &&
    typeof s.fleet.pads.classic === 'number' &&
    typeof s.rngState === 'number' &&
    typeof s.pop === 'number' &&
    Array.isArray(s.colonists) &&
    s.colonists.every((c) => typeof c.age === 'number' && typeof c.deathAge === 'number') &&
    Array.isArray(s.techs) &&
    typeof s.industryOutput === 'object' &&
    s.industryOutput !== null
  );
}

/** Full load path: parse → version check → hydrate → validate. Any mismatch/corruption → null
 * (fresh game). No migration path — pre-release, saves aren't worth preserving across schema changes. */
export function loadColony(raw: string, p: ColonyParams): ColonyState | null {
  try {
    const blob = JSON.parse(raw) as { v?: number };
    if (blob.v !== SAVE_VERSION) return null;
    const state = hydrateColony(blob as unknown as ColonySave, p);
    return valid(state) ? state : null;
  } catch {
    return null;
  }
}
