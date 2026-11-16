// PROTOTYPE - NOT FOR PRODUCTION
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BattleSimulation } from './battleEngine';
import { createBattlePresentationObserver, playBattleImpact } from './battlePresentation';
import { createInitialData } from '../store/gameStore';
import { getCampaignStage } from './campaign';
import { ThreeVfxPool } from './threeBattleScene';
import { getHeroById } from './heroes';
import { OATHBOUND_HEROES } from './oathboundHeroes';
import type { BattleSnapshot, CombatEvent, TeamFormationSlots } from './types';

test('opening passive wards emit once from initialized shields and actual cast outcomes preserve attribution', () => {
  const sim = fixture();
  const opening = sim.consumeEvents();
  const shielded = sim.getUnits().filter(unit => unit.shield > 0);
  const wards = opening.filter(event => event.type === 'shield' && event.skillSlot === 'passive');
  assert.equal(wards.length, shielded.length);
  for (const unit of shielded) {
    const ward = wards.find(event => event.sourceId === unit.instanceId)!;
    assert.equal(ward.targetId, unit.instanceId);
    assert.equal(ward.value, unit.shield);
    assert.equal(ward.skillName, getHeroById(unit.heroId).skills.passive.name);
  }
  assert.deepEqual(sim.consumeEvents(), [], 'opening wards cannot replay');
  const caster = sim.getUnits().find(unit => unit.heroId === 'celestial_guardian' && unit.team === 'ally')!;
  caster.energy = 100;
  assert.equal(sim.triggerUltimate(caster.instanceId), true);
  const events = collectCast(sim, caster.instanceId);
  const cast = events.find(event => event.type === 'ultimate_cast')!;
  const outcomes = events.filter(event => event.sourceId === caster.instanceId && ['damage', 'shield', 'buff'].includes(event.type));
  assert.equal(outcomes.filter(event => event.type === 'damage').length, 0, 'Lucius protection cannot fabricate offensive outcomes');
  const livingAllies = sim.getUnits().filter(unit => unit.team === 'ally' && unit.isAlive).map(unit => unit.instanceId).sort();
  for (const type of ['shield', 'buff']) {
    assert.deepEqual(outcomes.filter(event => event.type === type).map(event => event.targetId).sort(), livingAllies);
  }
  for (const event of [cast, ...outcomes]) {
    assert.equal(event.skillSlot, 'ultimate'); assert.equal(event.castId, cast.id);
    assert.equal(event.skillName, getHeroById(caster.heroId).skills.ultimate.name);
    assert.ok(event.vfxColor && event.vfxShape);
    if (event !== cast) assert.ok(sim.getUnits().some(unit => unit.instanceId === event.targetId));
  }
});

test('every imported opening passive reports only its actual initialized ward and never fabricates a passive attack', () => {
  for (const hero of OATHBOUND_HEROES) {
    const initial = createInitialData();
    const formation = [hero.heroId, ...initial.formation.filter(id => id !== hero.heroId)].slice(0, 5) as TeamFormationSlots;
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes: initial.ownedHeroes,
      enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const unit = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === hero.heroId)!;
    const events = sim.consumeEvents().filter(event => event.sourceId === unit.instanceId);
    const passive = getHeroById(hero.heroId).skills.passive;
    assert.equal(events.length, unit.shield > 0 ? 1 : 0, `${hero.name}: no invented trigger for static bonuses`);
    for (const event of events) {
      assert.equal(event.type, 'shield'); assert.equal(event.skillSlot, 'passive');
      assert.equal(event.targetId, unit.instanceId); assert.equal(event.value, unit.shield);
      assert.equal(event.skillName, passive.name); assert.equal(event.castId, undefined);
    }
    assert.deepEqual(sim.consumeEvents(), [], `${hero.name}: ward does not replay`);
  }
});

test('actual lifesteal remains a self-heal attributed to the triggering attack, not a fabricated extra passive cast', () => {
  const initial = createInitialData();
  const formation = ['astral_blademaster', ...initial.formation].slice(0, 5) as TeamFormationSlots;
  const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes: initial.ownedHeroes,
    enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
  const caster = sim.getUnits().find(unit => unit.team === 'ally' && unit.heroId === 'astral_blademaster')!;
  sim.consumeEvents();
  const observed: CombatEvent[] = [];
  for (let step = 0; step < 200 && sim.getStatus() === 'running' && !observed.some(event => event.skillName === 'Lifesteal'); step++) {
    sim.step(50); observed.push(...sim.consumeEvents().filter(event => event.sourceId === caster.instanceId));
  }
  const heals = observed.filter(event => event.type === 'heal' && event.skillName === 'Lifesteal');
  assert.ok(heals.length > 0);
  for (const heal of heals) {
    assert.equal(heal.targetId, caster.instanceId); assert.ok(heal.value! > 0);
    const cast = observed.find(event => event.id === heal.castId)!;
    assert.ok(cast); assert.equal(heal.skillSlot, cast.skillSlot);
    assert.ok(['basic', 'active', 'ultimate'].includes(heal.skillSlot!));
  }
  assert.equal(observed.some(event => event.skillSlot === 'passive' && event.type !== 'shield'), false);
});

test('completed casts never leak presentation attribution into later public crowd control', () => {
  const sim = fixture();
  sim.consumeEvents();
  const caster = sim.getUnits().find(unit => unit.heroId === 'celestial_guardian' && unit.team === 'ally')!;
  caster.energy = 100;
  assert.equal(sim.triggerUltimate(caster.instanceId), true);
  const cast = collectCast(sim, caster.instanceId).find(event => event.type === 'ultimate_cast')!;
  assert.equal(cast.skillSlot, 'ultimate');
  const target = sim.getUnits().find(unit => unit.team === 'enemy' && unit.isAlive)!;
  sim.applyCrowdControl(caster, target, 'knockback', 600);
  const events = sim.consumeEvents();
  assert.deepEqual(events.map(event => event.type), ['knockback', 'crowd_control']);
  for (const event of events) {
    assert.equal(event.targetId, target.instanceId);
    assert.equal(event.castId, undefined);
    assert.equal(event.skillSlot, undefined);
    assert.equal(event.skillName, undefined);
    assert.equal(event.vfxShape, undefined);
  }
});

/** Controlled runtime fixture uses target combat, never browser storage or real saves. */
function fixture(maxDurationMs = 90000) {
  const initial = createInitialData();
  return new BattleSimulation({ allyFormation: initial.formation,
    ownedHeroes: initial.ownedHeroes, enemies: getCampaignStage(1).enemies,
    seed: 2201, autoUltimate: false, maxDurationMs });
}

/** Freeze unrelated actions while preserving simulation-owned cast advancement. */
function advanceControlled(sim: BattleSimulation) {
  for (const unit of sim.getUnits()) {
    unit.basicAttackCooldownMs = Infinity; unit.activeSkillCooldownMs = Infinity;
    unit.moveSpeedPxPerSec = 0;
    if (unit.team === 'enemy') unit.energy = 0;
  }
  sim.step(50);
}

/** Gather a cast's immediate start and delayed results through its declared duration. */
function collectCast(sim: BattleSimulation, casterId: string) {
  const events = sim.consumeEvents();
  const caster = sim.getUnits().find(unit => unit.instanceId === casterId)!;
  for (let tick = 0; tick < 80 && caster.currentCast && sim.getStatus() === 'running'; tick++) {
    advanceControlled(sim); events.push(...sim.consumeEvents());
  }
  assert.ok(!caster.currentCast || sim.getStatus() !== 'running');
  return events;
}

/** Leaves one vulnerable nearby enemy so a delayed damaging ultimate ends the battle. */
function startFinalUltimate(sim: BattleSimulation) {
  const caster = sim.getUnits().find(u => u.heroId === 'belinda')!;
  const enemies = sim.getUnits().filter(u => u.team === 'enemy');
  for (const enemy of enemies) {
    enemy.isAlive = enemy === enemies[0]; enemy.hp = enemy.isAlive ? 1 : 0;
    enemy.shield = 0; enemy.baseDefense = 0;
    enemy.x = caster.x; enemy.y = caster.y;
  }
  caster.energy = 100;
  assert.equal(sim.triggerUltimate(caster.instanceId), true);
  assert.equal(sim.getStatus(), 'running', 'cast start cannot resolve the delayed killing hit');
}

test('impact audio plays once per positive damage batch, prioritizes criticals and ignores support/empty damage', () => {
  const unit = fixture().getUnits()[0];
  const damage: CombatEvent = { id: 1, timestampMs: 0, type: 'damage', value: 10, isCrit: false,
    sourceId: unit.instanceId, sourceName: unit.name };
  const heard: boolean[] = [];
  const sink = { playHit: (critical: boolean) => { heard.push(critical); } };
  const inputs: CombatEvent[][] = [[], [{ ...damage, type: 'heal' }], [{ ...damage, value: 0 }],
    [{ ...damage, value: -1 }], [{ ...damage, value: NaN }], [damage],
    [damage, { ...damage, id: 2, isCrit: true }, { ...damage, id: 3 }],
    [{ ...damage, type: 'shield', isCrit: true }, damage]];
  const before = structuredClone(inputs);
  for (const events of inputs) playBattleImpact(events, sink);
  assert.deepEqual(heard, [false, true, false]);
  assert.deepEqual(inputs, before);
});

test('delayed final ultimate drains each event batch before reporting victory exactly once', () => {
  const sim = fixture();
  sim.consumeEvents();
  startFinalUltimate(sim);
  const observe = createBattlePresentationObserver();
  const events: CombatEvent[] = [], snapshots: BattleSnapshot[] = [], order: string[] = [];
  const inspect = () => observe(sim, batch => { events.push(...batch); order.push('events'); },
    snapshot => { snapshots.push(snapshot); order.push('finished'); });
  inspect(); inspect();
  assert.equal(snapshots.length, 0, 'cast start must not complete the battle');
  assert.equal(events.some(event => event.type === 'death'), false);
  for (let tick = 0; tick < 80 && sim.getStatus() === 'running'; tick++) {
    advanceControlled(sim); inspect();
  }
  inspect(); inspect();
  assert.ok(events.some(event => event.type === 'ultimate_cast'));
  assert.ok(events.some(event => event.type === 'death'));
  assert.equal(snapshots.length, 1);
  assert.deepEqual(order, ['events', 'events', 'events', 'finished']);
  const cast = events.find(event => event.type === 'ultimate_cast')!;
  const death = events.find(event => event.type === 'death')!;
  assert.ok(death.timestampMs >= cast.timestampMs + 650, 'victory waits for Belinda’s first declared hit');
  assert.ok(events.some(event => event.type === 'damage' && event.castId === cast.id && event.value === 1));
  assert.equal(snapshots[0].status, 'victory');
});

test('new simulation gets its own completion even when instance IDs are reused', () => {
  const observe = createBattlePresentationObserver();
  const completed: BattleSnapshot[] = [];
  for (const sim of [fixture(), fixture()]) {
    startFinalUltimate(sim);
    const before = completed.length;
    observe(sim, () => {}, snapshot => completed.push(snapshot));
    assert.equal(completed.length, before, 'cast start cannot report completion');
    for (let tick = 0; tick < 80 && sim.getStatus() === 'running'; tick++) {
      advanceControlled(sim); observe(sim, () => {}, snapshot => completed.push(snapshot));
    }
    observe(sim, () => {}, snapshot => completed.push(snapshot));
  }
  assert.equal(completed.length, 2);
});

test('running manual casts drain without premature completion', () => {
  const sim = fixture();
  const observe = createBattlePresentationObserver();
  let completed = false;
  let events = 0;
  sim.consumeEvents();
  const caster = sim.getUnits().find(unit => unit.heroId === 'celestial_guardian' && unit.team === 'ally')!;
  caster.energy = 100;
  assert.equal(sim.triggerUltimate(caster.instanceId), true);
  observe(sim, batch => {
    assert.ok(batch.some(event => event.type === 'ultimate_cast' && event.sourceId === caster.instanceId));
    events += batch.length;
  }, () => { completed = true; });
  assert.equal(sim.getStatus(), 'running');
  assert.ok(events > 0);
  assert.equal(completed, false);
});

test('completion is marked before callbacks so reentrant observation cannot grant twice', () => {
  const sim = fixture();
  startFinalUltimate(sim);
  const observe = createBattlePresentationObserver();
  let completions = 0;
  const finish = () => {
    completions++;
    observe(sim, () => {}, finish);
  };
  observe(sim, () => {}, finish);
  assert.equal(completions, 0);
  for (let tick = 0; tick < 80 && sim.getStatus() === 'running'; tick++) {
    advanceControlled(sim); observe(sim, () => {}, finish);
  }
  observe(sim, () => {}, finish);
  assert.equal(completions, 1);
});

test('timeout defeat without combat events is reported once', () => {
  const sim = fixture(50);
  sim.consumeEvents();
  sim.step(50);
  assert.equal(sim.getStatus(), 'defeat');
  const observe = createBattlePresentationObserver();
  const outcomes: BattleSnapshot[] = [];
  let eventBatches = 0;
  for (let frame = 0; frame < 3; frame++) {
    observe(sim, () => { eventBatches++; }, snapshot => outcomes.push(snapshot));
  }
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, 'defeat');
  assert.equal(eventBatches, 0, 'an empty event queue cannot suppress completion');
});

test('clearing transient VFX hides old particles without disposing reusable pool resources', () => {
  const pool = new ThreeVfxPool();
  let disposals = 0;
  pool.group.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.addEventListener('dispose', () => disposals++);
      (obj.material as THREE.Material).addEventListener('dispose', () => disposals++);
    }
  });
  try {
    pool.spawnCastBurst({ x: 0, z: 0 }, 0xffffff);
    pool.spawnImpact({ x: 0, z: 0 }, 0xffffff, 1, true);
    pool.update(0.1);
    assert.ok(pool.getActiveCount() > 0);
    pool.clear();
    assert.equal(pool.getActiveCount(), 0);
    assert.ok(pool.group.children.every(child => !child.visible));
    pool.update(0.1);
    assert.equal(pool.getActiveCount(), 0);
    assert.equal(disposals, 0);
    pool.spawnCastBurst({ x: 0, z: 0 }, 0xffffff);
    assert.ok(pool.getActiveCount() > 0, 'pool is reusable after a restart');
  } finally { pool.dispose(); }
});
