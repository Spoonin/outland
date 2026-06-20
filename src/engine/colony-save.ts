// Save backward-compatibility (D-051). Persist ONLY dynamic state (not config — params are always
// defaults, reconstructed on load). Load = parse → migrate (versioned chain) → hydrate (merge over a
// fresh colony, so additive changes self-fill) → validate (else null → fresh game, never crash).

import { newColony, type ColonyState, type ColonyParams } from './colony';
import { RESOURCES, emptyStocks, type Stocks } from './resources';
import { type LaunchTech } from './logistics';

export const SAVE_VERSION = 3;

/** The persisted shape — dynamic state only (config is rebuilt from defaults on load). */
export interface ColonySave {
  v: number;
  window: number;
  pop: number;
  stocks: Partial<Stocks>;
  inTransit: { stocks: Partial<Stocks>; colonists: number };
  fleet: { pads: Partial<Record<LaunchTech, number>>; refuelUnlocked: boolean };
  built: Record<string, number>;
  condition: Record<string, number>;
  rngState: number;
}

export function serializeColony(s: ColonyState): ColonySave {
  return {
    v: SAVE_VERSION,
    window: s.window,
    pop: s.pop,
    stocks: { ...s.stocks },
    inTransit: { stocks: { ...s.inTransit.stocks }, colonists: s.inTransit.colonists },
    fleet: { pads: { ...s.fleet.pads }, refuelUnlocked: s.fleet.refuelUnlocked },
    built: { ...s.built },
    condition: { ...s.condition },
    rngState: s.rngState,
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

/** Source version → one-step migration. Add an entry whenever a breaking schema change ships. */
const MIGRATIONS: Record<number, (b: AnyBlob) => AnyBlob> = {
  1: legacyToV3,
  2: legacyToV3,
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
    stocks: { ...base.stocks, ...save.stocks },
    inTransit: {
      stocks: { ...emptyStocks(0), ...save.inTransit.stocks },
      colonists: save.inTransit.colonists,
    },
    fleet: {
      refuelUnlocked: save.fleet.refuelUnlocked,
      pads: { classic: save.fleet.pads.classic ?? 0, refuel: save.fleet.pads.refuel ?? 0 },
    },
    built: { ...save.built },
    condition: { ...(save.condition ?? {}) },
    rngState: save.rngState,
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
