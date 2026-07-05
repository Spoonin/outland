import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ColonyStore } from '../colonyStore';
import { padClassFor, type ResourceKind } from '../../engine';

const ICON: Record<string, string> = {
  food: '🍞', water: '💧', o2: '🫧', n2: '🌫️',
  steel: '🔩', metals: '⚙️', polymers: '🧪', glass: '🪟', spares: '🔧',
  pharma: '💊', chips: '🔌', catalyst: '⚗️', fuel: '⚛️',
};
const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const kg = (v: number) => Math.round(v).toLocaleString('en-US') + ' кг';

const TABS = [
  { id: 'logi', label: '🛫 Логистика' },
  { id: 'life', label: '🍞 Жизнеобеспечение' },
  { id: 'mat', label: '🔩 Материалы' },
  { id: 'tech', label: '🔬 Хайтек' },
  { id: 'people', label: '🧑‍🚀 Люди' },
  { id: 'import', label: '📦 Импорт построек' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const LIFE: ResourceKind[] = ['food', 'water', 'o2', 'n2'];
const MAT: ResourceKind[] = ['steel', 'metals', 'polymers', 'glass', 'spares'];
const TECH: ResourceKind[] = ['pharma', 'chips', 'catalyst', 'fuel'];

/** Earth ordering manifest (colony-sim §4): tabs of slider cards + live budget/mass summary. */
@customElement('earth-tab')
export class EarthTab extends LitElement {
  @property({ attribute: false }) store!: ColonyStore;
  @state() private tab: TabId = 'life';
  @state() private tick = 0;
  private unsub?: () => void;

  willUpdate(): void {
    if (!this.unsub && this.store) this.unsub = this.store.subscribe(() => (this.tick = this.tick + 1));
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
    this.unsub = undefined;
  }

  static styles = css`
    :host {
      display: block;
      border-top: 1px solid #2a2a34;
      margin-top: 1rem;
      padding-top: 1rem;
    }
    .tabs {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    .tabs button {
      font: inherit;
      background: #1a1a22;
      color: #b8b8c0;
      border: 1px solid #2a2a34;
      border-bottom: none;
      border-radius: 5px 5px 0 0;
      padding: 0.4rem 0.9rem;
      cursor: pointer;
    }
    .tabs button.active {
      background: #24242e;
      color: #fff;
      border-color: #44444f;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 0.6rem;
    }
    .card {
      background: #16161c;
      border: 1px solid #2a2a34;
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
    }
    .card .h {
      display: flex;
      justify-content: space-between;
      font-size: 0.9rem;
      margin-bottom: 0.4rem;
    }
    .card .v {
      font-weight: 600;
    }
    input[type='range'] {
      width: 100%;
    }
    .sub {
      font-size: 0.75rem;
      opacity: 0.5;
    }
    .summary {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      background: #14141a;
      border: 1px solid #2a2a34;
      border-radius: 6px;
      font-size: 0.9rem;
    }
    .summary .line {
      display: flex;
      justify-content: space-between;
    }
    .neg {
      color: #d96a6a;
    }
    .ok {
      color: #5ad17a;
    }
    button.commit {
      font: inherit;
      margin-top: 0.6rem;
      background: #14361f;
      color: #d8f0d8;
      border: 1px solid #5ad17a;
      padding: 0.5rem 1.25rem;
      border-radius: 5px;
      cursor: pointer;
    }
    button.commit:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      border-color: #555;
      color: #999;
    }
  `;

  private resCard(r: ResourceKind, max: number, step: number): TemplateResult {
    const store = this.store;
    const qty = store.resQty(r);
    const spec = store.catalog()[r];
    const del = store.deliveryPerKg();
    const shipPerKg = 1 + spec.tare; // container/tare adds ship mass
    const deliveryPerKg = del.perKg * shipPerKg;
    const earthPerKgNow = store.pricePerKg(r); // inflation/price-spike-aware, matches what commit() bills
    const lineCost = qty * (earthPerKgNow + deliveryPerKg);
    const auto = r === 'spares' && store.autoSparesEnabled;
    return html`<div class="card">
      <div class="h">
        <span>${ICON[r] ?? ''} ${r}</span><span class="v">${kg(qty)} кг${auto ? ' (авто)' : ''}</span>
      </div>
      <input
        type="range"
        min="0"
        max=${max}
        step=${step}
        .value=${String(qty)}
        @input=${(e: Event) => store.setRes(r, Number((e.target as HTMLInputElement).value))}
      />
      <div class="sub">
        товар ${money(earthPerKgNow)}/кг + доставка ~${money(deliveryPerKg)}/кг${spec.tare ? ` (тара ×${shipPerKg.toFixed(2)})` : ''} (${del.tech})${spec.perCapita ? ` · потр. ${spec.perCapita}/чел` : ''}${spec.recycle ? ` · η ${(spec.recycle * 100).toFixed(0)}%` : ''}
      </div>
      ${r === 'n2'
        ? html`<div class="sub">⚠ утечка идёт от жилых модулей (корпус негерметичен), не от населения — «потр./чел» тут ни при чём</div>`
        : nothing}
      ${r === 'spares'
        ? html`<label class="sub" style="cursor:pointer;display:block;margin-top:.3rem">
            <input type="checkbox" .checked=${store.autoSparesEnabled} @change=${() => store.toggleAutoSpares()} />
            авто-ЗИП: держать заказ не ниже текущего расхода на обслуживание
          </label>`
        : nothing}
      ${qty > 0 ? html`<div class="sub">≈ ${money(lineCost)} за позицию</div>` : nothing}
    </div>`;
  }

  private body(): TemplateResult {
    const store = this.store;
    if (this.tab === 'life') return html`<div class="cards">${LIFE.map((r) => this.resCard(r, 500_000, 5_000))}</div>`;
    if (this.tab === 'mat') return html`<div class="cards">${MAT.map((r) => this.resCard(r, 200_000, 5_000))}</div>`;
    if (this.tab === 'tech')
      return html`
        <div class="sub" style="margin-bottom:.5rem">
          ⚠ нелокализуемо при колониальном масштабе (D-045) — только завоз. Лёгкое, но дорогое:
          вечный «земной leg» снабжения. Заводы (полимеры/медблок/RnD) тянут это каждое окно.
        </div>
        <div class="cards">${TECH.map((r) => this.resCard(r, 50_000, 500))}</div>
      `;
    if (this.tab === 'people') {
      const max = store.maxColonists();
      const perHead = store.colonistPriceNow();
      return html`<div class="cards">
        <div class="card">
          <div class="h"><span>🧑‍🚀 колонисты</span><span class="v">${store.colonists} / ${max}</span></div>
          <input type="range" min="0" max=${Math.max(max, 1)} step=${max >= 10 ? 10 : 1} .value=${String(store.colonists)}
            ?disabled=${max === 0}
            @input=${(e: Event) => store.setColonists(Number((e.target as HTMLInputElement).value))} />
          <div class="sub">
            ${max === 0
              ? 'нет свободного жилья — постройте хабитат на Марсе или закажите готовую структуру с жильём (📦 Импорт построек)'
              : `${money(perHead)}/чел (без учёта доставки) · прибудут через окно (лаг) · вес + вечный шлейф потребления`}
          </div>
          ${store.colonists > 0 ? html`<div class="sub">≈ ${money(perHead * store.colonists)} за позицию (без доставки)</div>` : nothing}
        </div>
      </div>`;
    }
    if (this.tab === 'import')
      return html`
        <div class="sub" style="margin-bottom:.5rem">
          Готовые сооружения с Земли: цена — это сложная, дублируемая, космического класса техника
          (не россыпь металла), плюс доставка по массе. На порядки дороже местной стройки на Марсе,
          которая обходится только в материалы (D-054) — оправдано лишь для первой партии, пока на
          Марсе физически нечем строить.
        </div>
        <div class="cards">${store.structures().map((s) => this.structImportCard(s.id))}</div>
      `;
    // logistics
    return this.logistics();
  }

  private structImportCard(id: string): TemplateResult {
    const store = this.store;
    const struct = store.structures().find((s) => s.id === id)!;
    const qty = store.importQty(id);
    const unit = store.importUnitPlan(id); // { mass, cost } — cost = capex (unit price), tare-inclusive shipping mass
    const del = store.deliveryPerKg();
    const deliveryCost = unit.mass * del.perKg;
    const landedCost = unit.cost + deliveryCost;
    const prereqOk = store.importPrereqMet(id); // D-075: imports skip the minPop labor gate
    return html`<div class="card">
      <div class="h">
        <span>${struct.icon} ${struct.name}</span><span class="v">есть ${store.builtCount(id)} · +${qty}</span>
      </div>
      <input type="range" min="0" max="10" step="1" .value=${String(qty)}
        ?disabled=${!prereqOk}
        @input=${(e: Event) => store.setImportQty(id, Number((e.target as HTMLInputElement).value))} />
      <div class="sub">
        ${money(landedCost)}/шт под ключ (готовая структура ${money(unit.cost)} + доставка ${money(deliveryCost)}, ${kg(unit.mass)}, ${del.tech})
        ${struct.energy > 0 ? ` · ⚡ средняя мощность +${struct.energy}/окно (среднегодовая)` : ''}
        ${struct.housing ? ` · жильё +${struct.housing}` : ''}${!prereqOk ? ` · 🔒 нужен сначала: ${struct.prereq}` : ''}
      </div>
      ${qty > 0 ? html`<div class="sub">≈ ${money(landedCost * qty)} за позицию</div>` : nothing}
    </div>`;
  }

  private padCard(tech: 'classic' | 'refuel', title: string, sub: string): TemplateResult {
    const store = this.store;
    const spec = padClassFor(store.fleet(), store.launch(), tech); // refuel specs follow the R&D stage (D-068)
    const built = store.fleet().pads[tech];
    const priceNow = store.padPriceNow(tech); // inflation-adjusted — spec.padCapex alone is the window-0 price
    return html`<div class="card">
      <div class="h"><span>${title}</span><span class="v">есть ${built} · +${store.padQty(tech)}${store.padScrapQty(tech) ? ` · −${store.padScrapQty(tech)}` : ''}</span></div>
      <input type="range" min="0" max="10" step="1" .value=${String(store.padQty(tech))}
        @input=${(e: Event) => store.setPad(tech, Number((e.target as HTMLInputElement).value))} />
      <div class="sub">
        ${money(priceNow)}/площадка · содержание ${(spec.padMaintFrac * 100).toFixed(0)}%/окно ·
        payload ${kg(spec.payload)} кг · риск взрыва ${(spec.explodeProb * 100).toFixed(2)}%/пуск. ${sub}
      </div>
      ${built > 0
        ? html`<label class="sub" style="display:block;margin-top:.3rem;cursor:pointer">
            🔧 утилизировать (стоимость демонтажа ${(store.launch().padScrapCostFrac * 100).toFixed(0)}% капекса):
            <input type="range" min="0" max=${built} step="1" .value=${String(store.padScrapQty(tech))}
              @input=${(e: Event) => store.setPadScrap(tech, Number((e.target as HTMLInputElement).value))} />
            ${store.padScrapQty(tech)} шт
          </label>`
        : nothing}
    </div>`;
  }

  /** Buy-the-next-R&D-rung card (staged ladder, D-068). */
  private rndCard(rnd: { stage: number; total: number; next: { index: number; name: string; cost: number } }): TemplateResult {
    const store = this.store;
    const locked = store.rndLocked; // D-077: campaigns need somebody on Mars to run them
    return html`<div class="card">
      <div class="h">
        <span>🚀 R&D ${rnd.next.index}/${rnd.total}: ${rnd.next.name}</span>
        <span class="v">${rnd.stage === 0 ? '🔒' : `ст. ${rnd.stage}`}</span>
      </div>
      <div class="sub">
        ${money(rnd.next.cost)} — ${rnd.next.index === 1
          ? 'многоразовый сверхтяж + демо перекачки топлива на орбите: кампании работают, но тест-эра (60 т, дороже, рискованнее)'
          : 'серийные танкеры, орбитальное депо, посадка 100 т (сверхзвуковая ретротяга): коммерческая цена $1 000/кг'}
      </div>
      ${locked
        ? html`<div class="sub" style="opacity:.7">🔒 нужен хотя бы один колонист на Марсе — некому вести кампанию</div>`
        : html`<label class="sub" style="cursor:pointer;display:block;margin-top:.4rem">
            <input type="checkbox" .checked=${store.unlockRefuelDraft}
              @change=${() => store.toggleUnlockRefuel()} /> заказать R&D в этом окне
          </label>`}
    </div>`;
  }

  private logistics(): TemplateResult {
    const store = this.store;
    const rnd = store.refuelRnD();
    return html`<div class="cards">
      ${this.padCard('classic', '🛫 Классические (одноразовые)', 'дёшево построить, ~3 т на грунт, рискованнее')}
      ${rnd.stage > 0
        ? this.padCard('refuel', `🚀 Орбитальная заправка (ст. ${rnd.stage}/${rnd.total})`, rnd.stage < rnd.total ? 'тест-эра кампаний' : 'серийный флот')
        : nothing}
      ${rnd.next ? this.rndCard({ stage: rnd.stage, total: rnd.total, next: rnd.next }) : nothing}
    </div>`;
  }

  render() {
    void this.tick;
    const store = this.store;
    if (!store) return nothing;
    return html`
      <div class="tabs">
        ${TABS.map(
          (t) => html`<button class=${this.tab === t.id ? 'active' : ''} @click=${() => (this.tab = t.id)}>${t.label}</button>`,
        )}
      </div>
      ${this.body()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'earth-tab': EarthTab;
  }
}
