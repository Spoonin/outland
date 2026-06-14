import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Snapshot, NodeView } from '../store';
import type { NodeStatus } from '../../engine';

const GLYPH: Record<NodeStatus, string> = {
  local: '🟢',
  buildable: '🟡',
  import: '🔴',
  black: '⚫',
};

/** Hub dashboard (mechanics §8.2): autonomy loud, F dim, node grid. No self-sufficiency (D-025). */
@customElement('dashboard-panel')
export class DashboardPanel extends LitElement {
  @property({ attribute: false }) snapshot!: Snapshot;

  static styles = css`
    :host {
      display: block;
    }
    .top {
      display: flex;
      align-items: baseline;
      gap: 1.5rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    .autonomy {
      font-size: 3rem;
      font-weight: 700;
      color: #5ad17a;
      line-height: 1;
    }
    .autonomy small {
      font-size: 0.85rem;
      font-weight: 400;
      opacity: 0.6;
      display: block;
    }
    .meta {
      opacity: 0.8;
    }
    .dim {
      opacity: 0.45;
      font-size: 0.85rem;
    }
    .erode {
      color: #c98a5a;
      opacity: 0.9;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 0.15rem 0.75rem;
      margin-top: 0.75rem;
    }
    .cell {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 0.85rem;
    }
    .tier {
      opacity: 0.35;
    }
    .legend {
      opacity: 0.4;
      font-size: 0.75rem;
      margin-top: 0.5rem;
    }
    .events {
      color: #d1b65a;
      font-size: 0.85rem;
      min-height: 1.2em;
      margin-top: 0.5rem;
    }
  `;

  render() {
    const s = this.snapshot;
    if (!s) return nothing;
    const pct = (s.autonomy * 100).toFixed(1);
    const money = (v: number) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return html`
      <div class="top">
        <div class="autonomy">${pct}%<small>автономия (по массе)</small></div>
        <div class="meta">
          <div>окно <b>${s.window}</b> · год ~${s.year}</div>
          <div>население <b>${s.pop.toLocaleString('ru-RU')}</b></div>
          <div>термояд: ${s.fusion}</div>
        </div>
        <div class="dim">
          <div>
            субсидия M: ${money(s.M)} · реальная ~${money(s.realM)}
            <span class="erode">(−${s.erosionPct.toFixed(0)}% инфляция ${(s.inflationPct * 100).toFixed(0)}%/окно)</span>
          </div>
          <div>пол импорта F: ${money(s.F)} (F/M ${s.fm.toFixed(2)})</div>
          <div>эфф. $/кг: ${money(s.effPerKg)} · пуск.K: ${s.launchK.toLocaleString('en-US')} кг/окно</div>
        </div>
      </div>

      <div class="events">${s.events.join(' · ') || nothing}</div>

      <div class="grid">
        ${s.nodes.map(
          (n: NodeView) => html`<span class="cell"
            >${GLYPH[n.status]} ${n.name} <span class="tier">T${n.tier}</span></span
          >`,
        )}
      </div>
      <div class="legend">🟢 локализовано · 🟡 можно · 🔴 импорт · ⚫ чёрный (нелокализуемо)</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dashboard-panel': DashboardPanel;
  }
}
