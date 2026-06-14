import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GameStore } from '../store';

const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

/**
 * Window manifest (mechanics §8.5 / §4.3): split subsidy M between localization (make),
 * colonists, and the mandatory import floor F. Commit advances one synodic window.
 */
@customElement('window-manifest')
export class WindowManifest extends LitElement {
  @property({ attribute: false }) store!: GameStore;
  @state() private tick = 0;
  private unsub?: () => void;

  willUpdate(): void {
    if (!this.unsub && this.store) {
      this.unsub = this.store.subscribe(() => (this.tick = this.tick + 1));
    }
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
      margin-top: 1.25rem;
      padding-top: 1rem;
    }
    h2 {
      font-size: 1rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
    }
    .budget {
      font-size: 0.85rem;
      margin-bottom: 0.75rem;
    }
    .budget .neg {
      color: #d96a6a;
    }
    .budget .pos {
      color: #5ad17a;
    }
    .opts {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 0.25rem 1rem;
    }
    label.opt {
      font-size: 0.85rem;
      cursor: pointer;
      display: flex;
      gap: 0.4rem;
      align-items: baseline;
    }
    .cost {
      opacity: 0.5;
    }
    .none {
      opacity: 0.5;
      font-size: 0.85rem;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.75rem 0;
      font-size: 0.85rem;
    }
    input[type='number'] {
      width: 7rem;
      font: inherit;
      background: #15151b;
      color: #d8d8d8;
      border: 1px solid #33333f;
      padding: 0.25rem 0.4rem;
      border-radius: 3px;
    }
    button.commit {
      font: inherit;
      background: #14361f;
      color: #d8f0d8;
      border: 1px solid #5ad17a;
      padding: 0.5rem 1.25rem;
      cursor: pointer;
      border-radius: 4px;
    }
  `;

  render() {
    void this.tick;
    const store = this.store;
    if (!store) return nothing;
    const plan = store.plan();
    const selectedCost = plan.eligible
      .filter((e) => store.isPicked(e.name))
      .reduce((a, e) => a + e.cost, 0);
    const colonists = store.draftColonistCount;
    const colonistSpend = colonists * plan.colonistCost;
    const remaining = plan.projectedFree - selectedCost - colonistSpend;

    return html`
      <h2>Манифест окна — распределение субсидии M</h2>
      <div class="budget">
        <div class="dim">M: ${money(plan.M)} − импорт-floor F ~${money(plan.projectedF)}</div>
        <div>свободный капитал ~<b>${money(plan.projectedFree)}</b></div>
        <div>
          на локализацию ${money(selectedCost)} · на колонистов ${money(colonistSpend)} · остаток
          <b class=${remaining < 0 ? 'neg' : 'pos'}>${money(remaining)}</b>
        </div>
      </div>

      <h2>Локализовать (🟡 доступно: спрос ≥ MES)</h2>
      ${plan.eligible.length
        ? html`<div class="opts">
            ${plan.eligible.map(
              (e) => html`<label class="opt">
                <input
                  type="checkbox"
                  .checked=${store.isPicked(e.name)}
                  @change=${() => store.toggleLocalize(e.name)}
                />
                ${e.name} <span class="cost">T${e.tier} · ${money(e.cost)}</span>
              </label>`,
            )}
          </div>`
        : html`<div class="none">сейчас нечего локализовать (спрос ниже MES)</div>`}

      <div class="row">
        <span>завезти колонистов:</span>
        <input
          type="number"
          min="0"
          .value=${String(colonists)}
          @input=${(e: Event) => store.setColonists(Number((e.target as HTMLInputElement).value))}
        />
        <span class="cost">× ${money(plan.colonistCost)}</span>
      </div>

      <button class="commit" @click=${() => store.commit()}>Коммит ▸ ход времени</button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'window-manifest': WindowManifest;
  }
}
