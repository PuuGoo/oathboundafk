// PROTOTYPE - NOT FOR PRODUCTION
// Implements the authorized additive Oathbound save transfer; no progression reset.
import { OATHBOUND_HEROES } from './oathboundHeroes';
import type { OwnedHeroState } from './types';

type MigratedSave<T> = Omit<T, 'ownedHeroes'> & {
  ownedHeroes: Record<string, OwnedHeroState>;
};

/**
 * Grants only absent source heroes and preserves every other field and existing record.
 * Invalid collections (null, arrays, primitives, missing) are treated as empty. Existing
 * own keys, even malformed records, are retained verbatim: repairing player progression
 * is deliberately outside this migration. Neither the input nor nested records are mutated.
 * A fully migrated save is returned by reference; repeated calls are therefore no-ops.
 */
export function migrateOathboundSave<T extends { ownedHeroes?: unknown }>(save: T): MigratedSave<T> {
  const existing = save.ownedHeroes;
  const isCollection = existing !== null && typeof existing === 'object' && !Array.isArray(existing);
  const missing = OATHBOUND_HEROES.filter(({ heroId }) =>
    !isCollection || !Object.prototype.hasOwnProperty.call(existing, heroId));

  if (isCollection && missing.length === 0) return save as MigratedSave<T>;

  const ownedHeroes: Record<string, OwnedHeroState> = isCollection
    ? { ...(existing as Record<string, OwnedHeroState>) }
    : {};
  for (const { heroId } of missing) {
    ownedHeroes[heroId] = {
      heroId,
      level: 1,
      stars: 1,
      copies: 1,
      equipment: { weapon: 0, armor: 0, relic: 0 },
    };
  }
  return { ...save, ownedHeroes };
}
