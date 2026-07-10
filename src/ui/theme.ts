// Mission-control design system (documents/ui/README.md) — tokens shared by every component via
// CSS custom properties (they pierce shadow boundaries through normal inheritance, so defining them
// once at colony-app's :host is enough for the whole tree). `pulse` is a separate css fragment
// because @keyframes only resolve within the shadow root that defines them — any component that
// animates with it must spread `pulse` into its own `static styles` array.
import { css } from 'lit';

export const tokens = css`
  :host {
    --c-bg: #070d0b;
    --c-panel: #0d1a16;
    --c-panel-hover: #132a25;
    --c-track: #182a24;
    --c-border: #1e352d;
    --c-border-hover: #33544a;

    --c-text-bright: #eafaf1;
    --c-text: #dfeee7;
    --c-text-log: #c3ddd0;
    --c-text-note: #a8c4b8;
    --c-text-dim: #7fa596;
    --c-text-dim2: #5f8272;
    --c-text-faint: #4d6a5e;
    --c-text-ts: #3d5a4d;

    --c-green: #2fd68a;
    --c-amber: #ffb020;
    --c-red: #ff5a3c;
    --c-violet: #8b8296;
    --c-blue: #4a9fd8;

    --c-alert-bg: rgba(255, 90, 60, 0.1);
    --c-alert-bg-strong: rgba(255, 90, 60, 0.12);
    --c-alert-border: #7a3326;
    --c-alert-text: #ffb8a8;

    --c-commit-bg: #123d28;
    --c-commit-bg-hover: #164a30;
    --c-commit-border: #2fd68a;
    --c-commit-text: #d8f5e2;

    --font-head: 'Space Grotesk', ui-sans-serif, sans-serif;
    --font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

    --radius: 4px;
    --radius-sm: 3px;
  }
`;

export const pulse = css`
  @keyframes blinkPulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.28;
    }
  }
`;

/** local=built/ok, buildable=prereq met, import=pending/attention, black=locked/unknown — reused
 * across the systems grid (mars-tab), import cards (earth-tab) and status thresholds. */
export type LedStatus = 'local' | 'buildable' | 'import' | 'black';
export const LED: Record<LedStatus, string> = {
  local: '#2fd68a',
  buildable: '#ffb020',
  import: '#ff5a3c',
  black: '#8b8296',
};
