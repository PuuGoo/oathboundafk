// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBelindaPose, createBelinda3D, type BelindaRenderBackend } from './belinda3d';
import { getCombatTimeline } from './skillTimelines';
import { createSpriteActor } from './spriteBattleRenderer';
import type { BattleUnitRuntime } from './types';

const unit = (patch: Partial<BattleUnitRuntime> = {}) => ({
  instanceId: 'ally-belinda', heroId: 'belinda', isAlive: true, hp: 100,
  facing: 1, lastActionType: 'idle', statusEffects: [], ...patch,
} as BattleUnitRuntime);
const actor = () => createSpriteActor(unit());
const cast = (slot: 'basic' | 'active' | 'ultimate') => ({
  castId: 1, skillId: slot, skillSlot: slot, startedAtMs: 1000,
  timeline: getCombatTimeline('belinda', slot)!, targetIds: ['enemy'],
});
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const drawContext = {} as CanvasRenderingContext2D;

test('cast pose reads engine time, clamps and preserves all four ultimate contact times', () => {
  const u = unit({ currentCast: cast('ultimate') });
  for (const atMs of [650, 850, 1050, 1250]) {
    assert.deepEqual(getBelindaPose(u, actor(), 1000 + atMs, false), { clip: 'ultimate', seconds: atMs / 1000 });
  }
  assert.equal(getBelindaPose(u, actor(), 0, false).seconds, 0);
  assert.equal(getBelindaPose(u, actor(), 9999, false).seconds, 1.65);
  assert.equal(getBelindaPose(unit({ currentCast: cast('active') }), actor(), 1600, false).clip, 'active');
  assert.equal(getBelindaPose(unit({ currentCast: cast('basic') }), actor(), 1200, false).seconds, .2);
});

test('pause and x2 are engine-clock inputs, not wall-clock animation updates', () => {
  const u = unit({ currentCast: cast('ultimate') }), a = actor();
  assert.deepEqual(getBelindaPose(u, a, 1650, false), getBelindaPose(u, a, 1650, false));
  assert.ok(Math.abs(getBelindaPose(u, a, 1850, false).seconds - getBelindaPose(u, a, 1650, false).seconds - .2) < 1e-12);
});

test('death overrides cast, control freezes previous pose, cancelled cast never resumes stale action', () => {
  const a = actor(); a.age = .4; a.actionKind = 'ultimate'; a.actionRemaining = 1;
  assert.equal(getBelindaPose(unit(), a, 1500, false).clip, 'idle');
  const previous = { clip: 'active' as const, seconds: .3 };
  assert.deepEqual(getBelindaPose(unit({ statusEffects: [{ type: 'stun', remainingMs: 500 } as never] }), a, 1500, false, previous), previous);
  assert.equal(getBelindaPose(unit({ isAlive: false, hp: 0, currentCast: cast('ultimate') }), { ...a, clip: 'death' }, 1500, false, previous).clip, 'death');
});

test('idle/run/hit/death and reduced-motion clocks remain deterministic', () => {
  const a = actor(); a.age = .7;
  assert.equal(getBelindaPose(unit({ lastActionType: 'move' }), a, 0, false).clip, 'run');
  assert.equal(getBelindaPose(unit({ lastActionType: 'move' }), a, 0, true).seconds, 0);
  a.actionKind = 'hit'; a.actionRemaining = .2;
  assert.equal(getBelindaPose(unit(), a, 0, false).clip, 'hit');
  assert.equal(getBelindaPose(unit({ hp: 0 }), { ...a, clip: 'idle' }, 0, false).seconds, 0);
});

test('pose selection never writes back into simulation or actor state', () => {
  const u = unit({ currentCast: cast('ultimate') }), a = actor();
  Object.freeze(u.currentCast); Object.freeze(u.statusEffects); Object.freeze(u); Object.freeze(a);
  const before = JSON.stringify({ u, a });
  getBelindaPose(u, a, 1850, false);
  assert.equal(JSON.stringify({ u, a }), before);
});

test('silence permits the current visual pose and expired controls do not freeze it', () => {
  const u = unit({ currentCast: cast('active'), statusEffects: [
    { type: 'stun', remainingMs: 0 } as never, { type: 'silence', remainingMs: 500 } as never,
  ] });
  assert.deepEqual(getBelindaPose(u, actor(), 1600, false, { clip: 'idle', seconds: 0 }), { clip: 'active', seconds: .6 });
});

function backend() {
  const seen: string[] = [];
  const api: BelindaRenderBackend = {
    draw: (_ctx, u) => { seen.push(u.instanceId); return true; },
    reset: () => { seen.push('reset'); }, dispose: () => { seen.push('dispose'); },
  };
  return { api, seen };
}

test('lazy initialization: non-Belinda never loads, loading uses sprite fallback, ready draws per-instance', async () => {
  const b = backend(); let loads = 0;
  const view = createBelinda3D(async () => { loads++; return b.api; });
  assert.equal(view.draw(drawContext, unit({ heroId: 'raine' }), actor(), 0, false, 0, 0, 1), false);
  assert.equal(loads, 0);
  assert.equal(view.draw(drawContext, unit(), actor(), 0, false, 0, 0, 1), false);
  await flush();
  assert.equal(view.status(), 'ready');
  assert.equal(view.draw(drawContext, unit(), actor(), 0, false, 0, 0, 1), true);
  view.draw(drawContext, unit({ instanceId: 'enemy-belinda', facing: -1 }), actor(), 0, false, 0, 0, 1);
  assert.deepEqual(b.seen, ['ally-belinda', 'enemy-belinda']);
  view.reset(); view.dispose(); view.dispose();
  assert.deepEqual(b.seen.slice(-2), ['reset', 'dispose']);
});

test('load/WebGL/draw failures fall back without retries or throwing into battle', async () => {
  let attempts = 0;
  const view = createBelinda3D(async () => { attempts++; throw new Error('No WebGL'); });
  view.draw(drawContext, unit(), actor(), 0, false, 0, 0, 1); await flush();
  assert.equal(view.status(), 'failed');
  assert.equal(view.draw(drawContext, unit(), actor(), 0, false, 0, 0, 1), false);
  assert.equal(attempts, 1);
  const b = backend(); b.api.draw = () => { throw new Error('context lost'); };
  const broken = createBelinda3D(async () => b.api);
  broken.draw(drawContext, unit(), actor(), 0, false, 0, 0, 1); await flush();
  assert.equal(broken.draw(drawContext, unit(), actor(), 0, false, 0, 0, 1), false);
  assert.equal(broken.status(), 'failed'); assert.deepEqual(b.seen, ['dispose']);
});

test('late model load after unmount disposes backend and never resurrects renderer', async () => {
  const b = backend(); let resolve!: (value: BelindaRenderBackend) => void;
  const view = createBelinda3D(() => new Promise(r => { resolve = r; }));
  view.draw(drawContext, unit(), actor(), 0, false, 0, 0, 1);
  await Promise.resolve(); // Start the deferred loader before resolving its result after unmount.
  view.dispose(); resolve(b.api); await flush();
  assert.equal(view.status(), 'disposed'); assert.deepEqual(b.seen, ['dispose']);
  assert.equal(view.draw(drawContext, unit(), actor(), 0, false, 0, 0, 1), false);
});
