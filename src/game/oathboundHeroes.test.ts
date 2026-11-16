// PROTOTYPE - NOT FOR PRODUCTION
// Identity and baseline preservation, with explicitly asserted authorized combat corrections.
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

test('preserves baseline fields except explicitly asserted Lucius protection, Estrilda charge, Raine mark and Fawkes isolation corrections', () => {
  const guardian = HERO_ROSTER.find(hero => hero.id === 'celestial_guardian')!;
  const estrilda = HERO_ROSTER.find(hero => hero.id === 'estrilda')!;
  const raine = HERO_ROSTER.find(hero => hero.id === 'raine')!;
  const fawkes = HERO_ROSTER.find(hero => hero.id === 'fawkes')!;
  assert.equal(fawkes.skills.basic.name, 'Grave Bolt');
  assert.equal(fawkes.skills.basic.damageMultiplier, 1.1);
  assert.match(fawkes.skills.basic.description, /Grants no extra mark, shield or control/);
  assert.equal(fawkes.skills.active.name, 'Coffin Seal');
  assert.equal(fawkes.skills.active.targetType, 'current_target');
  assert.equal(fawkes.skills.active.damageMultiplier, 0);
  assert.equal(fawkes.skills.active.ccType, 'isolation');
  assert.equal(fawkes.skills.active.ccDurationMs, 3000);
  assert.match(fawkes.skills.active.description, /non-boss/);
  assert.match(fawkes.skills.active.description, /Deals no damage or slow/);
  assert.equal(fawkes.skills.ultimate.name, 'Purification');
  assert.equal(fawkes.skills.ultimate.damageMultiplier, 2.5);
  assert.equal(fawkes.skills.ultimate.targetType, 'all_enemies');
  assert.equal(fawkes.skills.ultimate.purgePositiveEffects, true);
  assert.equal(fawkes.skills.ultimate.ccType, undefined);
  assert.equal(fawkes.skills.ultimate.ccDurationMs, undefined);
  assert.match(fawkes.skills.ultimate.description, /strips shield HP/);
  assert.equal(fawkes.skills.passive.name, 'Grave Resolve');
  assert.deepEqual(fawkes.skills.passive.controlResistance, { reductionPct: 0.25, cooldownMs: 8000 });
  assert.match(fawkes.skills.passive.description, /does not grant team immunity/);
  assert.equal(raine.skills.active.targetType, 'current_target');
  assert.equal(raine.skills.active.healMultiplier, undefined);
  assert.equal(raine.skills.active.damageMultiplier, 1.85);
  assert.equal(raine.skills.active.markDurationMs, 6000);
  assert.match(raine.skills.active.description, /Does not heal/);
  assert.equal(raine.skills.ultimate.damageMultiplier, 0);
  assert.equal(raine.skills.ultimate.targetType, 'current_target');
  assert.equal(raine.skills.ultimate.healMultiplier, undefined);
  assert.equal(raine.skills.ultimate.energyGrant, undefined);
  assert.equal(raine.skills.ultimate.buffType, undefined);
  assert.equal(raine.skills.ultimate.markDurationMs, 6000);
  assert.deepEqual(raine.skills.ultimate.focusReward, { durationMs: 6000, energy: 5, cooldownMs: 1000, maxPerAttacker: 3 });
  assert.equal(raine.skills.passive.markedDefeatEnergy, 10);
  assert.equal(guardian.skills.ultimate.damageMultiplier, 0);
  assert.equal(guardian.skills.ultimate.damageTargetType, undefined);
  assert.equal(guardian.skills.ultimate.shieldMultiplier, 3.2);
  assert.equal(guardian.skills.ultimate.buffMagnitude, 0.35);
  assert.equal(guardian.skills.ultimate.buffDurationMs, 6000);
  assert.match(guardian.skills.ultimate.description, /Deals no damage/);
  assert.match(guardian.skills.active.description, /180% ATK personal shield/);
  assert.match(guardian.skills.passive.description, /Max HP by 15%, Attack by 5% and Defense by 20%/);
  assert.match(guardian.skills.passive.description, /18% of computed Max HP/);
  assert.deepEqual(estrilda.skills.active.charge, { activationRangePx: 360, maxDistancePx: 320, stopDistancePx: 60, contactRangePx: 90 });
  assert.equal(estrilda.skills.active.ccType, 'knockback');
  assert.equal(estrilda.skills.active.ccDurationMs, 350);
  assert.match(estrilda.skills.active.description, /locked contact point/);
  // Normalize only these explicitly asserted changes, retaining the original broad hash gate.
  const normalized = HERO_ROSTER.map(({ name, ...hero }) => {
    if (hero.id === fawkes.id) {
      const entry = catalog.find(entry => entry.slug === 'fawkes')!;
      const { purgePositiveEffects, ...ultimate } = hero.skills.ultimate;
      const { controlResistance, ...passive } = hero.skills.passive;
      return { ...hero, skills: { ...hero.skills,
        basic: { ...hero.skills.basic, name: entry.builderSkills[3]?.name || `${entry.name} Strike`,
          description: entry.builderSkills[3]?.desc || `Strikes the enemy target with ${entry.faction} power for 110% ATK.` },
        active: { ...hero.skills.active,
        name: entry.builderSkills[1].name, description: entry.builderSkills[1].desc,
        damageMultiplier: 1.85, ccType: 'slow', ccDurationMs: 2200 },
        ultimate: { ...ultimate, name: entry.builderSkills[0].name, description: entry.builderSkills[0].desc,
          ccType: 'slow', ccDurationMs: 2800 },
        passive: { ...passive, name: entry.sigItem?.name || entry.builderSkills[2]?.name || `${entry.faction} Bloodline`,
          description: entry.sigItem?.desc || entry.builderSkills[2]?.desc || `Increases combat attributes and grants ${entry.faction} battlefield mastery.` } } };
    }
    if (hero.id === estrilda.id) {
      const { charge, ...active } = hero.skills.active;
      return { ...hero, skills: { ...hero.skills, active: { ...active,
        description: catalog.find(entry => entry.slug === 'estrilda')!.builderSkills[1].desc,
        ccType: undefined, ccDurationMs: undefined } } };
    }
    if (hero.id === raine.id) {
      const { markDurationMs, ...active } = hero.skills.active;
      const { markDurationMs: mark, focusReward, ...ultimate } = hero.skills.ultimate;
      const { markedDefeatEnergy, ...passive } = hero.skills.passive;
      const entry = catalog.find(entry => entry.slug === 'raine')!;
      return { ...hero, skills: { ...hero.skills, active: { ...active,
        targetType: 'lowest_hp_ally', healMultiplier: 1.9, description: entry.builderSkills[1].desc },
        ultimate: { ...ultimate, damageMultiplier: 1.35, targetType: 'all_allies', healMultiplier: 2.4,
          energyGrant: 30, buffType: 'atk_up', buffDurationMs: 6000, buffMagnitude: 0.3,
          description: entry.builderSkills[0].desc },
        passive: { ...passive, description: entry.sigItem!.desc } } };
    }
    if (hero.id !== guardian.id) return hero;
    return { ...hero, skills: { ...hero.skills,
      active: { ...hero.skills.active, description: 'Slams the frontline with a golden tower shield, dealing 165% ATK and Stunning the target for 2.2s.' },
      ultimate: { ...hero.skills.ultimate, damageMultiplier: 1.8,
        description: 'Calls down a cathedral of solar light, granting all allies a massive Shield (320% ATK) and Defense +35% for 6s while dealing 180% ATK to frontline foes.' },
      passive: { ...hero.skills.passive, description: 'Begins every battle with a Solar Barrier equal to 18% Max HP and increases base Defense by 20%.' } } };
  });
  const actual = createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
  assert.equal(actual, BASELINE_NON_NAME_SHA256);
});
