import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ColonyStore } from '../colonyStore';
import { STRUCT_BY_ID, MILESTONES, type ColonyReport, type MilestoneId, type MortalityCause, type WindowEvent } from '../../engine';
import { tokens } from '../theme';
import { i18n, t } from '../i18n';

const MILESTONE_BY_ID = new Map(MILESTONES.map((m) => [m.id, m]));

const ICON: Record<string, string> = {
  food: '🍞', water: '💧', o2: '🫧', n2: '🌫️',
  steel: '🔩', metals: '⚙️', polymers: '🧪', glass: '🪟', spares: '🔧',
  pharma: '💊', chips: '🔌', catalyst: '⚗️', fuel: '⚛️',
  regolith: '🪨', hydrogen: '💠', co2: '💨', // D-089 (P1): local ISRU intermediates
  composite: '🧱', components: '🛠️', // D-090 (P2): regolith construction — importable, not localOnly
};
/** Shared with the debrief (D-064) — bilingual label per named mortality cause (D-061/D-063). */
export function causeLabel(c: MortalityCause): string {
  return t(`cause.${c}` as Parameters<typeof t>[0]);
}
const kg = (v: number) => Math.round(v).toLocaleString('ru-RU');
const pct = (v: number) => Math.round(v * 100) + '%';
const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

/** D-076: milestone name, plus the subsidy bump if this one carries one — stated as a dry economic
 * fact ("субсидия +$3B"), not a congratulatory reward banner (D-036/D-064 tone). Milestone NAMES
 * stay Russian (CSV/engine data, see i18n.ts) — only the surrounding subsidy phrase translates. */
function milestoneLabel(id: MilestoneId): string {
  const m = MILESTONE_BY_ID.get(id);
  const bonus = m?.subsidyBonus;
  // D-097 #5: percentage milestones don't know their $ amount until they actually fire (it's a
  // fraction of the budget AT THAT MOMENT) — so the checklist names the rate, not a dollar figure
  // (the dollar figure the player actually got is implicit in the budget line right after).
  const bonusPct = m?.subsidyBonusPct;
  const bonusText = bonus
    ? t('chronicle.subsidyBonus', { v: money(bonus) })
    : bonusPct
      ? t('chronicle.subsidyBonusPct', { v: Math.round(bonusPct * 100) })
      : '';
  return `${m?.name ?? id}${bonusText}`;
}

/** Per-window causality report + history (D-061): last window expanded, past windows a
 * collapsible feed — quiet windows compress to one line. Replaces the old single red strip. */
@customElement('chronicle-panel')
export class ChroniclePanel extends LitElement {
  @property({ attribute: false }) store!: ColonyStore;
  @state() private tick = 0;
  @state() private expanded = new Set<number>();
  @state() private historyOpen = false;
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
        margin: 0 0 16px;
      }
      .panel-label {
        font-size: 11px;
        letter-spacing: 0.08em;
        color: var(--c-text-dim);
        text-transform: uppercase;
        font-family: var(--font-head);
        font-weight: 600;
        margin-bottom: 8px;
      }
      .entry {
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
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
        gap: 0.6rem;
        cursor: pointer;
      }
      .win {
        font-family: var(--font-mono);
        font-weight: 600;
        color: var(--c-text-ts);
        flex: none;
      }
      .oneline {
        color: var(--c-text-log);
      }
      .neg {
        color: var(--c-red);
      }
      .warn {
        color: var(--c-amber);
      }
      .ok {
        color: var(--c-green);
      }
      .section {
        margin-top: 0.4rem;
        line-height: 1.5;
        color: var(--c-text-log);
      }
      .struct {
        color: var(--c-text-note);
      }
      .struct .frac {
        color: var(--c-text-dim2);
        font-size: 0.78rem;
      }
      .toggle {
        color: var(--c-text-dim2);
        cursor: pointer;
        font-size: 0.8rem;
        margin: 0.3rem 0;
        user-select: none;
      }
      .toggle:hover {
        color: var(--c-text-dim);
      }
    `,
  ];

  private landedLine(r: ColonyReport): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(r.landed.stocks)) {
      if ((v ?? 0) > 0) parts.push(`${ICON[k] ?? ''} ${k} +${kg(v!)} ${t('status.kg')}`);
    }
    if (r.landed.colonists > 0) parts.push(t('chronicle.colonistsLanded', { n: r.landed.colonists }));
    for (const [id, n] of Object.entries(r.landed.structures)) {
      if ((n ?? 0) > 0) parts.push(`${STRUCT_BY_ID[id]?.icon ?? ''} +${n} ${STRUCT_BY_ID[id]?.name ?? id}`);
    }
    return parts.length ? t('chronicle.fromEarth', { list: parts.join(' · ') }) : t('chronicle.fromEarthEmpty');
  }

  /** Storyteller event (D-063), stated as a dry fact — no forecast, this is what already happened. */
  private eventLabel(ev: WindowEvent): string {
    const cat = ev.category?.map((r) => ICON[r] ?? r).join('') ?? '';
    switch (ev.effect) {
      case 'energy':
        return `${ev.icon} ${ev.name}: солнечная генерация −${pct(ev.mag)} на ${ev.windows} ок`;
      case 'subsidy':
        return `${ev.icon} ${ev.name}: субсидия −${pct(ev.mag)} на ${ev.windows} ок`;
      case 'delay':
        return `${ev.icon} ${ev.name}: конвой этого окна задержан на окно`;
      case 'price':
        return `${ev.icon} ${ev.name}: цены ${cat} ×${ev.mag.toFixed(1)} на ${ev.windows} ок`;
      case 'farm':
        return `${ev.icon} ${ev.name}: выпуск ферм −${pct(ev.mag)} на ${ev.windows} ок`;
      case 'epidemic':
        // D-083: the toll is decided by bed capacity — the doomed die at the start of NEXT window
        return `${ev.icon} ${ev.name}: заболело ${ev.sickened ?? 0}, коек хватило на ${ev.treated ?? 0}${ev.deaths ? ` · обречено ${ev.deaths}` : ' · все выздоравливают'}`;
      case 'breach':
        return `${ev.icon} ${ev.name}: −${pct(ev.mag)} запаса N₂ · покрытие ЗИП ${pct(ev.coverage ?? 0)}${ev.deaths ? ` · † ${ev.deaths}` : ' · заделана без потерь'}`;
      case 'radiation':
        return `${ev.icon} ${ev.name}: все в укрытии, выпуск −${pct(ev.mag)}${ev.covered ? ' — медблок прикрыл' : ''}${ev.deaths ? ` · † ${ev.deaths}` : ''}`;
      case 'outage':
        return `${ev.icon} ${ev.name}: ${ev.target ? `${STRUCT_BY_ID[ev.target]?.name ?? ev.target} — стоит ${ev.windows} ок` : 'отказывать нечему — обошлось'}`;
      case 'crash':
        return `${ev.icon} ${ev.name}: потеряно ${pct(ev.mag)} конвоя${ev.lostKg ? ` (~${kg(ev.lostKg)} кг)` : ''}${ev.deaths ? ` · † ${ev.deaths}` : ''}`;
      case 'harvest':
        return `${ev.icon} ${ev.name}: −${pct(ev.mag)} запаса еды${ev.covered ? ' — склад смягчил' : ''}`;
    }
  }

  private eventTags(r: ColonyReport): string[] {
    const ev: string[] = [];
    if (r.event) ev.push(this.eventLabel(r.event));
    if (r.explosions.classic) ev.push(t('chronicle.explosion', { n: r.explosions.classic, tech: 'classic' }));
    if (r.explosions.refuel) ev.push(t('chronicle.explosion', { n: r.explosions.refuel, tech: 'refuel' }));
    if (r.capped) ev.push(t('chronicle.capped'));
    if (r.built.length) ev.push(t('chronicle.built', { list: r.built.map((id) => STRUCT_BY_ID[id]?.name ?? id).join(', ') }));
    if (r.demolished.length)
      ev.push(t('chronicle.demolished', { list: r.demolished.map((id) => STRUCT_BY_ID[id]?.name ?? id).join(', ') }));
    if (r.repairSpentKg > 0) ev.push(t('chronicle.repairSpentD084', { v: kg(r.repairSpentKg) }));
    if (r.foodSpoiledKg > 0 || r.pharmaSpoiledKg > 0) {
      const parts: string[] = [];
      if (r.foodSpoiledKg > 0) parts.push(t('chronicle.spoiledFood', { v: kg(r.foodSpoiledKg) }));
      if (r.pharmaSpoiledKg > 0) parts.push(t('chronicle.spoiledPharma', { v: kg(r.pharmaSpoiledKg) }));
      ev.push(t('chronicle.spoiled', { list: parts.join(', ') }));
    }
    if (r.births > 0) ev.push(t('chronicle.births', { n: r.births }));
    // D-097 #2: fires ONCE, the window the colony's mean chronic dose first crosses the alarm
    // threshold — a fact the medical service reports about the past, not a telegraphed fate (D-063)
    if (r.radiationAlarmNew) {
      ev.push(t('chronicle.radiationAlarm', { v: r.avgRadiationDose.toFixed(2) }));
    }
    for (const id of r.milestones) ev.push(t('chronicle.milestone', { v: milestoneLabel(id) }));
    return ev;
  }

  private isQuiet(r: ColonyReport): boolean {
    return (
      r.mortality === 0 &&
      !r.capped &&
      !r.explosions.classic &&
      !r.explosions.refuel &&
      r.built.length === 0 &&
      r.demolished.length === 0 &&
      r.repairSpentKg === 0 &&
      r.foodSpoiledKg === 0 &&
      r.pharmaSpoiledKg === 0 &&
      r.births === 0 &&
      !r.event &&
      !r.milestones.length &&
      !r.radiationAlarmNew
    );
  }

  private oneLine(r: ColonyReport): TemplateResult {
    if (this.isQuiet(r)) return html`<span class="oneline">${t('chronicle.quiet')}</span>`;
    const bits: string[] = [];
    if (r.mortality > 0) bits.push(t('chronicle.died', { n: r.mortality }));
    bits.push(...this.eventTags(r));
    return html`<span class=${r.mortality > 0 ? 'neg' : 'warn'}>${bits.join(' · ')}</span>`;
  }

  private detail(r: ColonyReport): TemplateResult {
    const causes = (Object.entries(r.mortalityBreakdown) as [MortalityCause, number][]).filter(([, n]) => (n ?? 0) > 0);
    const structs = Object.entries(r.structDiag);
    const eShort = r.energyDeficit > 0;
    return html`
      <div class="section">${this.landedLine(r)}</div>
      ${r.mortality > 0
        ? html`<div class="section neg">
            ${t('chronicle.died', { n: r.mortality })}${causes.length
              ? `: ${causes.map(([c, n]) => `${causeLabel(c)} (${n})`).join(', ')}`
              : ''}
          </div>`
        : nothing}
      ${this.eventTags(r)
        .filter((tag) => !tag.startsWith('🏗') && !tag.startsWith('🔧') && !tag.startsWith('🐣') && !tag.startsWith('★'))
        .map((tag) => html`<div class="section warn">${tag}</div>`)}
      ${r.built.length || r.demolished.length || r.repairSpentKg > 0 || r.births > 0 || r.milestones.length
        ? html`<div class="section ok">
            ${r.built.length ? t('chronicle.built', { list: r.built.map((id) => STRUCT_BY_ID[id]?.name ?? id).join(', ') }) : ''}
            ${r.demolished.length
              ? ` ${t('chronicle.demolished', { list: r.demolished.map((id) => STRUCT_BY_ID[id]?.name ?? id).join(', ') })}`
              : ''}
            ${r.repairSpentKg > 0 ? ` ${t('chronicle.repairSpent', { v: kg(r.repairSpentKg) })}` : ''}
            ${r.births > 0 ? ` ${t('chronicle.births', { n: r.births })}` : ''}
            ${r.milestones.map((id) => ` ★ ${milestoneLabel(id)}`).join(' ·')}
          </div>`
        : nothing}
      ${structs.length
        ? html`<div class="section struct">
            ${structs.map(
              ([id, d]) => html`<div>
                ${STRUCT_BY_ID[id]?.icon ?? ''} ${STRUCT_BY_ID[id]?.name ?? id} — ${t('chronicle.structOutput')}
                <b>${pct(d.runFrac)}</b>
                <span class="frac"
                  >${t('chronicle.structFrac', { cond: pct(d.condition), energy: pct(d.energyFrac), input: pct(d.inputFrac) })}</span
                >
              </div>`,
            )}
          </div>`
        : nothing}
      <div class="section" style="opacity:.65">
        ${t('chronicle.footerEnergy', { gen: kg(r.energyGen), dem: kg(r.energyDemand) })}${eShort
          ? html` <span class="neg">${t('chronicle.footerBrownout', { v: kg(r.energyDeficit) })}</span>`
          : ''}
        · ${t('chronicle.footerSpares', { v: pct(r.sparesCoverage) })}
        ${r.n2LeakKg > 0 ? html`· ${t('chronicle.footerLeak', { v: kg(r.n2LeakKg) })}` : nothing}
        · ${t('chronicle.footerAutonomy', { v: pct(r.autonomyByMass) })}
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
        <span class="win">[W${r.window}]</span>
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
      <div class="panel-label">${t('chronicle.title')}</div>
      ${this.entryCard(last, true)}
      ${rest.length
        ? html`<div class="toggle" @click=${() => (this.historyOpen = !this.historyOpen)}>
            ${this.historyOpen ? '▾' : '▸'} ${t('chronicle.pastWindows', { n: rest.length })}
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
