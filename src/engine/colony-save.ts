// Save backward-compatibility (D-051). Persist ONLY dynamic state (not config — params are always
// defaults, reconstructed on load). Load = parse → migrate (versioned chain) → hydrate (merge over a
// fresh colony, so additive changes self-fill) → validate (else null → fresh game, never crash).

import { newColony, type ColonyState, type ColonyParams, type ColonyReport, type Transit, type MilestoneId } from './colony';
import { RESOURCES, emptyStocks, type Stocks } from './resources';
import { type LaunchTech } from './logistics';
import { type ActiveEffect } from './events';

export const SAVE_VERSION = 4;

/** The persisted shape — dynamic state only (config is rebuilt from defaults on load). */
export interface ColonySave {
  v: number;
  window: number;
  pop: number;
  everHadPop: boolean;
  stocks: Partial<Stocks>;
  inTransit: { stocks: Partial<Stocks>; colonists: number; structures?: Record<string, number> };
  fleet: { pads: Partial<Record<LaunchTech, number>>; refuelStage: number };
  built: Record<string, number>;
  condition: Record<string, number>;
  rngState: number;
  chronicle?: ColonyReport[]; // per-window report history (D-061); optional — older saves lack it
  activeEffects?: ActiveEffect[]; // rolling storyteller effects (D-063); optional — older saves lack it
  holdTransit?: Transit | null; // a convoy delayed by a skip_window event (D-063)
  lastEvent?: { id: string; window: number } | null; // last fired event, for the no-repeat rule (D-063)
  milestones?: Partial<Record<MilestoneId, number>>; // id → window achieved (D-064); optional — older saves lack it
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

// ---- migrations: transform a parsed blob one version forward, keyed by source version ----------

type AnyBlob = Record<string, unknown>;

/** Legacy (v1/v2): stored `{ v, state: <full ColonyState> }` with fleet.pads a NUMBER (pre-D-049). */
function legacyToV3(b: AnyBlob): AnyBlob {
  const st = ((b.state as AnyBlob) ?? b) as AnyBlob;
  const fleet = (st.fleet as AnyBlob) ?? {};
  const pads = fleet.pads as unknown;
  const classic = typeof pads === 'number' ? pads : ((pads as AnyBlob)?.classic as number) ?? 0;
  const refuel = typeof pads === 'number' ? 0 : ((pads as AnyBlob)?.refuel as number) ?? 0;
  const it = (st.inTransit as AnyBlob) ?? {};
  return {
    v: 3,
    window: st.window ?? 0,
    pop: st.pop ?? 0,
    stocks: st.stocks ?? {},
    inTransit: { stocks: (it.stocks as AnyBlob) ?? {}, colonists: (it.colonists as number) ?? 0 },
    fleet: { pads: { classic, refuel }, refuelUnlocked: (fleet.refuelUnlocked as boolean) ?? false },
    built: st.built ?? {},
    rngState: (st.rngState as number) ?? 1,
  };
}

/** v3 → v4 (D-068): the single refuel unlock became a staged R&D ladder. An old save with the
 * unlock owned had full (single-stage-era) capability → map to the ladder's TOP stage; without
 * it → stage 0. */
function v3ToV4(b: AnyBlob): AnyBlob {
  const fleet = (b.fleet as AnyBlob) ?? {};
  const unlocked = (fleet.refuelUnlocked as boolean) ?? false;
  return {
    ...b,
    v: 4,
    fleet: { pads: (fleet.pads as AnyBlob) ?? {}, refuelStage: unlocked ? 2 : 0 },
  };
}

/** Source version → one-step migration. Add an entry whenever a breaking schema change ships. */
const MIGRATIONS: Record<number, (b: AnyBlob) => AnyBlob> = {
  1: legacyToV3,
  2: legacyToV3,
  3: v3ToV4,
};

function migrate(blob: AnyBlob): AnyBlob | null {
  let b = blob;
  let guard = 0;
  while (typeof b.v === 'number' && b.v < SAVE_VERSION) {
    const step = MIGRATIONS[b.v as number];
    if (!step || guard++ > 16) return null; // no path / loop → discard
    b = step(b);
  }
  return b;
}

// ---- hydrate + validate -------------------------------------------------------------------------

/** Merge a save's dynamic fields over a fresh colony so missing/new keys self-fill with defaults. */
export function hydrateColony(save: ColonySave, p: ColonyParams): ColonyState {
  const base = newColony(p);
  return {
    ...base,
    window: save.window,
    pop: save.pop,
    everHadPop: save.everHadPop ?? save.pop > 0,
    stocks: { ...base.stocks, ...save.stocks },
    inTransit: {
      stocks: { ...emptyStocks(0), ...save.inTransit.stocks },
      colonists: save.inTransit.colonists,
      structures: { ...(save.inTransit.structures ?? {}) },
    },
    fleet: {
      refuelStage: save.fleet.refuelStage ?? 0,
      pads: { classic: save.fleet.pads.classic ?? 0, refuel: save.fleet.pads.refuel ?? 0 },
    },
    built: { ...save.built },
    condition: { ...(save.condition ?? {}) },
    rngState: save.rngState,
    chronicle: [...(save.chronicle ?? [])],
    activeEffects: (save.activeEffects ?? []).map((e) => ({ ...e })),
    holdTransit: save.holdTransit ?? null,
    lastEvent: save.lastEvent ?? null,
    milestones: { ...(save.milestones ?? {}) },
    p,
  };
}

function valid(s: ColonyState): boolean {
  return (
    RESOURCES.every((r) => typeof s.stocks[r] === 'number') &&
    typeof s.fleet.pads.classic === 'number' &&
    typeof s.rngState === 'number' &&
    typeof s.pop === 'number'
  );
}

/** Full load path: parse → migrate → hydrate → validate. Returns null on any incompatibility. */
export function loadColony(raw: string, p: ColonyParams): ColonyState | null {
  try {
    const migrated = migrate(JSON.parse(raw) as AnyBlob);
    if (!migrated || migrated.v !== SAVE_VERSION) return null;
    const state = hydrateColony(migrated as unknown as ColonySave, p);
    return valid(state) ? state : null;
  } catch {
    return null;
  }
}
