// Serialize/deserialize GameState (Phase 6). The RNG closure isn't JSON-able, so we persist
// its internal state integer and rebuild it on load — preserving event continuity after reload.

import { makeRng } from './rng';
import type { FusionState, GameState, Params } from './types';

export interface SerializedState {
  v: 1;
  p: Params;
  window: number;
  pop: number;
  localized: Record<string, boolean>;
  age: Record<string, number>;
  collapsed: boolean;
  plateauedAt: number;
  lastAutonomy: number;
  rngState: number;
  fusion: FusionState;
  fusionFund: number;
  launchK: number;
}

export function serializeState(s: GameState): SerializedState {
  return {
    v: 1,
    p: { ...s.p },
    window: s.window,
    pop: s.pop,
    localized: { ...s.localized },
    age: { ...s.age },
    collapsed: s.collapsed,
    plateauedAt: s.plateauedAt,
    lastAutonomy: s.lastAutonomy,
    rngState: s.rng.state(),
    fusion: s.fusion,
    fusionFund: s.fusionFund,
    launchK: s.launchK,
  };
}

export function deserializeState(o: SerializedState): GameState {
  return {
    p: { ...o.p },
    window: o.window,
    pop: o.pop,
    localized: { ...o.localized },
    age: { ...o.age },
    collapsed: o.collapsed,
    plateauedAt: o.plateauedAt,
    lastAutonomy: o.lastAutonomy,
    rng: makeRng(o.rngState),
    fusion: o.fusion,
    fusionFund: o.fusionFund,
    launchK: o.launchK,
  };
}
