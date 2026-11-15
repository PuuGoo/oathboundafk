// PROTOTYPE - NOT FOR PRODUCTION
// Acceptance coverage for the authorized additive Oathbound save transfer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OATHBOUND_HEROES } from './oathboundHeroes';
import { migrateOathboundSave } from './oathboundMigration';
import type { OwnedHeroState } from './types';

function ownedFixture(heroId = 'celestial_guardian'): OwnedHeroState {
  return {
    heroId, level: 87, stars: 5, copies: 19,
    equipment: { weapon: 8, armor: 7, relic: 6 },
  };
}

function saveFixture() {
  return {
    gold: 12345, heroExp: 23456, essenceGems: 3456, summonScrolls: 23,
    ascensionStones: 16, idleAccumulatedSeconds: 980, currentStageId: 14,
    maxUnlockedStageId: 21, clearedStageIds: [1, 2, 3], pityCounter: 17,
    totalSummons: 122, battleSpeed: 2, autoUltimate: false,
    formation: ['storm_empress', null, 'celestial_guardian', null, 'custom_hero'],
    savedPresets: [{ id: 'player_team', name: 'My team', slots: [null, null, null, null, null] }],
    ownedHeroes: {
      celestial_guardian: ownedFixture(),
      storm_empress: ownedFixture('storm_empress'),
      custom_hero: ownedFixture('custom_hero'),
    },
  };
}

test('grants every missing Oathbound hero at the authorized baseline without mutating input', () => {
  const empty = Object.freeze({ ownedHeroes: Object.freeze({}) });
  const migrated = migrateOathboundSave(empty);
  assert.notEqual(migrated, empty);
  assert.deepEqual(empty.ownedHeroes, {});
  assert.equal(Object.keys(migrated.ownedHeroes).length, 22);
  for (const { heroId } of OATHBOUND_HEROES) {
    assert.deepEqual(migrated.ownedHeroes[heroId], {
      heroId, level: 1, stars: 1, copies: 1,
      equipment: { weapon: 0, armor: 0, relic: 0 },
    });
  }
  const [first, second] = OATHBOUND_HEROES;
  assert.notEqual(migrated.ownedHeroes[first.heroId].equipment,
    migrated.ownedHeroes[second.heroId].equipment);
});

test('preserves every old record and unrelated save field by reference or value', () => {
  const old = saveFixture();
  const snapshot = structuredClone(old);
  Object.freeze(old.ownedHeroes.celestial_guardian.equipment);
  for (const hero of Object.values(old.ownedHeroes)) Object.freeze(hero);
  Object.freeze(old.ownedHeroes);
  Object.freeze(old);
  const migrated = migrateOathboundSave(old);
  assert.deepEqual(old, snapshot);
  assert.equal(Object.keys(migrated.ownedHeroes).length, 24);
  for (const [id, record] of Object.entries(old.ownedHeroes)) {
    assert.strictEqual(migrated.ownedHeroes[id], record);
  }
  for (const key of Object.keys(old) as (keyof typeof old)[]) {
    if (key !== 'ownedHeroes') assert.strictEqual(migrated[key], old[key]);
  }
});

test('migration is idempotent, returning the same save and ownership references on repeat', () => {
  const migrated = migrateOathboundSave(saveFixture());
  const again = migrateOathboundSave(migrated);
  assert.strictEqual(again, migrated);
  assert.strictEqual(again.ownedHeroes, migrated.ownedHeroes);
});

test('malformed ownership collections become empty collections without resetting other fields', () => {
  for (const ownedHeroes of [null, undefined, [], ['estrilda'], 'broken', 17, true]) {
    const save = { ownedHeroes, gold: 987, formation: ['custom_hero'], savedPresets: [] };
    const migrated = migrateOathboundSave(save);
    assert.equal(Object.keys(migrated.ownedHeroes).length, 22);
    assert.equal(migrated.gold, save.gold);
    assert.strictEqual(migrated.formation, save.formation);
    assert.strictEqual(migrated.savedPresets, save.savedPresets);
  }
});

test('retains malformed individual records deliberately instead of silently overwriting progress', () => {
  const ownedHeroes = { estrilda: null, raine: false, belinda: { level: 93 }, custom: 'legacy' };
  const migrated = migrateOathboundSave({ ownedHeroes });
  for (const [id, record] of Object.entries(ownedHeroes)) {
    assert.strictEqual(migrated.ownedHeroes[id], record);
  }
  assert.strictEqual(migrateOathboundSave(migrated), migrated);
});

test('an inherited property does not count as ownership', () => {
  const ownedHeroes = Object.create({ estrilda: ownedFixture('estrilda') });
  const migrated = migrateOathboundSave({ ownedHeroes });
  assert.equal(Object.prototype.hasOwnProperty.call(migrated.ownedHeroes, 'estrilda'), true);
  assert.equal(migrated.ownedHeroes.estrilda.level, 1);
});
