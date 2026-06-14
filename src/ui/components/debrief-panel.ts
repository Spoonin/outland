import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Debrief } from '../store';
import type { EndReason } from '../../engine';

const BLOCKS = '▁▂▃▄▅▆▇█';
function spark(vals: number[]): string {
  if (!vals.length) return '';
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const rng = hi - lo || 1;
  return vals.map((v) => BLOCKS[Math.round(((v - lo) / rng) * (BLOCKS.length - 1))]).join('');
}

// Diegetic headlines — state facts, no moralizing (D-036). The player draws the conclusion.
const HEADLINE: Record<Exclude<EndReason, 'none'>, (d: Debrief) => string> = {
  collapse: (d) =>
    `Колония схлопнулась на окне ${d.windows} (год ~${d.year}). Каскад отказов: импорт стало нечем покрывать.`,
  cancellation: (d) =>
    `Земля свернула проект на окне ${d.windows} (год ~${d.year}). Реальная ценность субсидии истончилась инфляцией (−${d.erosionPct.toFixed(0)}%) до незначимости.`,
  stall: (d) =>
    `Асимптотический штиль. Колония жива на окне ${d.windows} (год ~${d.year}), но автономия замерла ниже 100% — импорт вечен.`,
};

/** Debrief (mechanics §7.5): retrospective + the survival runway, named for the first time (D-025). */
@customElement('debrief-panel')
export class DebriefPanel extends LitElement {
  @property({ attribute: false }) debrief!: Debrief;

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
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 0.5rem 1.5rem;
      font-size: 0.9rem;
      margin: 0.75rem 0;
    }
    .curve {
      font-size: 0.85rem;
      margin: 0.35rem 0;
    }
    .curve .blocks {
      font-size: 1.1rem;
      letter-spacing: 1px;
    }
    .aut {
      color: #5ad17a;
    }
    .fm {
      color: #d96a6a;
    }
    .ceiling {
      opacity: 0.8;
      font-size: 0.9rem;
      margin-top: 0.75rem;
    }
    .dim {
      opacity: 0.6;
    }
  `;

  render() {
    const d = this.debrief;
    if (!d || d.reason === 'none') return nothing;
    return html`
      <h2>Дебриф</h2>
      <div class="headline">${HEADLINE[d.reason](d)}</div>

      <div class="stats">
        <div>пиковая автономия: <b>${d.peakAutonomy.toFixed(0)}%</b></div>
        <div>финальная автономия: <b>${d.finalAutonomy.toFixed(0)}%</b></div>
        <div>F/M на конце: <b>${d.finalFM.toFixed(2)}</b></div>
        <div>эрозия субсидии: <b>−${d.erosionPct.toFixed(0)}%</b></div>
      </div>

      <div class="runway">
        <div>Самодостаточность — при обрыве импорта колония продержалась бы:</div>
        <div class="big">~${d.runwayWindows} окна (~${d.runwayMonths} мес)</div>
        <small
          >Автономия росла по массе, но критичные узлы — чипы, фарма, катализаторы — чёрные
          (нелокализуемы). Запас хода так и не сдвинулся.</small
        >
      </div>

      <div class="curve">
        <span class="dim">автономия %</span>
        <span class="blocks aut">${spark(d.autonomyCurve)}</span>
      </div>
      <div class="curve">
        <span class="dim">F/M</span> <span class="blocks fm">${spark(d.fmCurve)}</span>
      </div>

      <div class="ceiling">
        Потолок поставили чёрные узлы: ${d.blackCeiling.join(', ')}.
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'debrief-panel': DebriefPanel;
  }
}
