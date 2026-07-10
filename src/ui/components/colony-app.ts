import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ColonyStore } from '../colonyStore';
import { updatePending, applyPendingUpdate } from '../pwa';
import { tokens, pulse } from '../theme';
import { i18n, t } from '../i18n';
import './colony-status';
import './chronicle-panel';
import './colony-debrief';
import './earth-tab';
import './mars-tab';
import './settings-menu';

const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const kg = (v: number) => Math.round(v).toLocaleString('en-US');
// Mirrors engine's BUFFER_LOOKAHEAD (colony.ts) — display-only, sizes the buffer donut's arc.
const BUFFER_LOOKAHEAD_UI = 12;

/** v2 root (colony-sim): status + Земля/Марс planning tabs + shared commit footer.
 * Visual system: documents/ui/README.md (mission-control tokens, see ../theme.ts). */
@customElement('colony-app')
export class ColonyApp extends LitElement {
  private store = new ColonyStore();
  private unsub?: () => void;
  private unsubI18n?: () => void;
  @state() private tick = 0;
  @state() private tab: 'earth' | 'mars' = 'earth';

  connectedCallback(): void {
    super.connectedCallback();
    this.unsub = this.store.subscribe(() => (this.tick = this.tick + 1));
    this.unsubI18n = i18n.subscribe(() => (this.tick = this.tick + 1));
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
    this.unsubI18n?.();
  }

  static styles = [
    tokens,
    pulse,
    css`
      :host {
        display: block;
        font-family: var(--font-mono);
        color: var(--c-text);
        background: var(--c-bg);
        min-height: 100vh;
        padding: clamp(14px, 3vw, 32px);
        box-sizing: border-box;
        background-image: radial-gradient(circle at 15% 0%, rgba(47, 214, 138, 0.05), transparent 55%);
      }

      /* ---- header ---- */
      .hdr {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        flex-wrap: wrap;
        gap: 16px;
        border-bottom: 2px solid var(--c-border);
        padding-bottom: 16px;
        margin-bottom: 20px;
      }
      .brand {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .brand .title-row {
        display: flex;
        align-items: baseline;
        gap: 10px;
      }
      .brand .title {
        font-family: var(--font-head);
        font-weight: 700;
        font-size: clamp(20px, 2.6vw, 30px);
        letter-spacing: 0.06em;
        color: var(--c-text-bright);
      }
      .brand .tag {
        font-size: 11px;
        color: var(--c-text-faint);
        letter-spacing: 0.04em;
      }
      .brand .subtitle {
        font-size: 11px;
        letter-spacing: 0.08em;
        color: var(--c-text-dim);
        text-transform: uppercase;
      }
      .brand .feed {
        font-size: 10.5px;
        letter-spacing: 0.05em;
        color: var(--c-text-faint);
        text-transform: uppercase;
      }
      .hdr-right {
        display: flex;
        align-items: center;
        gap: 14px;
        flex-wrap: wrap;
      }
      .readout {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
      }
      .readout .label {
        font-size: 11px;
        color: var(--c-text-dim);
        letter-spacing: 0.08em;
      }
      .readout .value {
        font-size: 18px;
        color: var(--c-text-bright);
        font-weight: 500;
      }
      .chip {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        font-size: 11px;
        letter-spacing: 0.06em;
        color: var(--c-text);
      }
      .chip .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: none;
        background: var(--c-green);
      }
      .chip.danger {
        background: var(--c-alert-bg-strong);
        border-color: var(--c-alert-border);
        color: var(--c-alert-text);
      }
      .chip.danger .dot {
        background: var(--c-red);
      }
      .pulse {
        animation: blinkPulse 2.2s ease-in-out infinite;
      }
      .warn {
        color: var(--c-amber);
        font-size: 12px;
      }

      /* ---- gauge row ---- */
      .gauges {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 16px;
      }
      .gauge {
        flex: 1 1 260px;
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .gauge-label {
        font-size: 11px;
        letter-spacing: 0.08em;
        color: var(--c-text-dim);
        text-transform: uppercase;
        font-family: var(--font-head);
        font-weight: 600;
      }
      .donut-wrap {
        align-items: center;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .donut {
        position: relative;
        width: 140px;
        height: 140px;
      }
      .donut .ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
      }
      .donut .cut {
        position: absolute;
        inset: 12px;
        border-radius: 50%;
        background: var(--c-panel);
      }
      .donut .center {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      .donut .big {
        font-size: 26px;
        font-weight: 600;
        color: var(--c-text-bright);
      }
      .donut .sub {
        font-size: 9px;
        color: var(--c-text-dim2);
        letter-spacing: 0.05em;
      }
      .bar-row {
        display: flex;
        justify-content: space-between;
        font-size: 20px;
        color: var(--c-text-bright);
      }
      .bar-row small {
        font-size: 11px;
        color: var(--c-text-dim2);
      }
      .bar-track {
        height: 14px;
        background: var(--c-track);
        border-radius: 2px;
        overflow: hidden;
        border: 1px solid var(--c-border);
      }
      .bar-fill {
        height: 100%;
      }
      .bar-status {
        font-size: 12px;
      }
      .bar-note {
        font-size: 12px;
        color: var(--c-text-dim2);
      }
      .bar-note b {
        color: var(--c-text);
      }

      /* ---- budget ledger ---- */
      .ledger {
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 16px;
        margin-bottom: 16px;
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        justify-content: space-between;
      }
      .ledger .main {
        flex: 2 1 320px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ledger .spend-track {
        position: relative;
        height: 16px;
        background: var(--c-track);
        border-radius: 2px;
        border: 1px solid var(--c-border);
        overflow: hidden;
      }
      .ledger .spend-fill {
        height: 100%;
      }
      .ledger .readouts {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: var(--c-text-dim);
        flex-wrap: wrap;
        gap: 8px;
      }
      .ledger .side {
        flex: 1 1 220px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 12px;
        color: var(--c-text-dim);
      }
      .ledger .side b {
        color: var(--c-text);
      }
      .ledger .notes {
        flex-basis: 100%;
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 2px;
        font-size: 12px;
      }

      /* ---- alert chips ---- */
      .alerts {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 16px;
      }
      .alert-chip {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: var(--c-alert-bg);
        border: 1px solid var(--c-alert-border);
        border-radius: var(--radius-sm);
        font-size: 12px;
        color: var(--c-alert-text);
        animation: blinkPulse 2.2s ease-in-out infinite;
      }
      .alert-chip .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--c-red);
        flex: none;
      }

      /* ---- tabs ---- */
      .toptabs {
        display: flex;
        gap: 0.25rem;
        margin: 0 0 16px;
      }
      .toptabs button {
        font: inherit;
        font-family: var(--font-head);
        font-weight: 600;
        font-size: 0.8rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        background: var(--c-panel);
        color: var(--c-text-dim);
        border: 1px solid var(--c-border);
        border-bottom: none;
        border-radius: var(--radius-sm) var(--radius-sm) 0 0;
        padding: 0.55rem 1.25rem;
        cursor: pointer;
      }
      .toptabs button.active {
        background: var(--c-panel-hover);
        color: var(--c-text-bright);
        border-color: var(--c-green);
      }

      /* ---- footer bar ---- */
      .footer-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 14px;
        border-top: 2px solid var(--c-border);
        padding-top: 16px;
        margin-top: 16px;
      }
      .footer-note {
        font-size: 11px;
        color: var(--c-text-dim2);
        letter-spacing: 0.04em;
      }
      .footer-actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      button.reset {
        font: inherit;
        font-family: var(--font-mono);
        background: var(--c-panel);
        color: var(--c-text);
        border: 1px solid var(--c-border-hover);
        padding: 10px 18px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        letter-spacing: 0.05em;
        font-size: 12px;
      }
      button.reset:hover {
        background: var(--c-panel-hover);
      }
      button.commit {
        font: inherit;
        font-family: var(--font-mono);
        background: var(--c-commit-bg);
        color: var(--c-commit-text);
        border: 1px solid var(--c-commit-border);
        padding: 10px 22px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        letter-spacing: 0.05em;
        font-size: 12px;
        font-weight: 600;
      }
      button.commit:hover:not(:disabled) {
        background: var(--c-commit-bg-hover);
      }
      button.commit:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        border-color: #555;
        color: #999;
      }

      .collapsed-note {
        color: var(--c-amber);
        margin: 0 0 1rem;
        font-size: 0.9rem;
      }
    `,
  ];

  /** roadmap-1 C1: some of the missing materials are already in transit — they just haven't
   * LANDED yet (arrivals land at commit, but a build queued the SAME window still checks against
   * stock-on-hand as of the start of it — so it always needs one more window after landing). */
  private materialsInTransitHint(materialsShort: readonly string[]) {
    const inTransit = this.store.inTransit().stocks;
    const arriving = materialsShort.filter((r) => (inTransit[r as keyof typeof inTransit] ?? 0) > 0);
    if (!arriving.length) return nothing;
    return html`<div class="warn">${t('app.materialsInTransit', { list: arriving.join(', ') })}</div>`;
  }

  /** roadmap-1 C3/C4: an empty-looking manifest that auto-spares/auto-pharma will still ship —
   * the player needs to know BEFORE committing that this window won't count toward zero_import
   * (D-064 finale-boss requires two truly empty windows in a row). */
  private zeroImportAutoHint() {
    const blocked = this.store.zeroImportBlockedByAuto();
    if (!blocked) return nothing;
    const who = [blocked.spares ? t('app.autoSparesWord') : null, blocked.pharma ? t('app.autoPharmaWord') : null]
      .filter(Boolean)
      .join(` ${t('app.and')} `);
    return html`<div class="warn">${t('app.autoWho', { who })}</div>`;
  }

  private header() {
    const st = this.store.status();
    const alertCount = this.criticalAlerts(this.store.plan(), st).length;
    return html`<div class="hdr">
      <div class="brand">
        <div class="title-row">
          <span class="title">OUTLAND</span>
          <span class="tag">${t('app.tag')}</span>
        </div>
        <div class="subtitle">${t('app.subtitle')}</div>
        <div class="feed">${t('app.callsign')}</div>
      </div>
      <div class="hdr-right">
        <div class="readout">
          <span class="label">${t('app.window')}</span>
          <span class="value">${t('app.windowYear', { window: st.window, year: st.year })}</span>
        </div>
        ${st.collapsed
          ? html`<div class="chip danger"><span class="dot"></span>${t('app.collapsedChip')}</div>`
          : st.ended
            ? html`<div class="chip"><span class="dot" style="background:var(--c-amber)"></span>${t('app.debriefChip')}</div>`
            : html`<div class="chip"><span class="dot"></span>${t('app.uplinkChip')}</div>`}
        ${!st.ended && alertCount > 0
          ? html`<div class="chip danger pulse">
              <span class="dot"></span>${t(alertCount === 1 ? 'app.alertOne' : 'app.alertMany', { n: alertCount })}
            </div>`
          : nothing}
        <settings-menu></settings-menu>
      </div>
    </div>`;
  }

  private donut(pct: number, color: string, big: string, sub: string) {
    return html`<div class="donut-wrap">
      <div class="donut">
        <div class="ring" style="background:conic-gradient(${color} ${pct}%, var(--c-track) 0)"></div>
        <div class="cut"></div>
        <div class="center">
          <div class="big">${big}</div>
          <div class="sub">${sub}</div>
        </div>
      </div>
    </div>`;
  }

  private gauges() {
    const st = this.store.status();
    const plan = this.store.plan();
    const eShort = st.energyDeficit > 0;
    const ePct = st.energyDemand > 0 ? Math.min(100, (st.energyGen / st.energyDemand) * 100) : 100;
    const eColor = eShort ? 'var(--c-red)' : 'var(--c-green)';
    const massPct = plan.earth.throughput > 0 ? Math.min(100, (plan.earth.mass / plan.earth.throughput) * 100) : 0;
    const massColor = plan.earth.capped ? 'var(--c-red)' : 'var(--c-green)';
    const bufPct = Math.min(100, (st.buffer / BUFFER_LOOKAHEAD_UI) * 100);
    const bufColor = st.buffer >= 2 ? 'var(--c-green)' : st.buffer >= 1 ? 'var(--c-amber)' : 'var(--c-red)';

    return html`<div class="gauges">
      <div class="gauge">
        <div class="gauge-label">${t('app.gaugeBuffer')}</div>
        ${this.donut(bufPct, bufColor, `${st.buffer}${st.bufferSaturated ? '+' : ''} ${t('app.wndUnit')}`, `POP ${st.pop}`)}
      </div>

      <div class="gauge">
        <div class="gauge-label">${t('app.gaugeEnergy')}</div>
        <div class="bar-row">
          <span>${kg(st.energyGen)} <small>${t('app.kwGen')}</small></span>
          <span>${kg(st.energyDemand)} <small>${t('app.kwDem')}</small></span>
        </div>
        <div class="bar-track"><div class="bar-fill ${eShort ? 'pulse' : ''}" style="width:${ePct}%;background:${eColor}"></div></div>
        <div class="bar-status" style="color:${eColor}">
          ${eShort ? t('app.deficit', { v: kg(st.energyDeficit) }) : t('app.surplus', { v: kg(st.energyGen - st.energyDemand) })}
        </div>
      </div>

      <div class="gauge">
        <div class="gauge-label">${t('app.gaugeThroughput')}</div>
        <div class="bar-row">
          <span>${kg(plan.earth.mass)} <small>${t('app.kgCargo')}</small></span>
          <span>${kg(plan.earth.throughput)} <small>${t('app.kgLimit')}</small></span>
        </div>
        <div class="bar-track"><div class="bar-fill ${plan.earth.capped ? 'pulse' : ''}" style="width:${massPct}%;background:${massColor}"></div></div>
        <div class="bar-note">${t('app.effPerKg')}: <b>${money(plan.earth.effPerKg)}</b></div>
      </div>
    </div>`;
  }

  private ledger() {
    const plan = this.store.plan();
    const spendScale = plan.budget * 1.3 || 1;
    const spendPct = Math.min(100, (plan.totalCost / spendScale) * 100);
    const spendColor = plan.overBudget ? 'var(--c-red)' : 'var(--c-green)';
    return html`<div class="ledger">
      <div class="main">
        <div class="gauge-label">${t('app.ledgerTitle')}</div>
        <div class="spend-track"><div class="spend-fill" style="width:${spendPct}%;background:${spendColor}"></div></div>
        <div class="readouts">
          <span>${t('app.plan')}: <b style="color:${spendColor}">${money(plan.totalCost)}</b></span>
          <span>${t('app.windowSubsidy')}: ${money(plan.budget)}</span>
          ${plan.earth.padScrapCost > 0 ? html`<span>${t('app.padScrap')}: ${money(plan.earth.padScrapCost)}</span>` : nothing}
        </div>
        ${plan.materialsShort.length || plan.prereqMissing.length
          ? html`<div class="notes">
              ${plan.materialsShort.length
                ? html`<div class="warn">${t('app.materialsShort', { list: plan.materialsShort.join(', ') })}</div>`
                : nothing}
              ${plan.prereqMissing.length
                ? html`<div class="warn">${t('app.prereqMissing', { list: plan.prereqMissing.join(', ') })}</div>`
                : nothing}
              ${plan.materialsShort.length ? this.materialsInTransitHint(plan.materialsShort) : nothing}
            </div>`
          : nothing}
      </div>
      <div class="side">
        <div>${t('app.cargoMass')}: <b>${kg(plan.earth.mass)}</b> / ${kg(plan.earth.throughput)} ${t('status.kg')}</div>
        <div>${t('app.totalCost')}: <b>${money(plan.totalCost)}</b></div>
        ${this.store.inTransit().colonists > 0 && plan.bootstrapBlocked
          ? html`<div class="warn">${t('app.bootstrapInTransit')}</div>`
          : nothing}
        ${plan.feasible ? this.store.projectionWarnings().map((w) => html`<div class="warn">${w}</div>`) : nothing}
        ${plan.feasible ? this.zeroImportAutoHint() : nothing}
      </div>
    </div>`;
  }

  private criticalAlerts(plan: ReturnType<ColonyStore['plan']>, st: ReturnType<ColonyStore['status']>): string[] {
    const alerts: string[] = [];
    if (st.energyDeficit > 0) alerts.push(t('app.brownout', { v: kg(st.energyDeficit) }));
    if (plan.earth.capped) alerts.push(t('app.massCapped'));
    if (plan.overBudget) alerts.push(t('app.overBudget'));
    if (plan.rndBlocked) alerts.push(t('app.rndBlocked'));
    if (plan.bootstrapBlocked) alerts.push(t('app.bootstrapBlocked'));
    return alerts;
  }

  private alertChips() {
    const st = this.store.status();
    if (st.ended) return nothing;
    const alerts = this.criticalAlerts(this.store.plan(), st);
    if (!alerts.length) return nothing;
    return html`<div class="alerts">
      ${alerts.map((a) => html`<div class="alert-chip"><span class="dot"></span><span>${a}</span></div>`)}
    </div>`;
  }

  /** "Новая партия" is the one safe boundary to swap app versions: reset writes a fresh save,
   * THEN (if a service-worker update finished downloading in the background) we activate it and
   * reload — the reload picks up the save just written, so the new game continues seamlessly on
   * the updated build instead of silently swapping assets under a game already in progress. */
  private startNewGame(): void {
    this.store.reset();
    if (updatePending()) applyPendingUpdate();
  }

  render() {
    void this.tick;
    const st = this.store.status();
    return html`
      ${this.header()}
      ${!st.ended ? this.gauges() : nothing}
      <colony-status
        .status=${st}
        .inTransit=${this.store.inTransit()}
        .lastReport=${this.store.lastReport()}
        .repairInfo=${this.store.repairInfo()}
        .demography=${this.store.demography()}
      ></colony-status>
      ${st.ended
        ? html`${st.collapsed ? html`<div class="collapsed-note">${t('app.collapsedNote')}</div>` : nothing}
            <colony-debrief .debrief=${this.store.debrief()}></colony-debrief>
            <div class="footer-bar">
              <span class="footer-note">${t('app.callsign')}</span>
              <div class="footer-actions">
                ${!st.collapsed
                  ? html`<button class="reset" @click=${() => this.store.resume()}>${t('app.returnToColony')}</button>`
                  : nothing}
                <button class="reset" @click=${() => this.startNewGame()}>${t('app.newGame')}</button>
              </div>
            </div>`
        : html`
            ${this.ledger()}
            ${this.alertChips()}
            <chronicle-panel .store=${this.store}></chronicle-panel>
            <div class="toptabs">
              <button class=${this.tab === 'earth' ? 'active' : ''} @click=${() => (this.tab = 'earth')}>${t('app.tabEarth')}</button>
              <button class=${this.tab === 'mars' ? 'active' : ''} @click=${() => (this.tab = 'mars')}>${t('app.tabMars')}</button>
            </div>
            ${this.tab === 'earth'
              ? html`<earth-tab .store=${this.store}></earth-tab>`
              : html`<mars-tab .store=${this.store}></mars-tab>`}
            <div class="footer-bar">
              <span class="footer-note">${t('app.footerNote')}</span>
              <div class="footer-actions">
                <button class="reset" @click=${() => this.store.finish()}>${t('app.finish')}</button>
                <button class="commit" ?disabled=${!this.store.plan().feasible || st.ended} @click=${() => this.store.commit()}>
                  ${t('app.commit')}
                </button>
              </div>
            </div>
          `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'colony-app': ColonyApp;
  }
}
