// Save/load (pre-release: no backward compatibility — a version mismatch or malformed blob just
// discards to a fresh colony, never crashes). Persist ONLY dynamic state; config is always
// reconstructed from defaults on load.

import { newColony, type ColonyState, type ColonyParams, type ColonyReport, type Transit, type MilestoneId } from './colony';
import { RESOURCES, type Stocks } from './resources';
import { type LaunchTech } from './logistics';
import { type ActiveEffect } from './events';

export const SAVE_VERSION = 4;

/** The persisted shape — dynamic state only (config is rebuilt from defaults on load). */
export interface ColonySave {
  v: number;
  window: number;
  pop: number;
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
}

export function serializeColony(s: ColonyState): ColonySave {
  return {
    v: SAVE_VERSION,
    window: s.window,
    pop: s.pop,
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
  };
}

/** Build a ColonyState from a save of the CURRENT version. */
export function hydrateColony(save: ColonySave, p: ColonyParams): ColonyState {
  const base = newColony(p);
  return {
    ...base,
    window: save.window,
    pop: save.pop,
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
    p,
  };
}

/** Basic shape sanity — guards against corrupted/truncated JSON, not schema drift. */
function valid(s: ColonyState): boolean {
  return (
    RESOURCES.every((r) => typeof s.stocks[r] === 'number') &&
    typeof s.fleet.pads.classic === 'number' &&
    typeof s.rngState === 'number' &&
    typeof s.pop === 'number'
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
