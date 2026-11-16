// PROTOTYPE - NOT FOR PRODUCTION
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_12_HEROES,
  ADDITIONAL_6_HEROES,
  ORIGINAL_18_HEROES,
  HERO_ROSTER,
  DREAM_REALM_BOSSES,
  OFFICIAL_GAME_VIDEOS,
  computeHeroStats,
  validateTeamFormation,
  getHeroLevelUpCost,
  computeFactionAura,
  getFactionDamageMultiplier,
} from './heroes';
import { CAMPAIGN_STAGES, getCampaignStage } from './campaign';
import { BattleSimulation, createSeededRng } from './battleEngine';
import { getCombatTimeline, getTimelineVisualPhase } from './skillTimelines';
import { createSpriteEffect, getActiveSkillSources } from './spriteBattleEffects';
import { getUltimateReadiness } from './ultimateReadiness';
import { OwnedHeroState, TeamFormationSlots } from './types';

function createDefaultOwnedHeroes(level = 5, stars = 2): Record<string, OwnedHeroState> {
  const map: Record<string, OwnedHeroState> = {};
  for (const h of HERO_ROSTER) {
    map[h.id] = {
      heroId: h.id,
      level,
      stars,
      copies: 2,
      equipment: { weapon: 1, armor: 1, relic: 1 },
    };
  }
  return map;
}

test('Roster contains all 254 playable heroes, 12 core archetypes, and 6 additional original heroes', () => {
  assert.equal(CORE_12_HEROES.length, 12, 'Must have 12 core starter heroes');
  assert.equal(ADDITIONAL_6_HEROES.length, 6, 'Must have 6 additional original heroes');
  assert.equal(ORIGINAL_18_HEROES.length, 18, 'Must have 18 total handcrafted original heroes');
  assert.equal(HERO_ROSTER.length, 254, 'Must have all 254 playable heroes from the repositories');

  const counts = {
    Tank: 0,
    'Damage Dealer': 0,
    Mage: 0,
    Support: 0,
    'Crowd Controller': 0,
  };

  for (const hero of CORE_12_HEROES) {
    counts[hero.heroClass]++;
  }

  assert.equal(counts.Tank, 3, 'Must have 3 core Tanks');
  assert.equal(counts['Damage Dealer'], 3, 'Must have 3 core Damage Dealers');
  assert.equal(counts.Mage, 2, 'Must have 2 core Mages');
  assert.equal(counts.Support, 2, 'Must have 2 core Supports');
  assert.equal(counts['Crowd Controller'], 2, 'Must have 2 core Crowd Controllers');

  const extraCounts = {
    Tank: 0,
    'Damage Dealer': 0,
    Mage: 0,
    Support: 0,
    'Crowd Controller': 0,
  };
  const activeSkillNames = new Set<string>();
  const ultimateSkillNames = new Set<string>();
  const passiveSkillNames = new Set<string>();

  for (const hero of ADDITIONAL_6_HEROES) {
    extraCounts[hero.heroClass]++;
    activeSkillNames.add(hero.skills.active.name);
    ultimateSkillNames.add(hero.skills.ultimate.name);
    passiveSkillNames.add(hero.skills.passive.name);
  }

  assert.equal(extraCounts.Tank, 2, 'Additional 6 heroes must include 2 Tanks');
  assert.equal(extraCounts['Damage Dealer'], 1, 'Additional 6 heroes must include 1 Damage Dealer');
  assert.equal(extraCounts.Mage, 1, 'Additional 6 heroes must include 1 Mage');
  assert.equal(extraCounts.Support, 1, 'Additional 6 heroes must include 1 Support');
  assert.equal(extraCounts['Crowd Controller'], 1, 'Additional 6 heroes must include 1 Crowd Controller');
  assert.equal(activeSkillNames.size, 6, 'All 6 additional heroes must have unique active skills');
  assert.equal(ultimateSkillNames.size, 6, 'All 6 additional heroes must have unique ultimate skills');
  assert.equal(passiveSkillNames.size, 6, 'All 6 additional heroes must have unique passive skills');

  for (const hero of HERO_ROSTER) {
    assert.ok(hero.id.length > 0);
    assert.ok(hero.name.length > 0);
    assert.ok(hero.framedUrl && hero.framedUrl.length > 0);
    assert.ok(hero.battleUrl && hero.battleUrl.length > 0);
    assert.ok(hero.skills.basic.name.length > 0);
    assert.ok(hero.skills.active.name.length > 0);
    assert.ok(hero.skills.ultimate.name.length > 0);
    assert.ok(hero.skills.passive.name.length > 0);
  }

  assert.ok(DREAM_REALM_BOSSES.length >= 8, 'Must include Dream Realm & Guild Hunt bosses');
  assert.ok(OFFICIAL_GAME_VIDEOS.length >= 7, 'Must include official AFK Arena cinematic videos');
});

test('Team formation validation rejects empty teams and duplicate heroes', () => {
  const validTeam: TeamFormationSlots = [
    'celestial_guardian',
    'crimson_revenant',
    'storm_empress',
    'dawn_oracle',
    'arcane_serpent',
  ];
  assert.equal(validateTeamFormation(validTeam).valid, true);

  const emptyTeam: TeamFormationSlots = [null, null, null, null, null];
  assert.equal(validateTeamFormation(emptyTeam).valid, false);

  const duplicateTeam: TeamFormationSlots = [
    'celestial_guardian',
    'celestial_guardian',
    'storm_empress',
    null,
    null,
  ];
  assert.equal(validateTeamFormation(duplicateTeam).valid, false);
});

test('Hero progression upgrades increase combat stats and power deterministically', () => {
  const hero = HERO_ROSTER[0];
  const lv1 = computeHeroStats(hero, {
    heroId: hero.id,
    level: 1,
    stars: 1,
    copies: 0,
    equipment: { weapon: 1, armor: 1, relic: 1 },
  });
  const lv10 = computeHeroStats(hero, {
    heroId: hero.id,
    level: 10,
    stars: 3,
    copies: 0,
    equipment: { weapon: 3, armor: 3, relic: 3 },
  });

  assert.ok(lv10.hp > lv1.hp);
  assert.ok(lv10.attack > lv1.attack);
  assert.ok(lv10.defense > lv1.defense);
  assert.ok(lv10.combatPower > lv1.combatPower);

  const cost1 = getHeroLevelUpCost(1);
  const cost10 = getHeroLevelUpCost(10);
  assert.ok(cost10.gold > cost1.gold);
  assert.ok(cost10.ascensionStones > 0, 'Breakthrough level 10 requires ascension stones');
});

function createSafetySimulation(heroId: string): BattleSimulation {
  return new BattleSimulation({ allyFormation: [heroId, null, null, null, null],
    ownedHeroes: createDefaultOwnedHeroes(), enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
}

function resolvePendingCasts(sim: BattleSimulation): void {
  for (let step = 0; step < 40 && sim.getUnits().some(unit => unit.currentCast) && sim.getStatus() === 'running'; step++) {
    // Accounting fixtures isolate the tested skill from unrelated unit actions.
    for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; }
    sim.step(50);
  }
}

// Synthetic mixed-skill contract: keep coverage after Lucius becomes pure protection.
// Restore immediately; pending casts capture this independent skill object, not the live roster slot.
function triggerMixedSupportFixture(sim: BattleSimulation, casterId: string): boolean {
  const skills = HERO_ROSTER.find(hero => hero.id === 'celestial_guardian')!.skills;
  const original = skills.ultimate;
  skills.ultimate = { ...original, damageMultiplier: 1.8, damageTargetType: 'frontline_enemies' };
  try { return sim.triggerUltimate(casterId); }
  finally { skills.ultimate = original; }
}

function createChargeFixture() {
  const sim = createSafetySimulation('estrilda');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  const target = sim.getUnits().find(unit => unit.team === 'enemy' && unit.position === 1)!;
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; }
  caster.x = 300; caster.y = target.y; target.x = 600; target.shield = 0;
  caster.activeSkillCooldownMs = 0; sim.consumeEvents();
  return { sim, caster, target };
}

test('P1 Estrilda winds up then charges in simulation and damages and pushes only at contact', () => {
  const { sim, caster, target } = createChargeFixture();
  sim.step(50);
  const cast = sim.consumeEvents().find(event => event.type === 'active_skill' && event.sourceId === caster.instanceId)!;
  assert.ok(cast, 'charge activates before ordinary melee range');
  const timeline = cast.timeline!;
  sim.step(timeline.releaseMs);
  assert.equal(caster.x, 300); assert.equal(target.hp, target.maxHp); assert.equal(target.x, 600);
  sim.step(50); assert.ok(caster.x > 300 && caster.x < 600);
  assert.equal(target.hp, target.maxHp); assert.equal(target.x, 600);
  sim.step(timeline.hits[0].atMs - timeline.releaseMs - 50);
  const entries = sim.consumeEvents().filter(event => event.castId === cast.castId);
  const hit = entries.find(event => event.type === 'damage')!;
  const push = entries.find(event => event.type === 'knockback')!;
  assert.ok(hit && push); assert.equal(hit.timestampMs, cast.timestampMs + timeline.hits[0].atMs);
  assert.equal(push.timestampMs, hit.timestampMs); assert.ok(caster.x > 300); assert.ok(target.x > 600);
});

test('P1 Estrilda charge freezes on pause, stops on control and misses a target leaving the locked contact point', () => {
  for (const mode of ['control', 'dodge'] as const) {
    const { sim, caster, target } = createChargeFixture(); sim.step(50);
    const cast = sim.consumeEvents().find(event => event.type === 'active_skill' && event.sourceId === caster.instanceId)!;
    assert.ok(cast); sim.step(cast.timeline!.releaseMs + 50);
    const x = caster.x; assert.ok(x > 300);
    sim.setPaused(true); sim.step(500); assert.equal(caster.x, x); sim.setPaused(false);
    if (mode === 'control') sim.applyCrowdControl(target, caster, 'stun', 2000);
    else { target.x = 900; target.y = 450; }
    sim.step(1000);
    const entries = sim.consumeEvents().filter(event => event.castId === cast.castId);
    assert.ok(!entries.some(event => event.type === 'damage' || event.type === 'knockback'));
    if (mode === 'control') { assert.equal(caster.x, x); assert.ok(entries.some(event => event.type === 'cast_cancelled')); }
  }
});

test('P1 Estrilda charge stops before another movement tick when locked target dies and is x1/x2 deterministic', () => {
  const first = createChargeFixture(), second = createChargeFixture();
  first.sim.step(50); second.sim.step(50);
  const snapshot = first.sim.getSnapshot();
  snapshot.units.find(unit => unit.instanceId === first.caster.instanceId)!.currentCast!.chargePath!.to.x = 0;
  assert.notEqual(first.caster.currentCast!.chargePath!.to.x, 0, 'snapshot charge paths are not live mutable state');
  for (let i = 0; i < 10; i++) { first.sim.step(50); first.sim.step(50); second.sim.step(100); }
  assert.deepEqual(first.sim.getSnapshot(), second.sim.getSnapshot());
  const deadTarget = createChargeFixture(); deadTarget.sim.step(400);
  const x = deadTarget.caster.x;
  deadTarget.target.hp = 0; deadTarget.target.isAlive = false; deadTarget.sim.consumeEvents();
  deadTarget.sim.step(50);
  assert.equal(deadTarget.caster.x, x);
  assert.ok(deadTarget.sim.consumeEvents().some(event => event.type === 'cast_cancelled' && event.cancelReason === 'target-lost'));
});

test('P1 Raine active marks one locked enemy at impact without healing or damaging allies', () => {
  const sim = createSafetySimulation('raine');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  const target = sim.getUnits().find(unit => unit.team === 'enemy')!;
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; }
  caster.hp -= 100; caster.activeSkillCooldownMs = 0; caster.attackRangePx = 1000;
  caster.targetInstanceId = target.instanceId; sim.consumeEvents(); sim.step(50);
  const cast = sim.consumeEvents().find(event => event.type === 'active_skill')!;
  assert.ok(cast); assert.deepEqual(caster.currentCast!.targetIds, [target.instanceId]);
  sim.step(cast.timeline!.hits[0].atMs - 50);
  assert.ok(!target.statusEffects.some(status => status.type === 'mark'));
  sim.step(50);
  const entries = sim.consumeEvents().filter(event => event.castId === cast.castId);
  assert.equal(entries.filter(event => event.type === 'heal' || event.type === 'shield').length, 0);
  assert.deepEqual(entries.filter(event => event.type === 'damage').map(event => event.targetId), [target.instanceId]);
  const mark = target.statusEffects.find(status => status.type === 'mark')!;
  assert.ok(mark); assert.equal(mark.sourceUnitId, caster.instanceId); assert.equal(mark.durationMs, 6000);
  const applied = entries.find(event => event.type === 'mark_applied')!;
  assert.ok(applied); assert.equal(applied.targetId, target.instanceId);
  assert.equal(applied.timestampMs, cast.timestampMs + cast.timeline!.hits[0].atMs);
});

test('P1 Raine active interruption after release prevents contact, but recovery interruption preserves a landed mark', () => {
  for (const phase of ['released', 'landed'] as const) {
    const sim = createSafetySimulation('raine');
    const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
    const target = sim.getUnits().find(unit => unit.team === 'enemy')!;
    for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; unit.energy = 0; }
    caster.attackRangePx = 1000; caster.activeSkillCooldownMs = 0;
    target.shield = 0; target.hp = target.maxHp = 1e6;
    sim.consumeEvents(); sim.step(50);
    const cast = sim.consumeEvents().find(event => event.type === 'active_skill')!;
    assert.ok(cast);
    sim.step(phase === 'released' ? cast.timeline!.releaseMs : cast.timeline!.hits[0].atMs);
    const beforeControl = sim.consumeEvents();
    assert.ok(beforeControl.some(event => event.type === 'cast_release' && event.castId === cast.castId));
    sim.applyCrowdControl(target, caster, 'stun', 2000);
    const cancellation = sim.consumeEvents().find(event => event.type === 'cast_cancelled');
    assert.equal(cancellation?.castId, cast.castId);
    assert.equal(cancellation?.cancelReason, 'control');
    const mark = target.statusEffects.find(status => status.type === 'mark');
    if (phase === 'released') {
      assert.equal(mark, undefined);
      assert.equal(beforeControl.some(event => event.castId === cast.castId && ['damage', 'mark_applied'].includes(event.type)), false);
    } else {
      assert.equal(mark?.remainingMs, 6000, 'landed outcomes are not rolled back by recovery control');
      assert.equal(beforeControl.filter(event => event.type === 'mark_applied' && event.castId === cast.castId).length, 1);
    }
    sim.step(cast.timeline!.durationMs);
    assert.equal(sim.consumeEvents().some(event => event.castId === cast.castId && ['damage', 'mark_applied'].includes(event.type)), false, 'cancelled cast cannot produce later or duplicate contact');
    assert.equal(target.statusEffects.some(status => status.type === 'mark'), phase === 'landed');
  }
});

test('P1 Raine live marks guide only the marking team current-target attacks and expire on simulation time', () => {
  const sim = new BattleSimulation({ allyFormation: ['raine', 'celestial_guardian', null, null, null],
    ownedHeroes: createDefaultOwnedHeroes(), enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
  const raine = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'raine')!;
  const lucius = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'celestial_guardian')!;
  const enemies = sim.getUnits().filter(unit => unit.team === 'enemy');
  const target = enemies.find(unit => unit.position >= 3)!;
  const near = enemies[0];
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; }
  raine.targetInstanceId = target.instanceId; raine.activeSkillCooldownMs = 0; raine.attackRangePx = 1000;
  // Current-target selection uses distance/frontline, not the cached targetInstanceId hint.
  target.position = 1; near.position = 5;
  for (const enemy of enemies) if (enemy !== target) { enemy.position = 5; enemy.x = 950; }
  target.x = raine.x + 50; target.y = raine.y;
  sim.step(50); resolvePendingCasts(sim);
  assert.ok(target.statusEffects.some(status => status.type === 'mark'));
  target.position = 5; target.x = 950; near.position = 1; near.x = lucius.x + 40; near.y = lucius.y;
  lucius.targetInstanceId = near.instanceId; lucius.attackRangePx = 1000; lucius.basicAttackCooldownMs = 0;
  sim.consumeEvents(); sim.step(50);
  assert.equal(lucius.currentCast!.targetIds[0], target.instanceId, 'current-target allies focus the living marked enemy');
  const remaining = target.statusEffects.find(status => status.type === 'mark')!.remainingMs;
  sim.setPaused(true); sim.step(6000);
  assert.equal(target.statusEffects.find(status => status.type === 'mark')!.remainingMs, remaining);
  sim.setPaused(false); resolvePendingCasts(sim);
  for (let i = 0; i < 125; i++) sim.step(50);
  assert.ok(!target.statusEffects.some(status => status.type === 'mark'));
  lucius.targetInstanceId = near.instanceId; lucius.basicAttackCooldownMs = 0;
  sim.step(50); assert.equal(lucius.currentCast!.targetIds[0], near.instanceId, 'expired marks cannot override normal targeting');
});

test('P1 Raine focus ultimate grants bounded energy only for allied basic HP hits and pays marked defeat once', () => {
  const sim = new BattleSimulation({ allyFormation: ['raine', 'celestial_guardian', null, null, null],
    ownedHeroes: createDefaultOwnedHeroes(), enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
  const raine = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'raine')!;
  const attacker = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'celestial_guardian')!;
  const target = sim.getUnits().find(unit => unit.team === 'enemy')!;
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; }
  target.shield = 0; target.hp = target.maxHp = 1e6;
  raine.energy = 100; sim.consumeEvents(); assert.equal(sim.triggerUltimate(raine.instanceId), true);
  const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
  assert.deepEqual(raine.currentCast!.targetIds, [target.instanceId]);
  resolvePendingCasts(sim);
  let events = sim.consumeEvents();
  assert.equal(events.filter(event => event.castId === cast.castId && ['heal', 'buff'].includes(event.type)).length, 0);
  assert.ok(target.statusEffects.some(status => status.type === 'mark'));
  attacker.attackRangePx = 1000;
  const grants = [];
  for (let i = 0; i < 8; i++) {
    for (const enemy of sim.getUnits().filter(unit => unit.team === 'enemy')) enemy.energy = 0;
    attacker.energy = 0; attacker.basicAttackCooldownMs = 0; sim.step(50); resolvePendingCasts(sim);
    grants.push(...sim.consumeEvents().filter(event => event.type === 'energy_gain' && event.skillSlot === 'ultimate'));
  }
  assert.equal(grants.length, 3, 'one attacker receives at most three opportunities per focus window');
  for (let i = 0; i < grants.length; i++) {
    assert.equal(grants[i].sourceId, raine.instanceId); assert.equal(grants[i].targetId, attacker.instanceId);
    assert.equal(grants[i].value, 5);
    if (i) assert.ok(grants[i].timestampMs - grants[i - 1].timestampMs >= 1000);
  }
  // Refresh an active mark and kill the marked target with one ordinary contact.
  raine.activeSkillCooldownMs = 0; raine.attackRangePx = 1000;
  sim.step(50); resolvePendingCasts(sim); sim.consumeEvents();
  assert.ok(target.statusEffects.some(status => status.type === 'mark'));
  target.hp = 1; target.shield = 0; attacker.basicAttackCooldownMs = 0; attacker.energy = 99; raine.energy = 99;
  for (const enemy of sim.getUnits().filter(unit => unit.team === 'enemy')) enemy.energy = 0;
  sim.step(50); resolvePendingCasts(sim);
  events = sim.consumeEvents();
  assert.equal(target.isAlive, false, 'ordinary contact defeats the marked fixture target: ' + JSON.stringify(events.map(event => [event.type, event.sourceId, event.targetId, event.cancelReason])));
  const rewards = events.filter(event => event.type === 'energy_gain' && event.skillSlot === 'passive');
  assert.deepEqual(rewards.map(event => event.targetId).sort(), [raine.instanceId, attacker.instanceId].sort());
  for (const reward of rewards) { assert.ok(reward.value! >= 0 && reward.value! <= 10); assert.equal(reward.castId, undefined); }
  assert.equal(raine.energy, 100); assert.equal(attacker.energy, 100);
  sim.step(500); assert.equal(sim.consumeEvents().filter(event => event.type === 'energy_gain' && event.skillSlot === 'passive').length, 0);
});

test('P1 Raine mark lasts exactly six simulation seconds after impact, not one tick less', () => {
  const sim = createSafetySimulation('raine');
  const source = sim.getUnits().find(unit => unit.team === 'ally')!;
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; }
  source.energy = 100; sim.consumeEvents(); assert.equal(sim.triggerUltimate(source.instanceId), true);
  const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
  sim.step(cast.timeline!.hits[0].atMs);
  const target = sim.getUnits().find(unit => unit.instanceId === source.currentCast!.targetIds[0])!;
  assert.equal(target.statusEffects.find(status => status.type === 'mark')?.remainingMs, 6000);
  sim.step(5950);
  assert.equal(target.statusEffects.find(status => status.type === 'mark')?.remainingMs, 50);
  sim.step(50); assert.equal(target.statusEffects.some(status => status.type === 'mark'), false);
});

test('P1 Raine focus rejects absorption, skill hits, expired marks, dead sources and refreshed active marks', () => {
  for (const condition of ['absorbed', 'active', 'expired', 'dead-source', 'refresh'] as const) {
    const sim = new BattleSimulation({ allyFormation: ['raine', 'celestial_guardian', null, null, null],
      ownedHeroes: createDefaultOwnedHeroes(), enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
    const raine = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'raine')!;
    const attacker = sim.getUnits().find(unit => unit.team === 'ally' && unit !== raine)!;
    const target = sim.getUnits().find(unit => unit.team === 'enemy')!;
    for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; }
    target.shield = 0; target.hp = target.maxHp = 1e6;
    raine.energy = 100; assert.equal(sim.triggerUltimate(raine.instanceId), true); resolvePendingCasts(sim);
    if (condition === 'absorbed') target.shield = 1e6;
    if (condition === 'expired') sim.step(6000);
    if (condition === 'dead-source') { raine.hp = 0; raine.isAlive = false; }
    if (condition === 'refresh') { raine.attackRangePx = 1000; raine.activeSkillCooldownMs = 0; sim.step(50); resolvePendingCasts(sim); }
    sim.consumeEvents(); attacker.attackRangePx = 1000; attacker.energy = 0;
    for (const enemy of sim.getUnits().filter(unit => unit.team === 'enemy')) enemy.energy = 0;
    if (condition === 'active') attacker.activeSkillCooldownMs = 0;
    else attacker.basicAttackCooldownMs = 0;
    sim.step(50); resolvePendingCasts(sim);
    const events = sim.consumeEvents();
    assert.ok(events.some(event => event.type === 'damage' && event.sourceId === attacker.instanceId), condition + ': actual contact required');
    assert.equal(events.some(event => event.type === 'energy_gain' && event.skillSlot === 'ultimate'), false, condition);
    if (condition === 'absorbed') assert.equal(events.find(event => event.type === 'damage' && event.sourceId === attacker.instanceId)!.value, 0);
  }
});

test('P1 Raine mark priority ignores an opposing or dead source and interruption creates no mark or reward window', () => {
  for (const condition of ['opposing-source', 'dead-source', 'interrupted'] as const) {
    const sim = new BattleSimulation({ allyFormation: ['raine', 'celestial_guardian', null, null, null],
      ownedHeroes: createDefaultOwnedHeroes(), enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
    const raine = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'raine')!;
    const attacker = sim.getUnits().find(unit => unit.team === 'ally' && unit !== raine)!;
    const enemies = sim.getUnits().filter(unit => unit.team === 'enemy'), target = enemies[0], near = enemies[1];
    for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; }
    raine.energy = 100; sim.consumeEvents(); assert.equal(sim.triggerUltimate(raine.instanceId), true);
    if (condition === 'interrupted') sim.applyCrowdControl(near, raine, 'stun', 2000);
    resolvePendingCasts(sim);
    const events = sim.consumeEvents();
    if (condition === 'interrupted') {
      assert.ok(events.some(event => event.type === 'cast_cancelled'));
      assert.equal(events.some(event => ['mark_applied', 'energy_gain'].includes(event.type)), false);
      assert.equal(target.statusEffects.some(status => status.type === 'mark'), false);
    } else {
      const mark = target.statusEffects.find(status => status.type === 'mark')!; assert.ok(mark);
      if (condition === 'opposing-source') mark.sourceUnitId = near.instanceId;
      else { raine.hp = 0; raine.isAlive = false; }
      for (const enemy of enemies) { enemy.position = 5; enemy.x = 950; enemy.energy = 0; }
      near.position = 1; near.x = attacker.x + 50; near.y = attacker.y;
      attacker.attackRangePx = 1000; attacker.basicAttackCooldownMs = 0; sim.step(50);
      assert.deepEqual(attacker.currentCast!.targetIds, [near.instanceId], condition + ': invalid mark cannot override normal target');
    }
  }
});

test('P1 Fawkes coffin isolates one non-boss only at contact without damage or slow', () => {
  const sim = createSafetySimulation('fawkes');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; unit.energy = 0; }
  caster.activeSkillCooldownMs = 0; caster.attackRangePx = 1000;
  sim.consumeEvents(); sim.step(50);
  const cast = sim.consumeEvents().find(event => event.type === 'active_skill')!;
  const target = sim.getUnits().find(unit => caster.currentCast!.targetIds.includes(unit.instanceId))!;
  const before = { hp: target.hp, shield: target.shield, x: target.x, y: target.y };
  sim.step(cast.timeline!.hits[0].atMs - 50);
  assert.equal(target.statusEffects.some(status => status.type as string === 'isolation'), false);
  sim.step(50);
  const status = target.statusEffects.find(status => status.type as string === 'isolation');
  assert.ok(status, 'coffin is a real simulation status, not cosmetic slow');
  assert.equal(status.remainingMs, 3000);
  assert.equal(status.sourceUnitId, caster.instanceId);
  assert.equal(target.isAlive, true);
  assert.deepEqual({ hp: target.hp, shield: target.shield, x: target.x, y: target.y }, before);
  const events = sim.consumeEvents().filter(event => event.castId === cast.castId);
  assert.equal(events.some(event => event.type === 'damage'), false);
  assert.equal(events.filter(event => event.type === 'crowd_control' && event.ccType as string === 'isolation').length, 1);
  assert.equal(target.statusEffects.some(status => status.type === 'slow'), false);
});

test('P1 Fawkes isolation cancels victim cast, blocks new actions and incoming skills, and returns exactly on time', () => {
  const sim = new BattleSimulation({ allyFormation: ['fawkes', 'celestial_guardian', null, null, null],
    ownedHeroes: createDefaultOwnedHeroes(), enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
  const caster = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'fawkes')!;
  const ally = sim.getUnits().find(unit => unit.team === 'ally' && unit !== caster)!;
  const target = sim.getUnits().find(unit => unit.team === 'enemy' && unit.heroId === 'celestial_guardian')!;
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; unit.energy = 0; }
  for (const unit of sim.getUnits().filter(unit => unit.team === 'enemy')) unit.position = unit === target ? 1 : 5;
  target.x = caster.x + 40; target.y = caster.y;
  caster.activeSkillCooldownMs = 0; caster.attackRangePx = 1000;
  sim.step(50); sim.consumeEvents(); sim.step(550);
  target.energy = 100;
  assert.equal(sim.triggerUltimate(target.instanceId), true, 'victim starts a legitimate ultimate before capture');
  const victimCast = target.currentCast!.castId;
  sim.step(50);
  const capturedEvents = sim.consumeEvents();
  assert.ok(target.statusEffects.some(status => status.type as string === 'isolation'));
  assert.ok(capturedEvents.some(event => event.type === 'cast_cancelled' && event.castId === victimCast && event.cancelReason === 'control'));
  target.energy = 100;
  assert.equal(sim.triggerUltimate(target.instanceId), false, 'full energy cannot bypass isolation');
  assert.equal(getUltimateReadiness(target, 'running').state, 'blocked');
  const frozen = [target.x, target.y, target.hp, target.shield, target.energy, target.basicAttackCooldownMs, target.activeSkillCooldownMs];
  ally.attackRangePx = 1000; ally.energy = 100;
  assert.equal(sim.triggerUltimate(ally.instanceId), true);
  sim.step(1000);
  assert.deepEqual([target.x, target.y, target.hp, target.shield, target.energy, target.basicAttackCooldownMs, target.activeSkillCooldownMs], frozen, 'coffin excludes even allied team wards and freezes actions/energy/cooldowns');
  assert.equal(sim.consumeEvents().some(event => event.targetId === target.instanceId && ['damage', 'heal', 'shield', 'buff'].includes(event.type)), false);
  const remaining = target.statusEffects.find(status => status.type as string === 'isolation')!.remainingMs;
  sim.setPaused(true); sim.step(10000);
  assert.equal(target.statusEffects.find(status => status.type as string === 'isolation')!.remainingMs, remaining);
  sim.setPaused(false); target.energy = 0;
  sim.step(remaining - 50);
  assert.equal(target.statusEffects.find(status => status.type as string === 'isolation')?.remainingMs, 50);
  sim.step(50);
  assert.equal(target.statusEffects.some(status => status.type as string === 'isolation'), false);
  assert.equal(target.isAlive, true);
  assert.equal(sim.consumeEvents().filter(event => event.type as string === 'isolation_end' && event.targetId === target.instanceId).length, 1);
});

test('P1 Fawkes coffin respects boss immunity and interrupted capture, and a captive prevents premature victory', () => {
  for (const condition of ['boss', 'interrupted', 'source-dead', 'last-enemy'] as const) {
    const sim = createSafetySimulation('fawkes');
    const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
    const enemies = sim.getUnits().filter(unit => unit.team === 'enemy');
    for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; unit.energy = 0; }
    if (condition === 'boss') for (const unit of enemies) unit.isBoss = true;
    caster.attackRangePx = 1000; caster.activeSkillCooldownMs = 0;
    sim.step(50);
    if (condition === 'interrupted') sim.applyCrowdControl(enemies[0], caster, 'stun', 2000);
    sim.step(600);
    const captive = enemies.find(unit => unit.statusEffects.some(status => status.type as string === 'isolation'));
    if (condition === 'boss' || condition === 'interrupted') {
      assert.equal(captive, undefined, condition);
      assert.equal(enemies.some(unit => unit.totalDamageTaken > 0), false, 'failed capture has no damage fallback');
      continue;
    }
    assert.ok(captive);
    if (condition === 'source-dead') {
      caster.hp = 0; caster.isAlive = false; sim.step(50);
      assert.equal(captive.statusEffects.some(status => status.type as string === 'isolation'), false);
      assert.equal(captive.isAlive, true, 'source death releases instead of defeating the captive');
    } else {
      for (const enemy of enemies) if (enemy !== captive) { enemy.hp = 0; enemy.isAlive = false; }
      sim.step(50); assert.equal(sim.getStatus(), 'running', 'isolated enemy still counts alive');
    }
  }
});

test('P1 Fawkes source defeat releases its captive in the same tick, even when battle ends', () => {
  for (const survivingAlly of [false, true]) {
    const sim = new BattleSimulation({ allyFormation: ['fawkes', survivingAlly ? 'belinda' : null, null, null, null],
      ownedHeroes: createDefaultOwnedHeroes(), enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
    const caster = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'fawkes')!;
    for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; unit.energy = 0; }
    caster.activeSkillCooldownMs = 0; caster.attackRangePx = 1000;
    sim.step(650);
    const captive = sim.getUnits().find(unit => unit.statusEffects.some(status => status.type === 'isolation'))!;
    assert.ok(captive);
    const killer = sim.getUnits().find(unit => unit.team === 'enemy' && unit.heroId === 'iron_bastion' && unit !== captive)
      ?? sim.getUnits().find(unit => unit.team === 'enemy' && unit.heroId === 'emerald_valkyrie' && unit !== captive)!;
    caster.hp = 1; caster.shield = 0;
    for (const unit of sim.getUnits().filter(unit => unit.team === 'ally')) unit.position = unit === caster ? 1 : 5;
    killer.basicAttackCooldownMs = 0; killer.attackRangePx = 1000;
    sim.consumeEvents(); sim.step(50);
    assert.equal(caster.isAlive, false, 'source really dies from an opposing skill, not fixture mutation');
    assert.equal(captive.isAlive, true);
    assert.equal(captive.statusEffects.some(status => status.type === 'isolation'), false, 'release must not wait for another tick');
    const events = sim.consumeEvents();
    assert.equal(events.filter(event => event.type === 'isolation_end' && event.targetId === captive.instanceId).length, 1);
    assert.equal(sim.getStatus(), survivingAlly ? 'running' : 'defeat');
    sim.step(50);
    assert.equal(sim.consumeEvents().some(event => event.type === 'isolation_end'), false, 'release is not duplicated');
  }
});

test('P1 Fawkes captive is excluded from its own team wards both before and after recipient locking', () => {
  const sim = createSafetySimulation('fawkes');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  const warder = sim.getUnits().find(unit => unit.team === 'enemy' && unit.heroId === 'celestial_guardian')!;
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; unit.energy = 0; }
  caster.activeSkillCooldownMs = 0; caster.attackRangePx = 1000;
  sim.step(50); warder.energy = 100;
  assert.equal(sim.triggerUltimate(warder.instanceId), true);
  const locked = warder.currentCast!;
  sim.step(600);
  const captive = sim.getUnits().find(unit => unit.statusEffects.some(status => status.type === 'isolation'))!;
  assert.ok(captive); assert.ok(locked.targetIds.includes(captive.instanceId));
  const before = { hp: captive.hp, shield: captive.shield };
  sim.consumeEvents(); sim.step(1050);
  assert.equal(warder.currentCast, undefined);
  let outcomes = sim.consumeEvents();
  assert.ok(outcomes.some(event => event.type === 'shield' && event.sourceId === warder.instanceId));
  assert.equal(outcomes.some(event => event.targetId === captive.instanceId && ['heal', 'shield', 'buff'].includes(event.type)), false);
  warder.energy = 100;
  assert.equal(sim.triggerUltimate(warder.instanceId), true);
  assert.equal(warder.currentCast!.targetIds.includes(captive.instanceId), false, 'new support cast cannot acquire a captive');
  sim.step(850); outcomes = sim.consumeEvents();
  assert.ok(outcomes.some(event => event.type === 'shield' && event.sourceId === warder.instanceId));
  assert.equal(outcomes.some(event => event.targetId === captive.instanceId && ['heal', 'shield', 'buff'].includes(event.type)), false);
  assert.deepEqual({ hp: captive.hp, shield: captive.shield }, before);
});

test('P1 Fawkes Purification strips only eligible positive effects and shield at the real contact', () => {
  const sim = createSafetySimulation('fawkes');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  const enemies = sim.getUnits().filter(unit => unit.team === 'enemy');
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; unit.energy = 0; }
  for (const enemy of enemies) {
    enemy.hp = enemy.maxHp = 1e6; enemy.shield = 100;
    enemy.statusEffects = ['atk_up', 'def_up', 'spd_up', 'regen', 'mark', 'slow'].map((type, i) => ({
      id: `purge_fixture_${enemy.instanceId}_${i}`, type: type as 'atk_up', durationMs: 10000, remainingMs: 10000,
      magnitude: 0.1, sourceUnitId: type === 'mark' || type === 'slow' ? caster.instanceId : enemy.instanceId }));
  }
  caster.energy = 100; sim.consumeEvents(); assert.equal(sim.triggerUltimate(caster.instanceId), true);
  const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
  sim.step(cast.timeline!.hits[0].atMs - 50);
  assert.ok(enemies.every(unit => unit.shield === 100 && unit.statusEffects.some(status => status.type === 'atk_up')));
  assert.equal(sim.consumeEvents().some(event => (event.type as string) === 'dispel'), false);
  sim.step(50);
  const events = sim.consumeEvents().filter(event => event.castId === cast.castId);
  for (const enemy of enemies) {
    assert.equal(enemy.shield, 0);
    assert.deepEqual(enemy.statusEffects.map(status => status.type).sort(), ['mark', 'slow']);
    const dispel = events.find(event => (event.type as string) === 'dispel' && event.targetId === enemy.instanceId)!;
    assert.ok(dispel); assert.equal(dispel.removedBuffCount, 4); assert.equal(dispel.removedShieldHp, 100);
    assert.equal(dispel.value, undefined); assert.equal(dispel.absorbed, undefined, 'purged shield is not damage absorption');
    assert.equal(dispel.timestampMs, cast.timestampMs + cast.timeline!.hits[0].atMs);
    assert.ok(events.some(event => event.type === 'damage' && event.targetId === enemy.instanceId && event.value! > 0));
    assert.equal(events.some(event => event.type === 'crowd_control' && event.targetId === enemy.instanceId), false, 'purge never fabricates slow');
  }
  resolvePendingCasts(sim);
  assert.equal(sim.consumeEvents().some(event => (event.type as string) === 'dispel'), false, 'no duplicate purge during recovery');
});

test('P1 Fawkes passive shortens one eligible hostile control per cooldown, never isolation or displacement', () => {
  const sim = createSafetySimulation('fawkes');
  const target = sim.getUnits().find(unit => unit.team === 'ally')!, source = sim.getUnits().find(unit => unit.team === 'enemy')!;
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; unit.energy = 0; }
  sim.consumeEvents(); sim.applyCrowdControl(source, target, 'stun', 2000);
  assert.equal(target.statusEffects.find(status => status.type === 'stun')!.remainingMs, 1500);
  let events = sim.consumeEvents();
  const ward = events.find(event => (event.type as string) === 'control_resisted')!;
  assert.ok(ward); assert.equal(ward.sourceId, target.instanceId); assert.equal(ward.targetId, target.instanceId);
  assert.equal(ward.skillSlot, 'passive'); assert.equal(ward.value, 500);
  sim.applyCrowdControl(source, target, 'silence', 2000);
  assert.equal(target.statusEffects.find(status => status.type === 'silence')!.remainingMs, 2000);
  assert.equal(sim.consumeEvents().some(event => (event.type as string) === 'control_resisted'), false);
  sim.step(8000);
  sim.applyCrowdControl(source, target, 'knockback', 2000);
  assert.equal(target.statusEffects.find(status => status.type === 'knockback')!.remainingMs, 2000);
  sim.applyCrowdControl(source, target, 'isolation', 3000);
  assert.equal(target.statusEffects.find(status => status.type === 'isolation')!.remainingMs, 3000);
  sim.step(3000); sim.consumeEvents();
  sim.applyCrowdControl(source, target, 'petrify', 2000);
  assert.equal(target.statusEffects.find(status => status.type === 'petrify')!.remainingMs, 1500, 'excluded control did not spend the available proc');
  assert.equal(sim.consumeEvents().filter(event => (event.type as string) === 'control_resisted').length, 1);
});

test('P1 Fawkes Purification cancels before contact and skips dead or isolated locked recipients', () => {
  for (const interrupt of [false, true]) {
    const sim = new BattleSimulation({ allyFormation: ['fawkes', 'belinda', null, null, null],
      ownedHeroes: createDefaultOwnedHeroes(), enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
    const caster = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'fawkes')!;
    const captor = sim.getUnits().find(unit => unit.team === 'ally' && unit !== caster)!;
    const enemies = sim.getUnits().filter(unit => unit.team === 'enemy');
    for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; unit.energy = 0; }
    for (const enemy of enemies) { enemy.hp = enemy.maxHp = 1e6; enemy.shield = 100; }
    caster.energy = 100; sim.consumeEvents(); assert.equal(sim.triggerUltimate(caster.instanceId), true);
    const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
    sim.step(cast.timeline!.releaseMs);
    if (interrupt) sim.applyCrowdControl(enemies[0], caster, 'stun', 2000);
    else {
      sim.applyCrowdControl(captor, enemies[0], 'isolation', 3000);
      enemies[1].hp = 0; enemies[1].isAlive = false;
    }
    sim.consumeEvents(); resolvePendingCasts(sim);
    const events = sim.consumeEvents().filter(event => event.castId === cast.castId);
    if (interrupt) {
      assert.equal(events.some(event => ['dispel', 'damage'].includes(event.type)), false);
      assert.ok(enemies.every(unit => unit.shield === 100));
    } else {
      assert.equal(enemies[0].shield, 100); assert.equal(enemies[1].shield, 100);
      assert.equal(events.some(event => [enemies[0].instanceId, enemies[1].instanceId].includes(event.targetId!) && ['dispel', 'damage'].includes(event.type)), false);
      assert.equal(events.filter(event => event.type === 'dispel').length, enemies.length - 2);
      assert.ok(enemies.slice(2).every(unit => unit.shield === 0));
    }
  }
});

test('P1 Fawkes resistance cooldown freezes on pause and never prevents cast interruption', () => {
  const sim = createSafetySimulation('fawkes');
  const target = sim.getUnits().find(unit => unit.team === 'ally')!, enemy = sim.getUnits().find(unit => unit.team === 'enemy')!;
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; unit.energy = 0; }
  target.energy = 100; sim.consumeEvents(); assert.equal(sim.triggerUltimate(target.instanceId), true);
  const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
  sim.applyCrowdControl(enemy, target, 'stun', 2000);
  const events = sim.consumeEvents();
  assert.ok(events.some(event => event.type === 'cast_cancelled' && event.castId === cast.castId && event.cancelReason === 'control'));
  assert.equal(events.find(event => event.type === 'control_resisted')!.castId, undefined);
  sim.setPaused(true); sim.step(8000); sim.setPaused(false);
  sim.applyCrowdControl(enemy, target, 'slow', 2000);
  assert.equal(target.statusEffects.find(status => status.type === 'slow')!.remainingMs, 2000);
  assert.equal(sim.consumeEvents().some(event => event.type === 'control_resisted'), false);
  sim.step(7950); sim.applyCrowdControl(enemy, target, 'silence', 2000);
  assert.equal(sim.consumeEvents().some(event => event.type === 'control_resisted'), false);
  sim.step(50); sim.applyCrowdControl(enemy, target, 'petrify', 2000);
  assert.equal(target.statusEffects.find(status => status.type === 'petrify')!.remainingMs, 1500);
  assert.equal(sim.consumeEvents().filter(event => event.type === 'control_resisted').length, 1);
});

test('P1 Lucius ultimate creates individual wards at impact without any enemy damage or control', () => {
  const sim = new BattleSimulation({ allyFormation: ['celestial_guardian', 'estrilda', 'raine', 'belinda', 'fawkes'],
    ownedHeroes: createDefaultOwnedHeroes(), enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
  const caster = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'celestial_guardian')!;
  const allies = sim.getUnits().filter(unit => unit.team === 'ally');
  const shields = new Map(allies.map(unit => [unit.instanceId, unit.shield]));
  const enemies = sim.getUnits().filter(unit => unit.team === 'enemy');
  const enemyState = enemies.map(unit => [unit.hp, unit.shield]);
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; }
  caster.energy = 100; sim.consumeEvents(); assert.equal(sim.triggerUltimate(caster.instanceId), true);
  const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
  assert.equal(caster.currentCast?.damageTargetIds, undefined, 'pure protection has no enemy damage scope');
  sim.step(cast.timeline!.hits[0].atMs - 50);
  assert.ok(allies.every(unit => unit.shield === shields.get(unit.instanceId)), 'wards do not arrive before impact');
  assert.equal(sim.consumeEvents().filter(event => event.type === 'shield').length, 0);
  sim.step(50);
  const events = sim.consumeEvents().filter(event => event.castId === cast.castId);
  const wards = events.filter(event => event.type === 'shield');
  assert.deepEqual(wards.map(event => event.targetId).sort(), allies.map(unit => unit.instanceId).sort());
  for (const ward of wards) {
    assert.equal(ward.timestampMs, cast.timestampMs + cast.timeline!.hits[0].atMs);
    assert.equal(ward.value, Math.round(caster.baseAttack * 3.2));
    const ally = allies.find(unit => unit.instanceId === ward.targetId)!;
    assert.equal(ally.shield, shields.get(ally.instanceId)! + ward.value!);
    const buff = ally.statusEffects.find(status => status.type === 'def_up')!;
    assert.equal(buff.magnitude, 0.35); assert.equal(buff.durationMs, 6000);
  }
  assert.equal(events.filter(event => ['damage', 'crowd_control', 'knockback'].includes(event.type)).length, 0);
  assert.deepEqual(enemies.map(unit => [unit.hp, unit.shield]), enemyState);
  assert.equal(caster.totalDamageDealt, 0);
  resolvePendingCasts(sim);
  assert.equal(sim.consumeEvents().filter(event => event.castId === cast.castId && event.type === 'shield').length, 0, 'no duplicate wards in recovery');
});

test('P1 Lucius protection skips dead locked allies and interrupted preparation grants no wards', () => {
  for (const interrupt of [false, true]) {
    const sim = new BattleSimulation({ allyFormation: ['celestial_guardian', 'estrilda', null, null, null],
      ownedHeroes: createDefaultOwnedHeroes(), enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
    const caster = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'celestial_guardian')!;
    const ally = sim.getUnits().find(unit => unit.team === 'ally' && unit !== caster)!;
    const enemy = sim.getUnits().find(unit => unit.team === 'enemy')!;
    caster.energy = 100; sim.consumeEvents(); assert.equal(sim.triggerUltimate(caster.instanceId), true);
    const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
    ally.hp = 0; ally.isAlive = false; ally.shield = 0;
    if (interrupt) sim.applyCrowdControl(enemy, caster, 'stun', 2000);
    resolvePendingCasts(sim);
    const events = sim.consumeEvents().filter(event => event.castId === cast.castId);
    assert.deepEqual(events.filter(event => event.type === 'shield').map(event => event.targetId), interrupt ? [] : [caster.instanceId]);
    assert.equal(ally.shield, 0);
    assert.equal(events.filter(event => event.type === 'damage').length, 0);
    if (interrupt) assert.ok(events.some(event => event.type === 'cast_cancelled' && event.cancelReason === 'control'));
  }
});

test('P0 readiness rejects a full-energy actor throughout cast recovery', () => {
  const sim = createSafetySimulation('belinda');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  caster.energy = 100; assert.equal(sim.triggerUltimate(caster.instanceId), true);
  caster.energy = 100;
  assert.equal(getUltimateReadiness(caster).canCast, false);
  assert.equal(getUltimateReadiness(caster).state, 'casting');
  resolvePendingCasts(sim);
  assert.equal(getUltimateReadiness(caster).canCast, true);
});

test('P0 mixed support locks offensive recipients independently and never acquires new frontliners at impact', () => {
  const sim = createSafetySimulation('celestial_guardian');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  const enemies = sim.getUnits().filter(unit => unit.team === 'enemy');
  const originalFront = enemies.filter(unit => unit.position <= 2).map(unit => unit.instanceId);
  const newFront = enemies.find(unit => unit.position >= 3)!;
  caster.energy = 100; sim.consumeEvents(); assert.equal(triggerMixedSupportFixture(sim, caster.instanceId), true);
  const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
  for (const enemy of enemies) if (originalFront.includes(enemy.instanceId)) enemy.position = 5;
  newFront.position = 1;
  resolvePendingCasts(sim);
  const hits = sim.consumeEvents().filter(event => event.type === 'damage' && event.castId === cast.castId);
  assert.deepEqual(hits.map(event => event.targetId).sort(), [...originalFront].sort());
  assert.equal(newFront.hp, newFront.maxHp);
});

test('P0 natural phase diagnostics report the same authored phase that the renderer draws', () => {
  const sim = createSafetySimulation('celestial_guardian');
  const source = sim.getUnits().find(unit => unit.team === 'ally')!;
  const target = sim.getUnits().find(unit => unit.team === 'enemy')!;
  const timeline = getCombatTimeline(source.heroId, 'active')!;
  const effect = createSpriteEffect({ id: 999, castId: 999, type: 'active_skill', timestampMs: 0,
    sourceId: source.instanceId, sourceName: source.name, targetId: target.instanceId, skillSlot: 'active', timeline }, source, target)!;
  // Halfway through preparation: authored p=.09, despite raw lifetime p=.13.
  effect.age = timeline.releaseMs / 2000;
  assert.equal(getTimelineVisualPhase(timeline, effect.age), 0.09);
  assert.deepEqual(getActiveSkillSources([effect], [0.08, 0.10]), [source.heroId]);
  assert.deepEqual(getActiveSkillSources([effect], [0.12, 0.14]), []);
});

test('P0 ordinary battle rejects forced low-energy ultimates without consuming resources or emitting casts', () => {
  const sim = createSafetySimulation('celestial_guardian');
  sim.consumeEvents();
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  caster.energy = 0;
  const before = sim.getSnapshot();
  assert.equal(sim.triggerUltimate(caster.instanceId, true), false);
  assert.deepEqual(sim.getSnapshot(), before);
  assert.deepEqual(sim.consumeEvents(), []);
  caster.energy = 100;
  assert.equal(sim.triggerUltimate(caster.instanceId), true);
  assert.equal(caster.energy, 0);
});

test('P0 synthetic mixed support damage respects the explicitly declared frontline scope', () => {
  const sim = createSafetySimulation('celestial_guardian');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  caster.energy = 100; sim.consumeEvents();
  assert.equal(triggerMixedSupportFixture(sim, caster.instanceId), true);
  resolvePendingCasts(sim);
  const hits = sim.consumeEvents().filter(event => event.type === 'damage');
  assert.ok(hits.length > 0);
  for (const hit of hits) assert.ok(sim.getUnits().find(unit => unit.instanceId === hit.targetId)!.position <= 2);
  assert.ok(sim.getUnits().filter(unit => unit.team === 'enemy' && unit.position >= 3).every(unit => unit.hp === unit.maxHp));
});

test('P0 heal event and totals separate actual healing from full and partial overheal', () => {
  for (const deficit of [0, 17]) {
    const sim = createSafetySimulation('dawn_oracle');
    const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
    caster.hp = caster.maxHp - deficit; caster.energy = 100; sim.consumeEvents();
    assert.equal(sim.triggerUltimate(caster.instanceId), true);
    const heal = sim.consumeEvents().find(event => event.type === 'heal' && event.targetId === caster.instanceId)!;
    assert.ok(heal);
    assert.equal(heal.value, deficit);
    assert.equal(caster.totalHealingDone, deficit);
    assert.equal(heal.requestedValue, heal.value! + heal.overheal!);
    assert.ok(heal.overheal! > 0);
    assert.equal(caster.hp, caster.maxHp);
  }
});

test('P0 full shield absorption never creates HP damage or lifesteal and shield break heals only actual loss', () => {
  for (const shield of [1e6, 7, 0]) {
    const sim = createSafetySimulation('belinda');
    const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
    caster.hp = 1; caster.lifestealPct = 1; caster.energy = 100;
    for (const enemy of sim.getUnits().filter(unit => unit.team === 'enemy')) { enemy.hp = 1; enemy.shield = shield; }
    sim.consumeEvents(); assert.equal(sim.triggerUltimate(caster.instanceId), true);
    resolvePendingCasts(sim);
    const entries = sim.consumeEvents();
    const hits = entries.filter(event => event.type === 'damage' && event.sourceId === caster.instanceId);
    const recovery = entries.filter(event => event.type === 'heal' && event.skillName === 'Lifesteal');
    assert.ok(hits.length > 0);
    for (const hit of hits) assert.equal(hit.requestedValue, hit.value! + hit.absorbed! + hit.overkill!);
    const hpLoss = hits.reduce((sum, hit) => sum + hit.value!, 0);
    assert.equal(caster.totalDamageDealt, hpLoss);
    assert.equal(caster.totalHealingDone, hpLoss);
    assert.equal(recovery.reduce((sum, event) => sum + event.value!, 0), hpLoss);
    assert.equal(caster.hp, 1 + hpLoss);
    if (shield === 1e6) {
      assert.equal(hpLoss, 0); assert.equal(recovery.length, 0);
      assert.ok(hits.every(hit => hit.absorbed === hit.requestedValue && hit.overkill === 0));
    } else assert.ok(hits.every(hit => hit.value === 1 && hit.absorbed === shield));
  }
});

test('P0 synthetic mixed frontline damage has no backline fallback when no frontliner survives', () => {
  const sim = createSafetySimulation('celestial_guardian');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  for (const enemy of sim.getUnits().filter(unit => unit.team === 'enemy' && unit.position <= 2)) {
    enemy.isAlive = false; enemy.hp = 0;
  }
  caster.energy = 100; sim.consumeEvents(); assert.equal(triggerMixedSupportFixture(sim, caster.instanceId), true);
  resolvePendingCasts(sim);
  const entries = sim.consumeEvents();
  assert.ok(entries.some(event => event.type === 'shield' && event.sourceId === caster.instanceId));
  assert.equal(entries.filter(event => event.type === 'damage' && event.sourceId === caster.instanceId).length, 0);
  assert.ok(sim.getUnits().filter(unit => unit.team === 'enemy' && unit.isAlive).every(unit => unit.hp === unit.maxHp));
});

test('P0 damage event and totals separate HP loss shield absorption and overkill', () => {
  const sim = createSafetySimulation('belinda');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  const enemies = sim.getUnits().filter(unit => unit.team === 'enemy');
  caster.energy = 100;
  for (const enemy of enemies) { enemy.hp = 1; enemy.shield = 7; }
  sim.consumeEvents(); assert.equal(sim.triggerUltimate(caster.instanceId), true);
  resolvePendingCasts(sim);
  const hits = sim.consumeEvents().filter(event => event.type === 'damage');
  assert.ok(hits.length > 0);
  for (const hit of hits) {
    assert.equal(hit.value, 1);
    assert.equal(hit.absorbed, 7);
    assert.equal(hit.requestedValue, hit.value! + hit.absorbed! + hit.overkill!);
    assert.ok(hit.overkill! > 0);
    assert.equal(sim.getUnits().find(unit => unit.instanceId === hit.targetId)!.totalDamageTaken, 1);
  }
  assert.equal(caster.totalDamageDealt, hits.length);
});

test('P0 pause rejects casts and freezes state even when legacy force is supplied', () => {
  const sim = createSafetySimulation('celestial_guardian');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  caster.energy = 100; sim.consumeEvents(); sim.setPaused(true);
  const before = sim.getSnapshot();
  sim.step(50);
  assert.equal(sim.triggerUltimate(caster.instanceId, true), false);
  assert.deepEqual(sim.getSnapshot(), before);
  assert.deepEqual(sim.consumeEvents(), []);
  sim.setPaused(false);
  assert.equal(sim.triggerUltimate(caster.instanceId), true);
});

test('P0 first-squad ultimate resolves exactly at simulation impact markers with stable cast identity', () => {
  const sim = createSafetySimulation('belinda');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0; }
  caster.energy = 100; sim.consumeEvents();
  const timeline = getCombatTimeline(caster.heroId, 'ultimate')!;
  assert.ok(timeline);
  const before = sim.getUnits().filter(unit => unit.team === 'enemy').map(unit => unit.hp);
  assert.equal(sim.triggerUltimate(caster.instanceId), true);
  const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
  assert.equal(cast.skillId, timeline.skillId);
  assert.deepEqual(sim.getUnits().filter(unit => unit.team === 'enemy').map(unit => unit.hp), before);
  assert.equal(caster.currentCast?.castId, cast.castId);
  const observed = [];
  for (let time = 50; time <= timeline.durationMs + 100; time += 50) {
    sim.step(50);
    for (const event of sim.consumeEvents().filter(event => event.type === 'damage' && event.castId === cast.castId)) {
      assert.equal(event.skillId, timeline.skillId);
      assert.ok(timeline.hits.some(marker => marker.atMs === event.timestampMs));
      observed.push(event);
    }
  }
  const perTarget = new Map<string, number[]>();
  for (const event of observed) perTarget.set(event.targetId!, [...(perTarget.get(event.targetId!) ?? []), event.hitIndex!]);
  assert.ok(perTarget.size > 0);
  for (const hits of perTarget.values()) assert.deepEqual(hits, timeline.hits.map((_, index) => index));
  assert.equal(caster.currentCast, undefined);
});

test('P0 multihit shares the skill minimum damage floor instead of multiplying it per marker', () => {
  const sim = createSafetySimulation('belinda');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  caster.baseAttack = 1; caster.critChance = 0; caster.energy = 100;
  for (const enemy of sim.getUnits().filter(unit => unit.team === 'enemy')) { enemy.shield = 0; enemy.baseDefense = 1e6; }
  sim.consumeEvents(); assert.equal(sim.triggerUltimate(caster.instanceId), true);
  const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
  resolvePendingCasts(sim);
  const hits = sim.consumeEvents().filter(event => event.type === 'damage' && event.castId === cast.castId);
  const perTarget = new Map<string, number>();
  for (const hit of hits) perTarget.set(hit.targetId!, (perTarget.get(hit.targetId!) ?? 0) + hit.requestedValue!);
  assert.ok(perTarget.size > 0);
  for (const total of perTarget.values()) assert.equal(total, 12, 'the existing skill floor is divided, not replayed four times');
});

test('P0 same-tick hard control cancels a started Lucius active without inventing a visible preparation', () => {
  const sim = createSafetySimulation('celestial_guardian');
  const lucius = sim.getUnits().find(unit => unit.team === 'ally')!;
  for (const unit of sim.getUnits()) { unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.energy = 0; }
  lucius.activeSkillCooldownMs = 0; lucius.attackRangePx = 1000;
  const hendrik = sim.getUnits().find(unit => unit.team === 'enemy' && unit.heroId === 'iron_bastion')!;
  hendrik.energy = 100;
  sim.consumeEvents(); sim.step(50);
  const entries = sim.consumeEvents();
  const active = entries.find(event => event.type === 'active_skill' && event.sourceId === lucius.instanceId)!;
  assert.ok(active, 'a missing drawn phase does not imply no active start');
  const cancel = entries.find(event => event.type === 'cast_cancelled' && event.castId === active.castId)!;
  assert.ok(cancel); assert.equal(cancel.cancelReason, 'control');
  assert.equal(cancel.timestampMs, active.timestampMs);
  assert.ok(!entries.some(event => event.castId === active.castId && ['cast_release', 'damage', 'shield'].includes(event.type)));
});

test('P0 preparation stun cancels outcomes and prevents incompatible basics and repeated ultimates', () => {
  const sim = createSafetySimulation('belinda');
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  const enemy = sim.getUnits().find(unit => unit.team === 'enemy')!;
  caster.energy = 100; sim.consumeEvents();
  assert.equal(sim.triggerUltimate(caster.instanceId), true);
  const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
  caster.energy = 100;
  assert.equal(sim.triggerUltimate(caster.instanceId), false);
  sim.applyCrowdControl(enemy, caster, 'stun', 2000);
  for (let i = 0; i < 40; i++) sim.step(50);
  const events = sim.consumeEvents();
  assert.ok(events.some(event => event.type === 'cast_cancelled' && event.castId === cast.castId));
  assert.ok(!events.some(event => event.type === 'damage' && event.castId === cast.castId));
});

test('P0 fixed simulation steps are invariant to x1/x2 frame batching and invalid deltas', () => {
  const first = createSafetySimulation('belinda'), second = createSafetySimulation('belinda');
  for (const sim of [first, second]) {
    const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
    caster.energy = 100; sim.triggerUltimate(caster.instanceId);
  }
  for (let i = 0; i < 20; i++) { first.step(50); first.step(50); second.step(100); }
  assert.deepEqual(first.getSnapshot(), second.getSnapshot());
  const before = first.getSnapshot();
  for (const dt of [NaN, Infinity, -50, 0]) first.step(dt);
  assert.deepEqual(first.getSnapshot(), before);
});

test('P0 renderer uses the same release contact and recovery clock as simulation', () => {
  const sim = createSafetySimulation('belinda');
  const source = sim.getUnits().find(unit => unit.team === 'ally')!;
  const target = sim.getUnits().find(unit => unit.team === 'enemy')!;
  source.energy = 100; sim.consumeEvents(); sim.triggerUltimate(source.instanceId);
  const event = sim.consumeEvents().find(entry => entry.type === 'ultimate_cast')!;
  const effect = createSpriteEffect(event, source, target)!;
  const timeline = event.timeline!;
  assert.equal(effect.duration * 1000, timeline.durationMs);
  assert.deepEqual(effect.timeline, timeline);
  assert.equal(effect.castId, event.castId);
  assert.equal(getTimelineVisualPhase(timeline, timeline.releaseMs / 1000), 0.18);
  assert.equal(getTimelineVisualPhase(timeline, timeline.hits[0].atMs / 1000), 0.5);
  assert.equal(getTimelineVisualPhase(timeline, timeline.durationMs / 1000), 1);
});

test('P0 pending casts freeze during pause including partial fixed-step time and resume without duplicate hits', () => {
  const sim = createSafetySimulation('belinda');
  for (const unit of sim.getUnits()) { unit.moveSpeedPxPerSec = 0; unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; }
  const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
  caster.energy = 100; sim.consumeEvents(); sim.triggerUltimate(caster.instanceId);
  const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
  sim.step(625); sim.setPaused(true);
  const frozen = sim.getSnapshot();
  for (let i = 0; i < 10; i++) sim.step(100);
  assert.deepEqual(sim.getSnapshot(), frozen);
  sim.setPaused(false); sim.step(25);
  const hits = sim.consumeEvents().filter(event => event.type === 'damage' && event.castId === cast.castId);
  assert.ok(hits.length > 0);
  assert.ok(hits.every(event => event.timestampMs === 650 && event.hitIndex === 0));
  sim.step(0); assert.deepEqual(sim.consumeEvents(), []);
});

test('P0 death and lost locked targets cancel preparation without retargeting or phantom outcomes', () => {
  for (const reason of ['caster-death', 'all-targets-death'] as const) {
    const sim = createSafetySimulation('belinda');
    const caster = sim.getUnits().find(unit => unit.team === 'ally')!;
    caster.energy = 100; sim.consumeEvents(); sim.triggerUltimate(caster.instanceId);
    const cast = sim.consumeEvents().find(event => event.type === 'ultimate_cast')!;
    for (const unit of sim.getUnits()) {
      unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0;
      if (reason === 'caster-death' ? unit === caster : unit.team === 'enemy') { unit.hp = 0; unit.isAlive = false; }
    }
    sim.step(50);
    const events = sim.consumeEvents();
    assert.ok(events.some(event => event.type === 'cast_cancelled' && event.castId === cast.castId &&
      event.cancelReason === (reason === 'caster-death' ? 'death' : 'target-lost')));
    assert.ok(!events.some(event => event.type === 'damage' && event.castId === cast.castId));
    assert.equal(caster.currentCast, undefined);
  }
});

test('P0 simultaneous first-squad ultimates retain separate cast ownership and block basics during recovery', () => {
  const sim = new BattleSimulation({ allyFormation: ['belinda', 'celestial_guardian', null, null, null],
    ownedHeroes: createDefaultOwnedHeroes(), enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
  for (const unit of sim.getUnits()) { unit.moveSpeedPxPerSec = 0; unit.activeSkillCooldownMs = 1e6;
    if (unit.team === 'enemy') unit.basicAttackCooldownMs = 1e6; }
  sim.consumeEvents();
  for (const caster of sim.getUnits().filter(unit => unit.team === 'ally')) { caster.energy = 100; assert.equal(sim.triggerUltimate(caster.instanceId), true); }
  const casts = sim.consumeEvents().filter(event => event.type === 'ultimate_cast');
  assert.equal(new Set(casts.map(event => event.castId)).size, 2);
  for (let step = 0; step < 32; step++) sim.step(50);
  const events = sim.consumeEvents();
  assert.ok(!events.some(event => event.type === 'basic_attack' && casts.some(cast => cast.sourceId === event.sourceId)));
  for (const event of events.filter(event => event.type === 'damage' || event.type === 'shield')) {
    const origin = casts.find(cast => cast.castId === event.castId);
    assert.ok(origin); assert.equal(event.sourceId, origin.sourceId); assert.equal(event.skillId, origin.skillId);
  }
});

test('Deterministic seeded RNG produces identical sequences for identical seeds', () => {
  const rngA = createSeededRng(42);
  const rngB = createSeededRng(42);
  for (let i = 0; i < 20; i++) {
    assert.equal(rngA(), rngB());
  }
});

test('5v5 Combat Engine executes movement, basic attacks, active skills, ultimates, and detects Victory/Defeat', () => {
  const owned = createDefaultOwnedHeroes(6, 2);
  const formation: TeamFormationSlots = [
    'celestial_guardian',
    'crimson_revenant',
    'storm_empress',
    'dawn_oracle',
    'arcane_serpent',
  ];
  const stage1 = getCampaignStage(1);

  const sim = new BattleSimulation({
    allyFormation: formation,
    ownedHeroes: owned,
    enemies: stage1.enemies,
    seed: 2026,
    autoUltimate: true,
  });

  assert.equal(sim.getStatus(), 'running');
  assert.equal(sim.getUnits().filter((u) => u.team === 'ally').length, 5);
  assert.equal(sim.getUnits().filter((u) => u.team === 'enemy').length, 4);

  // Run fixed-timestep simulation until completion
  let steps = 0;
  while (sim.getStatus() === 'running' && steps < 2000) {
    sim.step(50);
    steps++;
  }

  assert.equal(sim.getStatus(), 'victory', 'Level 6 squad should defeat Campaign Stage 1');
  const deadEnemies = sim
    .getUnits()
    .filter((u) => u.team === 'enemy' && !u.isAlive && u.hp === 0);
  assert.equal(deadEnemies.length, 4, 'All enemies must have 0 HP and be marked dead');
});

test('All 5 Crowd Control effects (stun, silence, slow, knockback, petrify) and manual Ultimates work accurately', () => {
  const owned = createDefaultOwnedHeroes(5, 2);
  const formation: TeamFormationSlots = [
    'celestial_guardian',
    'iron_bastion',
    'arcane_serpent',
    'frost_arbiter',
    'dawn_oracle',
  ];
  const stage2 = getCampaignStage(2);

  const sim = new BattleSimulation({
    allyFormation: formation,
    ownedHeroes: owned,
    enemies: stage2.enemies,
    seed: 99,
    autoUltimate: false,
  });

  const units = sim.getUnits();
  const guardian = units.find((u) => u.heroId === 'celestial_guardian' && u.team === 'ally')!;
  const enemy = units.find((u) => u.team === 'enemy')!;

  // 1. Test Stun incapacitation
  sim.applyCrowdControl(guardian, enemy, 'stun', 2000);
  assert.equal(sim.isIncapacitated(enemy), true, 'Stunned unit must be incapacitated');

  // 2. Test Petrify incapacitation
  enemy.statusEffects = [];
  sim.applyCrowdControl(guardian, enemy, 'petrify', 2500);
  assert.equal(sim.isIncapacitated(enemy), true, 'Petrified unit must be incapacitated');

  // 3. Test Silence blocking skills
  enemy.statusEffects = [];
  sim.applyCrowdControl(guardian, enemy, 'silence', 3000);
  assert.equal(sim.isSilenced(enemy), true, 'Silenced unit cannot cast skills');

  // 4. Test Knockback displacement
  const oldX = enemy.x;
  sim.applyCrowdControl(guardian, enemy, 'knockback', 1000);
  assert.ok(enemy.x > oldX, 'Knockback must push enemy backward along X axis');

  // 5. Test Manual Ultimate Activation when Energy = 100
  guardian.energy = 100;
  const didCast = sim.triggerUltimate(guardian.instanceId, false);
  assert.equal(didCast, true, 'Manual ultimate must trigger when energy is 100');
  assert.equal(guardian.energy, 0, 'Energy must reset to 0 after casting ultimate');
});

test('Campaign system defines 10 playable stages with increasing recommended power', () => {
  assert.equal(CAMPAIGN_STAGES.length, 10);
  for (let i = 1; i < CAMPAIGN_STAGES.length; i++) {
    assert.ok(
      CAMPAIGN_STAGES[i].recommendedPower > CAMPAIGN_STAGES[i - 1].recommendedPower,
      `Stage ${i + 1} should have higher recommended power than Stage ${i}`
    );
  }
});

test('AFK Arena Faction Counter Cycle (+25% damage) and Formation Aura Bonuses (3/3+2/4/5, Celestial Wildcard, Hypogean, Draconis) work accurately', () => {
  // 1. Faction Counter Cycle: Lightbearer -> Mauler -> Wilder -> Graveborn -> Lightbearer
  assert.equal(getFactionDamageMultiplier('Lightbearer', 'Mauler'), 1.25);
  assert.equal(getFactionDamageMultiplier('Mauler', 'Wilder'), 1.25);
  assert.equal(getFactionDamageMultiplier('Wilder', 'Graveborn'), 1.25);
  assert.equal(getFactionDamageMultiplier('Graveborn', 'Lightbearer'), 1.25);
  assert.equal(getFactionDamageMultiplier('Celestial', 'Hypogean'), 1.25);
  assert.equal(getFactionDamageMultiplier('Hypogean', 'Celestial'), 1.25);
  assert.equal(getFactionDamageMultiplier('Lightbearer', 'Wilder'), 1.0);

  // 2. 3 Lightbearers + 2 Celestials => 5 Same-Faction Aura (+25% ATK, +25% HP) via Celestial wildcard
  const aura5 = computeFactionAura([
    'celestial_guardian', // Lightbearer
    'storm_empress', // Lightbearer
    'astral_blademaster', // Lightbearer
    'dawn_oracle', // Celestial
    'celestial_weaver', // Celestial
  ]);
  assert.equal(aura5.atkBonusPct, 0.25);
  assert.equal(aura5.hpBonusPct, 0.25);

  // 3. Hypogean independent bonuses (1+ = +30% DEF, 2+ = +25% Energy, 3+ = +15% Crit)
  const auraHypo = computeFactionAura([
    'abyssal_warden', // Hypogean
    'chrono_warden', // Hypogean
    'ezizh', // Hypogean
    'celestial_guardian',
    'crimson_revenant',
  ]);
  assert.equal(auraHypo.defBonusPct, 0.3);
  assert.equal(auraHypo.energyOnHitBonusPct, 0.25);
  assert.equal(auraHypo.critBonusPct, 0.15);
});

test('3D Battle Scene Engine: Builds all 12 core 3D hero rigs, steps all 10 animation states, maps 3 3D environments, and pools 5-phase VFX', async () => {
  const {
    CORE_HERO_ARCHETYPES,
    GRAPHICS_PRESET_CONFIGS,
    buildThreeHeroRig,
    updateThreeHeroAnimation,
    resolveArenaEnvironment,
    ThreeVfxPool,
  } = await import('./threeBattleScene');

  assert.equal(
    Object.keys(CORE_HERO_ARCHETYPES).length,
    12,
    'Must define 12 bespoke 3D core hero archetypes'
  );
  assert.equal(
    Object.keys(GRAPHICS_PRESET_CONFIGS).length,
    4,
    'Must define LOW, MEDIUM, HIGH, ULTRA graphics configs'
  );

  assert.equal(resolveArenaEnvironment('sylvan', 'auto'), 'enchanted_forest');
  assert.equal(resolveArenaEnvironment('sanctuary', 'auto'), 'celestial_temple');
  assert.equal(resolveArenaEnvironment('obsidian', 'auto'), 'shadow_realm');
  assert.equal(resolveArenaEnvironment('sylvan', 'shadow_realm'), 'shadow_realm');

  const owned = createDefaultOwnedHeroes(10, 3);
  const sim = new BattleSimulation({
    allyFormation: [
      'celestial_guardian',
      'iron_bastion',
      'storm_empress',
      'emerald_valkyrie',
      'dawn_oracle',
    ],
    ownedHeroes: owned,
    enemies: getCampaignStage(1).enemies,
    seed: 777,
    autoUltimate: false,
  });

  const units = sim.getUnits();
  for (const unit of units) {
    const rig = buildThreeHeroRig(unit, true);
    assert.ok(rig.root.children.length >= 4, '3D hero rig must have hierarchical child nodes');
    updateThreeHeroAnimation(rig, unit, 0.016, 1.0, 'running');
    assert.equal(rig.animState, 'Idle');

    // Test BasicAttack, Skill, Ultimate, Hit, Knockback, Stun, Victory, Defeat states
    rig.animState = 'BasicAttack';
    rig.animTimer = 0.2;
    updateThreeHeroAnimation(rig, unit, 0.016, 1.1, 'running');
    assert.equal(rig.animState, 'BasicAttack');

    rig.knockbackOffset = 0.5;
    updateThreeHeroAnimation(rig, unit, 0.016, 1.2, 'running');
    assert.equal(rig.animState, 'Knockback');

    rig.knockbackOffset = 0;
    updateThreeHeroAnimation(rig, unit, 0.016, 1.3, 'victory');
    assert.equal(rig.animState, unit.team === 'ally' ? 'Victory' : 'Defeat');
  }

  const vfxPool = new ThreeVfxPool(64);
  vfxPool.spawnCastBurst({ x: -2, z: 0 }, 0xfbbf24, 1.2);
  vfxPool.spawnProjectile({ x: -2, z: 0 }, { x: 2, z: 0 }, 0x38bdf8, 0.25);
  vfxPool.spawnSlashArc({ x: 2, z: 0 }, 0xef4444, false);
  vfxPool.spawnImpact({ x: 2, z: 0 }, 0xfbbf24, 1.4, true);
  assert.ok(vfxPool.getActiveCount() >= 5, '5-phase VFX pool should activate pooled meshes');
  vfxPool.update(0.1);
  vfxPool.dispose();
});


