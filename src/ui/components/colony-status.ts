import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ColonyStatus, ResourceLine } from '../colonyStore';

const ICON: Record<string, string> = {
  food: '🍞', water: '💧', o2: '🫧', n2: '🌫️',
  steel: '🔩', metals: '⚙️', polymers: '🧪', glass: '🪟', spares: '🔧',
  pharma: '💊', chips: '🔌', catalyst: '⚗️',
};
const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const kg = (v: number) => Math.round(v).toLocaleString('en-US');
const dkg = (v: number) => (v >= 0 ? '+' : '−') + kg(Math.abs(v));

/** Header dashboard: window/pop/fleet/wear + ALL resource stocks with per-window net & runway. */
@customElement('colony-status')
export class ColonyStatusPanel extends LitElement {
  @property({ attribute: false }) status!: ColonyStatus;

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
  `;

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

  render() {
    const s = this.status;
    if (!s) return nothing;
    return html`
      <div class="top">
        <div class="pop">👥 ${s.pop.toLocaleString('ru-RU')}</div>
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
        </div>
        ${s.housingCapacity > 0 ? html`<div class="dim">
          🏠 жильё
          <b style="color:${s.pop <= s.housingCapacity * 0.9 ? '#5ad17a' : s.pop <= s.housingCapacity ? '#d1b65a' : '#d96a6a'}"
            >${s.pop.toLocaleString('ru-RU')} / ${s.housingCapacity.toLocaleString('ru-RU')}</b>
          ${s.n2LeakKgPerWindow > 0 ? html`· N₂ −${Math.round(s.n2LeakKgPerWindow).toLocaleString('ru-RU')} кг/окно` : ''}
        </div>` : ''}
        <div class="dim">
          🛡 без завоза
          <b style="color:${s.buffer >= 2 ? '#5ad17a' : s.buffer >= 1 ? '#d1b65a' : '#d96a6a'}"
            >${s.buffer}${s.bufferSaturated ? '+' : ''} ок</b>
        </div>
        <div class="dim">субсидия ${money(s.budget)}/окно</div>
      </div>
      <div class="grid">${s.resources.map((r) => this.cell(r))}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'colony-status': ColonyStatusPanel;
  }
}
