import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ColonyStore } from '../colonyStore';
import type { Structure } from '../../engine';

const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const kg = (v: number) => Math.round(v).toLocaleString('en-US');

/** Mars build tab (colony-sim §6): queue structures with prereqs, energy, local production. */
@customElement('mars-tab')
export class MarsTab extends LitElement {
  @property({ attribute: false }) store!: ColonyStore;
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
      border-top: 1px solid #2a2a34;
      margin-top: 1rem;
      padding-top: 1rem;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 0.6rem;
    }
    .card {
      background: #16161c;
      border: 1px solid #2a2a34;
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
    }
    .card.locked {
      opacity: 0.5;
    }
    .h {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.3rem;
    }
    .name {
      font-weight: 600;
    }
    .counts {
      font-size: 0.8rem;
      opacity: 0.7;
    }
    .spec {
      font-size: 0.78rem;
      opacity: 0.65;
      line-height: 1.5;
    }
    .gen {
      color: #5ad17a;
    }
    .draw {
      color: #d1b65a;
    }
    .lock {
      color: #d96a6a;
      font-size: 0.78rem;
    }
    .short {
      color: #d96a6a;
    }
    .ctrl {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.4rem;
    }
    .ctrl button {
      font: inherit;
      width: 1.9rem;
      height: 1.9rem;
      background: #24242e;
      color: #d8d8d8;
      border: 1px solid #3a3a44;
      border-radius: 4px;
      cursor: pointer;
    }
    .ctrl button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .q {
      min-width: 2rem;
      text-align: center;
    }
  `;

  private card(s: Structure): TemplateResult {
    const store = this.store;
    const locked = !store.prereqMet(s.id);
    const queued = store.queuedCount(s.id);
    const built = store.builtCount(s.id);
    const stocks = store.stocks();
    const units = Math.max(1, queued); // материалы нужны на всю очередь
    const prod = Object.entries(s.produces).map(([r, q]) => `${r} +${kg(q)}`).join(', ');
    const cons = Object.entries(s.consumes).map(([r, q]) => `${r} −${kg(q)}/окно`).join(', ');
    const matEntries = Object.entries(s.buildMaterials) as [string, number][];
    return html`<div class="card ${locked ? 'locked' : ''}">
      <div class="h">
        <span class="name">${s.icon} ${s.name}</span>
        <span class="counts">построено ${built}${queued ? ` · +${queued}` : ''}</span>
      </div>
      <div class="spec">
        ${money(s.capex)} за шт.
        ${matEntries.length
          ? html`<br />материалы (на ${units}):
              ${matEntries.map(([r, q]) => {
                const need = q * units;
                const have = Math.round(stocks[r as keyof typeof stocks] ?? 0);
                const short = have < need;
                return html`<span class=${short ? 'short' : ''}>${r} ${kg(need)} (склад ${kg(have)})</span>${' '}`;
              })}`
          : nothing}
        <br />энергия:
        ${s.energy >= 0 ? html`<span class="gen">+${s.energy}</span>` : html`<span class="draw">${s.energy}</span>`}
        ${prod ? html`· выпуск: ${prod}` : nothing} ${cons ? html`· потр.: ${cons}` : nothing}
        · ЗИП ${kg(s.upkeepSpares)}/окно
      </div>
      ${locked ? html`<div class="lock">🔒 нужен сначала: ${s.prereq}</div>` : nothing}
      <div class="ctrl">
        <button ?disabled=${locked || queued === 0} @click=${() => store.removeBuild(s.id)}>−</button>
        <span class="q">${queued}</span>
        <button ?disabled=${locked} @click=${() => store.addBuild(s.id)}>+</button>
      </div>
    </div>`;
  }

  render() {
    void this.tick;
    const store = this.store;
    if (!store) return nothing;
    return html`<div class="cards">${store.structures().map((s) => this.card(s))}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mars-tab': MarsTab;
  }
}
