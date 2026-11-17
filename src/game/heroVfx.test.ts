// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpriteEffect } from './spriteBattleEffects';
import { OATHBOUND_HEROES } from './oathboundHeroes';
import { getCombatTimeline } from './skillTimelines';
import type { BattleUnitRuntime, CombatEvent } from './types';
import type { SpriteEffect } from './spriteBattleEffects';
import {
  getHeroVfx, heroVfxTint, HERO_VFX_DEFINITIONS, sampleHeroVfx, sampleVfxBatch, vfxEffectsForFallback,
  VFX_CLIP_SECONDS, VFX_STYLE, vfxLightEnergy,
} from './heroVfx';
import authoredEffects from '../../tools/hero-vfx.json';

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
/** Thấp nhất trong batch là mức giảm chung; 1 nghĩa là không phải giảm. */
const dimmestLayer = (batch: readonly { brightness: number }[]) =>
  Math.min(1, ...batch.map(entry => entry.brightness));
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

test('a busy layer dims every cast instead of letting additive light blow out', () => {
  const quiet = sampleVfxBatch([cast('active', .5)], 480, 680, false);
  assert.equal(dimmestLayer(quiet), 1, 'one cast keeps full authored brightness');
  const busy = sampleVfxBatch(
    [1, 2, 3, 4, 5, 6].map(id => ({ ...cast('ultimate', .5), id })), 480, 680, false);
  assert.equal(busy.length, 6);
  assert.ok(dimmestLayer(busy) < .75, 'six simultaneous ultimates must be scaled back');
  for (const total of [quiet, busy]) {
    assert.ok(total.reduce((sum, entry) => sum + vfxLightEnergy(entry), 0) <= VFX_STYLE.brightnessBudget + 1e-9,
      'the layer never exceeds its light budget');
  }
  for (const entry of busy) assert.ok(entry.brightness > 0, 'a dimmed cast still draws');
});

test('travel follows the effect family: auras stay home, swords land, shots fly', () => {
  // Hào quang (sigil/bloom/storm) nở quanh người niệm, không bắn sang địch.
  for (const heroId of ['belinda', 'celestial_guardian', 'fawkes']) {
    const effect = { ...cast('active', .6), sourceHeroId: heroId };
    const value = sample(effect)!;
    assert.equal(value.travelMode, 'aura', `${heroId} must bloom in place`);
    assert.equal(value.travel, 0);
  }
  // Nhát chém/đòn cận chiến xảy ra tại mục tiêu ngay từ đầu.
  const melee = sample({ ...cast('active', .6), sourceHeroId: 'astral_blademaster' })!;
  assert.equal(melee.travelMode, 'melee');
  assert.equal(melee.travel, 1);
  // Đạn/thương/tên bay dần từ nòng tới mục tiêu.
  const travels = Array.from({ length: 40 }, (_, index) => sample({
    ...cast('active', index * .03), sourceHeroId: 'raine',
  })!).filter(Boolean);
  assert.equal(travels[0].travelMode, 'projectile');
  const seen = travels.map(entry => entry.travel);
  assert.ok(Math.min(...seen) === 0 && Math.max(...seen) === 1, 'a shot starts at the muzzle and reaches the target');
  assert.ok(seen.some(value => value > .1 && value < .9), 'a shot spends real time in flight');
  assert.equal(sample({ ...cast('active', .6), sourceHeroId: 'estrida' })?.travelMode, undefined,
    'unknown heroes resolve nothing');
});

test('damage bursts expand outward as they fade while cast scale stays fixed', () => {
  const base = { ...outcome(), duration: 1 };
  const sizes = [.05, .3, .6, .95].map(fraction => sample({
    ...base, age: VFX_STYLE.impactSeconds * fraction,
  })!.magnitude);
  for (let index = 1; index < sizes.length; index++) {
    assert.ok(sizes[index] > sizes[index - 1], 'a hit must keep growing outward');
  }
  assert.ok(sizes.at(-1)! < sizes[0] * 2, 'a burst must not swallow the fighters');
  for (const slot of ['basic', 'active', 'ultimate'] as const) {
    const early = sample(cast(slot, .05))!.magnitude;
    const late = sample(cast(slot, .05 + VFX_CLIP_SECONDS[slot] * .8))!.magnitude;
    assert.equal(early, late, `${slot} cast keeps one authored size`);
  }
});

test('damage bursts fade softly and stay handled after fading without a late flash', () => {
  const base = { ...outcome(), duration: 1 };
  let previous = 1;
  for (let step = 0; step <= 100; step++) {
    const age = VFX_STYLE.impactSeconds * step / 100;
    const value = sample({ ...base, age })!;
    assert.equal(value.clip, 'impact');
    assert.ok(value.opacity <= previous && value.opacity >= 0);
    previous = value.opacity;
  }
  const nearEnd = sample({ ...base, age: VFX_STYLE.impactSeconds * .99 })!;
  assert.ok(nearEnd.opacity < .001, 'opacity should flatten smoothly to zero');
  assert.equal(sample({ ...base, age: .8 })!.opacity, 0, 'retain handled id through original lifetime');
  assert.equal(sample({ ...base, age: -1 }), undefined, 'no anticipation of a damage outcome');
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
  // Belinda là hào quang: giữa flight vẫn đứng tại chỗ. Đạn mới có tiến độ .5.
  assert.equal(sample(effect)!.travel, 0);
  const shot = { ...effect, sourceHeroId: 'raine' };
  assert.ok(Math.abs(sample(shot)!.travel - .5) < 1e-12);
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

test('cast opacity stays continuous at release and contact for every slot', () => {
  for (const slot of ['basic', 'active', 'ultimate'] as const) {
    for (const timeline of [getCombatTimeline('belinda', slot), undefined]) {
      const effect = { ...cast(slot), timeline };
      const release = timeline ? timeline.releaseMs / 1000 : effect.duration * .24;
      const contact = timeline ? timeline.hits[0].atMs / 1000 : effect.duration * .52;
      for (const time of [release, contact]) {
        const left = sample({ ...effect, age: time - .00001 })!;
        const right = sample({ ...effect, age: time + .00001 })!;
        assert.ok(Math.abs(left.opacity - right.opacity) < .001, `${slot} opacity jumped at ${time}`);
        assert.notEqual(right.clip, 'impact', 'brightness never creates a synthetic hit');
      }
      assert.ok(sample({ ...effect, age: effect.duration - .00001 })!.opacity < .001);
    }
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

test('the arena pulse can borrow each hero primary colour from the same manifest', () => {
  for (const entry of HERO_VFX_DEFINITIONS) {
    const spec = authoredEffects.find(candidate => candidate.heroId === entry.heroId)!;
    const expected = Number.parseInt(spec.primary, 16);
    assert.equal(heroVfxTint(entry.heroId), expected, `${entry.heroId}: pulse tint must be the authored primary`);
    assert.ok(expected >= 0 && expected <= 0xffffff, `${entry.heroId}: tint must stay a 24-bit colour`);
  }
  assert.equal(heroVfxTint('not_a_hero'), undefined, 'heroes without an effect keep the arena palette');
  assert.equal(heroVfxTint(''), undefined);
});
