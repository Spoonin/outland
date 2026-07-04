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
//     "pads": {"classic": 1, "refuel": 0}, "unlockRefuel": true }
// ("structures"/"importStruct" are aliases — both mean import-fully-built from Earth.)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ColonyStore, type KV } from '../src/ui/colonyStore';
import { defaultColonyParams, STRUCTURES, RESOURCES, type ResourceKind } from '../src/engine';

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

function printStatus(store: ColonyStore): void {
  const s = store.status();
  const rnd = store.refuelRnD();
  console.log(`\n=== окно ${s.window} · год ~${s.year} · pop ${s.pop} ${s.collapsed ? '[СХЛОПНУЛАСЬ]' : s.ended ? '[ЗАВЕРШЕНО]' : ''} ===`);
  console.log(`бюджет: ${money(s.budget)}/окно  ·  🛡 без завоза: ${s.buffer}${s.bufferSaturated ? '+' : ''} ок`);
  console.log(`площадки: classic ${s.pads.classic}, refuel ${s.pads.refuel} (R&D ст. ${rnd.stage}/${rnd.total}${rnd.next ? `, следующая: ${rnd.next.name} за ${money(rnd.next.cost)}` : ', максимум'})`);
  console.log(`энергия: ${Math.round(s.energyGen)}/${Math.round(s.energyDemand)} (браунаут ${Math.round(s.energyDeficit)})  ·  износ ${(s.avgCondition * 100).toFixed(0)}%  ·  жильё ${s.pop}/${s.housingCapacity || '∞'}`);
  console.log('ресурсы (сток, net/окно, запас в окнах):');
  for (const r of s.resources) {
    console.log(`  ${r.kind.padEnd(9)} ${kg(r.stock).padStart(14)}  ${(r.net >= 0 ? '+' : '') + Math.round(r.net)}/ок${Number.isFinite(r.windows) ? `  (${r.windows.toFixed(1)} ок)` : ''}`);
  }
  const built = STRUCTURES.filter((st) => store.builtCount(st.id) > 0);
  if (built.length) console.log('построено: ' + built.map((st) => `${st.name}×${store.builtCount(st.id)}`).join(', '));
  const last = store.lastReport();
  if (last) {
    console.log(`--- прошлое окно (${last.window}) ---`);
    if (last.event) console.log(`  событие: ${last.event.icon} ${last.event.name}`);
    if (last.mortality) console.log(`  † погибло ${last.mortality} (${Object.entries(last.mortalityBreakdown).map(([c, n]) => `${c}:${n}`).join(', ')})`);
    if (last.births) console.log(`  🐣 рождения: +${last.births}`);
    if (last.built.length) console.log(`  🏗 построено: ${last.built.join(', ')}`);
    if (last.milestones.length) console.log(`  ★ майлстоуны: ${last.milestones.join(', ')}`);
    if (last.capped) console.log('  ⚠ завоз не влез в пропускную способность');
  }
}

function printCatalog(): void {
  const p = defaultColonyParams();
  console.log('=== ресурсы ($/кг, потребление/чел/окно, recycle, тара) ===');
  for (const r of RESOURCES as readonly ResourceKind[]) {
    const c = p.catalog[r];
    console.log(`  ${r.padEnd(9)} ${money(c.earthPerKg)}/кг  perCapita=${c.perCapita}  η=${c.recycle}  тара=${c.tare}`);
  }
  console.log('\n=== структуры (capex, энергия, материалы, produces/consumes) ===');
  for (const st of STRUCTURES) {
    const mats = Object.entries(st.buildMaterials).map(([r, q]) => `${r}:${q}`).join(',');
    const prod = Object.entries(st.produces).map(([r, q]) => `${r}:+${q}`).join(',');
    const cons = Object.entries(st.consumes).map(([r, q]) => `${r}:-${q}`).join(',');
    console.log(`  ${st.id.padEnd(16)} ${money(st.capex).padStart(12)}  energy=${st.energy}${st.housing ? `  housing=${st.housing}` : ''}${st.prereq ? `  prereq=${st.prereq}` : ''}`);
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
  const store = new ColonyStore(cmd === 'new' ? defaultColonyParams({ seed: Number(flag('seed', '1')) }) : undefined, fileKV(savePath));

  if (cmd === 'new') {
    store.reset(defaultColonyParams({ seed: Number(flag('seed', '1')) }));
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
    };
    // housing (build/import) must be queued BEFORE setColonists — maxColonists() reads the draft
    for (const [r, qty] of Object.entries(o.resources ?? {})) store.setRes(r as ResourceKind, qty ?? 0);
    for (const id of o.build ?? []) store.addBuild(id);
    for (const [id, n] of Object.entries({ ...(o.structures ?? {}), ...(o.importStruct ?? {}) })) store.setImportQty(id, n);
    if (o.pads?.classic) store.setPad('classic', o.pads.classic);
    if (o.pads?.refuel) store.setPad('refuel', o.pads.refuel);
    if (o.unlockRefuel) store.toggleUnlockRefuel();
    if (o.colonists !== undefined) store.setColonists(o.colonists);

    const plan = store.plan();
    if (!plan.feasible) {
      console.log('⚠ план НЕ прошёл фильтр фезибильности — ничего не отправится в этом окне:');
      if (plan.overBudget) console.log(`  дороже бюджета: ${money(plan.totalCost)} / ${money(plan.budget)}`);
      if (plan.earth.capped) console.log(`  масса больше пропускной: ${kg(plan.earth.mass)} / ${kg(plan.earth.throughput)}`);
      if (plan.materialsShort.length) console.log(`  не хватает материалов: ${plan.materialsShort.join(', ')}`);
      if (plan.prereqMissing.length) console.log(`  нет пререквизитов: ${plan.prereqMissing.join(', ')}`);
    }
    store.commit();
    printStatus(store);
    return;
  }

  console.log('команды: new | status | catalog | order <json> | finish | debrief   (--save=path.json, --seed=N)');
}

main();
