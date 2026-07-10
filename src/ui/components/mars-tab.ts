import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ColonyStore } from '../colonyStore';
import { STRUCT_BY_ID, TECH_BY_ID, type Structure } from '../../engine';
import { tokens } from '../theme';
import { i18n, t } from '../i18n';
import { structName, techName } from '../names';
import { groupOf, GROUP_ORDER, GROUP_LABEL_KEYS, type Group } from '../structGroups';

const kg = (v: number) => Math.round(v).toLocaleString('en-US');

/** LED status: running / buildable-now / short-on-materials / locked. Splits the design's
 * "can't afford" (amber, recoverable) from "locked" (violet, gated) — see the design brief. */
function structStatus(
  store: ColonyStore,
  s: Structure,
  short: boolean,
): { color: string; label: string } {
  if (store.builtCount(s.id) > 0) return { color: 'var(--c-green)', label: t('mars.built') };
  if (!store.prereqMet(s.id)) return { color: 'var(--c-violet)', label: t('mars.locked') };
  if (short) return { color: 'var(--c-amber)', label: t('mars.short') };
  return { color: 'var(--c-green)', label: t('mars.buildable') };
}

/** Mars build tab — redesigned per the "chaotic construction tab" brief:
 * fixed card zones (header → hero → cost chips → muted specs → prominent stepper),
 * a live consequences summary bar, functional grouping, and locked buildings
 * collapsed into their own section. */
@customElement('mars-tab')
export class MarsTab extends LitElement {
  @property({ attribute: false }) store!: ColonyStore;
  @state() private tick = 0;
  @state() private lockedOpen = false;
  @state() private collapsedGroups = new Set<Group>();
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

      /* ---- Summary bar: live consequences of the current queue ---- */
      .summary {
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 14px 16px;
        margin-bottom: 18px;
        display: flex;
        flex-wrap: wrap;
        gap: 22px;
        align-items: center;
        justify-content: space-between;
      }
      .summary .sect-label {
        font-size: 10px;
        letter-spacing: 0.09em;
        color: var(--c-text-dim);
        text-transform: uppercase;
        font-family: var(--font-head);
        font-weight: 600;
        margin-bottom: 8px;
      }
      .mat-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .mat-chip {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 5px 10px;
        background: var(--c-bg);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
      }
      .mat-chip.used {
        border-color: var(--c-green-border, #20423a);
      }
      .mat-chip.over {
        border-color: var(--c-red-border, #5c2b22);
      }
      .mat-chip .lbl {
        font-size: 11px;
        color: var(--c-text-note);
      }
      .mat-chip .val {
        font-size: 12px;
        font-weight: 500;
        color: var(--c-text);
      }
      .mat-chip.over .val {
        color: var(--c-red);
      }
      .mat-chip .cap {
        font-size: 10px;
        color: var(--c-text-dim2);
      }
      .metrics {
        display: flex;
        gap: 22px;
        flex-wrap: wrap;
      }
      .metric .k {
        font-size: 10px;
        letter-spacing: 0.07em;
        color: var(--c-text-dim);
      }
      .metric .v {
        font-size: 19px;
        font-weight: 500;
        color: var(--c-text);
      }
      .metric .v.gen {
        color: var(--c-green);
      }
      .metric .v.draw {
        color: var(--c-red);
      }
      .actions {
        display: flex;
        gap: 10px;
      }
      .actions button {
        font: inherit;
        padding: 9px 16px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        letter-spacing: 0.05em;
        font-size: 12px;
      }
      .actions .clear {
        background: var(--c-panel);
        color: var(--c-text);
        border: 1px solid var(--c-border-hover);
      }
      .actions .commit {
        background: var(--c-green-fill, #123d28);
        color: var(--c-green-text, #d8f5e2);
        border: 1px solid var(--c-green);
        font-weight: 600;
      }

      /* ---- Legend ---- */
      .legend {
        display: flex;
        gap: 18px;
        flex-wrap: wrap;
        font-size: 10px;
        color: var(--c-text-dim2);
        letter-spacing: 0.04em;
        margin-bottom: 16px;
      }
      .legend .dot,
      .name .dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        margin-right: 6px;
      }

      /* ---- Group ---- */
      .group {
        margin-bottom: 22px;
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
        color: var(--c-text-bright, #bfe6d6);
        text-transform: uppercase;
      }
      .group-head .g-count {
        font-size: 11px;
        color: var(--c-text-dim2);
      }

      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
        gap: 14px;
      }

      /* ---- Card: fixed zones ---- */
      .card {
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 15px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .card.queued {
        border-color: var(--c-green);
      }
      .card.queued.short {
        border-color: var(--c-amber);
      }
      .zone-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 10px;
      }
      .name {
        font-family: var(--font-head);
        font-weight: 600;
        font-size: 15px;
        color: var(--c-text);
        display: flex;
        align-items: center;
        line-height: 1.2;
      }
      .name .dot {
        flex: none;
      }
      .built {
        font-size: 10px;
        color: var(--c-text-dim);
        background: var(--c-bg);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        padding: 3px 8px;
        white-space: nowrap;
        flex: none;
      }
      /* Hero */
      .hero {
        display: flex;
        align-items: baseline;
        gap: 12px;
        flex-wrap: wrap;
      }
      .hero .big {
        font-size: 24px;
        font-weight: 600;
        line-height: 1;
        color: var(--c-green);
      }
      .hero .big.neutral {
        color: var(--c-text-note);
      }
      .hero .sub {
        font-size: 10px;
        color: var(--c-text-dim2);
        letter-spacing: 0.04em;
      }
      .pill {
        font-size: 11px;
        border-radius: var(--radius-sm);
        padding: 3px 8px;
      }
      .pill.gen {
        color: #9be3c2;
        border: 1px solid var(--c-green-border, #20423a);
      }
      .pill.draw {
        color: #ff9b86;
        border: 1px solid var(--c-red-border, #5c2b22);
      }
      /* Cost chips */
      .cost {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }
      .cost .chip {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 5px 9px;
        background: var(--c-bg);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
      }
      .cost .chip.short {
        border-color: var(--c-amber-border, #5c4a1f);
      }
      .cost .chip .need {
        font-size: 11px;
        color: var(--c-text-note);
      }
      .cost .chip .have {
        font-size: 10px;
        color: var(--c-text-dim2);
      }
      .cost .chip.short .have {
        color: var(--c-amber);
      }
      .caveat {
        font-size: 11px;
        color: var(--c-amber);
      }
      /* Specs strip (muted) */
      .specs {
        font-size: 10.5px;
        color: var(--c-text-dim2);
        line-height: 1.5;
        border-top: 1px solid var(--c-border);
        padding-top: 9px;
      }
      /* Stepper */
      .stepper {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 2px;
      }
      .stepper .box {
        display: flex;
        align-items: center;
      }
      .stepper button {
        font: inherit;
        width: 34px;
        height: 34px;
        background: var(--c-bg);
        color: var(--c-text);
        border: 1px solid var(--c-border-hover);
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .stepper button.minus {
        border-radius: var(--radius-sm) 0 0 var(--radius-sm);
      }
      .stepper button.plus {
        border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
        background: var(--c-green-fill, #123d28);
        color: var(--c-green-text, #d8f5e2);
        border-color: var(--c-green);
      }
      .stepper button:hover:not(:disabled) {
        filter: brightness(1.2);
      }
      .stepper button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .stepper .count {
        width: 52px;
        height: 34px;
        background: var(--c-bg);
        border-top: 1px solid var(--c-border-hover);
        border-bottom: 1px solid var(--c-border-hover);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        font-weight: 600;
        color: var(--c-text);
      }
      .stepper .step-hint {
        font-size: 11px;
        color: var(--c-text-dim2);
      }
      .stepper .step-hint.short {
        color: var(--c-amber);
      }
      .demolish {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border-top: 1px dashed var(--c-border);
        padding-top: 0.6rem;
      }
      .demolish button {
        font: inherit;
        width: 1.9rem;
        height: 1.9rem;
        background: var(--c-bg);
        color: var(--c-text);
        border: 1px solid var(--c-border-hover);
        border-radius: var(--radius-sm);
        cursor: pointer;
      }
      .demolish button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .demolish .q {
        min-width: 2rem;
        text-align: center;
      }
      .demolish .hint {
        font-size: 0.78rem;
        color: var(--c-text-dim2);
      }

      /* ---- Locked (collapsed) ---- */
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
      .locked-head .caret {
        font-size: 13px;
        color: var(--c-violet);
      }
      .locked-head .lh-name {
        font-family: var(--font-head);
        font-weight: 700;
        font-size: 14px;
        letter-spacing: 0.08em;
        color: var(--c-violet-text, #9a93a3);
        text-transform: uppercase;
      }
      .locked-head .lh-count,
      .locked-head .lh-hint {
        font-size: 11px;
        color: var(--c-text-dim2);
      }
      .locked-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        padding: 13px 16px;
        border-top: 1px solid var(--c-border);
      }
      .locked-row .lr-name {
        font-family: var(--font-head);
        font-weight: 600;
        font-size: 13.5px;
        color: var(--c-violet-text, #9a93a3);
      }
      .locked-row .lr-hero {
        font-size: 10.5px;
        color: var(--c-text-dim2);
      }
      .reasons {
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
      }
      .reason {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--c-violet-text2, #b7aec2);
        background: var(--c-violet-fill, #15121c);
        border: 1px solid var(--c-violet-border, #2e2739);
        border-radius: var(--radius-sm);
        padding: 4px 9px;
      }
    `,
  ];

  // ---- queue aggregates (self-contained; no engine change needed) ----
  private queueTotals(): { mats: Record<string, number>; power: number; crew: number; units: number } {
    const mats: Record<string, number> = {};
    let power = 0;
    let crew = 0;
    let units = 0;
    for (const s of this.store.structures()) {
      const q = this.store.queuedCount(s.id);
      if (!q) continue;
      units += q;
      power += (s.energy ?? 0) * q;
      crew += (s.opsCrew ?? 0) * q;
      for (const [r, v] of Object.entries(s.buildMaterials) as [string, number][]) {
        mats[r] = (mats[r] ?? 0) + v * q;
      }
    }
    return { mats, power, crew, units };
  }

  private toggleGroup(group: Group): void {
    const next = new Set(this.collapsedGroups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    this.collapsedGroups = next;
  }

  private hero(s: Structure): { big: string; sub: string; neutral: boolean } {
    const produces = Object.entries(s.produces) as [string, number][];
    if (produces.length) {
      const [r, q] = produces[0];
      return { big: `+${kg(q)} ${r}`, sub: t('mars.outputPerWindow'), neutral: false };
    }
    if (s.energy > 0) return { big: `+${s.energy} kW`, sub: t('mars.avgPower'), neutral: false };
    if (s.housing) return { big: t('mars.housingHero'), sub: t('mars.housingHeroSub'), neutral: true };
    return { big: '—', sub: t('mars.infra'), neutral: true };
  }

  private summaryBar(): TemplateResult {
    const totals = this.queueTotals();
    const stocks = this.store.stocks();
    const matChips = Object.keys(totals.mats).map((r) => {
      const used = totals.mats[r];
      const stock = Math.round(stocks[r as keyof typeof stocks] ?? 0);
      const over = used > stock;
      return html`<div class="mat-chip ${over ? 'over' : used > 0 ? 'used' : ''}">
        <span class="lbl">${r}</span><span class="val">${kg(used)}</span><span class="cap">/ ${kg(stock)}</span>
      </div>`;
    });
    return html`<div class="summary">
      <div style="flex:1 1 420px">
        <div class="sect-label">${t('mars.queuedMaterials')}</div>
        <div class="mat-chips">${matChips.length ? matChips : html`<span class="cap">—</span>`}</div>
      </div>
      <div class="metrics">
        <div class="metric">
          <div class="k">${t('mars.netPower')}</div>
          <div class="v ${totals.power > 0 ? 'gen' : totals.power < 0 ? 'draw' : ''}">
            ${totals.power >= 0 ? '+' : '−'}${kg(Math.abs(totals.power))} <span style="font-size:11px;color:var(--c-text-dim2)">kW</span>
          </div>
        </div>
        <div class="metric"><div class="k">${t('mars.crewReq')}</div><div class="v">${kg(totals.crew)}</div></div>
        <div class="metric"><div class="k">${t('mars.unitsQueued')}</div><div class="v">${totals.units}</div></div>
      </div>
      <div class="actions">
        <button class="clear" @click=${() => this.store.structures().forEach((s) => { while (this.store.queuedCount(s.id) > 0) this.store.removeBuild(s.id); })}>
          ${t('mars.clear')}
        </button>
        <!-- Commit lives in the shared footer; shown here for parity with the design mock. -->
      </div>
    </div>`;
  }

  private lockLineParts(s: Structure): string[] {
    const why = this.store.lockReason(s.id);
    if (!why) return [];
    const parts: string[] = [];
    if (why.missingStructure)
      parts.push(t('mars.needFirst', { v: structName(why.missingStructure, STRUCT_BY_ID[why.missingStructure]?.name ?? why.missingStructure) }));
    if (why.minPopNeeded) parts.push(t('mars.needPop', { v: why.minPopNeeded.toLocaleString('ru-RU') }));
    if (why.missingTech) parts.push(t('mars.needTech', { v: techName(why.missingTech, TECH_BY_ID[why.missingTech]?.name ?? why.missingTech) }));
    return parts;
  }

  private specsLine(s: Structure): string {
    const bits: string[] = [];
    if (s.opsCrew) bits.push(t('mars.crewPerUnit', { v: s.opsCrew }));
    bits.push(t('mars.sparesPerWnd', { v: kg(s.upkeepSpares) }));
    if (s.demolishCrew) bits.push(t('mars.demolish', { crew: s.demolishCrew, pct: ((s.recycleFrac ?? 0) * 100).toFixed(0) }));
    return bits.join(' · ');
  }

  private card(s: Structure): TemplateResult {
    const store = this.store;
    const queued = store.queuedCount(s.id);
    const built = store.builtCount(s.id);
    const stocks = store.stocks();
    const units = Math.max(1, queued);
    const matEntries = Object.entries(s.buildMaterials) as [string, number][];

    // "short" = queue would exceed stock (soft warning — commit enforces feasibility, D-*).
    const short = matEntries.some(([r, q]) => (stocks[r as keyof typeof stocks] ?? 0) < q * units);
    const status = structStatus(store, s, short);
    const h = this.hero(s);

    // power pill only when power isn't the hero
    const heroIsPower = Object.keys(s.produces).length === 0 && s.energy > 0;
    const powerPill = heroIsPower
      ? nothing
      : html`<span class="pill ${s.energy >= 0 ? 'gen' : 'draw'}">${s.energy >= 0 ? '+' : '−'}${Math.abs(s.energy)} kW</span>`;
    const consumPills = (Object.entries(s.consumes) as [string, number][]).map(
      ([r, q]) => html`<span class="pill draw">−${kg(q)} ${r}/${t('mars.perWindowShort')}</span>`,
    );

    return html`<div class="card ${queued ? 'queued' : ''} ${short ? 'short' : ''}">
      <div class="zone-head">
        <span class="name"><span class="dot" style="background:${status.color}"></span>${structName(s.id, s.name)}</span>
        <span class="built">${t('mars.builtCount', { n: built })}</span>
      </div>

      <div class="hero">
        <div>
          <div class="big ${h.neutral ? 'neutral' : ''}">${h.big}</div>
          <div class="sub">${h.sub}</div>
        </div>
        ${powerPill}${consumPills}
      </div>

      <div class="cost">
        ${matEntries.map(([r, q]) => {
          const need = q * units;
          const have = Math.round(stocks[r as keyof typeof stocks] ?? 0);
          const isShort = have < need;
          return html`<div class="chip ${isShort ? 'short' : ''}">
            <span class="need">${r} ${kg(need)}</span><span class="have">${t('mars.have')} ${kg(have)}</span>
          </div>`;
        })}
      </div>

      ${s.energy > 0 && s.stormVulnerable ? html`<div class="caveat">${t('mars.stormVulnerable')}</div>` : nothing}

      <div class="specs">${this.specsLine(s)}${this.industryLineText(s)}</div>

      <div class="stepper">
        <div class="box">
          <button class="minus" ?disabled=${queued === 0} @click=${() => store.removeBuild(s.id)}>−</button>
          <div class="count">${queued}</div>
          <button class="plus" @click=${() => store.addBuild(s.id)}>+</button>
        </div>
        <div class="step-hint ${short ? 'short' : ''}">
          ${short ? t('mars.shortMaterials') : t('mars.readyToBuild')}
        </div>
      </div>

      ${built > 0 ? this.demolishRow(s) : nothing}
    </div>`;
  }

  private industryLineText(s: Structure): string {
    if (this.store.builtCount(s.id) <= 0) return '';
    const mult = this.store.industryMultNow(s.id);
    if (mult === undefined) return '';
    const pct = (mult * 100).toFixed(0);
    const why = s.depletionScale ? t('mars.depletion') : t('mars.rampup');
    return ' · ' + t('mars.industryOutput', { pct, why });
  }

  private demolishRow(s: Structure): TemplateResult {
    const store = this.store;
    const queued = store.queuedDemolishCount(s.id);
    return html`<div class="demolish">
      <button ?disabled=${queued === 0} @click=${() => store.removeDemolish(s.id)}>−</button>
      <span class="q">${queued}</span>
      <button ?disabled=${store.demolishable(s.id) <= 0} @click=${() => store.addDemolish(s.id)}>+</button>
      <span class="hint">${t('mars.demolishLabel')}</span>
    </div>`;
  }

  render() {
    void this.tick;
    const store = this.store;
    if (!store) return nothing;

    const all = store.structures();
    const unlocked = all.filter((s) => store.prereqMet(s.id));
    const locked = all.filter((s) => !store.prereqMet(s.id));

    const groups = GROUP_ORDER.map((g) => ({ g, list: unlocked.filter((s) => groupOf(s) === g) })).filter(
      (x) => x.list.length,
    );

    return html`
      ${this.summaryBar()}

      <div class="legend">
        <span><span class="dot" style="background:var(--c-green)"></span>${t('mars.readyToBuild')}</span>
        <span><span class="dot" style="background:var(--c-amber)"></span>${t('mars.shortMaterials')}</span>
        <span><span class="dot" style="background:var(--c-violet)"></span>${t('mars.locked')}</span>
      </div>

      ${groups.map(
        ({ g, list }) => {
          const collapsed = this.collapsedGroups.has(g);
          return html`<div class="group" data-group=${g}>
            <div class="group-head" @click=${() => this.toggleGroup(g)}>
              <div class="left">
                <span class="caret">${collapsed ? '▸' : '▾'}</span>
                <span class="g-name">${t(GROUP_LABEL_KEYS[g])}</span>
              </div>
              <span class="g-count">${t('mars.typesCount', { n: list.length })}</span>
            </div>
            ${collapsed ? nothing : html`<div class="cards">${list.map((s) => this.card(s))}</div>`}
          </div>`;
        },
      )}

      ${locked.length
        ? html`<div class="locked-box">
            <div class="locked-head" @click=${() => (this.lockedOpen = !this.lockedOpen)}>
              <div class="lh-left">
                <span class="caret">${this.lockedOpen ? '▾' : '▸'}</span>
                <span class="dot" style="background:var(--c-violet)"></span>
                <span class="lh-name">${t('mars.locked')}</span>
                <span class="lh-count">(${locked.length})</span>
              </div>
              <span class="lh-hint">${this.lockedOpen ? t('mars.collapse') : t('mars.showRequirements')}</span>
            </div>
            ${this.lockedOpen
              ? locked.map((s) => {
                  const h = this.hero(s);
                  return html`<div class="locked-row">
                    <div>
                      <div class="lr-name">${structName(s.id, s.name)}</div>
                      <div class="lr-hero">${h.big}${h.sub ? ' · ' + h.sub : ''}</div>
                    </div>
                    <div class="reasons">
                      ${this.lockLineParts(s).map((r) => html`<span class="reason">🔒 ${r}</span>`)}
                    </div>
                  </div>`;
                })
              : nothing}
          </div>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mars-tab': MarsTab;
  }
}
