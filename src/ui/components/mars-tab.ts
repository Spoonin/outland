import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ColonyStore } from '../colonyStore';
import { STRUCT_BY_ID, TECH_BY_ID, type Structure } from '../../engine';
import { tokens } from '../theme';
import { i18n, t } from '../i18n';
import { structName, techName } from '../names';

const kg = (v: number) => Math.round(v).toLocaleString('en-US');

/** LED status for a structure card — echoes the design's Colony Systems grid (local/buildable/
 * black), repurposed to mars-tab's real states: at least one unit running, prereq met but nothing
 * built yet, or locked behind a prereq. */
function structStatus(store: ColonyStore, id: string): { color: string; label: string } {
  if (store.builtCount(id) > 0) return { color: 'var(--c-green)', label: t('mars.built') };
  if (store.prereqMet(id)) return { color: 'var(--c-amber)', label: t('mars.buildable') };
  return { color: 'var(--c-violet)', label: t('mars.locked') };
}

/** Mars build tab (colony-sim §6): queue structures with prereqs, energy, local production. */
@customElement('mars-tab')
export class MarsTab extends LitElement {
  @property({ attribute: false }) store!: ColonyStore;
  @state() private tick = 0;
  private unsub?: () => void;
  private unsubI18n?: () => void;

  willUpdate(): void {
    if (!this.unsub && this.store) this.unsub = this.store.subscribe(() => (this.tick = this.tick + 1));
    if (!this.unsubI18n) this.unsubI18n = i18n.subscribe(() => (this.tick = this.tick + 1));
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
    this.unsub = undefined;
    this.unsubI18n?.();
    this.unsubI18n = undefined;
  }

  static styles = [
    tokens,
    css`
      :host {
        display: block;
        border-top: 2px solid var(--c-border);
        margin-top: 1rem;
        padding-top: 1rem;
        font-family: var(--font-mono);
      }
      .legend {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
        font-size: 10px;
        color: var(--c-text-dim2);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 10px;
      }
      .legend .dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        margin-right: 5px;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 8px;
      }
      .card {
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 10px 12px;
      }
      .card.locked {
        opacity: 0.6;
      }
      .h {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 0.3rem;
        gap: 0.5rem;
      }
      .name {
        font-family: var(--font-head);
        font-weight: 600;
        color: var(--c-text);
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .name .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: none;
      }
      .counts {
        font-size: 0.8rem;
        color: var(--c-text-dim);
        white-space: nowrap;
      }
      .spec {
        font-size: 0.78rem;
        color: var(--c-text-note);
        line-height: 1.5;
      }
      .gen {
        color: var(--c-green);
      }
      .draw {
        color: var(--c-amber);
      }
      .hint {
        color: var(--c-text-dim2);
      }
      .lock {
        color: var(--c-red);
        font-size: 0.78rem;
      }
      .short {
        color: var(--c-red);
      }
      .ctrl {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.5rem;
      }
      .ctrl button {
        font: inherit;
        width: 1.9rem;
        height: 1.9rem;
        background: var(--c-bg);
        color: var(--c-text);
        border: 1px solid var(--c-border-hover);
        border-radius: var(--radius-sm);
        cursor: pointer;
      }
      .ctrl button:hover:not(:disabled) {
        background: var(--c-panel-hover);
      }
      .ctrl button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .q {
        min-width: 2rem;
        text-align: center;
        color: var(--c-text);
      }
      .ctrl.demolish {
        border-top: 1px dashed var(--c-border);
        padding-top: 0.5rem;
      }
    `,
  ];

  /** D-074: locked can mean "build the prereq" or "grow the colony first" — say which. */
  private lockLine(s: Structure): TemplateResult | typeof nothing {
    const why = this.store.lockReason(s.id);
    if (!why) return nothing;
    const parts: string[] = [];
    if (why.missingStructure)
      parts.push(t('mars.needFirst', { v: structName(why.missingStructure, STRUCT_BY_ID[why.missingStructure]?.name ?? why.missingStructure) }));
    if (why.minPopNeeded) parts.push(t('mars.needPop', { v: why.minPopNeeded.toLocaleString('ru-RU') }));
    if (why.missingTech) parts.push(t('mars.needTech', { v: techName(why.missingTech, TECH_BY_ID[why.missingTech]?.name ?? why.missingTech) }));
    return html`<div class="lock">${parts.join(' · ')}</div>`;
  }

  /** D-089 (P1): depletion (mined deposit running down) / ramp-up (new process still learning) —
   * a visible hint so the yield hit isn't a silent surprise (project convention: no invisible rules). */
  private industryLine(s: Structure): TemplateResult | typeof nothing {
    if (this.store.builtCount(s.id) <= 0) return nothing;
    const mult = this.store.industryMultNow(s.id);
    if (mult === undefined) return nothing;
    const pct = (mult * 100).toFixed(0);
    const why = s.depletionScale ? t('mars.depletion') : t('mars.rampup');
    return html`<div class="hint">${t('mars.industryOutput', { pct, why })}</div>`;
  }

  private card(s: Structure): TemplateResult {
    const store = this.store;
    const locked = !store.prereqMet(s.id);
    const queued = store.queuedCount(s.id);
    const built = store.builtCount(s.id);
    const stocks = store.stocks();
    const units = Math.max(1, queued); // материалы нужны на всю очередь
    const prod = Object.entries(s.produces).map(([r, q]) => `${r} +${kg(q)}`).join(', ');
    const cons = Object.entries(s.consumes).map(([r, q]) => `${r} −${kg(q)}/окно`).join(', ');
    const matEntries = Object.entries(s.buildMaterials) as [string, number][];
    const status = structStatus(store, s.id);
    return html`<div class="card ${locked ? 'locked' : ''}">
      <div class="h">
        <span class="name"><span class="dot" style="background:${status.color}"></span>${structName(s.id, s.name)}</span>
        <span class="counts">${t('mars.builtCount', { n: built })}${queued ? ` · +${queued}` : ''}</span>
      </div>
      <div class="spec">
        ${matEntries.length
          ? html`${t('mars.materialsFor', { n: units })}
              ${matEntries.map(([r, q]) => {
                const need = q * units;
                const have = Math.round(stocks[r as keyof typeof stocks] ?? 0);
                const short = have < need;
                return html`<span class=${short ? 'short' : ''}>${r} ${kg(need)} (${t('mars.stockOf', { v: kg(have) })})</span>${' '}`;
              })}`
          : nothing}
        <br />${s.energy > 0
          ? html`${t('mars.avgPowerLabel')} <span class="gen">+${s.energy}</span> <span class="hint">${t('mars.avgPowerNote')}</span>`
          : html`${t('mars.power')} ${s.energy < 0 ? html`<span class="draw">${s.energy}</span>` : '0'}`}
        ${s.energy > 0
          ? s.stormVulnerable
            ? html`<span class="hint">${t('mars.stormVulnerable')}</span>`
            : html`<span class="hint">${t('mars.stormProof')}</span>`
          : nothing}
        ${prod ? html`${t('mars.output')} ${prod}` : nothing} ${cons ? html`${t('mars.consumption')} ${cons}` : nothing}
        ${t('mars.sparesPerWnd', { v: kg(s.upkeepSpares) })}
        ${s.opsCrew ? html`${t('mars.crewPerUnit', { v: s.opsCrew })}` : nothing}
        ${s.housing ? html`${t('mars.housingPlus', { v: kg(s.housing) })}` : nothing}
        ${s.n2Leak ? html`<span class="short">${t('mars.n2Leak', { v: kg(s.n2Leak) })}</span>` : nothing}
        ${s.demolishCrew ? html`${t('mars.demolish', { crew: s.demolishCrew, pct: ((s.recycleFrac ?? 0) * 100).toFixed(0) })}` : nothing}
        ${this.industryLine(s)}
      </div>
      ${locked ? this.lockLine(s) : nothing}
      <div class="ctrl">
        <button ?disabled=${locked || queued === 0} @click=${() => store.removeBuild(s.id)}>−</button>
        <span class="q">${queued}</span>
        <button ?disabled=${locked} @click=${() => store.addBuild(s.id)}>+</button>
      </div>
      ${built > 0 ? this.demolishRow(s) : nothing}
    </div>`;
  }

  /** D-081: tear down existing units — recycles a fraction of their materials, costs one-time
   * colonist labor (shared with ongoing crew, D-075) rather than blocking on a hard gate. */
  private demolishRow(s: Structure): TemplateResult {
    const store = this.store;
    const queued = store.queuedDemolishCount(s.id);
    return html`<div class="ctrl demolish">
      <button ?disabled=${queued === 0} @click=${() => store.removeDemolish(s.id)}>−</button>
      <span class="q">${queued}</span>
      <button ?disabled=${store.demolishable(s.id) <= 0} @click=${() => store.addDemolish(s.id)}>+</button>
      <span class="hint">${t('mars.demolishLabel')}</span>
    </div>`;
  }

  render() {
    void this.tick;
    const store = this.store;
    if (!store) return nothing;
    return html`
      <div class="legend">
        <span><span class="dot" style="background:var(--c-green)"></span>${t('mars.built')}</span>
        <span><span class="dot" style="background:var(--c-amber)"></span>${t('mars.buildable')}</span>
        <span><span class="dot" style="background:var(--c-violet)"></span>${t('mars.locked')}</span>
      </div>
      <div class="cards">${store.structures().map((s) => this.card(s))}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mars-tab': MarsTab;
  }
}
