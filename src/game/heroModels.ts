// PROTOTYPE - NOT FOR PRODUCTION
import { OATHBOUND_HEROES, type OathboundHero } from './oathboundHeroes';

export interface HeroModelDefinition {
  readonly heroId: string;
  readonly sourceId: string;
  readonly url: string;
  readonly source: OathboundHero;
}

/** The first five keep their authored asset names; later identities use sourceId verbatim. */
const FILE_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  lancer: 'estrilda',
  warden: 'lucius',
  ranger: 'raine',
  mage: 'belinda',
  healer: 'fawkes',
});

export const HERO_MODEL_DEFINITIONS: readonly HeroModelDefinition[] = Object.freeze(
  OATHBOUND_HEROES.map(source => Object.freeze({
    heroId: source.heroId,
    sourceId: source.sourceId,
    url: `/assets/models/${FILE_OVERRIDES[source.sourceId] || source.sourceId}.glb`,
    source,
  })),
);

const byHeroId = new Map(HERO_MODEL_DEFINITIONS.map(model => [model.heroId, model]));

/** Resolve a model using the stable runtime identity, never its display name. */
export function getHeroModel(heroId: string): HeroModelDefinition | undefined {
  return byHeroId.get(heroId);
}
