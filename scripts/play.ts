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
//   npx tsx scripts/play.ts finish [--save=path.json]
//   npx tsx scripts/play.ts debrief [--save=path.json]
//
// order JSON shape (all fields optional):
//   { "resources": {"food": 50000, "water": 20000}, "colonists": 10,
//     "build": ["farm", "farm"], "structures": {"habitat": 1}, "importStruct": {"habitat": 1},
//     "pads": {"classic": 1, "refuel": 0}, "unlockRefuel": true, "autoSpares": true }
// ("structures"/"importStruct" are aliases — both mean import-fully-built from Earth.)
// "autoSpares": true keeps the spares order floored at current upkeep need every window from here
// on (set once, it stays on) — you can still order MORE spares than the floor, never less.

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

// mirrors chronicle-panel.ts's eventLabel() as plain text — playtest-3 found the old one-liner
// (icon+name only) dropped target/deaths/coverage, making the CLI unable to show WHY people died
// or WHAT broke without dumping the save JSON by hand.
function eventLine(ev: WindowEvent): string {
  switch (ev.effect) {
    case 'energy':
      return `${ev.icon} ${ev.name}: генерация −${pct(ev.mag)} на ${ev.windows} ок`;
    case 'subsidy':
      return `${ev.icon} ${ev.name}: субсидия −${pct(ev.mag)} на ${ev.windows} ок`;
    case 'delay':
      return `${ev.icon} ${ev.name}: конвой этого окна задержан на окно`;
    case 'price':
      return `${ev.icon} ${ev.name}: цены ×${ev.mag.toFixed(1)} на ${ev.windows} ок`;
    case 'farm':
      return `${ev.icon} ${ev.name}: выпуск ферм −${pct(ev.mag)} на ${ev.windows} ок`;
    case 'epidemic':
      return `${ev.icon} ${ev.name}${ev.covered ? ' — сдержана медблоком' : ''}${ev.deaths ? `: † ${ev.deaths}` : ''}`;
    case 'breach':
      return `${ev.icon} ${ev.name}: −${pct(ev.mag)} запаса N₂ · покрытие ЗИП ${pct(ev.coverage ?? 0)}${ev.deaths ? ` · † ${ev.deaths}` : ' · без потерь'}`;
    case 'radiation':
      return `${ev.icon} ${ev.name}: весь выпуск −${pct(ev.mag)}${ev.covered ? ' — медблок прикрыл' : ''}${ev.deaths ? ` · † ${ev.deaths}` : ''}`;
    case 'outage':
      return `${ev.icon} ${ev.name}: ${ev.target ? `${STRUCT_BY_ID[ev.target]?.name ?? ev.target} — стоит ${ev.windows} ок` : 'отказывать нечему — обошлось'}`;
    case 'crash':
      return `${ev.icon} ${ev.name}: потеряно ${pct(ev.mag)} конвоя${ev.lostKg ? ` (~${kg(ev.lostKg)})` : ''}${ev.deaths ? ` · † ${ev.deaths}` : ''}`;
  }
}

function printStatus(store: ColonyStore): void {
  const s = store.status();
  const rnd = store.refuelRnD();
  console.log(`\n=== окно ${s.window} · год ~${s.year} · pop ${s.pop} ${s.collapsed ? '[СХЛОПНУЛАСЬ]' : s.ended ? '[ЗАВЕРШЕНО]' : ''} ===`);
  console.log(`бюджет: ${money(s.budget)}/окно  ·  🛡 без завоза: ${s.buffer}${s.bufferSaturated ? '+' : ''} ок`);
  console.log(`площадки: classic ${s.pads.classic}, refuel ${s.pads.refuel} (R&D ст. ${rnd.stage}/${rnd.total}${rnd.next ? `, следующая: ${rnd.next.name} за ${money(rnd.next.cost)}` : ', максимум'})`);
  console.log(`энергия: ${Math.round(s.energyGen)}/${Math.round(s.energyDemand)} (браунаут ${Math.round(s.energyDeficit)})  ·  износ ${(s.avgCondition * 100).toFixed(0)}%  ·  жильё ${s.pop}/${s.housingCapacity || '∞'}`);
  if (s.crewCoverage < 1) console.log(`⚠ экипаж: население покрывает только ${(s.crewCoverage * 100).toFixed(0)}% нужного штата — выпуск всех объектов просажен`);
  console.log(`авто-ЗИП: ${store.autoSparesEnabled ? 'вкл' : 'выкл'}`);
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
  console.log('ресурсы (сток, net/окно, запас в окнах, текущая цена/кг):');
  for (const r of s.resources) {
    console.log(`  ${r.kind.padEnd(9)} ${kg(r.stock).padStart(14)}  ${(r.net >= 0 ? '+' : '') + Math.round(r.net)}/ок${Number.isFinite(r.windows) ? `  (${r.windows.toFixed(1)} ок)` : ''}  @ ${money(store.pricePerKg(r.kind))}/кг`);
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
    console.log(`  ${st.id.padEnd(16)} ${money(st.capex).padStart(12)}  energy=${st.energy}${st.housing ? `  housing=${st.housing}` : ''}${st.n2Leak ? `  n2Leak=${st.n2Leak}/окно` : ''}${st.prereq ? `  prereq=${st.prereq}` : ''}${st.minPop ? `  minPop=${st.minPop}` : ''}${st.opsCrew ? `  opsCrew=${st.opsCrew}` : ''}`);
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

function main(): void {
  // autoSpares is a UI-only preference (like a browser tab, not part of the save) — the real UI
  // keeps it in memory for the whole session, but this CLI is one fresh process per command, so it
  // needs its own tiny side-channel in the same file to survive across invocations.
  const kv = fileKV(savePath);
  const store = new ColonyStore(cmd === 'new' ? defaultColonyParams({ seed: Number(flag('seed', '1')) }) : undefined, kv);
  if (kv.getItem('ui:autoSpares') === 'true' && !store.autoSparesEnabled) store.toggleAutoSpares();

  if (cmd === 'new') {
    store.reset(defaultColonyParams({ seed: Number(flag('seed', '1')) }));
    kv.removeItem('ui:autoSpares');
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

  if (cmd === 'order') {
    const json = args[1];
    if (!json) throw new Error('order requires a JSON argument, e.g. order \'{"resources":{"food":1000}}\'');
    const o = JSON.parse(json) as {
      resources?: Partial<Record<ResourceKind, number>>;
      colonists?: number;
      build?: string[];
      structures?: Record<string, number>;
      importStruct?: Record<string, number>;
      pads?: { classic?: number; refuel?: number };
      unlockRefuel?: boolean;
      autoSpares?: boolean;
    };
    // housing (build/import) must be queued BEFORE setColonists — maxColonists() reads the draft
    if (o.autoSpares !== undefined && o.autoSpares !== store.autoSparesEnabled) store.toggleAutoSpares();
    for (const [r, qty] of Object.entries(o.resources ?? {})) store.setRes(r as ResourceKind, qty ?? 0);
    for (const id of o.build ?? []) store.addBuild(id);
    for (const [id, n] of Object.entries({ ...(o.structures ?? {}), ...(o.importStruct ?? {}) })) store.setImportQty(id, n);
    if (o.pads?.classic) store.setPad('classic', o.pads.classic);
    if (o.pads?.refuel) store.setPad('refuel', o.pads.refuel);
    if (o.unlockRefuel) store.toggleUnlockRefuel();
    if (o.colonists !== undefined) store.setColonists(o.colonists);

    const plan = store.plan();
    if (!plan.feasible) {
      // mirror the web UI, where the commit button is simply disabled on an infeasible plan —
      // the CLI used to warn and commit anyway, burning the window (2.2 years) on nothing
      console.log('⚠ план НЕ прошёл фильтр фезибильности — заказ НЕ отправлен, окно НЕ потрачено:');
      if (plan.overBudget) console.log(`  дороже бюджета: ${money(plan.totalCost)} / ${money(plan.budget)}`);
      if (plan.earth.capped) console.log(`  масса больше пропускной: ${kg(plan.earth.mass)} / ${kg(plan.earth.throughput)}`);
      if (plan.materialsShort.length) console.log(`  не хватает материалов: ${plan.materialsShort.join(', ')}`);
      if (plan.prereqMissing.length) console.log(`  нет пререквизитов: ${plan.prereqMissing.join(', ')}`);
      if (plan.rndBlocked) console.log('  R&D требует высадки: на Марсе ещё никого нет');
      console.log('  поправь заказ и повтори команду (пустой order {} — просто пропустить ход).');
      process.exitCode = 1;
      return;
    }
    store.commit();
    kv.setItem('ui:autoSpares', String(store.autoSparesEnabled));
    printStatus(store);
    return;
  }

  console.log('команды: new | status | catalog | order <json> | finish | debrief   (--save=path.json, --seed=N)');
}

main();
