import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ColonyStore } from '../colonyStore';
import { updatePending, applyPendingUpdate } from '../pwa';
import './colony-status';
import './chronicle-panel';
import './colony-debrief';
import './earth-tab';
import './mars-tab';

const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const kg = (v: number) => Math.round(v).toLocaleString('en-US');

/** v2 root (colony-sim): status + Земля/Марс planning tabs + shared commit footer. */
@customElement('colony-app')
export class ColonyApp extends LitElement {
  private store = new ColonyStore();
  private unsub?: () => void;
  @state() private tick = 0;
  @state() private tab: 'earth' | 'mars' = 'earth';

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
      margin-top: 0.75rem;
      display: flex;
      gap: 0.75rem;
    }
    .toptabs {
      display: flex;
      gap: 0.5rem;
      margin: 1rem 0 0;
    }
    .toptabs button {
      font: inherit;
      font-size: 1rem;
      background: #1a1a22;
      color: #b8b8c0;
      border: 1px solid #2a2a34;
      border-radius: 6px;
      padding: 0.5rem 1.25rem;
      cursor: pointer;
    }
    .toptabs button.active {
      background: #24242e;
      color: #fff;
      border-color: #5ad17a;
    }
    .footer {
      margin-top: 1.25rem;
      padding: 0.85rem 1rem;
      background: #14141a;
      border: 1px solid #2a2a34;
      border-radius: 6px;
      font-size: 0.9rem;
    }
    .line {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
    }
    .neg {
      color: #d96a6a;
    }
    .ok {
      color: #5ad17a;
    }
    .ebar {
      height: 0.6rem;
      background: #26262e;
      border-radius: 3px;
      overflow: hidden;
      margin: 0.3rem 0 0.6rem;
    }
    .efill {
      height: 100%;
      background: #5ad17a;
    }
    .efill.short {
      background: #d96a6a;
    }
    button.commit {
      font: inherit;
      margin-top: 0.6rem;
      background: #14361f;
      color: #d8f0d8;
      border: 1px solid #5ad17a;
      padding: 0.55rem 1.5rem;
      border-radius: 5px;
      cursor: pointer;
    }
    button.commit:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      border-color: #555;
      color: #999;
    }
    button.reset {
      font: inherit;
      background: #1c1c24;
      color: #d8d8d8;
      border: 1px solid #33333f;
      padding: 0.5rem 1.25rem;
      border-radius: 4px;
      cursor: pointer;
    }
  `;

  private footer() {
    const st = this.store.status();
    const plan = this.store.plan();
    const ePct = st.energyDemand > 0 ? Math.min(100, (st.energyGen / st.energyDemand) * 100) : 100;
    const eShort = st.energyDeficit > 0;
    return html`<div class="footer">
      <div class="line">
        <span>⚡ энергия ${Math.round(st.energyGen)} / ${Math.round(st.energyDemand)}</span>
        <span class=${eShort ? 'neg' : 'ok'}>${eShort ? `браунаут −${Math.round(st.energyDeficit)}` : 'баланс ок'}</span>
      </div>
      <div class="ebar"><div class="efill ${eShort ? 'short' : ''}" style="width:${ePct}%"></div></div>
      <div class="line">
        <span>стоимость завоза с Земли${plan.earth.padScrapRefund > 0 ? ` (за вычетом возврата за утилизацию ${money(plan.earth.padScrapRefund)})` : ''}</span>
        <span class=${plan.overBudget ? 'neg' : 'ok'}>${money(plan.totalCost)} / ${money(plan.budget)}</span>
      </div>
      <div class="line">
        <span>масса завоза</span>
        <span class=${plan.earth.capped ? 'neg' : 'ok'}>
          ${kg(plan.earth.mass)} / ${kg(plan.earth.throughput)} кг (пропускная)
        </span>
      </div>
      ${plan.earth.capped ? html`<div class="neg">⚠ масса &gt; пропускной способности — строй площадки или режь завоз</div>` : nothing}
      ${plan.overBudget ? html`<div class="neg">⚠ план дороже субсидии окна</div>` : nothing}
      ${plan.materialsShort.length ? html`<div class="neg">⚠ не хватает материалов на стройку: ${plan.materialsShort.join(', ')}</div>` : nothing}
      ${plan.prereqMissing.length ? html`<div class="neg">⚠ нет пререквизитов: ${plan.prereqMissing.join(', ')}</div>` : nothing}
      ${plan.rndBlocked ? html`<div class="neg">⚠ R&D требует высадки — на Марсе ещё никого нет</div>` : nothing}
      ${plan.bootstrapBlocked ? html`<div class="neg">⚠ первая партия должна включать колонистов — груз не летит один</div>` : nothing}
      <button class="commit" ?disabled=${!plan.feasible || st.ended} @click=${() => this.store.commit()}>
        Коммит ▸ ход (≈2.2 года)
      </button>
    </div>`;
  }

  /** "Новая партия" is the one safe boundary to swap app versions: reset writes a fresh save,
   * THEN (if a service-worker update finished downloading in the background) we activate it and
   * reload — the reload picks up the save just written, so the new game continues seamlessly on
   * the updated build instead of silently swapping assets under a game already in progress. */
  private startNewGame(): void {
    this.store.reset();
    if (updatePending()) applyPendingUpdate();
  }

  render() {
    void this.tick;
    const st = this.store.status();
    return html`
      <h1>OUTLAND</h1>
      <colony-status .status=${st} .inTransit=${this.store.inTransit()}></colony-status>
      <chronicle-panel .store=${this.store}></chronicle-panel>
      ${st.ended
        ? html`${st.collapsed ? html`<div style="color:#d1b65a;margin:1rem 0">► Колония схлопнулась.</div>` : nothing}
            <colony-debrief .debrief=${this.store.debrief()}></colony-debrief>
            <div class="controls" style="margin-top:1rem">
              ${!st.collapsed
                ? html`<button class="reset" @click=${() => this.store.resume()}>‹ Вернуться к колонии</button>`
                : nothing}
              <button class="reset" @click=${() => this.startNewGame()}>Новая партия</button>
            </div>`
        : html`
            <div class="toptabs">
              <button class=${this.tab === 'earth' ? 'active' : ''} @click=${() => (this.tab = 'earth')}>🌍 Земля — завоз</button>
              <button class=${this.tab === 'mars' ? 'active' : ''} @click=${() => (this.tab = 'mars')}>🔴 Марс — стройка</button>
            </div>
            ${this.tab === 'earth'
              ? html`<earth-tab .store=${this.store}></earth-tab>`
              : html`<mars-tab .store=${this.store}></mars-tab>`}
            ${this.footer()}
            <div class="controls">
              <button class="reset" @click=${() => this.store.finish()}>Завершить ▸ дебриф</button>
            </div>
          `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'colony-app': ColonyApp;
  }
}
