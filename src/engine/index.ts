// Public engine API (SDD §3).
export * from './types';
export { GRAPH, NODES, CONSUMERS } from './graph';
export { makeRng } from './rng';
export { greedyAllocate } from './policy';
export {
  mes,
  tailFrac,
  needs,
  importBreakdown,
  launchMaint,
  autonomyByMass,
  survivalRunway,
  nodeStatus,
  localizationCost,
  planView,
  newState,
  step,
} from './sim';
export type { EligibleNode, PlanView } from './sim';
