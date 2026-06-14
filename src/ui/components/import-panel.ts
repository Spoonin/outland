import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GameStore } from '../store';

const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

/** Import economics of the focused node (mechanics §8.4): the D-038 price dichotomy made visible. */
@customElement('import-panel')
export class ImportPanel extends LitElement {
  @property({ attribute: false }) store!: GameStore;
  @property() node = '';
  @state() private tick = 0;
  private unsub?: () => void;

  willUpdate(): void {
    if (!this.unsub && this.store) this.unsub = this.store.subscribe(() => (this.tick = this.tick + 1));
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
    this.unsub = undefined;
  }

  static styles = css`
    :host {
      display: block;
      background: #14141a;
      border: 1px solid #2a2a34;
      border-radius: 5px;
      padding: 0.75rem 1rem;
      font-size: 0.85rem;
      margin-bottom: 0.75rem;
    }
    .name {
      font-weight: 600;
      font-size: 1rem;
    }
    .bars {
      margin: 0.5rem 0;
    }
    .bar {
      height: 0.8rem;
      display: flex;
      border-radius: 3px;
      overflow: hidden;
      margin: 0.25rem 0;
    }
    .earth {
      background: #b5683c;
    }
    .ship {
      background: #3c7ab5;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
    }
    .dim {
      opacity: 0.55;
    }
    .tag {
      font-size: 0.7rem;
      padding: 0 0.3rem;
      border-radius: 3px;
      border: 1px solid #555;
    }
  `;

  render() {
    void this.tick;
    const store = this.store;
    const node = store?.nodeOf(this.node);
    if (!store || !node) return nothing;
    const nd = store.needsNow();
    const e = store.econOf(this.node, nd);
    const status = store.statusOf(this.node, nd);
    const earthPct = e.unitPrice > 0 ? (e.unitEarth / e.unitPrice) * 100 : 0;
    const shipPct = 100 - earthPct;
    return html`
      <div class="name">${node.name} <span class="tag">тир ${node.tier}${node.black ? ' · ⚫ чёрный' : ''}</span></div>
      <div class="row dim"><span>спрос</span><span>${Math.round(e.demandUnits).toLocaleString('en-US')} ед./окно</span></div>
      <div class="row"><span>цена за ед.</span><span>${money(e.unitPrice)}</span></div>
      <div class="bars">
        <div class="bar">
          <div class="earth" style="width:${earthPct}%" title="внутренняя"></div>
          <div class="ship" style="width:${shipPct}%" title="доставка"></div>
        </div>
        <div class="row dim">
          <span>🟧 внутр. ${money(e.unitEarth)} (${earthPct.toFixed(0)}%)</span>
          <span>🟦 доставка ${money(e.unitShipping)} (${shipPct.toFixed(0)}%)</span>
        </div>
      </div>
      <div class="row">
        <span>статус: ${status}</span>
        <span>вклад в F: <b>${money(e.fContribution)}</b>/окно</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'import-panel': ImportPanel;
  }
}
