// Public engine API (SDD §3).
export * from './types';
export { GRAPH, NODES, CONSUMERS } from './graph';
export { makeRng, rngFromState } from './rng';
export { serializeState, deserializeState } from './persist';
export type { SerializedState } from './persist';
export {
  RESOURCES,
  LIFE_SUPPORT,
  emptyStocks,
  resolveEnergy,
  applyFlows,
  runwayFromStocks,
} from './resources';
export type {
  ResourceKind,
  Stocks,
  EnergyDemand,
  EnergyAllocation,
  ResourceFlows,
  FlowResult,
} from './resources';
export {
  defaultLaunchParams,
  techSpec,
  maxLaunches,
  throughputMass,
  launchesNeeded,
  padBuildCost,
  launchCost,
} from './logistics';
export type { LaunchTech, TechSpec, LaunchParams, Fleet, LaunchCost } from './logistics';
export {
  defaultCatalog,
  defaultColonyParams,
  consumption,
  newColony,
  previewOrder,
  priceMult as colonyPriceMult,
  commitWindow,
} from './colony';
export type {
  ResourceSpec,
  ResourceCatalog,
  ColonyParams,
  ColonyState,
  Transit,
  EarthOrder,
  OrderPreview,
  ColonyReport,
} from './colony';
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
  priceMultNow,
  subsidyErosion,
  endReason,
  nodeEconomics,
  newState,
  step,
} from './sim';
export type { EligibleNode, PlanView, NodeEconomics } from './sim';
