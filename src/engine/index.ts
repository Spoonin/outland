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
  importPrereqMet,
  lockReason,
  techGateMet,
  structureImportPlan,
  bufferRunway,
  BUFFER_LOOKAHEAD,
  collapseRunway,
  COLLAPSE_LOOKAHEAD,
  MILESTONES,
  supplyDeaths,
  projectOrder,
  pharmaNeed,
} from './colony';
export {
  STRUCTURES,
  STRUCT_BY_ID,
  energyGeneration,
  resolveColonyEnergy,
  structureFlows,
  spareUpkeep,
  laborDemand,
  housingCapacity,
  shieldCapacity,
  recycleBonusCapacity,
  birthRateMult,
  sickBedCapacity,
  foodCapacity,
  waterCapacity,
  foodSpoilRateMult,
  structuralN2Leak,
  industryMult,
} from './structures';
export {
  colonistRng,
  workforceCount,
  YEARS_PER_WINDOW,
  expectedOldAgeDeaths,
  phi,
  shieldAttenuation,
  effectiveDeathAge,
  avgRadiationDose,
  cohortAgingForecast,
} from './colonists';
export type { Colonist, DemographicParams } from './colonists';
// roadmap-2/V8 scaffold — TECHS aliased to ADVANCED_TECHS: `TECHS` already names logistics.ts's
// pad-class list (classic/refuel) in this barrel; two different "TECHS" would collide.
export { TECHS as ADVANCED_TECHS, TECH_BY_ID, techMods, techBuyable } from './techs';
export type { TechSpec, TechEffect, TechMods } from './techs';
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
