import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

/** Root shell. Hub-dashboard + spokes wiring lands in Phase 2+ (mechanics §8.1). */
@customElement('outland-app')
export class OutlandApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #d8d8d8;
      background: #0e0e12;
      min-height: 100vh;
      padding: 2rem;
    }
    h1 {
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .dim {
      opacity: 0.5;
    }
  `;

  render() {
    return html`
      <h1>OUTLAND</h1>
      <p class="dim">каркас (Фаза 0) — дашборд появится в Фазе 2</p>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'outland-app': OutlandApp;
  }
}
