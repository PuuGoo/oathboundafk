// PROTOTYPE - NOT FOR PRODUCTION
// Authorized Oathbound identity transfer; target mechanics must remain unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import catalog from './fullRepoCatalog.json';
import { HERO_ROSTER, ORIGINAL_18_HEROES } from './heroes';
import { OATHBOUND_HEROES, getOathboundHero, createOathboundFormation } from './oathboundHeroes';

const EXPECTED_IDENTITIES = [
  ['lancer', 4, 'Estrilda', 'estrilda'],
  ['warden', 44, 'Lucius', 'celestial_guardian'],
  ['ranger', 34, 'Raine', 'raine'],
  ['mage', 20, 'Belinda', 'belinda'],
  ['healer', 37, 'Fawkes', 'fawkes'],
  ['thane', 45, 'Thane', 'astral_blademaster'],
  ['hendrik', 50, 'Hendrik', 'iron_bastion'],
  ['rowan', 52, 'Rowan', 'rowan'],
  ['gwyneth', 60, 'Gwyneth', 'gwyneth'],
  ['rosaline', 61, 'Rosaline', 'rosaline'],
  ['cecilia', 66, 'Cecilia', 'cecilia'],
  ['rigby', 68, 'Rigby', 'hero_68_rigby'],
  ['oscar', 72, 'Oscar', 'oscar'],
  ['eluard', 105, 'Eluard', 'eluard'],
  ['eluard-awakened', 248, 'Eluard · Catalyst of Fate', 'hero_248_eluard'],
  ['peggy', 107, 'Peggy', 'hero_107_peggy'],
  ['walker', 110, 'Walker', 'walker'],
  ['morrow', 116, 'Morrow', 'morrow'],
  ['scarlet', 127, 'Scarlet', 'scarlet'],
  ['thane-awakened', 134, 'Thane · The Veiled Wind', 'hero_134_thane'],
  ['sonja', 136, 'Sonja', 'sonja'],
  ['palmer', 150, 'Palmer', 'dawn_oracle'],
] as const;

// Captured before implementation: every roster field other than its display name.
const BASELINE_NON_NAME_SHA256 = 'af37f3723214273d856548b3b78c319d11ae1befbc478d54a2d1200d12a927be';

test('maps exactly 22 ordered source identities to verified existing catalog units', () => {
  assert.deepEqual(OATHBOUND_HEROES.map(({ sourceId, unitId, name, heroId }) =>
    [sourceId, unitId, name, heroId]), EXPECTED_IDENTITIES);
  for (const key of ['sourceId', 'unitId', 'heroId'] as const) {
    assert.equal(new Set(OATHBOUND_HEROES.map((hero) => hero[key])).size, 22);
  }
  for (const mapping of OATHBOUND_HEROES) {
    const entry = catalog.find((hero) => hero.unitId === mapping.unitId);
    const target = HERO_ROSTER.find((hero) => hero.id === mapping.heroId);
    assert.ok(entry, `Missing catalog unit ${mapping.unitId}`);
    assert.equal(target?.unitId, entry.unitId);
    assert.equal(target?.name, mapping.name);
    assert.equal(getOathboundHero(mapping.heroId), mapping);
  }
});

test('source opening squad factory returns five independent stable slots', () => {
  const first = createOathboundFormation();
  const second = createOathboundFormation();
  assert.deepEqual(first, EXPECTED_IDENTITIES.slice(0, 5).map(entry => entry[3]));
  assert.equal(new Set(first).size, 5);
  assert.notStrictEqual(first, second);
  first[0] = 'changed';
  assert.equal(second[0], 'estrilda');
  assert.equal(OATHBOUND_HEROES[0].heroId, 'estrilda');
});

test('optional lookup does not fall back to another hero', () => {
  assert.equal(getOathboundHero('not-a-hero'), undefined);
  assert.equal(getOathboundHero('storm_empress'), undefined);
});

test('base and awakened identities remain separate', () => {
  for (const sourceId of ['eluard', 'thane']) {
    const base = OATHBOUND_HEROES.find((hero) => hero.sourceId === sourceId)!;
    const awakened = OATHBOUND_HEROES.find((hero) => hero.sourceId === `${sourceId}-awakened`)!;
    assert.notEqual(base.heroId, awakened.heroId);
    assert.notEqual(base.unitId, awakened.unitId);
    assert.notEqual(base.name, awakened.name);
    assert.equal(HERO_ROSTER.find((hero) => hero.id === awakened.heroId)?.isAwakened, true);
  }
});

test('preserves all 254 roster IDs, unit IDs and their original ordering without duplicates', () => {
  const coreUnitIds = new Set(ORIGINAL_18_HEROES.map((hero) => hero.unitId));
  const expectedIds = [
    ...ORIGINAL_18_HEROES.map((hero) => hero.id),
    ...catalog.filter((hero) => !coreUnitIds.has(hero.unitId)).map((hero) => hero.slug),
  ];
  assert.equal(HERO_ROSTER.length, 254);
  assert.equal(new Set(HERO_ROSTER.map((hero) => hero.id)).size, 254);
  assert.equal(new Set(HERO_ROSTER.map((hero) => hero.unitId)).size, 254);
  assert.deepEqual(HERO_ROSTER.map((hero) => hero.id), expectedIds);
  assert.deepEqual(HERO_ROSTER.map((hero) => hero.unitId).sort((a, b) => a! - b!),
    catalog.map((hero) => hero.unitId).sort((a, b) => a - b));
});

test('preserves every pre-transfer target field except display names, including stats and skills', () => {
  const actual = createHash('sha256')
    .update(JSON.stringify(HERO_ROSTER.map(({ name, ...hero }) => hero)))
    .digest('hex');
  assert.equal(actual, BASELINE_NON_NAME_SHA256);
});
