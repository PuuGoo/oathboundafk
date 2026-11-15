// PROTOTYPE - NOT FOR PRODUCTION
// Implements the authorized local Oathbound identity transfer, not source combat skills.

/** Source identity paired with an existing, stable target roster ID and catalog unit. */
export interface OathboundHero {
  readonly sourceId: string;
  readonly unitId: number;
  readonly name: string;
  readonly heroId: string;
}

/** Ordered source roster; constants only so roster enrichment never imports itself. */
export const OATHBOUND_HEROES: readonly OathboundHero[] = [
  { sourceId: 'lancer', unitId: 4, name: 'Estrilda', heroId: 'estrilda' },
  { sourceId: 'warden', unitId: 44, name: 'Lucius', heroId: 'celestial_guardian' },
  { sourceId: 'ranger', unitId: 34, name: 'Raine', heroId: 'raine' },
  { sourceId: 'mage', unitId: 20, name: 'Belinda', heroId: 'belinda' },
  { sourceId: 'healer', unitId: 37, name: 'Fawkes', heroId: 'fawkes' },
  { sourceId: 'thane', unitId: 45, name: 'Thane', heroId: 'astral_blademaster' },
  { sourceId: 'hendrik', unitId: 50, name: 'Hendrik', heroId: 'iron_bastion' },
  { sourceId: 'rowan', unitId: 52, name: 'Rowan', heroId: 'rowan' },
  { sourceId: 'gwyneth', unitId: 60, name: 'Gwyneth', heroId: 'gwyneth' },
  { sourceId: 'rosaline', unitId: 61, name: 'Rosaline', heroId: 'rosaline' },
  { sourceId: 'cecilia', unitId: 66, name: 'Cecilia', heroId: 'cecilia' },
  { sourceId: 'rigby', unitId: 68, name: 'Rigby', heroId: 'hero_68_rigby' },
  { sourceId: 'oscar', unitId: 72, name: 'Oscar', heroId: 'oscar' },
  { sourceId: 'eluard', unitId: 105, name: 'Eluard', heroId: 'eluard' },
  { sourceId: 'eluard-awakened', unitId: 248, name: 'Eluard · Catalyst of Fate', heroId: 'hero_248_eluard' },
  { sourceId: 'peggy', unitId: 107, name: 'Peggy', heroId: 'hero_107_peggy' },
  { sourceId: 'walker', unitId: 110, name: 'Walker', heroId: 'walker' },
  { sourceId: 'morrow', unitId: 116, name: 'Morrow', heroId: 'morrow' },
  { sourceId: 'scarlet', unitId: 127, name: 'Scarlet', heroId: 'scarlet' },
  { sourceId: 'thane-awakened', unitId: 134, name: 'Thane · The Veiled Wind', heroId: 'hero_134_thane' },
  { sourceId: 'sonja', unitId: 136, name: 'Sonja', heroId: 'sonja' },
  { sourceId: 'palmer', unitId: 150, name: 'Palmer', heroId: 'dawn_oracle' },
];

const oathboundByHeroId = new Map(OATHBOUND_HEROES.map((hero) => [hero.heroId, hero]));

/** Returns an independent five-slot copy of the source opening squad. */
export function createOathboundFormation(): [string, string, string, string, string] {
  return OATHBOUND_HEROES.slice(0, 5).map(hero => hero.heroId) as [string, string, string, string, string];
}

/** Returns source metadata for a target hero ID, or undefined for unrelated heroes. */
export function getOathboundHero(heroId: string): OathboundHero | undefined {
  return oathboundByHeroId.get(heroId);
}
