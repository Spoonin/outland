import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ColonyStore } from '../colonyStore';
import type { ResourceKind } from '../../engine';

const ICON: Record<string, string> = {
  food: '🍞', water: '💧', o2: '🫧', n2: '🌫️',
  steel: '🔩', metals: '⚙️', polymers: '🧪', glass: '🪟', spares: '🔧',
};
const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const kg = (v: number) => Math.round(v).toLocaleString('en-US') + ' кг';

const TABS = [
  { id: 'logi', label: '🛫 Логистика' },
  { id: 'life', label: '🍞 Жизнеобеспечение' },
  { id: 'mat', label: '🔩 Материалы' },
  { id: 'people', label: '🧑‍🚀 Люди' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const LIFE: ResourceKind[] = ['food', 'water', 'o2', 'n2'];
const MAT: ResourceKind[] = ['steel', 'metals', 'polymers', 'glass', 'spares'];

/** Earth ordering manifest (colony-sim §4): tabs of slider cards + live budget/mass summary. */
@customElement('earth-tab')
export class EarthTab extends LitElement {
  @property({ attribute: false }) store!: ColonyStore;
  @state() private tab: TabId = 'life';
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
    .tabs {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    .tabs button {
      font: inherit;
      background: #1a1a22;
      color: #b8b8c0;
      border: 1px solid #2a2a34;
      border-bottom: none;
      border-radius: 5px 5px 0 0;
      padding: 0.4rem 0.9rem;
      cursor: pointer;
    }
    .tabs button.active {
      background: #24242e;
      color: #fff;
      border-color: #44444f;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 0.6rem;
    }
    .card {
      background: #16161c;
      border: 1px solid #2a2a34;
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
    }
    .card .h {
      display: flex;
      justify-content: space-between;
      font-size: 0.9rem;
      margin-bottom: 0.4rem;
    }
    .card .v {
      font-weight: 600;
    }
    input[type='range'] {
      width: 100%;
    }
    .sub {
      font-size: 0.75rem;
      opacity: 0.5;
    }
    .summary {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      background: #14141a;
      border: 1px solid #2a2a34;
      border-radius: 6px;
      font-size: 0.9rem;
    }
    .summary .line {
      display: flex;
      justify-content: space-between;
    }
    .neg {
      color: #d96a6a;
    }
    .ok {
      color: #5ad17a;
    }
    button.commit {
      font: inherit;
      margin-top: 0.6rem;
      background: #14361f;
      color: #d8f0d8;
      border: 1px solid #5ad17a;
      padding: 0.5rem 1.25rem;
      border-radius: 5px;
      cursor: pointer;
    }
    button.commit:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      border-color: #555;
      color: #999;
    }
  `;

  private resCard(r: ResourceKind, max: number, step: number): TemplateResult {
    const store = this.store;
    const qty = store.resQty(r);
    const spec = store.catalog()[r];
    return html`<div class="card">
      <div class="h">
        <span>${ICON[r] ?? ''} ${r}</span><span class="v">${kg(qty)}</span>
      </div>
      <input
        type="range"
        min="0"
        max=${max}
        step=${step}
        .value=${String(qty)}
        @input=${(e: Event) => store.setRes(r, Number((e.target as HTMLInputElement).value))}
      />
      <div class="sub">${money(spec.earthPerKg)}/кг${spec.perCapita ? ` · потр. ${spec.perCapita}/чел` : ''}${spec.recycle ? ` · η ${(spec.recycle * 100).toFixed(0)}%` : ''}</div>
    </div>`;
  }

  private body(): TemplateResult {
    const store = this.store;
    if (this.tab === 'life') return html`<div class="cards">${LIFE.map((r) => this.resCard(r, 500_000, 5_000))}</div>`;
    if (this.tab === 'mat') return html`<div class="cards">${MAT.map((r) => this.resCard(r, 200_000, 5_000))}</div>`;
    if (this.tab === 'people')
      return html`<div class="cards">
        <div class="card">
          <div class="h"><span>🧑‍🚀 колонисты</span><span class="v">${store.colonists}</span></div>
          <input type="range" min="0" max="500" step="10" .value=${String(store.colonists)}
            @input=${(e: Event) => store.setColonists(Number((e.target as HTMLInputElement).value))} />
          <div class="sub">прибудут через окно (лаг) · вес + вечный шлейф потребления</div>
        </div>
      </div>`;
    // logistics
    return html`<div class="cards">
      <div class="card">
        <div class="h"><span>🛫 строить площадки</span><span class="v">+${store.pads}</span></div>
        <input type="range" min="0" max="10" step="1" .value=${String(store.pads)}
          @input=${(e: Event) => store.setPads(Number((e.target as HTMLInputElement).value))} />
        <div class="sub">+5 пусков/окно за площадку · содержание идёт даже вхолостую</div>
      </div>
    </div>`;
  }

  render() {
    void this.tick;
    const store = this.store;
    if (!store) return nothing;
    return html`
      <div class="tabs">
        ${TABS.map(
          (t) => html`<button class=${this.tab === t.id ? 'active' : ''} @click=${() => (this.tab = t.id)}>${t.label}</button>`,
        )}
      </div>
      ${this.body()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'earth-tab': EarthTab;
  }
}
