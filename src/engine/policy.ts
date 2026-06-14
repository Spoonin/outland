// Greedy auto-policy (SDD §8): stands in for the player until Phase 3; also the AI baseline
// and the oracle for golden tests. Localizes the best F-saved-per-capital node while affordable.

import { GRAPH } from './graph';
import { mes } from './sim';
import type { GameState, Node } from './types';

export interface AllocResult {
  localizedThis: string[];
  capitalLeft: number;
}

/** Mutates s.localized/s.age. Returns nodes localized this window and leftover capital. */
export function greedyAllocate(
  s: GameState,
  capital: number,
  priceMult: number,
  nd: Record<string, number>,
): AllocResult {
  const p = s.p;
  const localizedThis: string[] = [];
  for (;;) {
    let best: Node | null = null;
    let bestRatio = 0.0;
    for (const n of GRAPH) {
      if (s.localized[n.name] || n.black || nd[n.name]! < mes(p, n)) continue;
      const cap = p.capitalFactor * mes(p, n);
      if (cap > capital) continue;
      // localizing saves intrinsic + marginal fuel shipping (capacity maint is sunk)
      const price = (n.earthCost + n.mass * p.fuelPerKg) * priceMult;
      const saved = nd[n.name]! * (1.0 - p.tailMax) * price;
      const ratio = saved / cap;
      if (ratio > bestRatio) {
        best = n;
        bestRatio = ratio;
      }
    }
    if (!best) break;
    s.localized[best.name] = true;
    s.age[best.name] = 0;
    capital -= p.capitalFactor * mes(p, best);
    localizedThis.push(best.name);
  }
  return { localizedThis, capitalLeft: capital };
}
