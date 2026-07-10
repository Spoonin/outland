import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens } from '../theme';
import { i18n, t, type Lang } from '../i18n';

/** First-contact briefing: shown instead of the console when no save exists (colony-app decides),
 * replayable from settings-menu. Diegetic boot sequence in the mission-control language of
 * documents/ui/README.md — uplink log (with an amber «colony telemetry: NO SIGNAL» beat: the
 * colony is the thing the player hasn't built yet) → title → synodic-window orbit diagram →
 * four directive cards (one per LED semantic color) → accept-mandate CTA.
 *
 * All motion is CSS-only. Entrance reveals share the `.in` class, staggered by a per-element
 * `--t` delay; a click anywhere fast-forwards by adding `.instant` (kills entrances, keeps the
 * looping orbit/scan ambience); prefers-reduced-motion stops everything. The orbit diagram sizes
 * its geometry in `cqi` units against its own inline-size container, so it stays fluid without
 * media queries (the design system's no-breakpoints rule). */
@customElement('mission-briefing')
export class MissionBriefing extends LitElement {
  /** Replayed mid-game from settings — swaps the CTA label («accept mandate» → «back to console»). */
  @property({ type: Boolean }) replay = false;
  @state() private instant = false;
  private unsubI18n?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubI18n = i18n.subscribe(() => this.requestUpdate());
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubI18n?.();
  }

  static styles = [
    tokens,
    css`
      :host {
        display: block;
        font-family: var(--font-mono);
        color: var(--c-text);
        background: var(--c-bg);
        min-height: 100vh;
        box-sizing: border-box;
      }
      .root {
        position: relative;
        min-height: 100vh;
        box-sizing: border-box;
        padding: clamp(14px, 3vw, 40px);
        overflow: hidden;
        cursor: default;
        /* faint console grid + the app's signature corner glow */
        background-image:
          radial-gradient(circle at 15% 0%, rgba(47, 214, 138, 0.06), transparent 55%),
          radial-gradient(circle at 85% 100%, rgba(255, 90, 60, 0.05), transparent 50%),
          repeating-linear-gradient(0deg, transparent 0 47px, rgba(47, 214, 138, 0.03) 47px 48px),
          repeating-linear-gradient(90deg, transparent 0 47px, rgba(47, 214, 138, 0.03) 47px 48px);
      }
      .inner {
        max-width: 1060px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: clamp(18px, 3vh, 30px);
      }

      /* ---- entrance choreography ---- */
      .in {
        opacity: 0;
        transform: translateY(12px);
        animation: rise 0.6s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
        animation-delay: var(--t, 0s);
      }
      @keyframes rise {
        to {
          opacity: 1;
          transform: none;
        }
      }
      .lt {
        opacity: 0;
        animation: flickIn 0.5s steps(1, end) forwards;
        animation-delay: var(--t, 0s);
      }
      @keyframes flickIn {
        0% {
          opacity: 0;
        }
        12% {
          opacity: 1;
        }
        24% {
          opacity: 0.25;
        }
        36% {
          opacity: 1;
        }
        52% {
          opacity: 0.5;
        }
        64%,
        100% {
          opacity: 1;
        }
      }
      .root.instant .in,
      .root.instant .lt {
        animation: none;
        opacity: 1;
        transform: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .root * {
          animation: none !important;
        }
        .in,
        .lt {
          opacity: 1;
          transform: none;
        }
      }

      /* ---- scanline sweep ---- */
      .scan {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 140px;
        pointer-events: none;
        background: linear-gradient(to bottom, transparent, rgba(47, 214, 138, 0.045) 50%, transparent);
        animation: scanMove 8s linear infinite;
      }
      @keyframes scanMove {
        from {
          transform: translateY(-140px);
        }
        to {
          transform: translateY(100vh);
        }
      }

      /* ---- top bar: boot log + controls ---- */
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        flex-wrap: wrap;
      }
      .bootlog {
        flex: 0 1 460px;
        min-width: 260px;
        display: flex;
        flex-direction: column;
        gap: 5px;
        font-size: 12px;
        letter-spacing: 0.04em;
      }
      .bootline {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .bootline .pr {
        color: var(--c-text-faint);
      }
      .bootline .lbl {
        color: var(--c-text-dim);
        text-transform: uppercase;
        white-space: nowrap;
      }
      .bootline .leader {
        flex: 1;
        border-bottom: 1px dotted var(--c-border-hover);
        transform: translateY(-3px);
        min-width: 20px;
      }
      .bootline .st {
        font-weight: 600;
        white-space: nowrap;
      }
      .st.ok {
        color: var(--c-green);
      }
      .st.warn {
        color: var(--c-amber);
        animation: blinkSoft 2.2s ease-in-out infinite;
      }
      @keyframes blinkSoft {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.45;
        }
      }
      .controls {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-left: auto;
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
      button.skip {
        font: inherit;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.06em;
        background: none;
        border: none;
        color: var(--c-text-dim2);
        cursor: pointer;
        padding: 5px 0;
      }
      button.skip:hover {
        color: var(--c-text-bright);
      }

      /* ---- hero: title + orbit diagram ---- */
      .hero {
        display: flex;
        align-items: center;
        gap: clamp(20px, 4vw, 48px);
        flex-wrap: wrap;
      }
      .hero-copy {
        flex: 1 1 380px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .rule {
        height: 2px;
        background: var(--c-border);
        transform-origin: left;
        animation: drawX 0.7s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
        transform: scaleX(0);
        animation-delay: var(--t, 0s);
      }
      .root.instant .rule {
        animation: none;
        transform: none;
      }
      @keyframes drawX {
        to {
          transform: scaleX(1);
        }
      }
      .title {
        font-family: var(--font-head);
        font-weight: 700;
        font-size: clamp(38px, 7vw, 64px);
        letter-spacing: 0.16em;
        color: var(--c-text-bright);
        text-shadow: 0 0 24px rgba(47, 214, 138, 0.25);
        line-height: 1;
        margin-top: 4px;
      }
      .subtitle {
        font-size: 12px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--c-text-dim);
      }
      .callsign {
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--c-text-faint);
      }
      .lede {
        font-size: 13.5px;
        line-height: 1.65;
        color: var(--c-text-note);
        max-width: 46ch;
      }

      /* ---- orbit diagram ---- */
      .orbit-wrap {
        flex: 0 1 360px;
        min-width: 250px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        margin: 0 auto;
      }
      .orbit-box {
        container-type: inline-size;
        position: relative;
        width: min(340px, 84vw);
        aspect-ratio: 1;
      }
      .orbit-box .c {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
      }
      .orbit {
        border: 1px solid var(--c-border-hover);
        opacity: 0.7;
      }
      .orbit.e {
        width: 42cqi;
        aspect-ratio: 1;
      }
      .orbit.m {
        width: 67cqi;
        aspect-ratio: 1;
        border-style: dashed;
      }
      .transfer {
        width: 55cqi;
        aspect-ratio: 1;
        border: 1px dashed rgba(47, 214, 138, 0.22);
        animation: rot 90s linear infinite;
      }
      .sun {
        width: 13px;
        height: 13px;
        background: radial-gradient(circle at 40% 35%, #ffd98a, var(--c-amber) 55%, #b36f00);
        box-shadow: 0 0 16px rgba(255, 176, 32, 0.55);
        animation: sunPulse 4s ease-in-out infinite;
      }
      @keyframes sunPulse {
        0%,
        100% {
          box-shadow: 0 0 14px rgba(255, 176, 32, 0.45);
        }
        50% {
          box-shadow: 0 0 26px rgba(255, 176, 32, 0.75);
        }
      }
      .spin {
        position: absolute;
        inset: 0;
      }
      .spin.e {
        animation: rot 8s linear infinite;
      }
      .spin.m {
        animation: rot 15s linear infinite;
        animation-delay: -5.5s;
      }
      .spin.ship {
        animation: shipRot 11s linear infinite;
      }
      @keyframes rot {
        to {
          transform: rotate(360deg);
        }
      }
      .body {
        position: absolute;
        top: 50%;
        left: 50%;
        border-radius: 50%;
      }
      .body.earth {
        width: 11px;
        height: 11px;
        transform: translate(-50%, -50%) translateX(21cqi);
        background: radial-gradient(circle at 35% 32%, #9fffd4, var(--c-green) 45%, #0f6b44 85%);
        box-shadow: 0 0 10px rgba(47, 214, 138, 0.5);
      }
      .body.mars {
        width: 16px;
        height: 16px;
        transform: translate(-50%, -50%) translateX(33.5cqi);
        background: radial-gradient(circle at 35% 32%, #ff9a6a, #e0512e 40%, #8a2a15 78%, #501408);
        box-shadow: 0 0 12px rgba(255, 90, 60, 0.45);
      }
      .body.cargo {
        width: 5px;
        height: 5px;
        background: var(--c-text-bright);
        box-shadow: 0 0 8px rgba(234, 250, 241, 0.9);
        animation: shipDrift 11s linear infinite;
      }
      /* cargo departs the inner orbit ~30% into the cycle and spirals to the outer one — the
       * rotation (on .spin.ship) and the radius (here) share one duration so they stay in phase */
      @keyframes shipRot {
        0%,
        28% {
          transform: rotate(0deg);
        }
        76%,
        100% {
          transform: rotate(205deg);
        }
      }
      @keyframes shipDrift {
        0%,
        27% {
          opacity: 0;
          transform: translate(-50%, -50%) translateX(21cqi);
        }
        31% {
          opacity: 1;
        }
        72% {
          opacity: 1;
        }
        76%,
        100% {
          opacity: 0;
          transform: translate(-50%, -50%) translateX(33.5cqi);
        }
      }
      .window-ring {
        width: 67cqi;
        aspect-ratio: 1;
        border: 1px solid var(--c-green);
        opacity: 0;
        animation: ringOut 11s ease-out infinite;
      }
      @keyframes ringOut {
        0%,
        22% {
          transform: translate(-50%, -50%) scale(0.14);
          opacity: 0;
        }
        28% {
          opacity: 0.45;
        }
        60%,
        100% {
          transform: translate(-50%, -50%) scale(1);
          opacity: 0;
        }
      }
      .orbit-caption {
        font-size: 11px;
        letter-spacing: 0.05em;
        color: var(--c-text-dim);
        text-align: center;
        max-width: 40ch;
        line-height: 1.5;
      }
      .orbit-legend {
        display: flex;
        gap: 16px;
        font-size: 10.5px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--c-text-dim2);
      }
      .orbit-legend .dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        margin-right: 5px;
      }

      /* ---- directives ---- */
      .directives {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      .dir {
        background: var(--c-panel);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .dir .tag {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 10px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--c-text-faint);
      }
      .dir .tag .led {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex: none;
      }
      .dir h3 {
        margin: 0;
        font-family: var(--font-head);
        font-weight: 600;
        font-size: 14px;
        letter-spacing: 0.03em;
        color: var(--c-text-bright);
      }
      .dir p {
        margin: 0;
        font-size: 12px;
        line-height: 1.6;
        color: var(--c-text-note);
      }

      /* ---- CTA ---- */
      .cta-row {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 8px 0 20px;
      }
      button.cta {
        font: inherit;
        font-family: var(--font-mono);
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        background: var(--c-commit-bg);
        color: var(--c-commit-text);
        border: 1px solid var(--c-commit-border);
        border-radius: var(--radius-sm);
        padding: 14px 34px;
        cursor: pointer;
        animation: glow 2.6s ease-in-out infinite;
      }
      button.cta:hover {
        background: var(--c-commit-bg-hover);
      }
      @keyframes glow {
        0%,
        100% {
          box-shadow: 0 0 10px rgba(47, 214, 138, 0.15);
        }
        50% {
          box-shadow: 0 0 26px rgba(47, 214, 138, 0.4);
        }
      }
    `,
  ];

  private dismiss(): void {
    this.dispatchEvent(new CustomEvent('dismiss'));
  }
  /** Any click that isn't a control fast-forwards the entrance choreography. */
  private fastForward(): void {
    if (!this.instant) this.instant = true;
  }
  /** Deliberately lets the click bubble to the root fast-forward — switching language mid-boot
   * means «show me everything, in that language», not «replay the choreography». */
  private setLang(l: Lang): void {
    i18n.set(l);
  }

  private bootline(lbl: string, st: string, warn: boolean, delay: number) {
    return html`<div class="bootline in" style="--t:${delay}s">
      <span class="pr">&gt;</span><span class="lbl">${lbl}</span><span class="leader"></span>
      <span class="st ${warn ? 'warn' : 'ok'}">${st}</span>
    </div>`;
  }

  private orbitDiagram() {
    return html`<div class="orbit-wrap in" style="--t:2.2s">
      <div class="orbit-box">
        <div class="c orbit e"></div>
        <div class="c orbit m"></div>
        <div class="c transfer"></div>
        <div class="c window-ring"></div>
        <div class="c sun"></div>
        <div class="spin e"><div class="body earth"></div></div>
        <div class="spin m"><div class="body mars"></div></div>
        <div class="spin ship"><div class="body cargo"></div></div>
      </div>
      <div class="orbit-legend">
        <span><span class="dot" style="background:var(--c-green)"></span>${t('intro.orbitEarth')}</span>
        <span><span class="dot" style="background:#e0512e"></span>${t('intro.orbitMars')}</span>
      </div>
      <div class="orbit-caption in" style="--t:2.8s">${t('intro.orbitCaption')}</div>
    </div>`;
  }

  render() {
    const lang = i18n.get();
    const title = 'OUTLAND';
    const dirs = [
      { led: 'var(--c-amber)', head: t('intro.dir1head'), body: t('intro.dir1') },
      { led: 'var(--c-red)', head: t('intro.dir2head'), body: t('intro.dir2') },
      { led: 'var(--c-green)', head: t('intro.dir3head'), body: t('intro.dir3') },
      { led: 'var(--c-violet)', head: t('intro.dir4head'), body: t('intro.dir4') },
    ];
    return html`<div class="root ${this.instant ? 'instant' : ''}" @click=${() => this.fastForward()}>
      <div class="scan"></div>
      <div class="inner">
        <div class="topbar">
          <div class="bootlog">
            ${this.bootline(t('intro.bootUplink'), t('intro.bootUplinkSt'), false, 0.2)}
            ${this.bootline(t('intro.bootRelay'), t('intro.bootRelaySt'), false, 0.55)}
            ${this.bootline(t('intro.bootTelemetry'), t('intro.bootTelemetrySt'), true, 0.9)}
            ${this.bootline(t('intro.bootMandate'), t('intro.bootMandateSt'), false, 1.25)}
          </div>
          <div class="controls in" style="--t:0.1s">
            <div class="segmented">
              <button class=${lang === 'en' ? 'active' : ''} @click=${() => this.setLang('en')}>EN</button>
              <button class=${lang === 'ru' ? 'active' : ''} @click=${() => this.setLang('ru')}>RU</button>
            </div>
            <button class="skip" @click=${() => this.dismiss()}>${t('intro.skip')}</button>
          </div>
        </div>

        <div class="hero">
          <div class="hero-copy">
            <div class="rule" style="--t:1.6s"></div>
            <div class="title" aria-label=${title}>
              ${[...title].map((ch, k) => html`<span class="lt" style="--t:${(1.75 + k * 0.07).toFixed(2)}s">${ch}</span>`)}
            </div>
            <div class="subtitle in" style="--t:2.45s">${t('intro.subtitle')}</div>
            <div class="callsign in" style="--t:2.6s">${t('app.callsign')}</div>
            <div class="lede in" style="--t:2.75s">${t('intro.lede')}</div>
          </div>
          ${this.orbitDiagram()}
        </div>

        <div class="directives">
          ${dirs.map(
            (d, k) => html`<div class="dir in" style="--t:${(3.0 + k * 0.25).toFixed(2)}s">
              <div class="tag"><span class="led" style="background:${d.led}"></span>${t('intro.directive', { n: `0${k + 1}` })}</div>
              <h3>${d.head}</h3>
              <p>${d.body}</p>
            </div>`,
          )}
        </div>

        <div class="cta-row in" style="--t:4.2s">
          <button class="cta" @click=${(e: Event) => { e.stopPropagation(); this.dismiss(); }}>
            ${this.replay ? t('intro.return') : t('intro.start')}
          </button>
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mission-briefing': MissionBriefing;
  }
}
