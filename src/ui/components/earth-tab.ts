import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ColonyStore } from '../colonyStore';
import { padClassFor, type ResourceKind, type TechSpec } from '../../engine';
import { tokens } from '../theme';
import { i18n, t } from '../i18n';

const ICON: Record<string, string> = {
  food: '🍞', water: '💧', o2: '🫧', n2: '🌫️',
  steel: '🔩', metals: '⚙️', polymers: '🧪', glass: '🪟', spares: '🔧',
  pharma: '💊', chips: '🔌', catalyst: '⚗️', fuel: '⚛️',
  regolith: '🪨', hydrogen: '💠', co2: '💨', // D-089 (P1): local ISRU intermediates
  composite: '🧱', components: '🛠️', // D-090 (P2): regolith construction — importable, not localOnly
};
const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const kg = (v: number) => Math.round(v).toLocaleString('en-US') + ' ' + t('status.kg');

const TABS = [
  { id: 'logi', key: 'earth.tabLogi' },
  { id: 'life', key: 'earth.tabLife' },
  { id: 'mat', key: 'earth.tabMat' },
  { id: 'tech', key: 'earth.tabTech' },
  { id: 'people', key: 'earth.tabPeople' },
  { id: 'import', key: 'earth.tabImport' },
  { id: 'ttree', key: 'earth.tabTtree' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const LIFE: ResourceKind[] = ['food', 'water', 'o2', 'n2'];
const MAT: ResourceKind[] = ['steel', 'metals', 'polymers', 'glass', 'spares', 'composite', 'components'];
const TECH: ResourceKind[] = ['pharma', 'chips', 'catalyst', 'fuel'];

/** Earth ordering manifest (colony-sim §4): tabs of slider cards + live budget/mass summary. */
@customElement('earth-tab')
export class EarthTab extends LitElement {
  @property({ attribute: false }) store!: ColonyStore;
  @state() private tab: TabId = 'life';
  @state() private tick = 0;
  private unsub?: () => void;
  private unsubI18n?: () => void;

  willUpdate(): void {
    if (!this.unsub && this.store) this.unsub = this.store.subscribe(() => (this.tick = this.tick + 1));
    if (!this.unsubI18n) this.unsubI18n = i18n.subscribe(() => (this.tick = this.tick + 1));
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
    this.unsub = undefined;
    this.unsubI18n?.();
    this.unsubI18n = undefined;
  }

  static styles = [
    tokens,
    css`
      :host {
        display: block;
        border-top: 2px solid var(--c-border);
        margin-top: 1rem;
        padding-top: 1rem;
        font-family: var(--font-mono);
      }
      .tabs {
        display: flex;
        gap: 0.25rem;
        flex-wrap: wrap;
        margin-bottom: 1rem;
      }
      .tabs button {
        font: inherit;
        font-family: var(--font-head);
        font-weight: 600;
        font-size: 0.75rem;
        letter-spacing: 0.04em;
        background: var(--c-panel);
        color: var(--c-text-dim);
        border: 1px solid var(--c-border);
        border-bottom: none;
        border-radius: var(--radius-sm) var(--radius-sm) 0 0;
        padding: 0.4rem 0.9rem;
        cursor: pointer;
      }
      .tabs button.active {
        background: var(--c-panel-hover);
        color: var(--c-text-bright);
        border-color: var(--c-border-hover);
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 8px;
      }
      .card {
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 10px 12px;
      }
      .card .h {
        display: flex;
        justify-content: space-between;
        font-size: 0.9rem;
        margin-bottom: 0.4rem;
        color: var(--c-text);
      }
      .card .v {
        font-weight: 600;
        color: var(--c-text-bright);
      }
      input[type='range'] {
        width: 100%;
        accent-color: var(--c-green);
      }
      .sub {
        font-size: 0.75rem;
        color: var(--c-text-dim2);
      }
      .summary {
        margin-top: 1rem;
        padding: 0.75rem 1rem;
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        font-size: 0.9rem;
      }
      .summary .line {
        display: flex;
        justify-content: space-between;
      }
      .neg {
        color: var(--c-red);
      }
      .ok {
        color: var(--c-green);
      }
      button.commit {
        font: inherit;
        font-family: var(--font-mono);
        margin-top: 0.6rem;
        background: var(--c-commit-bg);
        color: var(--c-commit-text);
        border: 1px solid var(--c-commit-border);
        padding: 0.5rem 1.25rem;
        border-radius: var(--radius-sm);
        cursor: pointer;
      }
      button.commit:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        border-color: #555;
        color: #999;
      }
    `,
  ];

  private resCard(r: ResourceKind, max: number, step: number): TemplateResult {
    const store = this.store;
    const qty = store.resQty(r);
    const spec = store.catalog()[r];
    const del = store.deliveryPerKg();
    const shipPerKg = 1 + spec.tare; // container/tare adds ship mass
    const deliveryPerKg = del.perKg * shipPerKg;
    const earthPerKgNow = store.pricePerKg(r); // inflation/price-spike-aware, matches what commit() bills
    const lineCost = qty * (earthPerKgNow + deliveryPerKg);
    const auto = (r === 'spares' && store.autoSparesEnabled) || (r === 'pharma' && store.autoPharmaEnabled);
    return html`<div class="card">
      <div class="h">
        <span>${ICON[r] ?? ''} ${r}</span><span class="v">${kg(qty)}${auto ? t('earth.auto') : ''}</span>
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
        ${t('earth.priceLine', {
          price: money(earthPerKgNow),
          delivery: money(deliveryPerKg),
          tare: spec.tare ? t('earth.tareSuffix', { v: shipPerKg.toFixed(2) }) : '',
          tech: del.tech,
          perCapita: spec.perCapita ? t('earth.perCapitaSuffix', { v: spec.perCapita }) : '',
          recycle: spec.recycle ? t('earth.recycleSuffix', { v: (spec.recycle * 100).toFixed(0) }) : '',
        })}
      </div>
      ${r === 'n2' ? html`<div class="sub">${t('earth.n2Note')}</div>` : nothing}
      ${r === 'spares'
        ? html`<label class="sub" style="cursor:pointer;display:block;margin-top:.3rem">
            <input type="checkbox" .checked=${store.autoSparesEnabled} @change=${() => store.toggleAutoSpares()} />
            ${t('earth.autoSparesLabel')}
          </label>
          <div class="sub">
            ${t('earth.autoSparesNote', {
              v: kg(store.repairInfo().upkeep),
              r: (store.repairInfo().rate * 100).toFixed(0),
            })}
          </div>`
        : nothing}
      ${r === 'pharma'
        ? html`<label class="sub" style="cursor:pointer;display:block;margin-top:.3rem">
            <input type="checkbox" .checked=${store.autoPharmaEnabled} @change=${() => store.toggleAutoPharma()} />
            ${t('earth.autoPharmaLabel')}
          </label>`
        : nothing}
      ${qty > 0 ? html`<div class="sub">${t('earth.lineCost', { v: money(lineCost) })}</div>` : nothing}
    </div>`;
  }

  private body(): TemplateResult {
    const store = this.store;
    if (this.tab === 'life') return html`<div class="cards">${LIFE.map((r) => this.resCard(r, 500_000, 5_000))}</div>`;
    if (this.tab === 'mat') return html`<div class="cards">${MAT.map((r) => this.resCard(r, 200_000, 5_000))}</div>`;
    if (this.tab === 'tech')
      return html`
        <div class="sub" style="margin-bottom:.5rem">${t('earth.techWarn')}</div>
        <div class="cards">${TECH.map((r) => this.resCard(r, 50_000, 500))}</div>
      `;
    if (this.tab === 'people') {
      const max = store.maxColonists();
      const perHead = store.colonistPriceNow();
      return html`<div class="cards">
        <div class="card">
          <div class="h"><span>${t('earth.colonistsLabel')}</span><span class="v">${store.colonists} / ${max}</span></div>
          <input type="range" min="0" max=${Math.max(max, 1)} step=${max >= 10 ? 10 : 1} .value=${String(store.colonists)}
            ?disabled=${max === 0}
            @input=${(e: Event) => store.setColonists(Number((e.target as HTMLInputElement).value))} />
          <div class="sub">
            ${max === 0 ? t('earth.noHousing') : t('earth.perHead', { v: money(perHead) })}
          </div>
          ${store.colonists > 0 ? html`<div class="sub">${t('earth.lineCostNoDelivery', { v: money(perHead * store.colonists) })}</div>` : nothing}
          ${store.cohortWaveWarning() ? html`<div class="sub" style="color:var(--c-amber)">${store.cohortWaveWarning()}</div>` : nothing}
        </div>
      </div>`;
    }
    if (this.tab === 'import')
      return html`
        <div class="sub" style="margin-bottom:.5rem">${t('earth.importIntro')}</div>
        <div class="cards">${store.structures().map((s) => this.structImportCard(s.id))}</div>
      `;
    if (this.tab === 'ttree') return this.techTree();
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
        <span>${struct.icon} ${struct.name}</span><span class="v">${t('earth.have', { n: store.builtCount(id), m: qty })}</span>
      </div>
      <input type="range" min="0" max="10" step="1" .value=${String(qty)}
        ?disabled=${!prereqOk}
        @input=${(e: Event) => store.setImportQty(id, Number((e.target as HTMLInputElement).value))} />
      <div class="sub">
        ${t('earth.turnkeyLine', { price: money(landedCost), cost: money(unit.cost), delivery: money(deliveryCost), mass: kg(unit.mass), tech: del.tech })}
        ${struct.energy > 0 ? t('earth.avgPower', { v: struct.energy }) : ''}
        ${struct.housing ? t('earth.housingPlus', { v: struct.housing }) : ''}${
          !prereqOk
            ? struct.techGate && !store.techOwned(struct.techGate)
              ? t('earth.needTech', { v: struct.techGate })
              : t('earth.needFirst', { v: struct.prereq ?? '' })
            : ''
        }
      </div>
      ${qty > 0 ? html`<div class="sub">${t('earth.lineCost', { v: money(landedCost * qty) })}</div>` : nothing}
    </div>`;
  }

  private padCard(tech: 'classic' | 'refuel', title: string, sub: string): TemplateResult {
    const store = this.store;
    const spec = padClassFor(store.fleet(), store.launch(), tech); // refuel specs follow the R&D stage (D-068)
    const built = store.fleet().pads[tech];
    const priceNow = store.padPriceNow(tech); // inflation-adjusted — spec.padCapex alone is the window-0 price
    return html`<div class="card">
      <div class="h"><span>${title}</span><span class="v">${t('earth.padHave', { built, add: store.padQty(tech) })}${store.padScrapQty(tech) ? t('earth.padScrapSuffix', { v: store.padScrapQty(tech) }) : ''}</span></div>
      <input type="range" min="0" max="10" step="1" .value=${String(store.padQty(tech))}
        @input=${(e: Event) => store.setPad(tech, Number((e.target as HTMLInputElement).value))} />
      <div class="sub">
        ${t('earth.padLine', {
          price: money(priceNow),
          maint: (spec.padMaintFrac * 100).toFixed(0),
          payload: kg(spec.payload),
          risk: (spec.explodeProb * 100).toFixed(2),
          sub,
        })}
      </div>
      ${built > 0
        ? html`<label class="sub" style="display:block;margin-top:.3rem;cursor:pointer">
            ${t('earth.scrapLabel', { v: (store.launch().padScrapCostFrac * 100).toFixed(0) })}
            <input type="range" min="0" max=${built} step="1" .value=${String(store.padScrapQty(tech))}
              @input=${(e: Event) => store.setPadScrap(tech, Number((e.target as HTMLInputElement).value))} />
            ${store.padScrapQty(tech)} ${t('earth.units')}
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
        <span>${t('earth.rndTitle', { i: rnd.next.index, n: rnd.total, name: rnd.next.name })}</span>
        <span class="v">${rnd.stage === 0 ? '🔒' : t('earth.rndStage', { v: rnd.stage })}</span>
      </div>
      <div class="sub">
        ${money(rnd.next.cost)} — ${rnd.next.index === 1 ? t('earth.rndDesc1') : t('earth.rndDesc2')}
      </div>
      ${locked
        ? html`<div class="sub" style="opacity:.7">${t('earth.rndLockedNote')}</div>`
        : html`<label class="sub" style="cursor:pointer;display:block;margin-top:.4rem">
            <input type="checkbox" .checked=${store.unlockRefuelDraft}
              @change=${() => store.toggleUnlockRefuel()} /> ${t('earth.rndOrder')}
          </label>`}
    </div>`;
  }

  /** Buy-a-tech card (D-088, P0 — by the R&D ladder's own pattern, D-068). */
  private techCard(spec: TechSpec): TemplateResult {
    const store = this.store;
    const owned = store.techOwned(spec.id);
    const buyable = store.techBuyable(spec.id);
    const selected = store.unlockTechDraft() === spec.id;
    return html`<div class="card">
      <div class="h">
        <span>${spec.icon} ${spec.name}</span>
        <span class="v">${owned ? t('earth.techOwned') : buyable ? money(store.techPriceNow(spec.id)) : '🔒'}</span>
      </div>
      ${spec.notes ? html`<div class="sub">${spec.notes}</div>` : nothing}
      ${owned
        ? nothing
        : buyable
          ? html`<label class="sub" style="cursor:pointer;display:block;margin-top:.4rem">
              <input type="checkbox" .checked=${selected} @change=${() => store.setUnlockTech(spec.id)} />
              ${t('earth.techOrder')}
            </label>`
          : html`<div class="sub" style="opacity:.7">${t('earth.techLockedNote')}</div>`}
    </div>`;
  }

  /** D-088 (P0): dedicated tab for the advanced-tech tree — fundament only, techs.csv ships empty
   * on purpose (real content arrives P1+, colony-sim.md §9 / documents/tech-tree/). */
  private techTree(): TemplateResult {
    const techs = this.store.techs();
    return html`
      <div class="sub" style="margin-bottom:.5rem">${t('earth.techTreeIntro')}</div>
      ${techs.length
        ? html`<div class="cards">${techs.map((spec) => this.techCard(spec))}</div>`
        : html`<div class="sub">${t('earth.techTreeEmpty')}</div>`}
    `;
  }

  private logistics(): TemplateResult {
    const store = this.store;
    const rnd = store.refuelRnD();
    return html`<div class="cards">
      ${this.padCard('classic', t('earth.padClassic'), t('earth.padClassicSub'))}
      ${rnd.stage > 0
        ? this.padCard(
            'refuel',
            t('earth.padRefuel', { stage: rnd.stage, total: rnd.total }),
            rnd.stage < rnd.total ? t('earth.padRefuelSubTest') : t('earth.padRefuelSubSerial'),
          )
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
          (tabDef) => html`<button class=${this.tab === tabDef.id ? 'active' : ''} @click=${() => (this.tab = tabDef.id)}>${t(tabDef.key)}</button>`,
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
