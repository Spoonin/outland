// Autonomous playtest driver (D-097, final v8 of 8 iterations) — maximize population.
// Drives the production ColonyStore exactly like the UI/CLI: every order passes plan().
// Best run: peak 1050 colonists, pop_1000 milestone at window 76 (seed 7).
// Usage: [SEED=7] [WINDOWS=220] npx vite-node src/bot/playtest.mjs
import { ColonyStore } from '../ui/colonyStore.ts';
import { defaultColonyParams, STRUCT_BY_ID } from '../engine/index.ts';

const memKV = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const SEED = Number(process.env.SEED ?? 7);
const WINDOWS = Number(process.env.WINDOWS ?? 200);
const store = new ColonyStore(defaultColonyParams({ seed: SEED }), memKV());

const st = () => store.status();
const stock = (k) => store.stocks()[k] ?? 0;
const inbound = (k) => store.inTransit().stocks[k] ?? 0;
const built = (id) => store.builtCount(id);
const owned = (id) => store.techOwned(id);

const TECH_ORDER = [
  'isru_extraction', 'regolith_construction', 'electrolysis', 'closed_loop', 'education',
  'higher_education', 'demographics', 'regolith_metallurgy', 'fabrication', 'robotics',
  'fusion', 'pgm_extraction', 'pharma_synthesis', 'semiconductors',
];

const log = [], techLog = [], milestoneLog = [], eventLog = [], mortality = {};
let peakPop = 0;

for (let w = 0; w < WINDOWS; w++) {
  const s = st();
  if (s.ended) break;
  if (!store.autoSparesEnabled) store.toggleAutoSpares();
  if (!store.autoPharmaEnabled) store.toggleAutoPharma();

  // bootstrap imports FIRST so every capacity/lsNeed calc below sees them (same-manifest landing)
  if (w === 0) store.setImportQty('base_block', 2);
  if (w === 1) store.setImportQty('base_block', 1);

  const cond = s.avgCondition;
  const bbSoon = built('base_block') + (store.inTransit().structures['base_block'] ?? 0) + store.importQty('base_block');
  // gross capacities (rated × condition; in-transit base blocks count — they land WITH the colonists)
  const foodGross = built('farm') * 80000 * cond;
  const waterGross = (built('water_recycler') * 80000 + built('ice_mine') * 40000 * (store.industryMultNow('ice_mine') ?? 1)) * cond + bbSoon * 35000;
  const o2Gross = (built('o2_generator') * 15000 + built('electrolyzer') * 32000 + built('mre_plant') * 5000 * 0.4) * cond + bbSoon * 9500;
  const ratedGen = (built('solar_plant') * 100 + built('nuclear_plant') * 500 + built('fusion_plant') * 3000) * cond + bbSoon * 10;

  // ---- 1. colonist decision FIRST (paced growth, hard safety gates).
  // Earth-fed growth allowed under 60 people (importing food for a village is affordable — the
  // mass wall only bites at scale); past that, local farms must carry any further growth.
  const foodOk = stock('food') + inbound('food') >= s.pop * 500 * 1.5;
  const safe = foodOk && s.energyDeficit === 0 && s.pop > 0;
  let colonistAsk = 0;
  if (w === 0) colonistAsk = 30;
  else if (safe || (w <= 4 && s.pop < 40)) {
    const foodRoom = s.pop < 100 ? 999 : Math.floor(foodGross / (500 * 1.35)) - s.pop; // Earth-fed under 100
    const houseRoom = store.maxColonists();
    colonistAsk = Math.max(0, Math.min(Math.ceil(s.pop * 0.12) + 10, foodRoom, houseRoom, 40));
  }
  const growth = colonistAsk + store.inTransit().colonists + Math.ceil(s.pop * 0.06);
  const projPop = s.pop + growth;

  // ---- 2. refuel R&D / tech ladder
  const rnd = store.refuelRnD();
  if (rnd.next && !store.rndLocked && !store.unlockRefuelDraft && rnd.next.cost <= s.budget * 0.85) store.toggleUnlockRefuel();
  if (!store.unlockRefuelDraft) {
    for (const t of TECH_ORDER) {
      if (owned(t)) continue;
      if (store.techBuyable(t) && store.techPriceNow(t) <= s.budget * 0.6) { store.setUnlockTech(t); break; }
    }
  }

  // ---- 3. builds: LS first (crew-priority), industry with leftovers
  let crewDemand = 0;
  for (const x of store.structures()) crewDemand += (x.opsCrew ?? 0) * built(x.id);
  const opsMult = owned('robotics') ? 0.7 : 1;
  let crewRoom = s.workforce * 0.85 - crewDemand * opsMult;
  const queue = [], wishOrder = {};
  let trueDraw = s.pop * 0.05;
  for (const x of store.structures()) if (x.energy < 0) trueDraw += -x.energy * built(x.id);
  let plannedDraw = trueDraw + growth * 0.05;
  let queuedGen = 0; // rated energy from THIS window's queued builds
  const tryBuild = (id, n = 1, { ignoreCrew = false, ignorePower = false } = {}) => {
    const spec = STRUCT_BY_ID[id];
    let ok = 0;
    for (let i = 0; i < n; i++) {
      if (!store.prereqMet(id)) break;
      if (!ignoreCrew && (spec.opsCrew ?? 0) * opsMult > crewRoom) break;
      // energy discipline: a drawing structure must fit inside 80% of rated generation
      if (!ignorePower && spec.energy < 0 && plannedDraw + -spec.energy > (ratedGen + queuedGen) * 0.8) break;
      const need = {};
      for (const q of [...queue, id]) for (const [r, v] of Object.entries(STRUCT_BY_ID[q].buildMaterials ?? {})) need[r] = (need[r] ?? 0) + v;
      const short = Object.entries(need).filter(([r, v]) => stock(r) < v);
      if (short.length) {
        for (const [r, v] of short) { const c = store.catalog()[r]; if (c && !c.localOnly) wishOrder[r] = Math.max(wishOrder[r] ?? 0, v - stock(r) - inbound(r)); }
        break;
      }
      store.addBuild(id); queue.push(id); crewRoom -= (spec.opsCrew ?? 0) * opsMult;
      if (spec.energy < 0) plannedDraw += -spec.energy; else queuedGen += spec.energy;
      ok++;
    }
    return ok;
  };

  // energy first — margin 1.35 incl. everything queued this window
  const genShort = () => ratedGen + queuedGen < plannedDraw * 1.5 + 40;
  if (genShort()) {
    if (owned('fusion') && s.pop >= 300 && built('fusion_plant') < 4) tryBuild('fusion_plant', 1, { ignoreCrew: true, ignorePower: true });
    while (genShort() && queue.filter((q) => q === 'solar_plant').length < 4) {
      if (!tryBuild('solar_plant', 1, { ignoreCrew: true, ignorePower: true })) break;
    }
  }
  if (s.pop >= 8 && built('medbay') < Math.max(1, Math.ceil(projPop / 60))) tryBuild('medbay', 2, { ignoreCrew: true, ignorePower: true });
  if (foodGross < projPop * 500 * 1.5) tryBuild('farm', 3, { ignoreCrew: true });
  if (waterGross < (projPop * 2400 * 0.7 + built('farm') * 20000) * 1.25) {
    if (owned('isru_extraction') && built('ice_mine') < 4) tryBuild('ice_mine', 1, { ignoreCrew: true });
    else tryBuild('water_recycler', 2, { ignoreCrew: true, ignorePower: true });
  }
  if (o2Gross < projPop * 660 * 0.7 * 1.3) tryBuild('o2_generator', 1, { ignoreCrew: true });
  if (s.n2LeakKgPerWindow > 0 && built('n2_concentrator') * 10000 < s.n2LeakKgPerWindow * 1.3) tryBuild('n2_concentrator', 1, { ignorePower: true });
  if (projPop * 1.25 > s.housingCapacity) {
    if (store.prereqMet('habitat_regolith')) tryBuild('habitat_regolith', 2);
    else if (s.pop >= 25) { if (!tryBuild('habitat', 1)) store.setImportQty('habitat', 1); }
    else if (w >= 2 && built('base_block') + (store.inTransit().structures['base_block'] ?? 0) < 5) store.setImportQty('base_block', 1);
  }
  if (store.prereqMet('shield_berm') && built('shield_berm') * 200 < projPop * 1.1) tryBuild('shield_berm', 2, { ignoreCrew: true });

  if (safe) {
    if (built('rnd_lab') === 0 && s.pop >= 30 && !owned('robotics')) tryBuild('rnd_lab', 1, { ignorePower: true });
    if (owned('isru_extraction')) {
      const regNeed = built('mre_plant') * 30000 + built('sinter_plant') * 25000 + built('pgm_refinery') * 200000;
      if (built('excavator') * 30000 * (store.industryMultNow('excavator') ?? 1) < regNeed * 1.1) tryBuild('excavator');
    }
    if (owned('regolith_construction') && built('sinter_plant') < 2 && s.pop >= 40) tryBuild('sinter_plant');
    if (owned('regolith_metallurgy') && built('mre_plant') < 2 && s.pop >= 60) tryBuild('mre_plant');
    if (owned('fabrication') && s.pop >= 90) { if (built('machine_shop') < 2) tryBuild('machine_shop'); if (built('fab_shop') < 1) tryBuild('fab_shop'); }
    if (owned('education') && s.pop >= 60 && built('school') < 2) tryBuild('school');
    if (owned('higher_education') && s.pop >= 120 && built('university') < 2) tryBuild('university');
    if (owned('demographics') && s.pop >= 80 && built('maternity_complex') === 0) tryBuild('maternity_complex');
    if (owned('closed_loop') && built('blss_module') * 300 < projPop * 1.1) tryBuild('blss_module', 2, { ignorePower: true });
    if (owned('pgm_extraction') && built('pgm_refinery') === 0 && stock('specialists') > 400) tryBuild('pgm_refinery');
    if (owned('pharma_synthesis') && built('api_plant') === 0 && stock('specialists') > 700) tryBuild('api_plant');
    if (owned('semiconductors') && built('chip_fab') === 0 && stock('specialists') >= 2600) tryBuild('chip_fab');
  }

  // ---- 5. orders — LS from POPULATION incl. this window's colonist ask
  const cover = s.buffer < 2 ? 3.5 : 2.5;
  // realized local production per kind = reported net + realized consumption (brownout/wear-honest)
  const perCap = { food: 500, water: 2400 * 0.7, o2: 660 * 0.7, n2: 0 };
  for (const kind of ['food', 'water', 'o2', 'n2']) {
    const line = s.resources.find((r) => r.kind === kind);
    const realizedProd = w === 0 ? (kind === 'water' ? bbSoon * 35000 : kind === 'o2' ? bbSoon * 9500 : 0)
      : Math.max(0, (line?.net ?? 0) + s.pop * (perCap[kind] ?? 0) + (kind === 'n2' ? s.n2LeakKgPerWindow : 0));
    const need = projPop * (perCap[kind] ?? 0) + (kind === 'n2' ? s.n2LeakKgPerWindow : 0);
    let want = Math.max(0, (need - realizedProd * 0.9) * cover - stock(kind) - inbound(kind));
    if (kind === 'food') want = Math.max(want, projPop * 500 * 1.5 - stock(kind) - inbound(kind)); // insurance stock
    let qty = Math.ceil(want / 1000) * 1000;
    if (kind === 'food') qty = Math.min(qty, store.maxFoodStock());
    if (kind === 'water') qty = Math.min(qty, store.maxWaterStock());
    if (qty > 0) store.setRes(kind, qty);
  }
  for (const [r, q] of Object.entries(wishOrder)) if (q > 0) store.setRes(r, Math.ceil(q / 500) * 500);
  // repair surplus (D-084): condition sagging → order one extra upkeep's worth
  if (cond < 0.97) store.setRes('spares', store.resQty('spares') + store.repairInfo().upkeep);
  const chipsDraw = built('rnd_lab') * 200 + built('fab_shop') * 50 + built('machine_shop') * 30 + built('fusion_plant') * 100 + built('robotics_bay') * 20;
  if (chipsDraw > 0 && stock('chips') + inbound('chips') < chipsDraw * 2) store.setRes('chips', chipsDraw * 2);
  const catDraw = built('api_plant') * 200;
  if (catDraw > 0 && stock('catalyst') + inbound('catalyst') < catDraw * 2) store.setRes('catalyst', catDraw * 2);

  // ---- 6. pads to fit the mass
  {
    const p0 = store.plan();
    const massWanted = p0.earth.mass + 2200 * colonistAsk;
    if (s.refuelStage >= 2 && massWanted > p0.earth.throughput * 0.9 && store.padPriceNow('refuel') < s.budget * 0.3 && p0.totalCost + store.padPriceNow('refuel') < p0.budget * 0.9) store.setPad('refuel', 1);
  }
  // ---- 7. commit colonist ask within money+mass
  {
    const p0 = store.plan();
    const spareMoney = p0.budget - p0.totalCost;
    const spareMass = Math.max(0, p0.earth.throughput - p0.earth.mass);
    const perHead = store.colonistPriceNow() + 2000 * store.deliveryPerKg().perKg;
    const n = Math.min(colonistAsk, store.maxColonists(), Math.floor((spareMoney * 0.7) / perHead), Math.floor(spareMass / 2200));
    if (n > 0 && p0.totalCost < p0.budget * 0.9) store.setColonists(n);
  }

  // ---- 8. trim: colonists → tech → pads → industry mats → base_block → LS last
  let guard = 0;
  while (guard++ < 80) {
    const p = store.plan();
    if (p.feasible) break;
    if (p.bootstrapBlocked) { store.setImportQty('base_block', Math.max(1, store.importQty('base_block'))); store.setColonists(Math.max(1, store.colonists)); continue; }
    if (p.materialsShort.length) {
      const bad = store.buildQueue().find((id) => p.materialsShort.some((r) => (STRUCT_BY_ID[id].buildMaterials[r] ?? 0) > 0));
      if (bad) { store.removeBuild(bad); continue; }
    }
    if (p.prereqMissing.length) { for (const id of p.prereqMissing) { store.removeBuild(id); store.setImportQty(id, 0); } continue; }
    if (p.overBudget || p.earth.mass > p.earth.throughput) {
      if (store.colonists > (w === 0 ? 10 : 0)) { store.setColonists(Math.floor(store.colonists * 0.7)); continue; }
      if (store.unlockTechDraft()) { store.setUnlockTech(undefined); continue; }
      if (store.padQty('refuel') > 0) { store.setPad('refuel', 0); continue; }
      const indMat = ['steel', 'glass', 'polymers', 'metals', 'composite', 'components'].map((r) => [r, store.resQty(r)]).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1])[0];
      if (indMat) { store.setRes(indMat[0], Math.floor(indMat[1] * 0.5)); continue; }
      if (store.importQty('habitat') > 0) { store.setImportQty('habitat', 0); continue; }
      if (w > 1 && store.importQty('base_block') > 0) { store.setImportQty('base_block', store.importQty('base_block') - 1); continue; }
      const lsFloor = { food: s.pop * 500, water: s.pop * 1680, o2: s.pop * 462, n2: s.n2LeakKgPerWindow };
      const ls = ['water', 'food', 'o2', 'n2'].map((r) => [r, store.resQty(r)]).filter(([r, q]) => q > (lsFloor[r] ?? 0) * 1.0 - stock(r)).sort((a, b) => b[1] - a[1])[0];
      if (ls) { store.setRes(ls[0], Math.max(Math.floor((lsFloor[ls[0]] ?? 0) * 1.0 - stock(ls[0])), Math.floor(store.resQty(ls[0]) * 0.8))); continue; }
      if (store.unlockRefuelDraft) { store.toggleUnlockRefuel(); continue; }
    }
    break;
  }

  const plan = store.plan();
  const techBought = store.unlockTechDraft();
  const rndBought = store.unlockRefuelDraft;
  const spent = plan.totalCost;
  const massUse = `${Math.round(plan.earth.mass / 1000)}/${Math.round(plan.earth.throughput / 1000)}t`;
  store.commit();

  const r = store.lastReport();
  if (!r) break;
  peakPop = Math.max(peakPop, r.pop);
  if (techBought && store.techOwned(techBought)) techLog.push({ w, tech: techBought });
  if (rndBought && store.refuelRnD().stage > 0) techLog.push({ w, tech: `refuel_stage_${store.refuelRnD().stage}` });
  for (const m of r.milestones) milestoneLog.push({ w, m });
  if (r.event) eventLog.push({ w, id: r.event.id, deaths: r.event.deaths ?? 0 });
  for (const [c, n] of Object.entries(r.mortalityBreakdown ?? {})) mortality[c] = (mortality[c] ?? 0) + n;

  const s2 = st();
  log.push({ w, pop: r.pop, births: r.births, deaths: r.mortality, housing: s2.housingCapacity, eGen: Math.round(r.energyGen), eDef: Math.round(r.energyDeficit), buffer: s2.buffer, autonomy: Math.round(r.autonomyByMass * 100), spentB: +(spent / 1e9).toFixed(1), budgetB: +(s2.budget / 1e9).toFixed(1), cond: +s2.avgCondition.toFixed(2), crew: +s2.crewCoverage.toFixed(2), shield: +s2.shieldCoverage.toFixed(2), spec: Math.round(stock('specialists')), massUse });
  if ((w + 1) % 10 === 0 || r.mortality > Math.max(4, r.pop * 0.06)) {
    const l = log[log.length - 1];
    console.log(`W${String(w).padStart(3)} pop=${l.pop} (+${l.births}/-${l.deaths}) hous=${l.housing} E=${l.eGen}${l.eDef ? `(-${l.eDef})` : ''} buf=${l.buffer} auto=${l.autonomy}% cond=${l.cond} crew=${l.crew} shield=${l.shield} spec=${l.spec} mass=${l.massUse} $${l.spentB}/${l.budgetB}B`);
  }
}

console.log('\n=== TECHS ==='); for (const t of techLog) console.log(`  W${t.w}: ${t.tech}`);
console.log('=== MILESTONES ==='); for (const m of milestoneLog) console.log(`  W${m.w}: ${m.m}`);
console.log('=== DEADLY EVENTS ==='); for (const e of eventLog.filter((e) => e.deaths > 0)) console.log(`  W${e.w}: ${e.id} deaths=${e.deaths}`);
console.log('=== MORTALITY ===', mortality);
const fin = st();
console.log(`\nFINAL: window=${fin.window} pop=${fin.pop} PEAK=${peakPop} collapsed=${fin.collapsed} housing=${fin.housingCapacity}`);
console.log('built:', JSON.stringify(Object.fromEntries(store.structures().map((x) => [x.id, built(x.id)]).filter(([, n]) => n > 0))));
console.log('techs:', store.techs().filter((t) => owned(t.id)).map((t) => t.id).join(', ') || '(none)');
console.log('demography:', JSON.stringify(store.demography()));
console.log('\npop curve:', log.filter((_, i) => i % 5 === 0).map((l) => `${l.w}:${l.pop}`).join(' '));
console.log('autonomy:', log.filter((_, i) => i % 5 === 0).map((l) => `${l.w}:${l.autonomy}`).join(' '));
