import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ColonyStore } from '../colonyStore';
import { STRUCT_BY_ID, MILESTONES, type ColonyReport, type MortalityCause, type WindowEvent } from '../../engine';

const MILESTONE_BY_ID = new Map(MILESTONES.map((m) => [m.id, m]));

const ICON: Record<string, string> = {
  food: '🍞', water: '💧', o2: '🫧', n2: '🌫️',
  steel: '🔩', metals: '⚙️', polymers: '🧪', glass: '🪟', spares: '🔧',
  pharma: '💊', chips: '🔌', catalyst: '⚗️', fuel: '⚛️',
};
/** Shared with the debrief (D-064) — one Russian label per named mortality cause (D-061/D-063). */
export const CAUSE_LABEL: Partial<Record<MortalityCause, string>> = {
  food: 'голод', water: 'жажда', o2: 'нехватка O₂', n2: 'удушье (N₂)', energy: 'браунаут ЖО', epidemic: 'эпидемия',
  breach: 'декомпрессия', radiation: 'радиация', crash: 'крушение при посадке',
};
const kg = (v: number) => Math.round(v).toLocaleString('ru-RU');
const pct = (v: number) => Math.round(v * 100) + '%';

/** Per-window causality report + history (D-061): last window expanded, past windows a
 * collapsible feed — quiet windows compress to one line. Replaces the old single red strip. */
@customElement('chronicle-panel')
export class ChroniclePanel extends LitElement {
  @property({ attribute: false }) store!: ColonyStore;
  @state() private tick = 0;
  @state() private expanded = new Set<number>();
  @state() private historyOpen = false;
  private unsub?: () => void;

  willUpdate(): void {
    if (!this.unsub && this.store) this.unsub = this.store.subscribe(() => (this.tick = this.tick + 1));
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
    this.unsub = undefined;
  }

  static styles = css`
    :host {
      display: block;
      margin: 0.75rem 0;
    }
    .entry {
      background: #14141a;
      border: 1px solid #2a2a34;
      border-radius: 6px;
      padding: 0.6rem 0.85rem;
      margin-bottom: 0.4rem;
      font-size: 0.85rem;
    }
    .entry.quiet {
      padding: 0.35rem 0.85rem;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      cursor: pointer;
    }
    .win {
      font-weight: 600;
      opacity: 0.85;
    }
    .oneline {
      opacity: 0.75;
    }
    .neg {
      color: #d96a6a;
    }
    .warn {
      color: #d1b65a;
    }
    .ok {
      color: #5ad17a;
    }
    .section {
      margin-top: 0.4rem;
      line-height: 1.5;
    }
    .struct {
      opacity: 0.85;
    }
    .struct .frac {
      opacity: 0.6;
      font-size: 0.78rem;
    }
    .toggle {
      opacity: 0.55;
      cursor: pointer;
      font-size: 0.8rem;
      margin: 0.3rem 0;
      user-select: none;
    }
    .toggle:hover {
      opacity: 0.85;
    }
  `;

  private landedLine(r: ColonyReport): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(r.landed.stocks)) {
      if ((v ?? 0) > 0) parts.push(`${ICON[k] ?? ''} ${k} +${kg(v!)} кг`);
    }
    if (r.landed.colonists > 0) parts.push(`🧑‍🚀 +${r.landed.colonists} колонистов`);
    for (const [id, n] of Object.entries(r.landed.structures)) {
      if ((n ?? 0) > 0) parts.push(`${STRUCT_BY_ID[id]?.icon ?? ''} +${n} ${STRUCT_BY_ID[id]?.name ?? id}`);
    }
    return parts.length ? `с Земли: ${parts.join(' · ')}` : 'с Земли: ничего не прибыло';
  }

  /** Storyteller event (D-063), stated as a dry fact — no forecast, this is what already happened. */
  private eventLabel(ev: WindowEvent): string {
    const cat = ev.category?.map((r) => ICON[r] ?? r).join('') ?? '';
    switch (ev.effect) {
      case 'energy':
        return `${ev.icon} ${ev.name}: генерация −${pct(ev.mag)} на ${ev.windows} ок`;
      case 'subsidy':
        return `${ev.icon} ${ev.name}: субсидия −${pct(ev.mag)} на ${ev.windows} ок`;
      case 'delay':
        return `${ev.icon} ${ev.name}: конвой этого окна задержан на окно`;
      case 'price':
        return `${ev.icon} ${ev.name}: цены ${cat} ×${ev.mag.toFixed(1)} на ${ev.windows} ок`;
      case 'farm':
        return `${ev.icon} ${ev.name}: выпуск ферм −${pct(ev.mag)} на ${ev.windows} ок`;
      case 'epidemic':
        return `${ev.icon} ${ev.name}${ev.covered ? ' — сдержана медблоком' : ''}${ev.deaths ? `: † ${ev.deaths}` : ''}`;
      case 'breach':
        return `${ev.icon} ${ev.name}: −${pct(ev.mag)} запаса N₂ · покрытие ЗИП ${pct(ev.coverage ?? 0)}${ev.deaths ? ` · † ${ev.deaths}` : ' · заделана без потерь'}`;
      case 'radiation':
        return `${ev.icon} ${ev.name}: все в укрытии, выпуск −${pct(ev.mag)}${ev.covered ? ' — медблок прикрыл' : ''}${ev.deaths ? ` · † ${ev.deaths}` : ''}`;
      case 'outage':
        return `${ev.icon} ${ev.name}: ${ev.target ? `${STRUCT_BY_ID[ev.target]?.name ?? ev.target} — стоит ${ev.windows} ок` : 'отказывать нечему — обошлось'}`;
      case 'crash':
        return `${ev.icon} ${ev.name}: потеряно ${pct(ev.mag)} конвоя${ev.lostKg ? ` (~${kg(ev.lostKg)} кг)` : ''}${ev.deaths ? ` · † ${ev.deaths}` : ''}`;
    }
  }

  private eventTags(r: ColonyReport): string[] {
    const ev: string[] = [];
    if (r.event) ev.push(this.eventLabel(r.event));
    if (r.explosions.classic) ev.push(`💥 взрыв на площадке: −${r.explosions.classic} classic`);
    if (r.explosions.refuel) ev.push(`💥 взрыв на площадке: −${r.explosions.refuel} refuel`);
    if (r.capped) ev.push('⚠ часть завоза не влезла в пропускную способность');
    if (r.built.length) ev.push(`🏗 построено: ${r.built.map((id) => STRUCT_BY_ID[id]?.name ?? id).join(', ')}`);
    if (r.births > 0) ev.push(`🐣 рождения: +${r.births}`);
    for (const id of r.milestones) ev.push(`★ майлстоун: ${MILESTONE_BY_ID.get(id)?.name ?? id}`);
    return ev;
  }

  private isQuiet(r: ColonyReport): boolean {
    return (
      r.mortality === 0 &&
      !r.capped &&
      !r.explosions.classic &&
      !r.explosions.refuel &&
      r.built.length === 0 &&
      r.births === 0 &&
      !r.event &&
      !r.milestones.length
    );
  }

  private oneLine(r: ColonyReport): TemplateResult {
    if (this.isQuiet(r)) return html`<span class="oneline">окно ${r.window} — тихо</span>`;
    const bits: string[] = [];
    if (r.mortality > 0) bits.push(`† ${r.mortality}`);
    bits.push(...this.eventTags(r));
    return html`<span class=${r.mortality > 0 ? 'neg' : 'warn'}>окно ${r.window}: ${bits.join(' · ')}</span>`;
  }

  private detail(r: ColonyReport): TemplateResult {
    const causes = (Object.entries(r.mortalityBreakdown) as [MortalityCause, number][]).filter(([, n]) => (n ?? 0) > 0);
    const structs = Object.entries(r.structDiag);
    const eShort = r.energyDeficit > 0;
    return html`
      <div class="section">${this.landedLine(r)}</div>
      ${r.mortality > 0
        ? html`<div class="section neg">
            † погибло ${r.mortality}${causes.length
              ? `: ${causes.map(([c, n]) => `${CAUSE_LABEL[c] ?? c} (${n})`).join(', ')}`
              : ''}
          </div>`
        : nothing}
      ${this.eventTags(r)
        .filter((t) => !t.startsWith('🏗') && !t.startsWith('🐣') && !t.startsWith('★'))
        .map((t) => html`<div class="section warn">${t}</div>`)}
      ${r.built.length || r.births > 0 || r.milestones.length
        ? html`<div class="section ok">
            ${r.built.length ? `🏗 построено: ${r.built.map((id) => STRUCT_BY_ID[id]?.name ?? id).join(', ')}` : ''}
            ${r.births > 0 ? ` 🐣 рождения: +${r.births}` : ''}
            ${r.milestones.map((id) => ` ★ ${MILESTONE_BY_ID.get(id)?.name ?? id}`).join(' ·')}
          </div>`
        : nothing}
      ${structs.length
        ? html`<div class="section struct">
            ${structs.map(
              ([id, d]) => html`<div>
                ${STRUCT_BY_ID[id]?.icon ?? ''} ${STRUCT_BY_ID[id]?.name ?? id} — выпуск
                <b>${pct(d.runFrac)}</b>
                <span class="frac"
                  >(состояние ${pct(d.condition)} × энергия ${pct(d.energyFrac)} × входы ${pct(d.inputFrac)})</span
                >
              </div>`,
            )}
          </div>`
        : nothing}
      <div class="section" style="opacity:.65">
        ⚡ энергия ${kg(r.energyGen)} / ${kg(r.energyDemand)}${eShort ? html` <span class="neg">браунаут −${kg(r.energyDeficit)}</span>` : ''}
        · 🔧 ЗИП покрытие ${pct(r.sparesCoverage)}
        ${r.n2LeakKg > 0 ? html`· 🌫️ утечка N₂ −${kg(r.n2LeakKg)} кг/окно` : nothing}
        · автономия по массе (окно) ${pct(r.autonomyByMass)}
      </div>
    `;
  }

  private entryCard(r: ColonyReport, forceExpanded: boolean): TemplateResult {
    const quiet = this.isQuiet(r);
    const isOpen = forceExpanded || this.expanded.has(r.window);
    return html`<div class="entry ${quiet && !isOpen ? 'quiet' : ''}">
      <div
        class="row"
        @click=${() => {
          if (forceExpanded) return;
          const next = new Set(this.expanded);
          if (next.has(r.window)) next.delete(r.window);
          else next.add(r.window);
          this.expanded = next;
        }}
      >
        <span class="win">окно ${r.window}</span>
        ${!isOpen ? this.oneLine(r) : nothing}
      </div>
      ${isOpen ? this.detail(r) : nothing}
    </div>`;
  }

  render() {
    void this.tick;
    const store = this.store;
    if (!store) return nothing;
    const chronicle = store.chronicle();
    if (!chronicle.length) return nothing;
    const last = chronicle[chronicle.length - 1]!;
    const rest = chronicle.slice(0, -1).slice().reverse();
    return html`
      ${this.entryCard(last, true)}
      ${rest.length
        ? html`<div class="toggle" @click=${() => (this.historyOpen = !this.historyOpen)}>
            ${this.historyOpen ? '▾' : '▸'} прошлые окна (${rest.length})
          </div>`
        : nothing}
      ${this.historyOpen ? rest.map((r) => this.entryCard(r, false)) : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'chronicle-panel': ChroniclePanel;
  }
}
