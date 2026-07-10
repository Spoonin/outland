import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ColonyStore } from '../colonyStore';
import { padClassFor, type ResourceKind, type TechSpec } from '../../engine';
import { tokens } from '../theme';
import { i18n, t } from '../i18n';
import { structName, techName, techNotes, refuelStageName } from '../names';
import { groupOf, GROUP_ORDER, GROUP_LABEL_KEYS, type Group } from '../structGroups';

const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const kg = (v: number) => Math.round(v).toLocaleString('en-US') + ' ' + t('status.kg');
/** Compact big-number for the order summary + hero costs (structures run to $Bs). */
const bn = (v: number): string => {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  return money(v);
};

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

/** Earth ordering manifest — redesigned per the "sliders don't work / pile of things" brief:
 *  - quantity sliders → steppers (− value +) with quick-add presets and live cost
 *  - resource cards show a goods-vs-delivery split (delivery is ~99% of landed cost — the real
 *    "build locally" signal); structure cards get a hero landed cost + prereq lock badge
 *  - a live order-summary bar (total $, ship mass, vs window subsidy) sits on the tab
 *  - locked tech collapses into its own section instead of a wall of gray prose. */
@customElement('earth-tab')
export class EarthTab extends LitElement {
  @property({ attribute: false }) store!: ColonyStore;
  /** OPTIONAL: window subsidy ($) so the summary bar can flag over-budget. Source it from the same
   * place the commit footer does (e.g. store.status()/plan()). Omit and the bar shows total+mass
   * only, leaving feasibility to the shared footer. */
  @property({ attribute: false }) windowSubsidy?: number;
  @state() private tab: TabId = 'life';
  @state() private techLockedOpen = false;
  @state() private importCollapsedGroups = new Set<Group>();
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

      /* ---- order summary bar ---- */
      .summary {
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 14px 16px;
        margin-bottom: 16px;
        display: flex;
        flex-wrap: wrap;
        gap: 22px;
        align-items: center;
        justify-content: space-between;
      }
      .summary .metrics {
        display: flex;
        gap: 26px;
        flex-wrap: wrap;
      }
      .summary .k {
        font-size: 10px;
        letter-spacing: 0.07em;
        color: var(--c-text-dim);
      }
      .summary .v {
        font-size: 19px;
        font-weight: 600;
        color: var(--c-text-bright);
      }
      .summary .v.neg {
        color: var(--c-red);
      }
      .summary .v.ok {
        color: var(--c-green);
      }
      .over {
        font-size: 11px;
        color: #ffb8a8;
        background: rgba(255, 90, 60, 0.1);
        border: 1px solid #7a3326;
        border-radius: var(--radius-sm);
        padding: 6px 11px;
      }
      .clear-btn {
        font: inherit;
        background: var(--c-panel);
        color: var(--c-text);
        border: 1px solid var(--c-border-hover);
        padding: 9px 14px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 12px;
        letter-spacing: 0.05em;
      }
      .clear-btn:hover {
        filter: brightness(1.2);
      }

      /* ---- tabs ---- */
      .tabs {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 16px;
      }
      .tabs button {
        font: inherit;
        font-family: var(--font-head);
        font-weight: 600;
        font-size: 12px;
        letter-spacing: 0.03em;
        padding: 8px 14px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        background: var(--c-bg);
        color: var(--c-text-dim);
        border: 1px solid var(--c-border);
      }
      .tabs button.active {
        background: var(--c-commit-bg);
        color: var(--c-commit-text);
        border-color: var(--c-green);
      }

      .intro {
        font-size: 12px;
        color: var(--c-text-dim);
        line-height: 1.5;
        margin-bottom: 14px;
        max-width: 900px;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 12px;
      }
      .cards.wide {
        grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
      }
      .card {
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 11px;
      }
      .card.queued {
        border-color: var(--c-green);
      }
      .card.locked {
        opacity: 0.72;
        border-color: var(--c-violet-border, #241f2e);
      }
      .card .h {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 10px;
      }
      .card .name {
        font-family: var(--font-head);
        font-weight: 600;
        font-size: 15px;
        color: var(--c-text-bright);
        text-transform: capitalize;
        line-height: 1.2;
      }
      .card .qty {
        font-size: 15px;
        font-weight: 600;
        color: var(--c-text-bright);
        white-space: nowrap;
      }
      .badge {
        font-size: 10px;
        color: var(--c-text-dim);
        background: var(--c-bg);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        padding: 3px 8px;
        white-space: nowrap;
        flex: none;
      }

      /* goods/delivery split */
      .split-chips {
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
      }
      .chip {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 9px;
        background: var(--c-bg);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        font-size: 11px;
      }
      .chip.delivery {
        border-color: #3a2f18;
      }
      .chip .lbl {
        font-size: 10px;
        color: var(--c-text-dim2);
      }
      .chip .amber {
        color: var(--c-amber);
      }
      .splitbar {
        height: 5px;
        border-radius: 3px;
        overflow: hidden;
        display: flex;
      }
      .splitbar .g {
        height: 100%;
        background: var(--c-green);
      }
      .splitbar .d {
        height: 100%;
        background: var(--c-amber);
      }

      /* stepper */
      .stepper {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .stepbox {
        display: flex;
        align-items: center;
      }
      .stepbox button {
        font: inherit;
        width: 32px;
        height: 32px;
        background: var(--c-panel);
        color: var(--c-text);
        border: 1px solid var(--c-border-hover);
        cursor: pointer;
        font-size: 17px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .stepbox button.minus {
        border-radius: var(--radius-sm) 0 0 var(--radius-sm);
      }
      .stepbox button.plus {
        border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
        background: var(--c-commit-bg);
        color: var(--c-commit-text);
        border-color: var(--c-green);
      }
      .stepbox button:hover:not(:disabled) {
        filter: brightness(1.2);
      }
      .stepbox button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .stepbox .val {
        min-width: 90px;
        height: 32px;
        padding: 0 8px;
        box-sizing: border-box;
        background: var(--c-bg);
        border-top: 1px solid var(--c-border-hover);
        border-bottom: 1px solid var(--c-border-hover);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 600;
        color: var(--c-text-bright);
      }
      .stepbox .val.narrow {
        min-width: 48px;
      }
      .presets {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
      }
      .presets button {
        font: inherit;
        font-size: 10.5px;
        padding: 5px 9px;
        background: var(--c-bg);
        color: var(--c-text-note);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        letter-spacing: 0.03em;
      }
      .presets button:hover {
        border-color: var(--c-border-hover);
        color: var(--c-text);
      }

      .hero {
        display: flex;
        align-items: baseline;
        gap: 10px;
        flex-wrap: wrap;
      }
      .hero .big {
        font-size: 21px;
        font-weight: 600;
        color: var(--c-text-bright);
        line-height: 1;
      }
      .hero .sub {
        font-size: 10px;
        color: var(--c-text-dim2);
      }
      .pill {
        font-size: 11px;
        border-radius: var(--radius-sm);
        padding: 3px 8px;
      }
      .pill.power {
        color: #9be3c2;
        border: 1px solid #20423a;
      }
      .pill.housing {
        color: #7fb0d8;
        border: 1px solid #24384a;
      }
      .breakdown {
        font-size: 10.5px;
        color: var(--c-text-dim2);
        line-height: 1.5;
        border-top: 1px solid var(--c-border);
        padding-top: 9px;
      }
      .sub {
        font-size: 11.5px;
        color: var(--c-text-dim);
      }
      .lockbadge {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--c-violet-text2, #b7aec2);
        background: var(--c-violet-fill, #15121c);
        border: 1px solid var(--c-violet-border, #2e2739);
        border-radius: var(--radius-sm);
        padding: 5px 10px;
        align-self: flex-start;
      }

      /* stat chips (pads) */
      .stats {
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
      }
      .stat {
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 5px 10px;
        background: var(--c-bg);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
      }
      .stat .s-lbl {
        font-size: 9.5px;
        color: var(--c-text-dim2);
      }
      .stat .s-val {
        font-size: 12px;
        font-weight: 500;
        color: var(--c-text);
      }

      /* functional grouping (import structures) */
      .group {
        margin-bottom: 20px;
      }
      .group-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--c-border);
        cursor: pointer;
      }
      .group-head .left {
        display: flex;
        align-items: baseline;
        gap: 10px;
      }
      .group-head .caret {
        font-size: 13px;
        color: var(--c-text-dim2);
      }
      .group-head .g-name {
        font-family: var(--font-head);
        font-weight: 700;
        font-size: 14px;
        letter-spacing: 0.08em;
        color: var(--c-text-bright);
        text-transform: uppercase;
      }
      .group-head .g-count {
        font-size: 11px;
        color: var(--c-text-dim2);
      }

      /* locked tech section */
      .locked-box {
        background: var(--c-bg);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        overflow: hidden;
      }
      .locked-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        cursor: pointer;
      }
      .locked-head .lh-left {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .locked-head .lh-name {
        font-family: var(--font-head);
        font-weight: 700;
        font-size: 14px;
        letter-spacing: 0.08em;
        color: var(--c-violet-text, #9a93a3);
        text-transform: uppercase;
      }

      input[type='checkbox'] {
        accent-color: var(--c-green);
        width: 15px;
        height: 15px;
      }
      label.order {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--c-text);
        cursor: pointer;
      }
    `,
  ];

  // ---------------- order summary (self-contained) ----------------
  private orderCost(): { total: number; mass: number } {
    const store = this.store;
    const del = store.deliveryPerKg();
    let total = 0;
    let mass = 0;
    for (const r of [...LIFE, ...MAT, ...TECH]) {
      const q = store.resQty(r);
      if (!q) continue;
      const spec = store.catalog()[r];
      const deliveryPerKg = del.perKg * (1 + spec.tare);
      total += q * (store.pricePerKg(r) + deliveryPerKg);
      mass += q * (1 + spec.tare);
    }
    for (const s of store.structures()) {
      const q = store.importQty(s.id);
      if (!q) continue;
      const unit = store.importUnitPlan(s.id);
      total += q * (unit.cost + unit.mass * del.perKg);
      mass += q * unit.mass;
    }
    for (const tech of ['classic', 'refuel'] as const) {
      const q = store.padQty(tech);
      if (q) total += q * store.padPriceNow(tech);
    }
    total += store.colonists * store.colonistPriceNow();
    const ut = store.unlockTechDraft();
    if (ut) total += store.techPriceNow(ut);
    return { total, mass };
  }

  private summaryBar(): TemplateResult {
    const { total, mass } = this.orderCost();
    const over = this.windowSubsidy != null && total > this.windowSubsidy;
    return html`<div class="summary">
      <div class="metrics">
        <div>
          <div class="k">${t('earth.orderTotal')}</div>
          <div class="v ${over ? 'neg' : total > 0 ? 'ok' : ''}">${bn(total)}</div>
        </div>
        ${this.windowSubsidy != null
          ? html`<div>
              <div class="k">${t('earth.windowSubsidy')}</div>
              <div class="v">${bn(this.windowSubsidy)}</div>
            </div>`
          : nothing}
        <div>
          <div class="k">${t('earth.shipMass')}</div>
          <div class="v">${kg(mass)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        ${over ? html`<div class="over">${t('earth.overBy', { v: bn(total - this.windowSubsidy!) })}</div>` : nothing}
        <button class="clear-btn" @click=${() => this.clearAll()}>${t('earth.clearAll')}</button>
      </div>
    </div>`;
  }

  private clearAll(): void {
    const store = this.store;
    for (const r of [...LIFE, ...MAT, ...TECH]) store.setRes(r, 0);
    for (const s of store.structures()) store.setImportQty(s.id, 0);
    store.setPad('classic', 0);
    store.setPad('refuel', 0);
    store.setColonists(0);
    if (store.unlockTechDraft()) store.setUnlockTech(store.unlockTechDraft()!);
  }

  private toggleImportGroup(group: Group): void {
    const next = new Set(this.importCollapsedGroups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    this.importCollapsedGroups = next;
  }

  // ---------------- resource card (materials / life / high-tech) ----------------
  private resCard(r: ResourceKind, step: number, presets: number[]): TemplateResult {
    const store = this.store;
    const qty = store.resQty(r);
    const spec = store.catalog()[r];
    const del = store.deliveryPerKg();
    const shipPerKg = 1 + spec.tare;
    const deliveryPerKg = del.perKg * shipPerKg;
    const earthPerKgNow = store.pricePerKg(r);
    const landedPerKg = earthPerKgNow + deliveryPerKg;
    const lineCost = qty * landedPerKg;
    const goodsPct = (earthPerKgNow / landedPerKg) * 100;
    const auto = (r === 'spares' && store.autoSparesEnabled) || (r === 'pharma' && store.autoPharmaEnabled);
    const set = (v: number) => store.setRes(r, Math.max(0, v));

    return html`<div class="card ${qty > 0 ? 'queued' : ''}">
      <div class="h">
        <span class="name">${r}${auto ? t('earth.auto') : ''}</span>
        <span class="qty">${kg(qty)}</span>
      </div>

      <div class="split-chips">
        <div class="chip"><span class="lbl">${t('earth.goods')}</span>${money(earthPerKgNow)}/kg</div>
        <div class="chip delivery"><span class="lbl">${t('earth.delivery')}</span><span class="amber">${money(deliveryPerKg)}/kg</span></div>
      </div>
      <div class="splitbar"><div class="g" style="width:${goodsPct}%"></div><div class="d" style="width:${100 - goodsPct}%"></div></div>

      <div class="stepper">
        <div class="stepbox">
          <button class="minus" @click=${() => set(qty - step)}>−</button>
          <div class="val">${kg(qty)}</div>
          <button class="plus" @click=${() => set(qty + step)}>+</button>
        </div>
        <div class="presets">
          ${presets.map((p) => html`<button @click=${() => set(qty + p)}>+${p / 1000}t</button>`)}
          <button @click=${() => set(0)}>${t('earth.clear')}</button>
        </div>
      </div>

      ${qty > 0
        ? html`<div class="sub">
            ${t('earth.landed')}: <b style="color:var(--c-text-bright)">${bn(lineCost)}</b>
            <span style="color:var(--c-text-dim2)"> · ${Math.round((deliveryPerKg / landedPerKg) * 100)}% ${t('earth.isDelivery')}</span>
          </div>`
        : nothing}
      ${r === 'n2' ? html`<div class="sub">${t('earth.n2Note')}</div>` : nothing}
      ${r === 'spares'
        ? html`<label class="order"><input type="checkbox" .checked=${store.autoSparesEnabled} @change=${() => store.toggleAutoSpares()} />${t('earth.autoSparesLabel')}</label>
            <div class="sub">${t('earth.autoSparesNote')}</div>`
        : nothing}
      ${r === 'pharma'
        ? html`<label class="order"><input type="checkbox" .checked=${store.autoPharmaEnabled} @change=${() => store.toggleAutoPharma()} />${t('earth.autoPharmaLabel')}</label>`
        : nothing}
    </div>`;
  }

  // ---------------- structure import card ----------------
  private structImportCard(id: string): TemplateResult {
    const store = this.store;
    const struct = store.structures().find((s) => s.id === id)!;
    const qty = store.importQty(id);
    const unit = store.importUnitPlan(id);
    const del = store.deliveryPerKg();
    const deliveryCost = unit.mass * del.perKg;
    const landed = unit.cost + deliveryCost;
    const prereqOk = store.importPrereqMet(id);
    const set = (v: number) => store.setImportQty(id, Math.max(0, Math.min(10, v)));
    const lockText =
      struct.techGate && !store.techOwned(struct.techGate)
        ? t('earth.needTech', { v: techName(struct.techGate, struct.techGate) })
        : t('earth.needFirst', { v: structName(struct.prereq ?? '', struct.prereq ?? '') });

    return html`<div class="card wide ${qty > 0 ? 'queued' : ''} ${prereqOk ? '' : 'locked'}">
      <div class="h">
        <span class="name">${structName(struct.id, struct.name)}</span>
        <span class="badge">${t('earth.have', { n: store.builtCount(id), m: qty })}</span>
      </div>
      <div class="hero">
        <div>
          <div class="big">${bn(landed)}</div>
          <div class="sub">${t('earth.perUnitLanded')}</div>
        </div>
        ${struct.energy > 0 ? html`<span class="pill power">+${struct.energy} kW</span>` : nothing}
        ${struct.housing ? html`<span class="pill housing">+${struct.housing} ${t('status.housing')}</span>` : nothing}
      </div>
      <div class="breakdown">
        ${t('earth.turnkeyBreakdown', { cost: bn(unit.cost), delivery: bn(deliveryCost), mass: kg(unit.mass), tech: del.tech })}
      </div>
      ${prereqOk
        ? html`<div class="stepbox">
              <button class="minus" @click=${() => set(qty - 1)}>−</button>
              <div class="val narrow">${qty}</div>
              <button class="plus" @click=${() => set(qty + 1)}>+</button>
            </div>
            ${qty > 0 ? html`<div class="sub">${t('earth.lineTotal')}: <b style="color:var(--c-text-bright)">${bn(landed * qty)}</b></div>` : nothing}`
        : html`<div class="lockbadge">🔒 ${lockText}</div>`}
    </div>`;
  }

  // ---------------- import structures tab: grouped like mars-tab's build groups ----------------
  private importStructures(): TemplateResult {
    const store = this.store;
    const all = store.structures();
    const groups = GROUP_ORDER.map((g) => ({ g, list: all.filter((s) => groupOf(s) === g) })).filter((x) => x.list.length);

    return html`<div class="intro">${t('earth.importIntro')}</div>
      ${groups.map(({ g, list }) => {
        const collapsed = this.importCollapsedGroups.has(g);
        return html`<div class="group">
          <div class="group-head" @click=${() => this.toggleImportGroup(g)}>
            <div class="left">
              <span class="caret">${collapsed ? '▸' : '▾'}</span>
              <span class="g-name">${t(GROUP_LABEL_KEYS[g])}</span>
            </div>
            <span class="g-count">${t('mars.typesCount', { n: list.length })}</span>
          </div>
          ${collapsed ? nothing : html`<div class="cards wide">${list.map((s) => this.structImportCard(s.id))}</div>`}
        </div>`;
      })}`;
  }

  // ---------------- pad card ----------------
  private padCard(tech: 'classic' | 'refuel', title: string, sub: string): TemplateResult {
    const store = this.store;
    const spec = padClassFor(store.fleet(), store.launch(), tech);
    const built = store.fleet().pads[tech];
    const priceNow = store.padPriceNow(tech);
    const qty = store.padQty(tech);
    const set = (v: number) => store.setPad(tech, Math.max(0, Math.min(10, v)));
    return html`<div class="card wide ${qty > 0 ? 'queued' : ''}">
      <div class="h">
        <span class="name">${title}</span>
        <span class="badge">${t('earth.padHave', { built, add: qty })}</span>
      </div>
      <div class="hero"><div class="big">${bn(priceNow)}</div><div class="sub">${t('earth.perPad')}</div></div>
      <div class="stats">
        <div class="stat"><span class="s-lbl">${t('earth.payload')}</span><span class="s-val">${kg(spec.payload)}</span></div>
        <div class="stat"><span class="s-lbl">${t('earth.upkeep')}</span><span class="s-val">${(spec.padMaintFrac * 100).toFixed(0)}%/${t('status.wnd')}</span></div>
        <div class="stat" style="border-color:#3a2f18">
          <span class="s-lbl">${t('earth.explodeRisk')}</span>
          <span class="s-val" style="color:var(--c-amber)">${(spec.explodeProb * 100).toFixed(2)}%</span>
        </div>
      </div>
      <div class="stepbox">
        <button class="minus" @click=${() => set(qty - 1)}>−</button>
        <div class="val narrow">${qty}</div>
        <button class="plus" @click=${() => set(qty + 1)}>+</button>
      </div>
      <div class="sub">${sub}</div>
      ${built > 0
        ? html`<label class="sub" style="display:block;margin-top:.2rem">
            ${t('earth.scrapLabel', { v: (store.launch().padScrapCostFrac * 100).toFixed(0) })}
            <div class="stepbox" style="margin-top:6px">
              <button class="minus" @click=${() => store.setPadScrap(tech, Math.max(0, store.padScrapQty(tech) - 1))}>−</button>
              <div class="val narrow">${store.padScrapQty(tech)}</div>
              <button class="plus" @click=${() => store.setPadScrap(tech, Math.min(built, store.padScrapQty(tech) + 1))}>+</button>
            </div>
          </label>`
        : nothing}
    </div>`;
  }

  private rndCard(rnd: { stage: number; total: number; next: { index: number; name: string; cost: number } }): TemplateResult {
    const store = this.store;
    const locked = store.rndLocked;
    return html`<div class="card wide ${locked ? 'locked' : ''}">
      <div class="h">
        <span class="name">${t('earth.rndTitle', { i: rnd.next.index, n: rnd.total, name: refuelStageName(rnd.next.index, rnd.next.name) })}</span>
        <span class="badge">${rnd.stage === 0 ? t('mars.locked') : t('earth.rndStage', { v: rnd.stage })}</span>
      </div>
      <div class="hero"><div class="big">${bn(rnd.next.cost)}</div></div>
      <div class="sub">${rnd.next.index === 1 ? t('earth.rndDesc1') : t('earth.rndDesc2')}</div>
      ${locked
        ? html`<div class="lockbadge">🔒 ${t('earth.rndLockedNote')}</div>`
        : html`<label class="order"><input type="checkbox" .checked=${store.unlockRefuelDraft} @change=${() => store.toggleUnlockRefuel()} />${t('earth.rndOrder')}</label>`}
    </div>`;
  }

  // ---------------- tech tree (buyable up top, locked collapsed) ----------------
  private techCard(spec: TechSpec): TemplateResult {
    const store = this.store;
    const selected = store.unlockTechDraft() === spec.id;
    return html`<div class="card wide ${selected ? 'queued' : ''}">
      <div class="h">
        <span class="name">${techName(spec.id, spec.name)}</span>
        <span class="qty" style="color:#9be3c2">${bn(store.techPriceNow(spec.id))}</span>
      </div>
      ${spec.notes ? html`<div class="sub">${techNotes(spec.id, spec.notes)}</div>` : nothing}
      <label class="order"><input type="checkbox" .checked=${selected} @change=${() => store.setUnlockTech(spec.id)} />${t('earth.techOrder')}</label>
    </div>`;
  }

  private techTree(): TemplateResult {
    const store = this.store;
    const techs = store.techs();
    if (!techs.length) return html`<div class="sub">${t('earth.techTreeEmpty')}</div>`;
    const buyable = techs.filter((s) => store.techBuyable(s.id) && !store.techOwned(s.id));
    const locked = techs.filter((s) => !store.techBuyable(s.id) && !store.techOwned(s.id));
    return html`
      <div class="intro">${t('earth.techTreeIntro')}</div>
      ${buyable.length ? html`<div class="cards wide" style="margin-bottom:16px">${buyable.map((s) => this.techCard(s))}</div>` : nothing}
      ${locked.length
        ? html`<div class="locked-box">
            <div class="locked-head" @click=${() => (this.techLockedOpen = !this.techLockedOpen)}>
              <div class="lh-left">
                <span style="color:var(--c-violet)">${this.techLockedOpen ? '▾' : '▸'}</span>
                <span class="dot" style="width:9px;height:9px;border-radius:50%;background:var(--c-violet)"></span>
                <span class="lh-name">${t('mars.locked')}</span>
                <span class="sub">(${locked.length})</span>
              </div>
              <span class="sub">${this.techLockedOpen ? t('mars.collapse') : t('mars.showRequirements')}</span>
            </div>
            ${this.techLockedOpen
              ? html`<div class="cards wide" style="padding:12px;border-top:1px solid var(--c-border)">
                  ${locked.map(
                    (s) => html`<div class="card locked">
                      <span class="name" style="font-size:13.5px">${techName(s.id, s.name)}</span>
                      ${s.notes ? html`<div class="sub">${techNotes(s.id, s.notes)}</div>` : nothing}
                      <div class="lockbadge">🔒 ${t('earth.techLockedNote')}</div>
                    </div>`,
                  )}
                </div>`
              : nothing}
          </div>`
        : nothing}
    `;
  }

  private peopleCard(): TemplateResult {
    const store = this.store;
    const max = store.maxColonists();
    const perHead = store.colonistPriceNow();
    const set = (v: number) => store.setColonists(Math.max(0, Math.min(max, v)));
    const step = max >= 10 ? 10 : 1;
    return html`<div class="cards wide">
      <div class="card ${store.colonists > 0 ? 'queued' : ''}">
        <div class="h"><span class="name">${t('earth.colonistsLabel')}</span><span class="qty">${store.colonists} / ${max}</span></div>
        ${max === 0
          ? html`<div class="lockbadge">🔒 ${t('earth.noHousing')}</div>`
          : html`<div class="stepbox">
                <button class="minus" @click=${() => set(store.colonists - step)}>−</button>
                <div class="val narrow">${store.colonists}</div>
                <button class="plus" @click=${() => set(store.colonists + step)}>+</button>
              </div>
              <div class="sub">${t('earth.perHead', { v: money(perHead) })}</div>
              ${store.colonists > 0 ? html`<div class="sub">${t('earth.lineCostNoDelivery', { v: money(perHead * store.colonists) })}</div>` : nothing}
              ${store.cohortWaveWarning()
                ? (() => {
                    const w = store.cohortWaveWarning()!;
                    return html`<div class="sub" style="color:var(--c-amber)">${t('earth.cohortWave', { n: w.colonists, peak: w.peakWindows, spread: w.spreadWindows })}</div>`;
                  })()
                : nothing}`}
      </div>
    </div>`;
  }

  private body(): TemplateResult {
    const store = this.store;
    switch (this.tab) {
      case 'life':
        return html`<div class="cards">${LIFE.map((r) => this.resCard(r, 5000, [10000, 50000, 100000]))}</div>`;
      case 'mat':
        return html`<div class="cards">${MAT.map((r) => this.resCard(r, 5000, [10000, 50000, 100000]))}</div>`;
      case 'tech':
        return html`<div class="intro">${t('earth.techWarn')}</div>
          <div class="cards">${TECH.map((r) => this.resCard(r, 500, [1000, 5000, 10000]))}</div>`;
      case 'people':
        return this.peopleCard();
      case 'import':
        return this.importStructures();
      case 'ttree':
        return this.techTree();
      case 'logi':
      default: {
        const rnd = store.refuelRnD();
        return html`<div class="cards wide">
          ${this.padCard('classic', t('earth.padClassic'), t('earth.padClassicSub'))}
          ${rnd.stage > 0
            ? this.padCard('refuel', t('earth.padRefuel', { stage: rnd.stage, total: rnd.total }), rnd.stage < rnd.total ? t('earth.padRefuelSubTest') : t('earth.padRefuelSubSerial'))
            : nothing}
          ${rnd.next ? this.rndCard({ stage: rnd.stage, total: rnd.total, next: rnd.next }) : nothing}
        </div>`;
      }
    }
  }

  render() {
    void this.tick;
    const store = this.store;
    if (!store) return nothing;
    return html`
      ${this.summaryBar()}
      <div class="tabs">
        ${TABS.map((d) => html`<button class=${this.tab === d.id ? 'active' : ''} @click=${() => (this.tab = d.id)}>${t(d.key)}</button>`)}
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
