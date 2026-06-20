import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ColonyStatus, ResourceCover } from '../colonyStore';

const ICON: Record<string, string> = { food: '🍞', water: '💧', o2: '🫧' };
const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

/** Header: window/pop/fleet + LIVE life-support sufficiency ("еды на N окон") — the tactile balance. */
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
    .cover {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .res {
      font-size: 0.9rem;
    }
    .bar {
      height: 0.5rem;
      width: 7rem;
      background: #26262e;
      border-radius: 3px;
      overflow: hidden;
      margin-top: 2px;
    }
    .fill {
      height: 100%;
    }
    .ok {
      background: #5ad17a;
    }
    .warn {
      background: #d1b65a;
    }
    .crit {
      background: #d96a6a;
    }
  `;

  private cover(c: ResourceCover) {
    const w = c.windows;
    const cls = w >= 2 ? 'ok' : w >= 1 ? 'warn' : 'crit';
    const pct = Math.max(4, Math.min(100, (w / 3) * 100));
    const label = Number.isFinite(w) ? `${w.toFixed(1)} ок` : '∞';
    return html`<div class="res">
      ${ICON[c.kind] ?? ''} ${c.kind}: <b>${label}</b>
      <div class="bar"><div class="fill ${cls}" style="width:${pct}%"></div></div>
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
          🛫 площадки: classic ${s.pads.classic}${s.refuelUnlocked ? ` · refuel ${s.pads.refuel}` : ''}
        </div>
        <div class="dim">субсидия ${money(s.budget)}/окно</div>
      </div>
      <div class="cover">${s.cover.map((c) => this.cover(c))}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'colony-status': ColonyStatusPanel;
  }
}
