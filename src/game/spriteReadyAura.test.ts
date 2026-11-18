// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyAura, READY_AURA_SPEED } from './spriteReadyAura';

test('a ready hero breathes a ring that never collapses or explodes', () => {
  const samples = [0, .4, 1.1, 2.7, 5.5].map(clock => readyAura(clock, 1));
  for (const aura of samples) {
    assert.equal(aura.visible, true);
    assert.ok(aura.radius > 25 && aura.radius < 40, `radius ${aura.radius} must stay legible`);
    assert.ok(aura.inner < aura.radius, 'the two rings must not invert');
    assert.ok(aura.opacity > .1 && aura.opacity < .5, 'the aura stays subordinate to the hero');
    assert.equal(aura.motes.length, 3);
  }
  // Nhịp thở thật: cùng độ đầy nhưng khác đồng hồ thì bán kính phải đổi.
  const radii = new Set(samples.map(aura => aura.radius.toFixed(3)));
  assert.ok(radii.size > 2, 'the aura must pulse, not sit still');
});

test('an uncastable hero draws nothing at all', () => {
  for (const charge of [0, .4, .99]) {
    const aura = readyAura(1.2, charge, 1, false);
    assert.equal(aura.visible, false);
    assert.equal(aura.radius, 0);
    assert.deepEqual(aura.motes, []);
  }
});

test('the motes orbit out of phase so something is always rising', () => {
  const aura = readyAura(.3, 1);
  const phases = aura.motes.map(mote => mote.alpha);
  assert.ok(new Set(phases.map(alpha => alpha.toFixed(3))).size === 3, 'motes must not share a phase');
  assert.ok(phases.some(alpha => alpha > 0), 'at least one mote is visible at any instant');
  for (const mote of aura.motes) {
    assert.ok(mote.alpha >= 0 && mote.alpha <= .85);
    assert.ok(mote.r > 0);
    assert.ok(Math.hypot(mote.x, mote.y) < aura.radius * 1.6, 'motes stay near the ring');
  }
  // Hạt phải đi lên: cùng hạt ở hai mốc khác nhau trong chu kỳ.
  const early = readyAura(0, 1).motes[0].y, later = readyAura(.4, 1).motes[0].y;
  assert.notEqual(early, later);
});

test('the ring grows with charge, follows scale and survives bad input', () => {
  assert.ok(readyAura(1, 1).radius > readyAura(1, .2).radius, 'a fuller bar reads slightly bigger');
  const normal = readyAura(1, 1, 1), large = readyAura(1, 1, 1.5);
  assert.ok(Math.abs(large.radius - normal.radius * 1.5) < 1e-6, 'radius follows the battle scale');
  for (const [clock, charge, scale] of [[NaN, NaN, NaN], [-2, 9, 0], [Infinity, -3, -1]] as const) {
    const aura = readyAura(clock, charge, scale);
    assert.ok(Number.isFinite(aura.radius) && Number.isFinite(aura.opacity) && Number.isFinite(aura.lineWidth));
    assert.ok(aura.radius >= 0 && aura.opacity >= 0 && aura.inner >= 0);
    for (const mote of aura.motes) {
      assert.ok(Number.isFinite(mote.x) && Number.isFinite(mote.y) && Number.isFinite(mote.alpha));
    }
  }
  assert.ok(READY_AURA_SPEED > 0);
});
