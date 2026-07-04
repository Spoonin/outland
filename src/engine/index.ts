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
  newFleet,
  padClassFor,
  nextRefuelStage,
  maxLaunches,
  throughputMass,
  padMaintTotal,
  padBuildCost,
  shipPlan,
  rollExplosions,
  TECHS,
} from './logistics';
export type { LaunchTech, PadClass, LaunchParams, Fleet, ShipPlan, RefuelStage } from './logistics';
export {
  defaultCatalog,
  defaultColonyParams,
  consumption,
  newColony,
  previewOrder,
  priceMult as colonyPriceMult,
  commitWindow,
  emptyOrder,
  marsPlanCost,
  marsPlanMaterials,
  prereqMet,
  lockReason,
  structureImportPlan,
  bufferRunway,
  BUFFER_LOOKAHEAD,
  collapseRunway,
  COLLAPSE_LOOKAHEAD,
  MILESTONES,
} from './colony';
export {
  STRUCTURES,
  STRUCT_BY_ID,
  energyGeneration,
  resolveColonyEnergy,
  structureFlows,
  spareUpkeep,
  housingCapacity,
  structuralN2Leak,
} from './structures';
export type { Structure, BuiltCounts, EnergyResolution, Condition, StructureDiag } from './structures';
export { SAVE_VERSION, serializeColony, hydrateColony, loadColony } from './colony-save';
export type { ColonySave } from './colony-save';
export type {
  ResourceSpec,
  ResourceCatalog,
  ColonyParams,
  ColonyState,
  Transit,
  EarthOrder,
  OrderPreview,
  ColonyReport,
  MortalityCause,
  MilestoneId,
  MilestoneSpec,
  LockReason,
} from './colony';
export { EVENTS, EVENT_BY_ID } from './events';
export type { EventSpec, EventEffect, ActiveEffect, WindowEvent } from './events';
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
