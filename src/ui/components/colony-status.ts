import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ColonyStatus, ResourceLine, DemographySnapshot } from '../colonyStore';
import { STRUCT_BY_ID, type Stocks, type ColonyReport } from '../../engine';

const ICON: Record<string, string> = {
  food: '🍞', water: '💧', o2: '🫧', n2: '🌫️',
  steel: '🔩', metals: '⚙️', polymers: '🧪', glass: '🪟', spares: '🔧',
  pharma: '💊', chips: '🔌', catalyst: '⚗️', fuel: '⚛️',
  regolith: '🪨', hydrogen: '💠', co2: '💨', // D-089 (P1): local ISRU intermediates
};
const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
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

/** Header dashboard: window/pop/fleet/wear + ALL resource stocks with per-window net & runway. */
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

  static styles = css`
    :host {
      display: block;
    }
    .top {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      align-items: baseline;
      margin-bottom: 0.75rem;
    }
    .pop {
      font-size: 1.6rem;
      font-weight: 700;
    }
    .dim {
      opacity: 0.6;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 0.3rem 1rem;
    }
    .cell {
      font-size: 0.85rem;
      border-bottom: 1px solid #1e1e26;
      padding-bottom: 2px;
    }
    .name {
      opacity: 0.75;
    }
    .stock {
      font-weight: 600;
    }
    .flow {
      font-size: 0.78rem;
    }
    .up {
      color: #5ad17a;
    }
    .down {
      color: #d1b65a;
    }
    .crit {
      color: #d96a6a;
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
      background: #3a3a46;
      border-radius: 2px 2px 0 0;
      min-height: 2px;
      max-width: 22px;
    }
  `;

  private transitLine(): TemplateResult | typeof nothing {
    const t = this.inTransit;
    if (!t) return nothing;
    const parts: string[] = [];
    if (t.colonists > 0) parts.push(`🧑‍🚀 ${t.colonists}`);
    for (const [k, v] of Object.entries(t.stocks)) if ((v ?? 0) > 0) parts.push(`${ICON[k] ?? k} ${kg(v!)}`);
    for (const [id, n] of Object.entries(t.structures)) if ((n ?? 0) > 0) parts.push(`${STRUCT_BY_ID[id]?.icon ?? ''} ${STRUCT_BY_ID[id]?.name ?? id}×${n}`);
    return html`<div class="dim">🚀 в пути (придёт след. окно): ${parts.length ? parts.join(' · ') : 'пусто'}</div>`;
  }

  /** Roadmap-2: a compact 5-bucket age bar chart + the forecast line beneath it. Bar height is
   * proportional to count within THIS render (no external scale) — a glance at shape, not a chart
   * meant for precise reading; exact counts are in each bar's tooltip. */
  private demographyBlock(): TemplateResult | typeof nothing {
    const d = this.demography;
    if (!d || !this.status || this.status.pop <= 0) return nothing;
    const maxCount = Math.max(1, ...d.buckets.map((b) => b.count));
    const showForecast = d.expectedOldAgeDeaths >= 0.5 || d.maturingSoon > 0;
    return html`
      <div class="agebars">
        ${d.buckets.map(
          (b) => html`<div
            class="agebar"
            style="height:${Math.max(2, (b.count / maxCount) * 28)}px"
            title="${b.label} лет: ${b.count}"
          ></div>`,
        )}
      </div>
      ${showForecast
        ? html`<div class="dim">
            ⏳ ~${d.expectedOldAgeDeaths.toFixed(1)} смертей от старости за 3 ок · 🎓 +${d.maturingSoon} в труд
          </div>`
        : nothing}
    `;
  }

  private cell(r: ResourceLine): TemplateResult {
    // colour by trend / urgency: draining + <1 window cover = critical
    const draining = r.net < 0;
    const critical = draining && r.windows < 1;
    const flowCls = !draining ? 'up' : critical ? 'crit' : 'down';
    const cover = Number.isFinite(r.windows) ? ` · ${r.windows.toFixed(1)} ок` : '';
    return html`<div class="cell">
      <span>${ICON[r.kind] ?? ''} <span class="name">${r.kind}</span></span>
      <span class="stock"> ${kg(r.stock)}</span>
      <div class="flow ${flowCls}">${dkg(r.net)}/ок${draining ? cover : ''}</div>
    </div>`;
  }

  /** D-089/D-087 (P1): ISRU intermediates (regolith/hydrogen/co2) are real stocks — buffers give
   * real decisions before a storm/outage — but collapsed OUT of the main life-support grid so the
   * dashboard doesn't grow a row for every industrial resource the tree eventually adds. */
  private industrialStocks(): TemplateResult | typeof nothing {
    const s = this.status;
    const industrial = s?.resources.filter((r) => r.localOnly) ?? [];
    if (industrial.length === 0) return nothing;
    return html`<details style="margin-top:0.4rem">
      <summary class="dim" style="cursor:pointer">⚙️ промышленные стоки (ISRU)</summary>
      <div class="grid" style="margin-top:0.3rem">${industrial.map((r) => this.cell(r))}</div>
    </details>`;
  }

  render() {
    const s = this.status;
    if (!s) return nothing;
    return html`
      <div class="top">
        <div class="pop">👥 ${s.pop.toLocaleString('ru-RU')}</div>
        ${s.pop > 0 ? html`<div class="dim">
          💪 труд ${s.workforce.toLocaleString('ru-RU')}${s.kids > 0 ? ` · 🧒 ${s.kids}` : ''}${s.sick > 0
            ? html` · 🤒 <b style="color:${s.sick <= s.sickBeds ? '#d1b65a' : '#d96a6a'}">${s.sick}</b>` : ''}
          · 🛏 койки ${s.sickBeds}
        </div>` : ''}
        <div class="dim">окно <b>${s.window}</b> · год ~${s.year}</div>
        <div class="dim">
          🛫 classic ${s.pads.classic}${s.refuelStage > 0 ? ` · refuel ${s.pads.refuel} (ст. ${s.refuelStage})` : ''}
        </div>
        <div class="dim">
          🛠 износ
          <b style="color:${s.avgCondition >= 0.8 ? '#5ad17a' : s.avgCondition >= 0.5 ? '#d1b65a' : '#d96a6a'}"
            >${(s.avgCondition * 100).toFixed(0)}%</b>
          · ЗИП
          <b style="color:${s.sparesCoverage >= 1 ? '#5ad17a' : '#d96a6a'}">${(s.sparesCoverage * 100).toFixed(0)}%</b>
          ${this.lastReport && this.lastReport.repairSpentKg > 0 && this.repairInfo && this.repairInfo.upkeep > 0
            ? html`· <b style="color:#5ad17a"
                >🔧 ремонт +${(this.repairInfo.rate * (this.lastReport.repairSpentKg / this.repairInfo.upkeep) * 100).toFixed(1)}%</b
              >`
            : nothing}
          ${s.crewCoverage < 1 ? html`· экипаж
          <b style="color:#d96a6a">${(s.crewCoverage * 100).toFixed(0)}%</b>` : nothing}
        </div>
        ${s.housingCapacity > 0 ? html`<div class="dim">
          🏠 жильё
          <b style="color:${s.pop <= s.housingCapacity * 0.9 ? '#5ad17a' : s.pop <= s.housingCapacity ? '#d1b65a' : '#d96a6a'}"
            >${s.pop.toLocaleString('ru-RU')} / ${s.housingCapacity.toLocaleString('ru-RU')}</b>
          ${s.n2LeakKgPerWindow > 0 ? html`· N₂ −${Math.round(s.n2LeakKgPerWindow).toLocaleString('ru-RU')} кг/окно` : ''}
        </div>` : ''}
        <div class="dim">
          🍞 склад
          <b>${kg(s.resources.find((r) => r.kind === 'food')?.stock ?? 0)} / ${kg(s.foodCapacityTotal)}</b>
          · 💧 склад
          <b>${kg(s.resources.find((r) => r.kind === 'water')?.stock ?? 0)} / ${kg(s.waterCapacityTotal)}</b>
        </div>
        <div class="dim">
          🛡 без завоза
          <b style="color:${s.buffer >= 2 ? '#5ad17a' : s.buffer >= 1 ? '#d1b65a' : '#d96a6a'}"
            >${s.buffer}${s.bufferSaturated ? '+' : ''} ок</b>
        </div>
        <div class="dim">субсидия ${money(s.budget)}/окно</div>
      </div>
      ${this.demographyBlock()}
      ${this.transitLine()}
      <div class="grid">${s.resources.filter((r) => !r.localOnly).map((r) => this.cell(r))}</div>
      ${this.industrialStocks()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'colony-status': ColonyStatusPanel;
  }
}
