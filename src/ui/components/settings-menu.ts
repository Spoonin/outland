import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens } from '../theme';
import { i18n, t, type Lang } from '../i18n';

/** Header gear → dropdown panel. One item for now (language); more settings land here later. */
@customElement('settings-menu')
export class SettingsMenu extends LitElement {
  @state() private open = false;
  private unsubI18n?: () => void;
  private onDocClick = (e: MouseEvent) => {
    if (!this.open) return;
    if (!e.composedPath().includes(this)) this.open = false;
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubI18n = i18n.subscribe(() => this.requestUpdate());
    document.addEventListener('click', this.onDocClick);
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubI18n?.();
    document.removeEventListener('click', this.onDocClick);
  }

  static styles = [
    tokens,
    css`
      :host {
        display: block;
        position: relative;
        font-family: var(--font-mono);
      }
      .gear {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        color: var(--c-text-dim);
        cursor: pointer;
        font-size: 15px;
        line-height: 1;
      }
      .gear:hover {
        color: var(--c-text-bright);
        border-color: var(--c-border-hover);
      }
      .gear.open {
        color: var(--c-text-bright);
        border-color: var(--c-green);
      }
      .panel {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        z-index: 20;
        min-width: 220px;
        background: var(--c-panel);
        border: 1px solid var(--c-border-hover);
        border-radius: var(--radius);
        padding: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      }
      .panel-label {
        font-size: 11px;
        letter-spacing: 0.08em;
        color: var(--c-text-dim);
        text-transform: uppercase;
        font-family: var(--font-head);
        font-weight: 600;
        margin-bottom: 10px;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .row .name {
        font-size: 12px;
        color: var(--c-text);
      }
      .segmented {
        display: flex;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        overflow: hidden;
      }
      .segmented button {
        font: inherit;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.04em;
        background: var(--c-bg);
        color: var(--c-text-dim);
        border: none;
        padding: 5px 10px;
        cursor: pointer;
      }
      .segmented button + button {
        border-left: 1px solid var(--c-border);
      }
      .segmented button.active {
        background: var(--c-panel-hover);
        color: var(--c-text-bright);
      }
    `,
  ];

  private setLang(l: Lang): void {
    i18n.set(l);
  }

  render() {
    const lang = i18n.get();
    return html`
      <div class="gear ${this.open ? 'open' : ''}" @click=${() => (this.open = !this.open)} title=${t('settings.title')}>
        ⚙
      </div>
      ${this.open
        ? html`<div class="panel">
            <div class="panel-label">${t('settings.title')}</div>
            <div class="row">
              <span class="name">${t('settings.language')}</span>
              <div class="segmented">
                <button class=${lang === 'en' ? 'active' : ''} @click=${() => this.setLang('en')}>EN</button>
                <button class=${lang === 'ru' ? 'active' : ''} @click=${() => this.setLang('ru')}>RU</button>
              </div>
            </div>
          </div>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'settings-menu': SettingsMenu;
  }
}
