import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ColonyStatus, ResourceLine, DemographySnapshot } from '../colonyStore';
import { STRUCT_BY_ID, type Stocks, type ColonyReport } from '../../engine';
import { tokens } from '../theme';
import { t } from '../i18n';
import { structName } from '../names';

const kg = (v: number) => Math.round(v).toLocaleString('en-US');

/** Net flow rate — one decimal below 50 kg/wnd keeps small flows self-consistent with the cover
 * number beside them (see original component note); larger flows stay clean whole numbers. */
const dkg = (v: number): string => {
  const abs = Math.abs(v);
  const text =
    abs > 0 && abs < 50
      ? (Math.round(abs * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : kg(abs);
  return (v >= 0 ? '+' : '−') + text;
};

const GREEN = 'var(--c-green)';
const AMBER = 'var(--c-amber)';
const RED = 'var(--c-red)';
const BLUE = 'var(--c-blue, #4a9fd8)';
const DIM = 'var(--c-text-dim2)';

/** Life-support resources get the emphasized treatment (fill bar + sparkline). */
const LIFE_KINDS = new Set(['food', 'water', 'o2', 'n2']);

/** SVG polyline points across a 60×18 box from a short numeric series. */
function spark(series: readonly number[] | undefined): string {
  if (!series || series.length < 2) return '1,9 59,9';
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const n = series.length;
  return series
    .map((v, i) => {
      const x = (i / (n - 1)) * 58 + 1;
      const y = 16 - ((v - min) / span) * 14;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Header dashboard, redesigned per the status-panel brief:
 *  - health percentages (wear/spares/crew/shield/housing) become a row of labeled mini-gauges
 *  - resources split into an emphasized Life Support grid (fill bar + sparkline + runway) and a
 *    compact Stockpile grid; ISRU stays collapsed
 *  - LEDs carry state (green/amber/red by flow health, blue at-cap, dim when inactive)
 *  - cold-start (pop 0) dims empty tiles and shows a single "awaiting first landing" cue. */
@customElement('colony-status')
export class ColonyStatusPanel extends LitElement {
  @property({ attribute: false }) status!: ColonyStatus;
  @property({ attribute: false }) inTransit?: { stocks: Stocks; colonists: number; structures: Record<string, number> };
  @property({ attribute: false }) lastReport?: ColonyReport;
  @property({ attribute: false }) repairInfo?: { rate: number; upkeep: number };
  @property({ attribute: false }) demography?: DemographySnapshot;
  /** NEW: recent stock history per resource kind (last ~8 windows), for the sparklines. Wire this
   * from the same source that feeds the debrief chart (store's `stockSeries`). Only food/water/o2/n2
   * need entries; anything missing renders a flat line. */
  @property({ attribute: false }) series?: Record<string, readonly number[]>;

  @state() private isruOpen = false;

  static styles = [
    tokens,
    css`
      :host {
        display: block;
      }
      .panel {
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 18px;
        margin-bottom: 16px;
      }
      .panel-label {
        font-size: 11px;
        letter-spacing: 0.08em;
        color: var(--c-text-dim);
        text-transform: uppercase;
        font-family: var(--font-head);
        font-weight: 600;
        margin-bottom: 14px;
      }

      /* ---- Top: population + health gauges ---- */
      .top {
        display: flex;
        flex-wrap: wrap;
        gap: 26px;
        align-items: center;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--c-border);
      }
      .pop {
        font-family: var(--font-head);
        font-size: 34px;
        font-weight: 700;
        color: var(--c-text-bright);
        line-height: 1;
      }
      .pop small {
        display: block;
        font-family: var(--font-mono);
        font-size: 9.5px;
        font-weight: 400;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color: var(--c-text-dim);
      }
      .sub {
        font-size: 10.5px;
        color: var(--c-text-dim);
        margin-top: 4px;
      }
      .gauges {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        flex: 1 1 auto;
      }
      .gauge {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 82px;
      }
      .gauge .g-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
      }
      .gauge .g-lbl {
        font-size: 9.5px;
        letter-spacing: 0.05em;
        color: var(--c-text-dim);
        text-transform: uppercase;
      }
      .gauge .g-val {
        font-size: 12px;
        font-weight: 600;
      }
      .gauge .track {
        height: 5px;
        background: var(--c-bg);
        border-radius: 3px;
        overflow: hidden;
      }
      .gauge .fill {
        height: 100%;
        border-radius: 3px;
      }

      .dim {
        color: var(--c-text-dim);
        font-size: 0.85rem;
      }
      .transit {
        font-size: 11.5px;
        color: var(--c-text-dim);
        margin: 12px 0;
      }

      /* ---- Section headers ---- */
      .sect {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin: 16px 0 10px;
      }
      .sect .s-name {
        font-family: var(--font-head);
        font-weight: 700;
        font-size: 12.5px;
        letter-spacing: 0.08em;
        color: var(--c-text-bright);
        text-transform: uppercase;
      }
      .sect .rule {
        flex: 1;
        height: 1px;
        background: var(--c-border);
      }

      /* ---- Life Support tiles (emphasized) ---- */
      .life-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 10px;
      }
      .life {
        padding: 12px;
        background: var(--c-bg);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .life .l-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .life .id {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .life .name {
        font-family: var(--font-head);
        font-weight: 600;
        font-size: 14px;
        color: var(--c-text-bright);
        text-transform: capitalize;
      }
      .life .cover {
        font-size: 10px;
        white-space: nowrap;
      }
      .life .stockrow {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .life .stock {
        font-size: 19px;
        font-weight: 600;
        color: var(--c-text-bright);
        line-height: 1;
      }
      .life .cap {
        font-size: 10px;
        color: var(--c-text-dim2);
      }
      .life .track {
        height: 6px;
        background: var(--c-bg);
        border: 1px solid var(--c-border);
        border-radius: 3px;
        overflow: hidden;
      }
      .life .fill {
        height: 100%;
        border-radius: 3px;
      }
      .life .flowrow {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 8px;
      }
      .flow {
        font-size: 12px;
      }
      .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex: none;
      }

      /* ---- Compact tiles (stockpile / ISRU) ---- */
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 8px;
      }
      .cell {
        padding: 10px;
        background: var(--c-bg);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .cell .id {
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .cell .dot {
        width: 8px;
        height: 8px;
      }
      .cell .name {
        font-family: var(--font-head);
        font-weight: 600;
        font-size: 12.5px;
        color: var(--c-text);
        text-transform: capitalize;
      }
      .cell .stock {
        font-size: 14px;
        font-weight: 600;
        color: var(--c-text-bright);
      }
      .cell .flow {
        font-size: 10.5px;
      }

      .isru-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 16px;
        cursor: pointer;
        font-size: 11.5px;
        color: var(--c-text-dim);
        letter-spacing: 0.04em;
      }

      .coldstart {
        margin-top: 16px;
        padding: 14px 16px;
        background: var(--c-bg);
        border: 1px dashed var(--c-border-hover);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 12.5px;
        color: var(--c-text-note);
      }

      /* demography (carried over) */
      .agebars {
        display: flex;
        align-items: flex-end;
        gap: 3px;
        height: 28px;
        margin: 0.2rem 0;
      }
      .agebar {
        flex: 1;
        background: var(--c-border-hover);
        border-radius: 2px 2px 0 0;
        min-height: 2px;
        max-width: 22px;
      }
    `,
  ];

  // ------- gauges (all data already on StatusView) -------
  private gaugeRow(): TemplateResult | typeof nothing {
    const s = this.status;
    if (s.pop <= 0) return nothing;
    const col = (v: number) => (v >= 0.85 ? GREEN : v >= 0.5 ? AMBER : RED);
    const items: { lbl: string; v: number }[] = [
      { lbl: t('status.wear'), v: s.avgCondition },
      { lbl: t('status.spares'), v: s.sparesCoverage },
      { lbl: t('status.crew'), v: s.crewCoverage },
      { lbl: t('status.radShield'), v: s.shieldCoverage },
    ];
    if (s.housingCapacity > 0) items.push({ lbl: t('status.housing'), v: s.pop / s.housingCapacity });
    return html`<div class="gauges">
      ${items.map(
        (x) => html`<div class="gauge">
          <div class="g-head">
            <span class="g-lbl">${x.lbl}</span>
            <span class="g-val" style="color:${col(x.v)}">${Math.round(x.v * 100)}%</span>
          </div>
          <div class="track"><div class="fill" style="width:${Math.min(100, x.v * 100)}%;background:${col(x.v)}"></div></div>
        </div>`,
      )}
    </div>`;
  }

  // ------- shared flow-state resolution -------
  private resolve(r: ResourceLine, cap: number | null) {
    const cold = this.status.pop <= 0;
    const draining = r.net < 0;
    const growing = r.net > 0;
    const fill = cap ? r.stock / cap : null;
    const atCap = fill != null && fill > 0.95 && growing;
    const critical = draining && r.windows < 4;
    const isDim = cold || (r.net === 0 && r.stock === 0);

    let dot = GREEN;
    let flowColor = GREEN;
    if (isDim) {
      dot = DIM;
      flowColor = DIM;
    } else if (atCap) {
      dot = BLUE;
      flowColor = BLUE;
    } else if (critical) {
      dot = RED;
      flowColor = RED;
    } else if (draining) {
      dot = AMBER;
      flowColor = AMBER;
    }

    const arrow = r.net > 0 ? '▲' : r.net < 0 ? '▼' : '–';
    let cover = '';
    let coverColor = 'var(--c-text-dim)';
    if (!isDim) {
      if (draining && Number.isFinite(r.windows)) {
        const w = r.windows < 10 ? r.windows.toFixed(1) : Math.round(r.windows).toString();
        cover = `≈ ${w} ${t('status.wnd')}`;
        coverColor = critical ? RED : AMBER;
      } else if (atCap) {
        cover = t('status.atCap');
        coverColor = BLUE;
      }
    }
    return { dot, flowColor, arrow, cover, coverColor, isDim, fill, atCap };
  }

  private lifeTile(r: ResourceLine, cap: number | null): TemplateResult {
    const st = this.resolve(r, cap);
    return html`<div class="life" style="opacity:${st.isDim ? 0.5 : 1}">
      <div class="l-head">
        <div class="id">
          <span class="dot" style="background:${st.dot}"></span>
          <span class="name">${r.kind}</span>
        </div>
        ${st.cover ? html`<span class="cover" style="color:${st.coverColor}">${st.cover}</span>` : nothing}
      </div>
      <div class="stockrow">
        <span class="stock">${kg(r.stock)} ${t('status.kg')}</span>
        ${cap ? html`<span class="cap">/ ${kg(cap)}</span>` : nothing}
      </div>
      ${cap && !st.isDim
        ? html`<div class="track">
            <div class="fill" style="width:${Math.min(100, (st.fill ?? 0) * 100)}%;background:${st.atCap ? BLUE : GREEN}"></div>
          </div>`
        : nothing}
      <div class="flowrow">
        <span class="flow" style="color:${st.flowColor}">${st.arrow} ${dkg(r.net)}/${t('status.wnd')}</span>
        <svg width="60" height="18" viewBox="0 0 60 18" style="flex:none">
          <polyline
            points="${st.isDim ? '1,9 59,9' : spark(this.series?.[r.kind])}"
            fill="none"
            stroke="${st.flowColor}"
            stroke-width="1.5"
            stroke-linejoin="round"
            stroke-linecap="round"
          ></polyline>
        </svg>
      </div>
    </div>`;
  }

  private cell(r: ResourceLine): TemplateResult {
    const st = this.resolve(r, null);
    return html`<div class="cell" style="opacity:${st.isDim ? 0.5 : 1}">
      <div class="id">
        <span class="dot" style="background:${st.dot}"></span>
        <span class="name">${r.kind}</span>
      </div>
      <span class="stock">${kg(r.stock)} ${t('status.kg')}</span>
      <span class="flow" style="color:${st.flowColor}"
        >${st.arrow} ${dkg(r.net)}/${t('status.wnd')}${st.cover ? ` · ${st.cover}` : ''}</span
      >
    </div>`;
  }

  private transitLine(): TemplateResult | typeof nothing {
    const inTransit = this.inTransit;
    if (!inTransit) return nothing;
    const parts: string[] = [];
    if (inTransit.colonists > 0) parts.push(`${t('status.pop')} +${inTransit.colonists}`);
    for (const [k, v] of Object.entries(inTransit.stocks)) if ((v ?? 0) > 0) parts.push(`${k} ${kg(v!)}`);
    for (const [id, n] of Object.entries(inTransit.structures))
      if ((n ?? 0) > 0) parts.push(`${structName(id, STRUCT_BY_ID[id]?.name ?? id)}×${n}`);
    return html`<div class="transit">${t('status.transit')} ${parts.length ? parts.join(' · ') : t('status.empty')}</div>`;
  }

  private demographyBlock(): TemplateResult | typeof nothing {
    const d = this.demography;
    if (!d || !this.status || this.status.pop <= 0) return nothing;
    const maxCount = Math.max(1, ...d.buckets.map((b) => b.count));
    const showForecast = d.expectedOldAgeDeaths >= 0.5 || d.maturingSoon > 0;
    const doseColor = d.avgRadiationDose >= 2 ? RED : d.avgRadiationDose >= 1 ? AMBER : GREEN;
    return html`
      <div class="agebars">
        ${d.buckets.map(
          (b) => html`<div class="agebar" style="height:${Math.max(2, (b.count / maxCount) * 28)}px" title="${b.label} ${t('status.years')}: ${b.count}"></div>`,
        )}
      </div>
      ${showForecast ? html`<div class="dim">${t('status.oldAgeForecast', { n: d.expectedOldAgeDeaths.toFixed(1), m: d.maturingSoon })}</div>` : nothing}
      ${d.avgRadiationDose >= 0.1
        ? html`<div class="dim">${t('status.avgDose')}: <b style="color:${doseColor}">${d.avgRadiationDose.toFixed(2)} ${t('status.sv')}</b></div>`
        : nothing}
    `;
  }

  render() {
    const s = this.status;
    if (!s) return nothing;
    const cold = s.pop <= 0;

    const capFor = (kind: string): number | null =>
      kind === 'food' ? s.foodCapacityTotal : kind === 'water' ? s.waterCapacityTotal : null;

    const life = s.resources.filter((r) => LIFE_KINDS.has(r.kind));
    const stockpile = s.resources.filter((r) => !r.localOnly && !LIFE_KINDS.has(r.kind));
    const isru = s.resources.filter((r) => r.localOnly);

    return html`
      <div class="panel">
        <div class="panel-label">${t('status.title')}</div>

        <div class="top">
          <div>
            <div class="pop">${s.pop.toLocaleString('ru-RU')}<small>${t('status.pop')}</small></div>
            ${s.pop > 0
              ? html`<div class="sub">
                  ${t('status.labor')} ${s.workforce.toLocaleString('ru-RU')} · ${t('status.beds')} ${s.sickBeds}
                </div>`
              : nothing}
          </div>
          ${this.gaugeRow()}
        </div>

        ${this.demographyBlock()} ${this.transitLine()}

        ${life.length
          ? html`<div class="sect"><span class="s-name">${t('status.lifeSupport')}</span><span class="rule"></span></div>
              <div class="life-grid">${life.map((r) => this.lifeTile(r, capFor(r.kind)))}</div>`
          : nothing}

        ${stockpile.length
          ? html`<div class="sect"><span class="s-name">${t('status.stockpile')}</span><span class="rule"></span></div>
              <div class="grid">${stockpile.map((r) => this.cell(r))}</div>`
          : nothing}

        ${isru.length
          ? html`<div class="isru-toggle" @click=${() => (this.isruOpen = !this.isruOpen)}>
                <span>${this.isruOpen ? '▾' : '▸'}</span>
                <span>${t('status.industrial')} (${isru.length})</span>
              </div>
              ${this.isruOpen ? html`<div class="grid" style="margin-top:10px">${isru.map((r) => this.cell(r))}</div>` : nothing}`
          : nothing}

        ${cold
          ? html`<div class="coldstart"><span class="dot" style="background:var(--c-text-dim)"></span>${t('status.coldStart')}</div>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'colony-status': ColonyStatusPanel;
  }
}
