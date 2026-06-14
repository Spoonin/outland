import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { NODES, type NodeStatus } from '../../engine';
import type { GameStore } from '../store';
import './import-panel';

const GLYPH: Record<NodeStatus, string> = { local: '🟢', buildable: '🟡', import: '🔴', black: '⚫' };
const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US');

/**
 * Object tree (mechanics §8.3): BOM drill-down of the focused node. Trace the pump down its
 * inputs until it hits a black node — the "осознай глубину" of make-or-buy (§3, §9).
 */
@customElement('object-tree')
export class ObjectTree extends LitElement {
  @property({ attribute: false }) store!: GameStore;
  @property() root = '';
  @state() private tick = 0;
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
      border-top: 1px solid #2a2a34;
      margin-top: 1.25rem;
      padding-top: 1rem;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.5rem;
    }
    h2 {
      font-size: 1rem;
      margin: 0;
    }
    button.close {
      font: inherit;
      background: none;
      color: #9a9aa6;
      border: 1px solid #33333f;
      border-radius: 4px;
      cursor: pointer;
      padding: 0.2rem 0.6rem;
    }
    .tree {
      font-size: 0.85rem;
      line-height: 1.7;
    }
    .twig {
      cursor: pointer;
      user-select: none;
      opacity: 0.6;
      width: 1rem;
      display: inline-block;
    }
    .leaf {
      width: 1rem;
      display: inline-block;
    }
    .qty {
      opacity: 0.5;
    }
    .f {
      opacity: 0.55;
      font-size: 0.8em;
    }
    label.loc {
      cursor: pointer;
    }
    .black {
      color: #c98a5a;
    }
  `;

  private rowFor(name: string, depth: number, qty: number | null, nd: Record<string, number>): TemplateResult {
    const store = this.store;
    const node = NODES[name]!;
    const status = store.statusOf(name, nd);
    const e = store.econOf(name, nd);
    const hasInputs = node.inputs.length > 0;
    const open = store.isExpanded(name);
    const pad = depth * 1.4;
    return html`
      <div style="padding-left:${pad}rem">
        ${hasInputs
          ? html`<span class="twig" @click=${() => store.toggleExpand(name)}>${open ? '▾' : '▸'}</span>`
          : html`<span class="leaf"></span>`}
        ${GLYPH[status]}
        ${status === 'buildable'
          ? html`<label class="loc"
              ><input
                type="checkbox"
                .checked=${store.isPicked(name)}
                @change=${() => store.toggleLocalize(name)}
              />${name}</label
            >`
          : html`<span class=${node.black ? 'black' : ''}>${name}</span>`}
        ${qty !== null ? html`<span class="qty"> ×${qty}/ед.</span>` : nothing}
        <span class="f"> — F ${money(e.fContribution)}/окно${node.black ? ' · нелокализуемо' : ''}</span>
      </div>
      ${hasInputs && open
        ? node.inputs.map(([inp, q]) => this.rowFor(inp, depth + 1, q, nd))
        : nothing}
    `;
  }

  render() {
    void this.tick;
    const store = this.store;
    if (!store || !this.root || !NODES[this.root]) return nothing;
    const nd = store.needsNow();
    return html`
      <div class="head">
        <h2>Дерево объекта — ${this.root}</h2>
        <button class="close" @click=${() => store.setFocus(null)}>закрыть ✕</button>
      </div>
      <import-panel .store=${store} .node=${this.root}></import-panel>
      <div class="tree">${this.rowFor(this.root, 0, null, nd)}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'object-tree': ObjectTree;
  }
}
