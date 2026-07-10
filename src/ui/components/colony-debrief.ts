import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ColonyDebrief, MilestoneLine } from '../colonyStore';
import type { MortalityCause } from '../../engine';
import { causeLabel } from './chronicle-panel';
import { tokens } from '../theme';
import { t } from '../i18n';

const BLOCKS = '▁▂▃▄▅▆▇█';
function spark(vals: number[]): string {
  if (!vals.length) return '';
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const range = hi - lo || 1;
  return vals.map((v) => BLOCKS[Math.round(((v - lo) / range) * (BLOCKS.length - 1))]).join('');
}

/** Debrief (D-064): shown on collapse or when the player clicks "finish" — reads the chronicle
 * (D-061) in retrospect. No win state, no interpretation (D-036) — states facts, lets the player
 * draw the conclusion. Named survival runway (glossary: debrief-only) lives here, distinct from
 * the live buffer gauge already on the dashboard (D-062). */
@customElement('colony-debrief')
export class ColonyDebriefPanel extends LitElement {
  @property({ attribute: false }) debrief!: ColonyDebrief;

  static styles = [
    tokens,
    css`
      :host {
        display: block;
        border-top: 2px solid var(--c-green);
        margin-top: 1.25rem;
        padding-top: 1rem;
        font-family: var(--font-mono);
        color: var(--c-text);
      }
      h2 {
        font-family: var(--font-head);
        font-size: 1.1rem;
        margin: 0 0 0.75rem;
        color: var(--c-text-bright);
        letter-spacing: 0.04em;
      }
      .headline {
        color: var(--c-amber);
        margin-bottom: 1rem;
        line-height: 1.5;
      }
      .cause {
        color: var(--c-text-note);
        margin-top: 0.35rem;
      }
      .runway {
        position: relative;
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 0.85rem 1rem;
        margin: 1rem 0;
      }
      .runway::before,
      .runway::after,
      .runway .corner-bl,
      .runway .corner-br {
        content: '';
        position: absolute;
        width: 10px;
        height: 10px;
        border-color: var(--c-green);
        border-style: solid;
        border-width: 0;
      }
      .runway::before {
        top: 6px;
        left: 6px;
        border-top-width: 2px;
        border-left-width: 2px;
      }
      .runway::after {
        top: 6px;
        right: 6px;
        border-top-width: 2px;
        border-right-width: 2px;
      }
      .runway .corner-bl {
        bottom: 6px;
        left: 6px;
        border-bottom-width: 2px;
        border-left-width: 2px;
      }
      .runway .corner-br {
        bottom: 6px;
        right: 6px;
        border-bottom-width: 2px;
        border-right-width: 2px;
      }
      .runway .label {
        font-size: 11px;
        letter-spacing: 0.06em;
        color: var(--c-text-dim);
        text-transform: uppercase;
      }
      .runway .big {
        font-family: var(--font-head);
        font-size: 1.6rem;
        font-weight: 700;
        color: var(--c-text-bright);
      }
      .runway small {
        color: var(--c-text-dim2);
        display: block;
        margin-top: 0.35rem;
      }
      .curve {
        font-size: 0.85rem;
        margin: 0.35rem 0;
        color: var(--c-text-dim);
      }
      .curve .blocks {
        font-size: 1.1rem;
        letter-spacing: 1px;
      }
      .pop {
        color: var(--c-green);
      }
      .aut {
        color: var(--c-amber);
      }
      .stock {
        color: var(--c-text-log);
      }
      .dim {
        color: var(--c-text-dim2);
      }
      .milestones {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 8px;
        margin: 0.75rem 0 1rem;
        font-size: 0.88rem;
      }
      .milestone {
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 8px 10px;
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-sm);
        color: var(--c-text-dim);
      }
      .milestone.done {
        color: var(--c-text);
        border-color: var(--c-green);
      }
      .milestone .w {
        color: var(--c-text-dim2);
        font-size: 0.8rem;
      }
    `,
  ];

  private headline(): string {
    const d = this.debrief;
    if (d.reason === 'collapsed') {
      return t('debrief.collapsedHeadline', { w: d.window, y: d.year });
    }
    return t('debrief.aliveHeadline', { w: d.window, y: d.year });
  }

  private causeLine(): TemplateResult | typeof nothing {
    const d = this.debrief;
    if (d.reason !== 'collapsed') return nothing;
    const entries = (Object.entries(d.collapseCause) as [MortalityCause, number][]).filter(([, n]) => (n ?? 0) > 0);
    if (!entries.length) return nothing;
    const total = entries.reduce((a, [, n]) => a + n, 0);
    const parts = entries
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${causeLabel(c)} (${Math.round((n / total) * 100)}%)`);
    return html`<div class="cause">${t('debrief.cause', { v: parts.join(', ') })}</div>`;
  }

  private milestone(m: MilestoneLine): TemplateResult {
    return html`<div class="milestone ${m.window !== undefined ? 'done' : ''}">
      <span>${m.icon} ${m.name}</span>
      <span class="w">${m.window !== undefined ? t('debrief.windowN', { v: m.window }) : '—'}</span>
    </div>`;
  }

  render() {
    const d = this.debrief;
    if (!d) return nothing;
    return html`
      <h2>${t('debrief.title')}</h2>
      <div class="headline">${this.headline()}${this.causeLine()}</div>

      ${d.reason === 'collapsed'
        ? d.preSpiralBuffer !== undefined
          ? html`<div class="runway">
              <div class="corner-bl"></div>
              <div class="corner-br"></div>
              <div class="label">${t('debrief.preSpiralLabel')}</div>
              <div class="big">${d.preSpiralBuffer} ${t('debrief.windowsUnit')}</div>
              <small>${t('debrief.preSpiralNote')}</small>
            </div>`
          : nothing
        : html`<div class="runway">
            <div class="corner-bl"></div>
            <div class="corner-br"></div>
            <div class="label">${t('debrief.selfSufficiencyLabel')}</div>
            <div class="big">
              ${d.collapseRunwaySaturated ? `${d.collapseRunwayWindows}+` : d.collapseRunwayWindows} ${t('debrief.windowsUnit')}
            </div>
            <small>${t('debrief.selfSufficiencyNote')}</small>
          </div>`}

      <div class="curve">
        <span class="dim">${t('debrief.population')}</span> <span class="blocks pop">${spark(d.populationSeries)}</span>
      </div>
      <div class="curve">
        <span class="dim">${t('debrief.autonomyByMass')}</span> <span class="blocks aut">${spark(d.autonomySeries)}</span>
      </div>
      <div class="curve">
        <span class="dim">${t('debrief.stocks')}</span>
        <span class="blocks stock">${spark(d.stockSeries.food)}</span>
        <span class="blocks stock">${spark(d.stockSeries.water)}</span>
        <span class="blocks stock">${spark(d.stockSeries.o2)}</span>
        <span class="blocks stock">${spark(d.stockSeries.n2)}</span>
      </div>

      <h2 style="margin-top:1.25rem">${t('debrief.milestones')}</h2>
      <div class="milestones">${d.milestones.map((m) => this.milestone(m))}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'colony-debrief': ColonyDebriefPanel;
  }
}
