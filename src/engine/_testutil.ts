// Test-only helpers (not part of the engine API).
import { GRAPH } from './graph';
import { defaultParams, type GameState, type Params, type Rng } from './types';

/** A no-op deterministic RNG for tests that don't exercise events. */
export const stubRng: Rng = { random: () => 0, choice: (a) => a[0]! };

/** Build a GameState with all nodes unlocalized, age 0, given pop/overrides. */
export function mkState(over: Partial<GameState> = {}, p: Params = defaultParams()): GameState {
  const localized: Record<string, boolean> = {};
  const age: Record<string, number> = {};
  for (const n of GRAPH) {
    localized[n.name] = false;
    age[n.name] = 0;
  }
  return {
    p,
    window: 0,
    pop: p.pop0,
    localized,
    age,
    collapsed: false,
    plateauedAt: -1,
    lastAutonomy: 0,
    rng: stubRng,
    fusion: 'none',
    fusionFund: 0,
    launchK: 0,
    ...over,
  };
}
