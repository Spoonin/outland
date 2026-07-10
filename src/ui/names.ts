// English names for CSV/engine-authored proper nouns (structures.csv, techs.csv, MILESTONES in
// colony.ts). Kept separate from i18n.ts's UI-chrome dictionary because these are keyed by
// STABLE IDS, not phrases — the Russian name is always the fallback (both for 'ru' and for any id
// this map hasn't caught up with yet), so nothing ever renders blank.
import { i18n } from './i18n';

const STRUCT_EN: Record<string, string> = {
  solar_plant: 'Solar Power Plant',
  waste_pad: 'Waste Pad',
  nuclear_plant: 'Nuclear Power Plant',
  farm: 'Farm / Greenhouse',
  water_recycler: 'Life Support: Water Recycling',
  o2_generator: 'Life Support: O₂ Generator (MOXIE)',
  steel_plant: 'Metallurgy (Steel)',
  glass_plant: 'Glass/Ceramics',
  polymer_plant: 'Polymers (Fischer-Tropsch)',
  medbay: 'Medbay (→ births)',
  rnd_lab: 'R&D Lab',
  habitat: 'Habitat Module',
  n2_concentrator: 'N₂ Concentrator (ISRU)',
  algae_bioreactor: 'Bioreactor (Algae)',
  base_block: 'Base Block (housing + life support, 20 crew)',
  food_silo: 'Food Silo',
  water_tank: 'Water Tank',
  excavator: 'Excavator (ISRU)',
  ice_mine: 'Ice Mine',
  co2_capture: 'CO₂ Capture (atmosphere)',
  electrolyzer: 'Water Electrolyzer',
  mre_plant: 'MRE Plant (metals from regolith)',
  sinter_plant: 'Regolith Sintering (composite)',
  habitat_regolith: 'Habitat Module (regolith-printed)',
  silo_regolith: 'Food Silo (regolith-printed)',
  fab_shop: 'Fabrication Shop (components)',
  machine_shop: 'Machine Shop (local spares)',
  robotics_bay: 'Robotics Bay',
  school: 'School',
  university: 'University',
  shield_berm: 'Radiation Berm (regolith)',
  fusion_plant: 'Fusion Power Plant',
  blss_module: 'BLSS Module (closed loop)',
  maternity_complex: 'Demographic Complex',
  chip_fab: 'Chip Fab (semiconductors)',
  api_plant: 'API Plant (local pharma)',
  pgm_refinery: 'PGM Extraction Plant',
  hospital: 'Hospital (urban medicine)',
};

const TECH_EN: Record<string, string> = {
  isru_extraction: 'ISRU Extraction (regolith/ice/CO₂)',
  electrolysis: 'Water Electrolysis',
  regolith_metallurgy: 'Regolith Metallurgy (MRE)',
  regolith_construction: 'Regolith Construction',
  fabrication: 'Means of Production (Fabrication)',
  robotics: 'Robotics',
  education: 'Education (School)',
  higher_education: 'Higher Education (University)',
  fusion: 'Fusion Power',
  closed_loop: 'BLSS Closed Loop',
  demographics: 'Demographic Program',
  semiconductors: 'Semiconductors',
  pharma_synthesis: 'Pharma Synthesis',
  pgm_extraction: 'Platinum-Group Metal Extraction',
  agrotech: 'Agrotech',
  deep_drilling: 'Deep Drilling',
};

const TECH_NOTES_EN: Record<string, string> = {
  isru_extraction:
    'Unlocks primary extraction: excavator (regolith) · ice mine (primary water) · CO₂ capture — raw material from Mars, not Earth',
  electrolysis: 'Unlocks the electrolyzer: water → hydrogen + O₂ — feedstock for future chemistry (P2+)',
  regolith_metallurgy: 'Unlocks the MRE plant: metals from regolith — steel stops depending solely on Earth ingots',
  regolith_construction:
    'Unlocks the sintering plant (composite from regolith) and cheap housing/storage from local composite — construction volume stops depending on imported steel/glass',
  fabrication:
    'Unlocks the fabrication shop (local metal parts) and machine shop (local spares) — components and part of spares stop depending solely on Earth',
  robotics: 'Unlocks the robotics bay — cuts crew demand by 30% across every structure at once',
  education: 'Unlocks the school — trains specialists from the rising generation',
  higher_education: 'Unlocks the university — a major source of specialists, gating future high-tech structures',
  fusion:
    'Unlocks the fusion power plant — GW-scale energy without a perpetual fuel import (unlike nuclear), at the cost of a small ongoing chips draw for plasma maintenance',
  closed_loop: 'Unlocks the BLSS module — pushes water/O₂ recycling toward near-total closure, but never all the way',
  demographics: 'Unlocks the demographic complex — boosts colony birth rate when bulk needs are fully met',
  semiconductors:
    "Unlocks the chip fab — a tiny local chips output at the cost of enormous energy and thousands of specialists; a real semiconductor fab's minimum efficient scale dwarfs the colony — import shrinks a lot, but never to zero",
  pharma_synthesis: 'Unlocks the API plant — local synthesis of simple pharmaceuticals from catalyst and trained crew',
  pgm_extraction:
    'Unlocks the PGM extraction plant — catalyst from platinum-group metals scattered through regolith, at the cost of processing enormous volumes of soil',
  agrotech:
    '+30% output for every food producer (farm/bioreactor/base block) — crop selection and greenhouse tuning for Martian light',
  deep_drilling:
    'The ice mine depletes its deposit twice as slowly for the same real extraction volume — access to deeper, richer ice lenses',
};

const MILESTONE_EN: Record<string, string> = {
  first_landing: 'First Landing',
  first_birth: 'First Birth',
  pop_100: '100 colonists',
  bulk_autonomy: 'Bulk Autonomy',
  buffer_2: 'Buffer without resupply ≥ 2 windows',
  event_survived: 'Survived an event with no losses',
  refuel_unlocked: 'Orbital Refueling',
  zero_import: 'A window with zero imports',
  local_metals: 'Local Metals (MRE)',
  local_construction: 'Regolith Construction',
  local_fabrication: 'Local Fabrication',
  local_spares: 'Local Spares',
  fusion_online: 'Fusion Online',
  pop_1000: '1,000 colonists',
  pop_10000: '10,000 colonists',
  pop_50000: '50,000 colonists',
  pop_100000: '100,000 colonists',
  first_local_chip: 'First Local Chip',
  bulk_autonomy_city: 'Bulk Autonomy at City Scale (1000+)',
};

// Refuel R&D ladder (logistics.ts defaultLaunchParams) has no stable id, just a 1-based rung index.
const REFUEL_STAGE_EN: Record<number, string> = {
  1: 'Refueling: Demo Campaigns',
  2: 'Serial Fleet, Depot & Mars EDL',
};

function pick(map: Record<string, string>, id: string, fallback: string): string {
  return i18n.get() === 'en' ? (map[id] ?? fallback) : fallback;
}

export const structName = (id: string, fallback: string): string => pick(STRUCT_EN, id, fallback);
export const techName = (id: string, fallback: string): string => pick(TECH_EN, id, fallback);
export const techNotes = (id: string, fallback: string): string => pick(TECH_NOTES_EN, id, fallback);
export const milestoneName = (id: string, fallback: string): string => pick(MILESTONE_EN, id, fallback);
export const refuelStageName = (index: number, fallback: string): string =>
  i18n.get() === 'en' ? (REFUEL_STAGE_EN[index] ?? fallback) : fallback;
