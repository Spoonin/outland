// Service-worker update gating: a new deploy must NEVER swap live assets under a game in
// progress — only when the player deliberately starts a fresh partie (colony-app.ts's "Новая
// партия") is it safe to apply. `registerType: 'prompt'` + manual registration (vite.config.ts)
// means the browser downloads and installs updates in the background but never activates them
// on its own; we hold the activation callback here until something calls applyPendingUpdate().

import { registerSW } from 'virtual:pwa-register';

let pendingUpdate: (() => Promise<void>) | null = null;

/** Registers the service worker once at startup. No-ops silently if the browser has none
 * (vite-plugin-pwa's virtual module already guards this) or the app isn't served over the
 * built output (e.g. `vite dev`, where no SW is generated at all). */
export function initServiceWorker(): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // a new version finished installing in the background — hold it, don't reload anyone
      pendingUpdate = () => updateSW(true); // true = reload once the new SW takes control
    },
  });
}

/** Is a downloaded-but-not-yet-applied update waiting? */
export function updatePending(): boolean {
  return pendingUpdate !== null;
}

/** Activate the waiting update and reload — call ONLY at a safe boundary (new game start). */
export function applyPendingUpdate(): void {
  const apply = pendingUpdate;
  pendingUpdate = null;
  void apply?.();
}
