// Headless text CLI for Outland (v2 colony-sim), driving the same ColonyStore the UI uses — no
// browser needed. Built so an LLM agent can play full sessions via shell commands: read `status`,
// decide, submit one `order` per window, read the report, repeat. State persists to a JSON file
// between invocations (one process per command), so a whole playthrough is a shell script/loop.
//
// Usage:
//   npx tsx scripts/play.ts new [--seed=N] [--save=path.json]
//   npx tsx scripts/play.ts status [--save=path.json]
//   npx tsx scripts/play.ts catalog
//   npx tsx scripts/play.ts order '<json>' [--save=path.json]
//   npx tsx scripts/play.ts plan '<json>' [--save=path.json]
//   npx tsx scripts/play.ts finish [--save=path.json]
//   npx tsx scripts/play.ts debrief [--save=path.json]
//
// order/plan JSON shape (all fields optional):
//   { "resources": {"food": 50000, "water": 20000}, "colonists": 10,
//     "build": ["farm", "farm"], "demolish": ["steel_plant"],
//     "structures": {"habitat": 1}, "importStruct": {"habitat": 1},
//     "pads": {"classic": 1, "refuel": 0}, "scrapPads": {"classic": 1, "refuel": 0},
//     "unlockRefuel": true, "autoSpares": true, "autoPharma": true }
// ("structures"/"importStruct" are aliases — both mean import-fully-built from Earth.)
// "autoSpares": true keeps the spares order floored at current upkeep need every window from here
// on (set once, it stays on) — you can still order MORE spares than the floor, never less.
// "autoPharma": true — same floor, for pharma (roadmap-1: structural draw + expected D-083 illness
// treatments at current pop). Both auto-floors ship SOMETHING every window even off an otherwise
// empty manifest — which quietly defeats the 🌌 zero_import milestone (D-064) unless turned off for
// the two windows that are meant to be truly empty; `order`/`plan` both warn when this applies.
// "demolish": D-081 — tear down existing Mars structures, money-free, recycles a fraction of their
// build materials back to stock, costs one-time colonist labor (shared with ongoing crew, D-075).
// "scrapPads": D-080/082 — decommission existing launch pads for a net COST (~20% of current
// capex, matching real decommissioning economics — never a source of profit) — still the escape
// valve for an over-built fleet whose idle maintenance (D-038) would otherwise only grow with
// inflation forever, just not free money.
//
// `plan` applies the SAME JSON to the draft and prints the same feasibility/cost/mass/projection
// diagnostics as `order`, but never commits — a dry run to check a manifest before spending the window.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ColonyStore, type KV } from '../src/ui/colonyStore';
import { defaultColonyParams, STRUCTURES, STRUCT_BY_ID, MILESTONES, RESOURCES, type ResourceKind, type WindowEvent } from '../src/engine';

const MILESTONE_BY_ID = new Map(MILESTONES.map((m) => [m.id, m]));

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string, dflt?: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const savePath = flag('save', 'scripts/.play-save.json')!;

function fileKV(path: string): KV {
  return {
    getItem: (k) => {
      if (!existsSync(path)) return null;
      try {
        const all = JSON.parse(readFileSync(path, 'utf8'));
        return all[k] ?? null;
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      const all = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
      all[k] = v;
      writeFileSync(path, JSON.stringify(all));
    },
    removeItem: (k) => {
      if (!existsSync(path)) return;
      const all = JSON.parse(readFileSync(path, 'utf8'));
      delete all[k];
      writeFileSync(path, JSON.stringify(all));
    },
  };
}

const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const kg = (v: number) => Math.round(v).toLocaleString('en-US') + ' кг';
const pct = (v: number) => Math.round(v * 100) + '%';
/** Net flow rate, sign-prefixed — mirrors colony-status.ts's dkg(): a small rate (e.g. n2 leak
 * barely offset by production, ~1.6 kg/ок) rounded to the nearest whole kg used to print
 * "+2/ок" right next to a "(28125.7 ок)" cover computed from the real ~1.6 — technically
 * consistent (same unrounded net) but visibly not, since 45001/2 ≠ 45001/1.6. */
const dnet = (v: number): string => {
  const abs = Math.abs(v);
  const text = abs > 0 && abs < 50 ? (Math.round(abs * 10) / 10).toFixed(1) : String(Math.round(abs));
  return (v >= 0 ? '+' : '-') + text;
};

// mirrors chronicle-panel.ts's eventLabel() as plain text — playtest-3 found the old one-liner
// (icon+name only) dropped target/deaths/coverage, making the CLI unable to show WHY people died
// or WHAT broke without dumping the save JSON by hand.
function eventLine(ev: WindowEvent): string {
  switch (ev.effect) {
    case 'energy':
      return `${ev.icon} ${ev.name}: солнечная генерация −${pct(ev.mag)} на ${ev.windows} ок`;
    case 'subsidy':
      return `${ev.icon} ${ev.name}: субсидия −${pct(ev.mag)} на ${ev.windows} ок`;
    case 'delay':
      return `${ev.icon} ${ev.name}: конвой этого окна задержан на окно`;
    case 'price':
      return `${ev.icon} ${ev.name}: цены ×${ev.mag.toFixed(1)} на ${ev.windows} ок`;
    case 'farm':
      return `${ev.icon} ${ev.name}: выпуск ферм −${pct(ev.mag)} на ${ev.windows} ок`;
    case 'epidemic':
      // D-083: bed capacity decides the toll; the doomed die at the start of NEXT window
      return `${ev.icon} ${ev.name}: заболело ${ev.sickened ?? 0}, коек хватило на ${ev.treated ?? 0}${ev.deaths ? ` · обречено ${ev.deaths}` : ' · все выздоравливают'}`;
    case 'breach':
      return `${ev.icon} ${ev.name}: −${pct(ev.mag)} запаса N₂ · покрытие ЗИП ${pct(ev.coverage ?? 0)}${ev.deaths ? ` · † ${ev.deaths}` : ' · без потерь'}`;
    case 'radiation':
      return `${ev.icon} ${ev.name}: весь выпуск −${pct(ev.mag)}${ev.covered ? ' — медблок прикрыл' : ''}${ev.deaths ? ` · † ${ev.deaths}` : ''}`;
    case 'outage':
      return `${ev.icon} ${ev.name}: ${ev.target ? `${STRUCT_BY_ID[ev.target]?.name ?? ev.target} — стоит ${ev.windows} ок` : 'отказывать нечему — обошлось'}`;
    case 'crash':
      return `${ev.icon} ${ev.name}: потеряно ${pct(ev.mag)} конвоя${ev.lostKg ? ` (~${kg(ev.lostKg)})` : ''}${ev.deaths ? ` · † ${ev.deaths}` : ''}`;
    case 'harvest':
      return `${ev.icon} ${ev.name}: −${pct(ev.mag)} запаса еды${ev.covered ? ' — склад смягчил' : ''}`;
  }
}

function printStatus(store: ColonyStore): void {
  const s = store.status();
  const rnd = store.refuelRnD();
  console.log(`\n=== окно ${s.window} · год ~${s.year} · pop ${s.pop} ${s.collapsed ? '[СХЛОПНУЛАСЬ]' : s.ended ? '[ЗАВЕРШЕНО]' : ''} ===`);
  console.log(`бюджет: ${money(s.budget)}/окно  ·  🛡 без завоза: ${s.buffer}${s.bufferSaturated ? '+' : ''} ок`);
  console.log(`площадки: classic ${s.pads.classic}, refuel ${s.pads.refuel} (R&D ст. ${rnd.stage}/${rnd.total}${rnd.next ? `, следующая: ${rnd.next.name} за ${money(rnd.next.cost)}` : ', максимум'})`);
  const lastForRepair = store.lastReport();
  const repairInfo = store.repairInfo();
  const repairPct =
    lastForRepair && lastForRepair.repairSpentKg > 0 && repairInfo.upkeep > 0
      ? repairInfo.rate * (lastForRepair.repairSpentKg / repairInfo.upkeep) * 100
      : 0;
  console.log(`энергия: ${Math.round(s.energyGen)}/${Math.round(s.energyDemand)} (браунаут ${Math.round(s.energyDeficit)})  ·  износ ${(s.avgCondition * 100).toFixed(0)}%${repairPct > 0 ? ` (🔧 ремонт +${repairPct.toFixed(1)}%)` : ''}  ·  жильё ${s.pop}/${s.housingCapacity || '∞'}`);
  const foodStock = s.resources.find((r) => r.kind === 'food')?.stock ?? 0;
  const waterStock = s.resources.find((r) => r.kind === 'water')?.stock ?? 0;
  console.log(`склад: еда ${kg(foodStock)}/${kg(s.foodCapacityTotal)}  ·  вода ${kg(waterStock)}/${kg(s.waterCapacityTotal)}`);
  if (s.crewCoverage < 1) console.log(`⚠ экипаж: население покрывает только ${(s.crewCoverage * 100).toFixed(0)}% нужного штата — выпуск всех объектов просажен`);
  // roadmap-2: демография — труд/дети/больные (D-083) + возрастная структура и статистический
  // прогноз старения (never reads a colonist's own deathAge — see expectedOldAgeDeaths, D-063).
  if (s.pop > 0) {
    console.log(`демография: 💪 труд ${s.workforce} · 🧒 дети ${s.kids} · 🤒 больных ${s.sick} · 🛏 коек ${s.sickBeds}`);
    const dem = store.demography();
    const forecast =
      dem.expectedOldAgeDeaths >= 0.5 || dem.maturingSoon > 0
        ? ` · ⏳ ~${dem.expectedOldAgeDeaths.toFixed(1)}† старость/3 ок · 🎓 +${dem.maturingSoon} в труд`
        : '';
    console.log(`возраст: ${dem.buckets.map((b) => `${b.label}: ${b.count}`).join(' · ')}${forecast}`);
  }
  console.log(`авто-ЗИП: ${store.autoSparesEnabled ? 'вкл' : 'выкл'} · авто-фарма: ${store.autoPharmaEnabled ? 'вкл' : 'выкл'}`);
  console.log(
    `текущие цены: колонист ${money(store.colonistPriceNow())} · classic-площадка ${money(store.padPriceNow('classic'))}` +
      (s.refuelStage > 0 ? ` · refuel-площадка ${money(store.padPriceNow('refuel'))}` : '') +
      ` · доставка ~${money(store.deliveryPerKg().perKg)}/кг (${store.deliveryPerKg().tech})`,
  );
  const t = store.inTransit();
  const tParts: string[] = [];
  if (t.colonists > 0) tParts.push(`колонисты ${t.colonists}`);
  for (const [k, v] of Object.entries(t.stocks)) if ((v ?? 0) > 0) tParts.push(`${k} ${kg(v!)}`);
  for (const [id, n] of Object.entries(t.structures)) if ((n ?? 0) > 0) tParts.push(`${id}×${n}`);
  console.log(`в пути (придёт след. окно): ${tParts.length ? tParts.join(', ') : 'пусто'}`);
  // roadmap-1: projection of the CURRENT (empty at this point — fresh/just-committed) draft, i.e.
  // "what happens if the next order is empty" — the same honest 2-window sim the footer warns from
  for (const w of store.projectionWarnings()) console.log(`  ${w}`);
  console.log('ресурсы (сток, net/окно, запас в окнах, текущая цена/кг):');
  for (const r of s.resources) {
    console.log(`  ${r.kind.padEnd(9)} ${kg(r.stock).padStart(14)}  ${dnet(r.net)}/ок${Number.isFinite(r.windows) ? `  (${r.windows.toFixed(1)} ок)` : ''}  @ ${money(store.pricePerKg(r.kind))}/кг`);
  }
  const built = STRUCTURES.filter((st) => store.builtCount(st.id) > 0);
  if (built.length) console.log('построено: ' + built.map((st) => `${st.name}×${store.builtCount(st.id)}`).join(', '));
  const last = store.lastReport();
  if (last) {
    console.log(`--- прошлое окно (${last.window}) ---`);
    if (last.event) console.log(`  событие: ${eventLine(last.event)}`);
    if (last.mortality) console.log(`  † погибло ${last.mortality} (${Object.entries(last.mortalityBreakdown).map(([c, n]) => `${c}:${n}`).join(', ')})`);
    if (last.births) console.log(`  🐣 рождения: +${last.births}`);
    if (last.built.length) console.log(`  🏗 построено: ${last.built.join(', ')}`);
    if (last.demolished.length) console.log(`  🔧 демонтировано: ${last.demolished.join(', ')}`);
    if (last.repairSpentKg > 0) console.log(`  🔧 ремонт: потрачено ${kg(last.repairSpentKg)} сверх обслуживания (D-084)`);
    if (last.foodSpoiledKg > 0 || last.pharmaSpoiledKg > 0) {
      const parts: string[] = [];
      if (last.foodSpoiledKg > 0) parts.push(`еда -${kg(last.foodSpoiledKg)}`);
      if (last.pharmaSpoiledKg > 0) parts.push(`фарма -${kg(last.pharmaSpoiledKg)}`);
      console.log(`  🦠 порча: ${parts.join(', ')}`);
    }
    if (last.milestones.length) {
      console.log(`  ★ майлстоуны: ${last.milestones.map((id) => {
        const m = MILESTONE_BY_ID.get(id);
        return m?.subsidyBonus ? `${m.name} (субсидия +${money(m.subsidyBonus)}/окно)` : m?.name ?? id;
      }).join(', ')}`);
    }
    if (last.capped) console.log('  ⚠ завоз не влез в пропускную способность');
  }
}

function printCatalog(): void {
  const p = defaultColonyParams();
  console.log('=== ресурсы (window-0 $/кг — inflates every window, check `status` for the CURRENT price; потребление/чел/окно, recycle, тара) ===');
  for (const r of RESOURCES as readonly ResourceKind[]) {
    const c = p.catalog[r];
    console.log(`  ${r.padEnd(9)} ${money(c.earthPerKg)}/кг  perCapita=${c.perCapita}  η=${c.recycle}  тара=${c.tare}`);
  }
  console.log(
    '  NOTE: n2 perCapita=0 (life support draws none directly), BUT habitat-class structures leak\n' +
      '        n2 through the hull regardless of population (structural, see their n2Leak field below)\n' +
      '        — `status` shows the live total drain, it is NOT visible from perCapita.',
  );
  console.log('\n=== структуры (capex, энергия, материалы, produces/consumes) ===');
  for (const st of STRUCTURES) {
    const mats = Object.entries(st.buildMaterials).map(([r, q]) => `${r}:${q}`).join(',');
    const prod = Object.entries(st.produces).map(([r, q]) => `${r}:+${q}`).join(',');
    const cons = Object.entries(st.consumes).map(([r, q]) => `${r}:-${q}`).join(',');
    console.log(`  ${st.id.padEnd(16)} ${money(st.capex).padStart(12)}  energy=${st.energy}${st.housing ? `  housing=${st.housing}` : ''}${st.n2Leak ? `  n2Leak=${st.n2Leak}/окно` : ''}${st.prereq ? `  prereq=${st.prereq}` : ''}${st.minPop ? `  minPop=${st.minPop}` : ''}${st.opsCrew ? `  opsCrew=${st.opsCrew}` : ''}${st.demolishCrew ? `  demolishCrew=${st.demolishCrew}` : ''}${st.recycleFrac ? `  recycleFrac=${st.recycleFrac}` : ''}`);
    if (mats) console.log(`      materials: ${mats}`);
    if (prod || cons) console.log(`      ${prod}  ${cons}`);
  }
}

function printDebrief(store: ColonyStore): void {
  const d = store.debrief();
  if (!d) {
    console.log('партия ещё не закончена (нет коллапса и не нажато "finish")');
    return;
  }
  console.log(`\n=== ДЕБРИФ (${d.reason}) — окно ${d.window}, год ~${d.year} ===`);
  if (Object.keys(d.collapseCause).length) console.log('причина: ' + Object.entries(d.collapseCause).map(([c, n]) => `${c}:${n}`).join(', '));
  console.log(`запас без завоза до полного коллапса: ${d.collapseRunwaySaturated ? d.collapseRunwayWindows + '+' : d.collapseRunwayWindows} ок`);
  console.log('майлстоуны:');
  for (const m of d.milestones) console.log(`  ${m.window !== undefined ? '✓' : '·'} ${m.icon} ${m.name}${m.window !== undefined ? ` (окно ${m.window})` : ''}`);
}

interface OrderInput {
  resources?: Partial<Record<ResourceKind, number>>;
  colonists?: number;
  build?: string[];
  demolish?: string[];
  structures?: Record<string, number>;
  importStruct?: Record<string, number>;
  pads?: { classic?: number; refuel?: number };
  scrapPads?: { classic?: number; refuel?: number };
  unlockRefuel?: boolean;
  autoSpares?: boolean;
  autoPharma?: boolean;
}

/** Applies one parsed order/plan JSON object to the store's draft — shared by `order` (which
 * commits afterward) and `plan` (which only inspects). Toggles (auto-spares/auto-pharma) flip
 * immediately since they're session state, not part of the draft that plan() reads. */
function applyDraft(store: ColonyStore, o: OrderInput): void {
  // housing (build/import) must be queued BEFORE setColonists — maxColonists() reads the draft
  if (o.autoSpares !== undefined && o.autoSpares !== store.autoSparesEnabled) store.toggleAutoSpares();
  if (o.autoPharma !== undefined && o.autoPharma !== store.autoPharmaEnabled) store.toggleAutoPharma();
  for (const [r, qty] of Object.entries(o.resources ?? {})) store.setRes(r as ResourceKind, qty ?? 0);
  for (const id of o.build ?? []) store.addBuild(id);
  for (const id of o.demolish ?? []) store.addDemolish(id); // D-081
  for (const [id, n] of Object.entries({ ...(o.structures ?? {}), ...(o.importStruct ?? {}) })) store.setImportQty(id, n);
  if (o.pads?.classic) store.setPad('classic', o.pads.classic);
  if (o.pads?.refuel) store.setPad('refuel', o.pads.refuel);
  if (o.scrapPads?.classic) store.setPadScrap('classic', o.scrapPads.classic); // D-080
  if (o.scrapPads?.refuel) store.setPadScrap('refuel', o.scrapPads.refuel);
  if (o.unlockRefuel) store.toggleUnlockRefuel();
  if (o.colonists !== undefined) store.setColonists(o.colonists);
}

/** Feasibility diagnostics shared by `order` (rejected) and `plan` (dry run) — roadmap-1 C1/C2
 * add hints for the two "invisible rules" that bit the playtest: materials already in transit
 * (they need one more window after landing before a build can use them) and a first shipment
 * still in flight (every OTHER cargo order must itself carry colonists, D-078, until it lands). */
function printFeasibility(store: ColonyStore, plan: ReturnType<ColonyStore['plan']>): void {
  if (plan.overBudget) console.log(`  дороже бюджета: ${money(plan.totalCost)} / ${money(plan.budget)}`);
  if (plan.earth.capped) console.log(`  масса больше пропускной: ${kg(plan.earth.mass)} / ${kg(plan.earth.throughput)}`);
  if (plan.materialsShort.length) {
    console.log(`  не хватает материалов: ${plan.materialsShort.join(', ')}`);
    const t = store.inTransit().stocks;
    const arriving = plan.materialsShort.filter((r) => (t[r] ?? 0) > 0);
    if (arriving.length) {
      console.log(
        `  (${arriving.join(', ')} уже в пути — сядут к началу следующего окна; стройка станет доступна следующим ходом)`,
      );
    }
  }
  if (plan.prereqMissing.length) console.log(`  нет пререквизитов: ${plan.prereqMissing.join(', ')}`);
  if (plan.rndBlocked) console.log('  R&D требует высадки: на Марсе ещё никого нет');
  if (plan.bootstrapBlocked) {
    console.log('  первая партия должна включать колонистов: груз не летит один');
    if (store.inTransit().colonists > 0) {
      console.log(
        '  (первая партия уже в полёте — пока она не села, каждый заказ с грузом должен сам везти колонистов)',
      );
    }
  }
}

/** roadmap-1 C3/C4: warn when auto-spares/auto-pharma will ship something despite an otherwise
 * empty manifest — the window then does NOT count toward 🌌 zero_import (D-064), which needs two
 * truly empty windows in a row. Takes the precomputed value (not the store) because `order` must
 * read it BEFORE commit() clears the draft it depends on. */
function printZeroImportAutoHint(blocked: { spares: boolean; pharma: boolean } | null): void {
  if (!blocked) return;
  const who = [blocked.spares ? 'авто-ЗИП' : null, blocked.pharma ? 'авто-фарма' : null].filter(Boolean).join(' и ');
  console.log(
    `  ℹ автоматика (${who}) всё равно дошлёт груз в этом окне — оно не засчитается как «🌌 окно без единого завоза» (нужны два подряд пустых окна; на них ${who} придётся выключить)`,
  );
}

function main(): void {
  // autoSpares/autoPharma are UI-only preferences (like a browser tab, not part of the save) — the
  // real UI keeps them in memory for the whole session, but this CLI is one fresh process per
  // command, so they need their own tiny side-channel in the same file to survive across invocations.
  const kv = fileKV(savePath);
  const store = new ColonyStore(cmd === 'new' ? defaultColonyParams({ seed: Number(flag('seed', '1')) }) : undefined, kv);
  if (kv.getItem('ui:autoSpares') === 'true' && !store.autoSparesEnabled) store.toggleAutoSpares();
  if (kv.getItem('ui:autoPharma') === 'true' && !store.autoPharmaEnabled) store.toggleAutoPharma();

  if (cmd === 'new') {
    store.reset(defaultColonyParams({ seed: Number(flag('seed', '1')) }));
    kv.removeItem('ui:autoSpares');
    kv.removeItem('ui:autoPharma');
    console.log(`новая партия (seed=${flag('seed', '1')}), сохранение: ${savePath}`);
    printStatus(store);
    return;
  }
  if (cmd === 'catalog') return printCatalog();
  if (cmd === 'status') return printStatus(store);
  if (cmd === 'finish') {
    store.finish();
    printDebrief(store);
    return;
  }
  if (cmd === 'debrief') return printDebrief(store);

  if (cmd === 'plan') {
    const json = args[1];
    if (!json) throw new Error('plan requires a JSON argument, e.g. plan \'{"resources":{"food":1000}}\'');
    applyDraft(store, JSON.parse(json) as OrderInput);
    const plan = store.plan();
    console.log(plan.feasible ? '✓ план фезибилен (окно НЕ потрачено — это только проверка):' : '⚠ план НЕ фезибилен:');
    printFeasibility(store, plan);
    console.log(`  стоимость: ${money(plan.totalCost)} / ${money(plan.budget)}`);
    console.log(`  масса: ${kg(plan.earth.mass)} / ${kg(plan.earth.throughput)} (пропускная)`);
    for (const w of store.projectionWarnings()) console.log(`  ${w}`);
    if (plan.feasible) printZeroImportAutoHint(store.zeroImportBlockedByAuto());
    return; // dry run — never commits, draft is simply discarded with the process
  }

  if (cmd === 'order') {
    const json = args[1];
    if (!json) throw new Error('order requires a JSON argument, e.g. order \'{"resources":{"food":1000}}\'');
    applyDraft(store, JSON.parse(json) as OrderInput);

    const plan = store.plan();
    if (!plan.feasible) {
      // mirror the web UI, where the commit button is simply disabled on an infeasible plan —
      // the CLI used to warn and commit anyway, burning the window (2.2 years) on nothing
      console.log('⚠ план НЕ прошёл фильтр фезибильности — заказ НЕ отправлен, окно НЕ потрачено:');
      printFeasibility(store, plan);
      console.log('  поправь заказ и повтори команду (пустой order {} — просто пропустить ход).');
      process.exitCode = 1;
      return;
    }
    // projection of exactly the draft about to be committed — printed AFTER commit (below), next
    // to the resulting status, but computed from THIS draft (commit() clears it)
    const warnings = store.projectionWarnings();
    const autoHintBlocked = store.zeroImportBlockedByAuto();
    store.commit();
    kv.setItem('ui:autoSpares', String(store.autoSparesEnabled));
    kv.setItem('ui:autoPharma', String(store.autoPharmaEnabled));
    printStatus(store);
    for (const w of warnings) console.log(`  ${w}`);
    printZeroImportAutoHint(autoHintBlocked);
    return;
  }

  console.log('команды: new | status | catalog | order <json> | plan <json> | finish | debrief   (--save=path.json, --seed=N)');
}

main();
