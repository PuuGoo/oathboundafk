// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpriteEffect } from './spriteBattleEffects';
import { OATHBOUND_HEROES } from './oathboundHeroes';
import { getCombatTimeline } from './skillTimelines';
import type { BattleUnitRuntime, CombatEvent } from './types';
import type { SpriteEffect } from './spriteBattleEffects';
import {
  getHeroVfx, HERO_VFX_DEFINITIONS, sampleHeroVfx, sampleVfxBatch, vfxEffectsForFallback,
  VFX_CLIP_SECONDS, VFX_STYLE,
} from './heroVfx';

const source = { instanceId: 'mage', heroId: 'belinda', team: 'ally', x: 250, y: 230 } as BattleUnitRuntime;
const target = { instanceId: 'locked', heroId: 'lucius', team: 'enemy', x: 650, y: 260 } as BattleUnitRuntime;
const event = (slot: 'basic' | 'active' | 'ultimate', patch: Partial<CombatEvent> = {}) => ({
  id: 1, timestampMs: 1000, sourceId: source.instanceId, targetId: target.instanceId,
  type: slot === 'basic' ? 'basic_attack' : slot === 'active' ? 'active_skill' : 'ultimate_cast',
  skillSlot: slot, castId: 7, timeline: getCombatTimeline('belinda', slot), ...patch,
} as CombatEvent);
const cast = (slot: 'basic' | 'active' | 'ultimate', age = 0) => ({ ...createSpriteEffect(event(slot), source, target)!, age });
const outcome = (age = 0, id = 9) => ({
  ...createSpriteEffect(event('active', { id, type: 'damage', value: 12, skillSlot: 'active' }), source, target)!, age,
});
const sample = (effect: SpriteEffect, reducedMotion = false) => sampleHeroVfx(effect, 480, 680, reducedMotion);
/** Any roster hero without a committed effect; tests must survive heroes being enabled later. */
const disabledHero = OATHBOUND_HEROES.find(hero => !getHeroVfx(hero.heroId));

test('only roster heroes with a committed Blender effect resolve, by stable hero id', () => {
  const definition = getHeroVfx('belinda');
  assert.equal(definition?.url, '/assets/vfx/belinda.glb');
  if (disabledHero) {
    assert.equal(getHeroVfx(disabledHero.heroId), undefined, 'a hero without an effect asset stays Canvas2D');
  }
  assert.ok(HERO_VFX_DEFINITIONS.length > 0, 'at least one hero must ship an effect');
  for (const entry of HERO_VFX_DEFINITIONS) {
    assert.ok(OATHBOUND_HEROES.some(hero => hero.heroId === entry.heroId), `${entry.heroId} must be a roster hero`);
    assert.match(entry.url, /^\/assets\/vfx\/[a-z0-9-]+\.glb$/);
  }
  assert.equal(new Set(HERO_VFX_DEFINITIONS.map(entry => entry.url)).size, HERO_VFX_DEFINITIONS.length,
    'each hero needs its own effect file');
});

test('cast effects request the clip of their real slot; outcomes request the impact clip', () => {
  for (const slot of ['basic', 'active', 'ultimate'] as const) {
    assert.equal(sample(cast(slot))?.clip, slot);
  }
  const damage = outcome();
  assert.equal(sample(damage)?.clip, 'impact');
  assert.equal(sample(damage)?.slot, 'active');
  assert.equal(sample(damage)?.grounded, true);
  if (disabledHero) assert.equal(sample({ ...outcome(), sourceHeroId: disabledHero.heroId }), undefined);
});

test('heal, shield and control keep their semantic Canvas art instead of masking it', () => {
  for (const kind of ['heal', 'shield', 'control', 'mark', 'resist'] as const) {
    const effect = { ...outcome(.02), kind } as SpriteEffect;
    assert.equal(sample(effect), undefined, `${kind} must not be replaced by a damage burst`);
  }
  const support = { ...cast('active', .1), support: true, sourceId: source.instanceId };
  assert.equal(sample(support)?.clip, 'active');
  assert.equal(sample(support)?.support, true);
  assert.equal(sample(support)?.sourceInstanceId, source.instanceId);
});

test('a cast longer than its authored clip stays sampled past the clip length', () => {
  const effect = { ...cast('basic'), timeline: undefined, duration: 2.4 };
  assert.equal(sample(effect)?.clip, 'basic');
  effect.age = 2;
  const late = sample(effect);
  assert.ok(Math.abs(late!.progress - 2 / 2.4) < 1e-12, 'progress follows the cast, not the GLB clip length');
  assert.equal(late?.phase, 'recovery');
});

test('charge, flight and recovery follow the engine timeline inside the authored clip length', () => {
  const effect = cast('active');
  const release = effect.timeline!.releaseMs / 1000, contact = effect.timeline!.hits[0].atMs / 1000;
  assert.equal(sample(effect)?.phase, 'charge');
  effect.age = release;
  assert.equal(sample(effect)?.phase, 'flight');
  assert.equal(sample(effect)?.travel, 0);
  effect.age = (release + contact) / 2;
  assert.ok(Math.abs(sample(effect)!.travel - .5) < 1e-12);
  effect.age = contact;
  assert.equal(sample(effect)?.phase, 'recovery');
  assert.equal(sample(effect)?.clip, 'active', 'contact alone never fabricates an impact burst');
  effect.age = VFX_CLIP_SECONDS.active;
  assert.equal(sample(effect), undefined, 'the authored clip ends with the presentation window');
});

test('a cast without an authored timeline still resolves proportional phases and stays bounded', () => {
  const effect = { ...cast('ultimate'), timeline: undefined };
  const duration = effect.duration;
  effect.age = duration * .1;
  assert.equal(sample(effect)?.phase, 'charge');
  effect.age = duration * .4;
  assert.equal(sample(effect)?.phase, 'flight');
  effect.age = duration * .7;
  assert.equal(sample(effect)?.phase, 'recovery');
  for (const age of [0, duration * .25, duration * .5, duration * .99]) {
    effect.age = age;
    const value = sample(effect)!;
    assert.ok(value.progress >= 0 && value.progress <= 1);
    assert.ok(value.opacity >= 0 && value.opacity <= 1);
    assert.ok(Number.isFinite(value.spin) && Number.isFinite(value.magnitude));
  }
  for (const age of [-1, NaN, Infinity, duration, duration + 1]) {
    effect.age = age;
    assert.equal(sample(effect), undefined, `age ${age} must not render`);
  }
});

test('reduced motion freezes spin without touching clip, progress or magnitude', () => {
  const effect = cast('ultimate', .5);
  const moving = sample(effect, false)!, still = sample(effect, true)!;
  assert.equal(still.spin, 0);
  assert.equal(moving.spin, .5 * 2.6);
  assert.deepEqual([still.clip, still.phase, still.travel, still.magnitude],
    [moving.clip, moving.phase, moving.travel, moving.magnitude]);
});

test('per-layer batch is bounded and prefers ultimates, impacts and newer effects', () => {
  const effects = [
    ...[1, 2, 3, 4, 5, 6].map(id => ({ ...cast('basic', .1), id })),
    ...[7, 8, 9].map(id => ({ ...cast('ultimate', .2), id })),
    { ...outcome(.05, 10) },
  ];
  const batch = sampleVfxBatch(effects, 480, 680, false);
  assert.equal(batch.length, Math.min(VFX_STYLE.maxPerLayer, effects.length));
  assert.deepEqual(batch.map(entry => entry.id).slice(0, 4), [9, 8, 7, 10],
    'ultimate casts outrank an active-slot impact burst, newest first inside a tier');
  assert.equal(sampleVfxBatch(effects, 480, 680, false, 3).length, 3);
  assert.equal(sampleVfxBatch(effects, 480, 680, false, 0).length, 0);
});

test('fallback keeps every effect the 3D pass did not handle, in order', () => {
  const effects = [cast('basic'), outcome(.1, 5), cast('active', .2)];
  const remaining = vfxEffectsForFallback(effects, new Set([effects[1].id]));
  assert.deepEqual(remaining.map(effect => effect.id), [effects[0].id, effects[2].id]);
  assert.equal(vfxEffectsForFallback(effects, new Set([1, 5, 2])).length, 0);
});
