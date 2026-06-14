// Physical resource layer (v2, D-042 / colony-sim.md §2). Pure stock/flow core: energy is a
// per-window flow resolved by priority (brownout); the rest are stocks updated by production +
// arrivals − consumption (with recycling η). Structures (V4/V5) and Earth orders (V2) feed it.

/** Stock-tracked resources (energy is a flow, handled by resolveEnergy). */
export const RESOURCES = [
  'food',
  'water',
  'o2',
  'n2',
  'steel',
  'metals',
  'polymers',
  'glass',
  'spares',
] as const;
export type ResourceKind = (typeof RESOURCES)[number];
export type Stocks = Record<ResourceKind, number>;

/** Life-support resources whose depletion kills the colony (drives the survival runway). */
export const LIFE_SUPPORT: readonly ResourceKind[] = ['food', 'water', 'o2'];

export function emptyStocks(fill = 0): Stocks {
  return Object.fromEntries(RESOURCES.map((r) => [r, fill])) as Stocks;
}

// ---- energy: per-window flow resolved by priority (brownout) ---------------

export interface EnergyDemand {
  name: string;
  priority: number; // lower = served first (life-support 0 → food 1 → factories 2)
  demand: number;
}

export interface EnergyAllocation {
  generation: number;
  totalDemand: number;
  deficit: number;
  /** served fraction per consumer (0..1) — the brownout factor applied to its output. */
  served: Record<string, number>;
}

/** Allocate generation to demands by ascending priority; unmet low-priority consumers brown out. */
export function resolveEnergy(generation: number, demands: EnergyDemand[]): EnergyAllocation {
  const served: Record<string, number> = {};
  let avail = Math.max(0, generation);
  for (const d of [...demands].sort((a, b) => a.priority - b.priority)) {
    const give = Math.max(0, Math.min(avail, d.demand));
    served[d.name] = d.demand > 0 ? give / d.demand : 1;
    avail -= give;
  }
  const totalDemand = demands.reduce((a, d) => a + d.demand, 0);
  return { generation, totalDemand, deficit: Math.max(0, totalDemand - generation), served };
}

// ---- stocks: production + arrivals − consumption (with recycling η) ---------

export interface ResourceFlows {
  production?: Partial<Stocks>; // local output (structures / localized nodes), already energy-scaled
  arrivals?: Partial<Stocks>; // imports landing this window (from Earth orders, V2)
  consumption?: Partial<Stocks>; // population + structures
  recycleEff?: Partial<Stocks>; // η in 0..1: fraction of consumption recovered (ECLSS water/O₂)
}

export interface FlowResult {
  stocks: Stocks;
  /** unmet consumption per resource this window (0 if covered). */
  deficit: Partial<Stocks>;
}

/** Advance stocks one window. Net consumption = consumption·(1−η). Stocks floor at 0. */
export function applyFlows(stocks: Stocks, flows: ResourceFlows): FlowResult {
  const next = { ...stocks };
  const deficit: Partial<Stocks> = {};
  for (const r of RESOURCES) {
    const prod = flows.production?.[r] ?? 0;
    const arr = flows.arrivals?.[r] ?? 0;
    const cons = flows.consumption?.[r] ?? 0;
    const eff = flows.recycleEff?.[r] ?? 0;
    const netCons = cons * (1 - eff);
    const avail = stocks[r] + prod + arr;
    if (netCons > avail) deficit[r] = netCons - avail;
    next[r] = Math.max(0, avail - netCons);
  }
  return { stocks: next, deficit };
}

// ---- survival runway: honest, from real stocks (D-025/D-042) ---------------

/**
 * Windows survivable if imports are cut now: the worst-covered life-support resource
 * (Liebig). With a critical resource import-dependent (no local production), its stock empties
 * fast → runway pinned low however high autonomy climbs. The thesis, measured directly.
 */
export function runwayFromStocks(
  stocks: Stocks,
  consumption: Partial<Stocks>,
  recycleEff: Partial<Stocks> = {},
): number {
  let worst = Infinity;
  for (const r of LIFE_SUPPORT) {
    const eff = recycleEff[r] ?? 0;
    const netCons = (consumption[r] ?? 0) * (1 - eff);
    if (netCons <= 0) continue;
    worst = Math.min(worst, stocks[r] / netCons);
  }
  return worst === Infinity ? Infinity : Math.round(worst * 10) / 10;
}
