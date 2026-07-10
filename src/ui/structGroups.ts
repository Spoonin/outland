import type { Structure } from '../engine';
import type { I18nKey } from './i18n';

/* ---------------------------------------------------------------------------
 * Functional grouping, shared by mars-tab (build) and earth-tab (import) —
 * both render the same Structure catalog and should sort it identically.
 *
 * The engine's Structure has no `category` field, so we derive one. Two options:
 *   (A) add `category` to the Structure type in the engine (cleanest, do this if
 *       you own the engine), then replace `groupOf` with `s.category`.
 *   (B) keep this heuristic + per-id override map (zero engine change).
 *
 * The override map wins; fill it in with real structure ids as needed.
 * ------------------------------------------------------------------------- */
export type Group = 'power' | 'life' | 'infra' | 'industry' | 'population';
export const GROUP_ORDER: Group[] = ['population', 'power', 'life', 'infra', 'industry'];
const LIFE_RES = new Set(['food', 'water', 'o2', 'n2']);
export const GROUP_LABEL_KEYS: Record<Group, I18nKey> = {
  power: 'mars.group.power',
  life: 'mars.group.life',
  infra: 'mars.group.infra',
  industry: 'mars.group.industry',
  population: 'mars.group.population',
};

const GROUP_OVERRIDE: Record<string, Group> = {
  // e.g. medbay: 'population', waste_pad: 'infra',
};

export function groupOf(s: Structure): Group {
  const ov = GROUP_OVERRIDE[s.id];
  if (ov) return ov;
  if (s.housing) return 'population';
  if (s.energy > 0) return 'power';
  const produces = Object.keys(s.produces);
  if (produces.some((r) => LIFE_RES.has(r))) return 'life';
  if (produces.length > 0) return 'industry';
  return 'infra';
}
