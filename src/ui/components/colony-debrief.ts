import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ColonyDebrief, MilestoneLine } from '../colonyStore';
import type { MortalityCause } from '../../engine';
import { CAUSE_LABEL } from './chronicle-panel';

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

  static styles = css`
    :host {
      display: block;
      border-top: 2px solid #5ad17a;
      margin-top: 1.25rem;
      padding-top: 1rem;
    }
    h2 {
      font-size: 1.1rem;
      margin: 0 0 0.75rem;
    }
    .headline {
      color: #d1b65a;
      margin-bottom: 1rem;
      line-height: 1.5;
    }
    .cause {
      opacity: 0.85;
      margin-top: 0.35rem;
    }
    .runway {
      background: #1a1410;
      border: 1px solid #6a4a2a;
      border-radius: 5px;
      padding: 0.75rem 1rem;
      margin: 1rem 0;
    }
    .runway .big {
      font-size: 1.6rem;
      font-weight: 700;
      color: #c98a5a;
    }
    .runway small {
      opacity: 0.7;
      display: block;
      margin-top: 0.25rem;
    }
    .curve {
      font-size: 0.85rem;
      margin: 0.35rem 0;
    }
    .curve .blocks {
      font-size: 1.1rem;
      letter-spacing: 1px;
    }
    .pop {
      color: #5ad17a;
    }
    .aut {
      color: #d1b65a;
    }
    .stock {
      color: #7aa8d1;
    }
    .dim {
      opacity: 0.6;
    }
    .milestones {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 0.35rem 1rem;
      margin: 0.75rem 0 1rem;
      font-size: 0.88rem;
    }
    .milestone {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      opacity: 0.5;
    }
    .milestone.done {
      opacity: 1;
    }
    .milestone .w {
      opacity: 0.6;
      font-size: 0.8rem;
    }
  `;

  private headline(): string {
    const d = this.debrief;
    if (d.reason === 'collapsed') {
      return `Колония схлопнулась на окне ${d.window} (год ~${d.year}).`;
    }
    return `Партия завершена на окне ${d.window} (год ~${d.year}) по решению игрока — колония жива.`;
  }

  private causeLine(): TemplateResult | typeof nothing {
    const d = this.debrief;
    if (d.reason !== 'collapsed') return nothing;
    const entries = (Object.entries(d.collapseCause) as [MortalityCause, number][]).filter(([, n]) => (n ?? 0) > 0);
    if (!entries.length) return nothing;
    const total = entries.reduce((a, [, n]) => a + n, 0);
    const parts = entries
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${CAUSE_LABEL[c] ?? c} (${Math.round((n / total) * 100)}%)`);
    return html`<div class="cause">Причина: ${parts.join(', ')}.</div>`;
  }

  private milestone(m: MilestoneLine): TemplateResult {
    return html`<div class="milestone ${m.window !== undefined ? 'done' : ''}">
      <span>${m.icon} ${m.name}</span>
      <span class="w">${m.window !== undefined ? `окно ${m.window}` : '—'}</span>
    </div>`;
  }

  render() {
    const d = this.debrief;
    if (!d) return nothing;
    return html`
      <h2>Дебриф</h2>
      <div class="headline">${this.headline()}${this.causeLine()}</div>

      <div class="runway">
        <div>Самодостаточность — при обрыве импорта колония продержалась бы:</div>
        <div class="big">
          ${d.collapseRunwaySaturated ? `${d.collapseRunwayWindows}+` : d.collapseRunwayWindows} окна
        </div>
        <small
          >Живой «запас без завоза» на дашборде считает до первых смертей; здесь — до полного
          коллапса, при отключении завоза прямо сейчас.</small
        >
      </div>

      <div class="curve">
        <span class="dim">население</span> <span class="blocks pop">${spark(d.populationSeries)}</span>
      </div>
      <div class="curve">
        <span class="dim">автономия по массе</span> <span class="blocks aut">${spark(d.autonomySeries)}</span>
      </div>
      <div class="curve">
        <span class="dim">еда/вода/O₂/N₂ (стоки)</span>
        <span class="blocks stock">${spark(d.stockSeries.food)}</span>
        <span class="blocks stock">${spark(d.stockSeries.water)}</span>
        <span class="blocks stock">${spark(d.stockSeries.o2)}</span>
        <span class="blocks stock">${spark(d.stockSeries.n2)}</span>
      </div>

      <h2 style="margin-top:1.25rem">Майлстоуны</h2>
      <div class="milestones">${d.milestones.map((m) => this.milestone(m))}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'colony-debrief': ColonyDebriefPanel;
  }
}
