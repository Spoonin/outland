import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ColonyStore } from '../colonyStore';
import './colony-status';
import './earth-tab';

/** v2 root (colony-sim): live status + Earth ordering. Mars tab (V4) and debrief (V6) follow. */
@customElement('colony-app')
export class ColonyApp extends LitElement {
  private store = new ColonyStore();
  private unsub?: () => void;
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
    .ended {
      color: #d1b65a;
      margin: 1rem 0;
    }
    button {
      font: inherit;
      background: #1c1c24;
      color: #d8d8d8;
      border: 1px solid #33333f;
      padding: 0.5rem 1.25rem;
      border-radius: 4px;
      cursor: pointer;
    }
  `;

  render() {
    void this.tick;
    const status = this.store.status();
    return html`
      <h1>OUTLAND</h1>
      <colony-status .status=${status}></colony-status>
      ${status.ended
        ? html`<div class="ended">
              ${status.collapsed ? '► Колония схлопнулась.' : '► Конец партии.'} (дебриф — в V6)
            </div>
            <button @click=${() => this.store.reset()}>Новая партия</button>`
        : html`<earth-tab .store=${this.store}></earth-tab>`}
      ${nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'colony-app': ColonyApp;
  }
}
