import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ColonyStore } from '../colonyStore';
import type { ResourceKind } from '../../engine';

const ICON: Record<string, string> = {
  food: '🍞', water: '💧', o2: '🫧', n2: '🌫️',
  steel: '🔩', metals: '⚙️', polymers: '🧪', glass: '🪟', spares: '🔧',
  pharma: '💊', chips: '🔌', catalyst: '⚗️',
};
const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const kg = (v: number) => Math.round(v).toLocaleString('en-US') + ' кг';

const TABS = [
  { id: 'logi', label: '🛫 Логистика' },
  { id: 'life', label: '🍞 Жизнеобеспечение' },
  { id: 'mat', label: '🔩 Материалы' },
  { id: 'tech', label: '🔬 Хайтек' },
  { id: 'people', label: '🧑‍🚀 Люди' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const LIFE: ResourceKind[] = ['food', 'water', 'o2', 'n2'];
const MAT: ResourceKind[] = ['steel', 'metals', 'polymers', 'glass', 'spares'];
const TECH: ResourceKind[] = ['pharma', 'chips', 'catalyst'];

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
    if (this.tab === 'tech')
      return html`
        <div class="sub" style="margin-bottom:.5rem">
          ⚠ нелокализуемо при колониальном масштабе (D-045) — только завоз. Лёгкое, но дорогое:
          вечный «земной leg» снабжения. Заводы (полимеры/медблок/RnD) тянут это каждое окно.
        </div>
        <div class="cards">${TECH.map((r) => this.resCard(r, 50_000, 500))}</div>
      `;
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
    return this.logistics();
  }

  private padCard(tech: 'classic' | 'refuel', title: string, sub: string): TemplateResult {
    const store = this.store;
    const lp = store.launch();
    const spec = tech === 'refuel' ? lp.refuel : lp.classic;
    const built = store.fleet().pads[tech];
    return html`<div class="card">
      <div class="h"><span>${title}</span><span class="v">есть ${built} · +${store.padQty(tech)}</span></div>
      <input type="range" min="0" max="10" step="1" .value=${String(store.padQty(tech))}
        @input=${(e: Event) => store.setPad(tech, Number((e.target as HTMLInputElement).value))} />
      <div class="sub">
        ${money(spec.padCapex)}/площадка · содержание ${(spec.padMaintFrac * 100).toFixed(0)}%/окно ·
        payload ${kg(spec.payload)} кг · риск взрыва ${(spec.explodeProb * 100).toFixed(2)}%/пуск. ${sub}
      </div>
    </div>`;
  }

  private logistics(): TemplateResult {
    const store = this.store;
    const lp = store.launch();
    const unlocked = store.fleet().refuelUnlocked;
    return html`<div class="cards">
      ${this.padCard('classic', '🛫 Классические (одноразовые)', 'дёшево, малый груз, рискованнее')}
      ${unlocked
        ? this.padCard('refuel', '🚀 Орбитальная заправка', 'большой груз, дёшево/кг, безопаснее')
        : html`<div class="card">
            <div class="h"><span>🚀 Орбитальная заправка</span><span class="v">🔒</span></div>
            <div class="sub">R&D: ${money(lp.refuelRnDCost)} — многоразовость + дозаправка (D-039)</div>
            <label class="sub" style="cursor:pointer;display:block;margin-top:.4rem">
              <input type="checkbox" .checked=${store.unlockRefuelDraft}
                @change=${() => store.toggleUnlockRefuel()} /> заказать R&D в этом окне
            </label>
          </div>`}
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
