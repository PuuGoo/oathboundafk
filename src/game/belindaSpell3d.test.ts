// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleBelindaSpell, spellEffectsForFallback, SPELL_STYLE, createBelindaSpellScene } from './belindaSpell3d';
import { createBelinda3D } from './belinda3d';
import * as THREE from 'three';
import { createSpriteEffect, advanceSpriteEffects } from './spriteBattleEffects';
import { getCombatTimeline } from './skillTimelines';
import { BattleSimulation } from './battleEngine';
import type { OwnedHeroState } from './types';
import { getCampaignStage } from './campaign';
import type { BattleUnitRuntime, CombatEvent } from './types';
import type { SpriteEffect } from './spriteBattleEffects';

const source = { instanceId: 'mage', heroId: 'belinda', team: 'ally', x: 250, y: 230 } as BattleUnitRuntime;
const target = { instanceId: 'locked', heroId: 'lucius', team: 'enemy', x: 650, y: 260 } as BattleUnitRuntime;
const event = (slot: 'basic' | 'active' | 'ultimate', patch: Partial<CombatEvent> = {}) => ({
  id: 1, timestampMs: 1000, sourceId: source.instanceId, targetId: target.instanceId,
  type: slot === 'basic' ? 'basic_attack' : slot === 'active' ? 'active_skill' : 'ultimate_cast',
  skillSlot: slot, castId: 7, timeline: getCombatTimeline('belinda', slot), ...patch,
} as CombatEvent);
const cast = (slot: 'basic' | 'active' | 'ultimate', age = 0) => ({
  ...createSpriteEffect(event(slot), source, target)!, age,
});
const sample = (effect: SpriteEffect, reducedMotion = false) => sampleBelindaSpell(effect, 480, 680, reducedMotion);

test('basic and active charge, release, travel and finish follow their engine timeline', () => {
  for (const slot of ['basic', 'active'] as const) {
    const fx = cast(slot), release = fx.timeline!.releaseMs / 1000, contact = fx.timeline!.hits[0].atMs / 1000;
    assert.equal(sample(fx)?.phase, 'charge');
    fx.age = release; assert.equal(sample(fx)?.phase, 'flight');
    assert.equal(sample(fx)?.travel, 0);
    fx.age = (release + contact) / 2; assert.ok(Math.abs(sample(fx)!.travel - .5) < 1e-12);
    fx.age = contact; assert.equal(sample(fx)?.phase, 'recovery');
    assert.equal(sample(fx)?.impact, false, 'contact progress never fabricates damage feedback');
    fx.age = fx.duration; assert.equal(sample(fx), undefined);
  }
});

test('all four ultimate bursts require actual damage events, with the real recipient', () => {
  const timeline = getCombatTimeline('belinda', 'ultimate')!;
  for (const [hitIndex, hit] of timeline.hits.entries()) {
    const anticipation = cast('ultimate', hit.atMs / 1000);
    assert.equal(sample(anticipation)?.impact, false);
    const real = createSpriteEffect(event('ultimate', {
      id: 10 + hitIndex, type: 'damage', hitIndex, timestampMs: 1000 + hit.atMs, value: 20,
    }), source, target)!;
    assert.equal(real.kind, 'impact'); assert.equal(sample(real)?.impact, true);
    assert.equal(sample(real)?.targetId, target.instanceId);
    assert.deepEqual(sample(real)?.target, sample(anticipation)?.target);
  }
});

test('cancelled cast has no synthetic scheduled burst and retains only already emitted outcomes', () => {
  const real = createSpriteEffect(event('active', { id: 2, type: 'damage', value: 10 }), source, target)!;
  const effects = [cast('active'), real];
  const remaining = effects.filter(fx => !(fx.kind === 'cast' && fx.castId === 7));
  assert.deepEqual(remaining.map(fx => sample(fx)?.impact), [true]);
  assert.equal(sample(cast('ultimate', 1.3))?.impact, false);
});

test('pause is identical input; x2 uses supplied presentation delta; expiry is bounded', () => {
  const effects = [cast('active', .35)];
  const before = sample(effects[0]); advanceSpriteEffects(effects, 0);
  assert.deepEqual(sample(effects[0]), before);
  advanceSpriteEffects(effects, .1 * 2);
  assert.ok(sample(effects[0])!.travel > before!.travel);
  advanceSpriteEffects(effects, 20); assert.equal(effects.length, 0);
});

test('reduced motion stops rotation and arcs without suppressing real hit information', () => {
  const fx = cast('active', .4);
  const normal = sample(fx)!, reduced = sample(fx, true)!;
  assert.equal(reduced.spin, 0); assert.equal(reduced.arc, 0);
  assert.equal(normal.travel, reduced.travel); assert.equal(normal.targetId, reduced.targetId);
  assert.equal(sample(createSpriteEffect(event('active', { type: 'damage', value: 5 }), source, target)!, true)?.impact, true);
  assert.ok(SPELL_STYLE.lowSparks < SPELL_STYLE.sparks);
});

test('target-local projection, mirrored delivery and resize preserve actual recipient identity', () => {
  const fx = cast('active', .45), before = JSON.stringify(fx);
  Object.freeze(fx.source); Object.freeze(fx.target); Object.freeze(fx);
  const a = sample(fx)!, b = sampleBelindaSpell(fx, 960, 1360, false)!;
  assert.equal(b.target.x, a.target.x * 2); assert.equal(b.target.y, a.target.y * 2);
  assert.equal(JSON.stringify(fx), before);
  const enemy = createSpriteEffect(event('active'), { ...source, team: 'enemy', x: 800 }, { ...target, team: 'ally', x: 200 })!;
  assert.ok(sample(enemy)!.source.x > sample(enemy)!.target.x);
});

test('other heroes, support, death, invalid clocks and missing timelines keep original effects', () => {
  for (const patch of [{ sourceHeroId: 'raine' }, { support: true }, { kind: 'death' as const },
    { age: NaN }, { age: -1 }, { timeline: undefined }]) {
    assert.equal(sample({ ...cast('active'), ...patch }), undefined);
  }
});

test('2D suppression is transactional: only IDs successfully handled by a 3D pass are removed', () => {
  const a = cast('active', .4), b = { ...cast('ultimate', .8), id: 2 }, batch = [a, b];
  assert.deepEqual(spellEffectsForFallback(batch, new Set()), batch);
  assert.deepEqual(spellEffectsForFallback(batch, new Set([a.id])), [b]);
  assert.deepEqual(spellEffectsForFallback(batch, new Set([a.id, b.id])), []);
});

test('actual Three mesh pool reuses geometry, draws two layers, lowers detail and disposes exactly once', () => {
  const view = createBelindaSpellScene(THREE);
  const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  let draws = 0, visibleNormal = 0, visibleLow = 0, disposed = 0;
  let low = false;
  const renderer = { domElement: {}, getContext: () => ({ isContextLost: () => false }),
    render(scene: THREE.Scene, camera: THREE.Camera) {
      draws++; camera.updateMatrixWorld(); scene.updateMatrixWorld(true);
      let visible = 0;
      scene.traverse(object => { if (object instanceof THREE.Mesh) {
        geometry.add(object.geometry); materials.add(object.material as THREE.Material);
        if (object.visible) visible++;
        assert.ok(object.matrixWorld.elements.every(Number.isFinite));
      } });
      if (low) visibleLow = visible; else visibleNormal = visible;
    } } as unknown as THREE.WebGLRenderer;
  const ctx = { drawImage() {} } as unknown as CanvasRenderingContext2D;
  const frame = { width: 480, height: 680, low: false, reducedMotion: false, staffAnchors: new Map() };
  const fx = createSpriteEffect(event('ultimate', { type: 'damage', value: 20 }), source, target)!;
  view.draw(renderer, ctx, fx, 'ground', frame);
  view.draw(renderer, ctx, fx, 'front', frame);
  low = true; view.draw(renderer, ctx, fx, 'front', { ...frame, low: true, reducedMotion: true });
  assert.ok(visibleLow < visibleNormal); assert.equal(geometry.size, 4); assert.equal(materials.size, 3);
  for (const resource of [...geometry, ...materials]) resource.addEventListener('dispose', () => disposed++);
  view.dispose(); view.dispose(); assert.equal(disposed, 7);
  assert.equal(view.draw(renderer, ctx, fx, 'front', frame), false); assert.equal(draws, 3);
});

test('failed or unavailable shared spell backend never suppresses the 2D fallback', async () => {
  const api = { draw: () => true, reset() {}, dispose() {},
    drawSpells: () => { throw new Error('lost context'); } };
  const view = createBelinda3D(async () => api);
  const ctx = {} as CanvasRenderingContext2D;
  const frame = { width: 480, height: 680, low: false, reducedMotion: false };
  assert.equal(view.drawSpells(ctx, [cast('active')], 'front', frame).size, 0);
  view.draw(ctx, source, {} as never, 0, false, 0, 0, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.drawSpells(ctx, [cast('active')], 'front', frame).size, 0);
  assert.equal(view.status(), 'failed'); view.dispose();
});

test('real fixed-step engine ultimate outcomes produce exactly four hit groups without renderer mutation', () => {
  const owned = { belinda: { heroId: 'belinda', level: 5, stars: 2, copies: 2,
    equipment: { weapon: 1, armor: 1, relic: 1 } } } as Record<string, OwnedHeroState>;
  const sim = new BattleSimulation({ allyFormation: ['belinda', null, null, null, null],
    ownedHeroes: owned, enemies: getCampaignStage(1).enemies, seed: 2026, autoUltimate: false });
  const caster = sim.getUnits().find(unit => unit.heroId === 'belinda')!;
  for (const unit of sim.getUnits()) {
    unit.basicAttackCooldownMs = 1e6; unit.activeSkillCooldownMs = 1e6; unit.moveSpeedPxPerSec = 0;
    unit.hp = unit.maxHp = 1e6; unit.shield = 0;
  }
  caster.energy = 100; sim.consumeEvents(); assert.equal(sim.triggerUltimate(caster.instanceId), true);
  const started = sim.consumeEvents().find(entry => entry.type === 'ultimate_cast')!;
  const hits: CombatEvent[] = [];
  for (let i = 0; i < 34; i++) {
    sim.step(50);
    for (const entry of sim.consumeEvents()) if (entry.type === 'damage' && entry.castId === started.castId) {
      hits.push(entry);
      const recipient = sim.getUnits().find(unit => unit.instanceId === entry.targetId)!;
      const before = JSON.stringify(sim.getSnapshot());
      const fx = createSpriteEffect(entry, caster, recipient)!;
      assert.equal(sample(fx)?.impact, true); assert.equal(sample(fx)?.targetId, entry.targetId);
      assert.equal(JSON.stringify(sim.getSnapshot()), before);
    }
  }
  assert.deepEqual([...new Set(hits.map(hit => hit.hitIndex))], [0, 1, 2, 3]);
  assert.deepEqual([...new Set(hits.map(hit => hit.timestampMs - started.timestampMs))], [650, 850, 1050, 1250]);
});
