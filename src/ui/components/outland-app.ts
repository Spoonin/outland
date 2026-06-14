import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { GameStore } from '../store';
import './dashboard-panel';
import './window-manifest';
import './object-tree';

/** Root shell (mechanics §8.1): hosts the store + dashboard. Spokes land in Phase 3+. */
@customElement('outland-app')
export class OutlandApp extends LitElement {
  private store = new GameStore();
  private unsub?: () => void;

  // bump to force re-render when the store emits
  @state() private tick = 0;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsub = this.store.subscribe(() => (this.tick = this.tick + 1));
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
  }

  static styles = css`
    :host {
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #d8d8d8;
      background: #0e0e12;
      min-height: 100vh;
      padding: 2rem;
      box-sizing: border-box;
    }
    h1 {
      font-weight: 600;
      letter-spacing: 0.08em;
      margin: 0 0 1rem;
    }
    .controls {
      margin: 1.25rem 0;
      display: flex;
      gap: 0.75rem;
    }
    button {
      font: inherit;
      background: #1c1c24;
      color: #d8d8d8;
      border: 1px solid #33333f;
      padding: 0.5rem 1.25rem;
      cursor: pointer;
      border-radius: 4px;
    }
    button:hover:not(:disabled) {
      background: #26263010;
      border-color: #5ad17a;
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .ended {
      color: #d1b65a;
      margin-top: 1rem;
    }
  `;

  render() {
    void this.tick;
    const snap = this.store.snapshot();
    const focus = this.store.focus;
    return html`
      <h1>OUTLAND</h1>
      <dashboard-panel
        .snapshot=${snap}
        @node-focus=${(e: CustomEvent<string>) => this.store.setFocus(e.detail)}
      ></dashboard-panel>
      ${focus ? html`<object-tree .store=${this.store} .root=${focus}></object-tree>` : nothing}
      ${snap.ended
        ? html`<div class="ended">
              ${snap.collapsed ? '► Колония схлопнулась.' : '► Конец партии.'}
            </div>
            <div class="controls"><button @click=${() => this.store.reset()}>Новая партия</button></div>`
        : html`<window-manifest .store=${this.store}></window-manifest>
            <div class="controls">
              <button @click=${() => this.store.advance()} title="без решения — жадная авто-политика">
                Авто-ход
              </button>
              <button @click=${() => this.store.reset()}>Сброс</button>
            </div>`}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'outland-app': OutlandApp;
  }
}
