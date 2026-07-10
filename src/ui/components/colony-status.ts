import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ColonyStatus, ResourceLine, DemographySnapshot } from '../colonyStore';
import { STRUCT_BY_ID, type Stocks, type ColonyReport } from '../../engine';
import { tokens } from '../theme';
import { t } from '../i18n';
import { structName } from '../names';

const kg = (v: number) => Math.round(v).toLocaleString('en-US');
/** Net flow rate — rounding a SMALL rate (e.g. n2 leak barely offset by production, ~1.6 kg/ок)
 * to the nearest whole kg used to read as "−2/ок" next to a "28125.7 ок" cover computed from the
 * real ~1.6 — technically consistent (both derive from the same unrounded net) but visibly not,
 * since 45001/2 ≠ 45001/1.6. One decimal below 50 kg/ок keeps small flows self-consistent with
 * the cover number beside them; larger flows stay clean whole numbers. */
const dkg = (v: number): string => {
  const abs = Math.abs(v);
  const text =
    abs > 0 && abs < 50
      ? (Math.round(abs * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : kg(abs);
  return (v >= 0 ? '+' : '−') + text;
};

/** Header dashboard: pop/fleet/wear + ALL resource stocks with per-window net & runway, styled as
 * a mission-console systems panel (documents/ui/README.md) — each resource is a status tile with
 * an LED coloured by flow health, echoing the design's Colony Systems grid. Window/year/buffer/
 * budget live in colony-app's header + gauge row now, so this panel doesn't repeat them. */
@customElement('colony-status')
export class ColonyStatusPanel extends LitElement {
  @property({ attribute: false }) status!: ColonyStatus;
  /** What's already shipped, landing NEXT window (playtest bug: this was invisible before). */
  @property({ attribute: false }) inTransit?: { stocks: Stocks; colonists: number; structures: Record<string, number> };
  /** D-084: last window's report, to note when spares surplus actually repaired condition. */
  @property({ attribute: false }) lastReport?: ColonyReport;
  /** D-084: repairRate + upkeep as of NOW — used only to turn lastReport.repairSpentKg into the
   * displayed percentage; an approximation if the fleet changed since (informational only). */
  @property({ attribute: false }) repairInfo?: { rate: number; upkeep: number };
  /** Roadmap-2: age structure + forecasts (buckets, expected old-age deaths, kids maturing soon). */
  @property({ attribute: false }) demography?: DemographySnapshot;

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
        padding: 16px;
        margin-bottom: 16px;
      }
      .panel-label {
        font-size: 11px;
        letter-spacing: 0.08em;
        color: var(--c-text-dim);
        text-transform: uppercase;
        font-family: var(--font-head);
        font-weight: 600;
        margin-bottom: 12px;
      }
      .top {
        display: flex;
        gap: 1.5rem;
        flex-wrap: wrap;
        align-items: baseline;
        margin-bottom: 0.75rem;
      }
      .pop {
        font-family: var(--font-head);
        font-size: 1.6rem;
        font-weight: 700;
        color: var(--c-text-bright);
      }
      .pop small {
        font-family: var(--font-mono);
        font-size: 0.7rem;
        font-weight: 400;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--c-text-dim);
      }
      .dim {
        color: var(--c-text-dim);
        font-size: 0.85rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
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
      .cell .row1 {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .cell .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: none;
      }
      .cell .name {
        font-family: var(--font-head);
        font-weight: 600;
        font-size: 12.5px;
        color: var(--c-text);
        text-transform: capitalize;
      }
      .cell .stock {
        font-weight: 600;
        font-size: 13px;
        color: var(--c-text-bright);
      }
      .cell .flow {
        font-size: 11px;
      }
      .up {
        color: var(--c-green);
      }
      .down {
        color: var(--c-amber);
      }
      .crit {
        color: var(--c-red);
      }
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
      details summary {
        list-style: none;
      }
      details summary::-webkit-details-marker {
        display: none;
      }
    `,
  ];

  private transitLine(): TemplateResult | typeof nothing {
    const inTransit = this.inTransit;
    if (!inTransit) return nothing;
    const parts: string[] = [];
    if (inTransit.colonists > 0) parts.push(`${t('status.pop')} +${inTransit.colonists}`);
    for (const [k, v] of Object.entries(inTransit.stocks)) if ((v ?? 0) > 0) parts.push(`${k} ${kg(v!)}`);
    for (const [id, n] of Object.entries(inTransit.structures))
      if ((n ?? 0) > 0) parts.push(`${structName(id, STRUCT_BY_ID[id]?.name ?? id)}×${n}`);
    return html`<div class="dim">${t('status.transit')} ${parts.length ? parts.join(' · ') : t('status.empty')}</div>`;
  }

  /** Roadmap-2: a compact 5-bucket age bar chart + the forecast line beneath it. Bar height is
   * proportional to count within THIS render (no external scale) — a glance at shape, not a chart
   * meant for precise reading; exact counts are in each bar's tooltip. */
  private demographyBlock(): TemplateResult | typeof nothing {
    const d = this.demography;
    if (!d || !this.status || this.status.pop <= 0) return nothing;
    const maxCount = Math.max(1, ...d.buckets.map((b) => b.count));
    const showForecast = d.expectedOldAgeDeaths >= 0.5 || d.maturingSoon > 0;
    // D-097 #2: dose is a fact about the past (like avgAge), never a per-colonist telegraph (D-063)
    const doseColor = d.avgRadiationDose >= 2 ? 'var(--c-red)' : d.avgRadiationDose >= 1 ? 'var(--c-amber)' : 'var(--c-green)';
    return html`
      <div class="agebars">
        ${d.buckets.map(
          (b) => html`<div
            class="agebar"
            style="height:${Math.max(2, (b.count / maxCount) * 28)}px"
            title="${b.label} ${t('status.years')}: ${b.count}"
          ></div>`,
        )}
      </div>
      ${showForecast
        ? html`<div class="dim">${t('status.oldAgeForecast', { n: d.expectedOldAgeDeaths.toFixed(1), m: d.maturingSoon })}</div>`
        : nothing}
      ${d.avgRadiationDose >= 0.1
        ? html`<div class="dim">
            ${t('status.avgDose')}: <b style="color:${doseColor}">${d.avgRadiationDose.toFixed(2)} ${t('status.sv')}</b>
          </div>`
        : nothing}
    `;
  }

  private cell(r: ResourceLine): TemplateResult {
    // colour by trend / urgency: draining + <1 window cover = critical
    const draining = r.net < 0;
    const critical = draining && r.windows < 1;
    const flowCls = !draining ? 'up' : critical ? 'crit' : 'down';
    const dotColor = !draining ? 'var(--c-green)' : critical ? 'var(--c-red)' : 'var(--c-amber)';
    const cover = Number.isFinite(r.windows) ? ` · ${r.windows.toFixed(1)} ${t('status.wnd')}` : '';
    return html`<div class="cell">
      <div class="row1">
        <span class="dot" style="background:${dotColor}"></span>
        <span class="name">${r.kind}</span>
      </div>
      <span class="stock">${kg(r.stock)} ${t('status.kg')}</span>
      <div class="flow ${flowCls}">${dkg(r.net)}/${t('status.wnd')}${draining ? cover : ''}</div>
    </div>`;
  }

  /** D-089/D-087 (P1): ISRU intermediates (regolith/hydrogen/co2) are real stocks — buffers give
   * real decisions before a storm/outage — but collapsed OUT of the main life-support grid so the
   * dashboard doesn't grow a row for every industrial resource the tree eventually adds. */
  private industrialStocks(): TemplateResult | typeof nothing {
    const s = this.status;
    const industrial = s?.resources.filter((r) => r.localOnly) ?? [];
    if (industrial.length === 0) return nothing;
    return html`<details style="margin-top:0.6rem">
      <summary class="dim" style="cursor:pointer">${t('status.industrial')}</summary>
      <div class="grid" style="margin-top:0.5rem">${industrial.map((r) => this.cell(r))}</div>
    </details>`;
  }

  render() {
    const s = this.status;
    if (!s) return nothing;
    return html`
      <div class="panel">
        <div class="panel-label">${t('status.title')}</div>
        <div class="top">
          <div class="pop">${s.pop.toLocaleString('ru-RU')} <small>${t('status.pop')}</small></div>
          ${s.pop > 0 ? html`<div class="dim">
            ${t('status.labor')} ${s.workforce.toLocaleString('ru-RU')}${s.kids > 0 ? ` · ${t('status.kids')} ${s.kids}` : ''}${s.sick > 0
              ? html` · ${t('status.sick')} <b style="color:${s.sick <= s.sickBeds ? 'var(--c-amber)' : 'var(--c-red)'}">${s.sick}</b>` : ''}
            · ${t('status.beds')} ${s.sickBeds}
          </div>` : ''}
          <div class="dim">
            ${t('status.pads')} classic ${s.pads.classic}${s.refuelStage > 0 ? ` · refuel ${s.pads.refuel} (${t('status.stage')} ${s.refuelStage})` : ''}
          </div>
          <div class="dim">
            ${t('status.wear')}
            <b style="color:${s.avgCondition >= 0.8 ? 'var(--c-green)' : s.avgCondition >= 0.5 ? 'var(--c-amber)' : 'var(--c-red)'}"
              >${(s.avgCondition * 100).toFixed(0)}%</b
            >
            · ${t('status.spares')}
            <b style="color:${s.sparesCoverage >= 1 ? 'var(--c-green)' : 'var(--c-red)'}">${(s.sparesCoverage * 100).toFixed(0)}%</b>
            ${this.lastReport && this.lastReport.repairSpentKg > 0 && this.repairInfo && this.repairInfo.upkeep > 0
              ? html`· <b style="color:var(--c-green)"
                  >${t('status.repair')} +${(this.repairInfo.rate * (this.lastReport.repairSpentKg / this.repairInfo.upkeep) * 100).toFixed(1)}%</b
                >`
              : nothing}
            ${s.crewCoverage < 1 ? html`· ${t('status.crew')}
            <b style="color:var(--c-red)">${(s.crewCoverage * 100).toFixed(0)}%</b>` : nothing}
            ${s.shieldCoverage < 1 ? html`· ${t('status.radShield')}
            <b style="color:var(--c-red)">${(s.shieldCoverage * 100).toFixed(0)}%</b>` : nothing}
          </div>
          ${s.housingCapacity > 0 ? html`<div class="dim">
            ${t('status.housing')}
            <b style="color:${s.pop <= s.housingCapacity * 0.9 ? 'var(--c-green)' : s.pop <= s.housingCapacity ? 'var(--c-amber)' : 'var(--c-red)'}"
              >${s.pop.toLocaleString('ru-RU')} / ${s.housingCapacity.toLocaleString('ru-RU')}</b
            >
            ${s.n2LeakKgPerWindow > 0 ? html`· N₂ −${Math.round(s.n2LeakKgPerWindow).toLocaleString('ru-RU')} ${t('status.kgPerWnd')}` : ''}
          </div>` : ''}
          <div class="dim">
            food ${t('status.stock')}
            <b style="color:var(--c-text)">${kg(s.resources.find((r) => r.kind === 'food')?.stock ?? 0)} / ${kg(s.foodCapacityTotal)}</b>
            · water ${t('status.stock')}
            <b style="color:var(--c-text)">${kg(s.resources.find((r) => r.kind === 'water')?.stock ?? 0)} / ${kg(s.waterCapacityTotal)}</b>
          </div>
        </div>
        ${this.demographyBlock()}
        ${this.transitLine()}
        <div class="grid" style="margin-top:0.75rem">${s.resources.filter((r) => !r.localOnly).map((r) => this.cell(r))}</div>
        ${this.industrialStocks()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'colony-status': ColonyStatusPanel;
  }
}
