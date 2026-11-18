// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impactShock, IMPACT_SHOCK_SECONDS } from './spriteImpactShock';

test('the shock ring grows fast then slows, and dies on time', () => {
  const first = impactShock(0), quarter = impactShock(IMPACT_SHOCK_SECONDS * .25);
  const half = impactShock(IMPACT_SHOCK_SECONDS * .5), late = impactShock(IMPACT_SHOCK_SECONDS * .95);
  assert.equal(first.radius, 0, 'the ring starts collapsed at the contact point');
  assert.ok(quarter.radius > 0);
  assert.ok(half.radius > quarter.radius && late.radius > half.radius);
  // Nửa đầu phải loang nhiều hơn nửa sau: lực dồn ra ngoài ngay lúc chạm.
  assert.ok(half.radius - quarter.radius > late.radius - half.radius);
  assert.ok(late.opacity < .2, 'the ring is nearly gone before it disappears');
  assert.equal(impactShock(IMPACT_SHOCK_SECONDS).alive, false);
  assert.equal(impactShock(IMPACT_SHOCK_SECONDS * 4).radius, 0, 'nothing lingers after the window');
});

test('a heavier hit throws a wider, brighter ring', () => {
  const light = impactShock(.12, .4), heavy = impactShock(.12, 1.6);
  assert.ok(heavy.radius > light.radius * 1.4, 'ultimates must read wider than basic hits');
  assert.ok(heavy.opacity > light.opacity, 'and brighter');
  assert.ok(heavy.lineWidth >= light.lineWidth, 'stroke thickens with the hit');
});

test('the ring follows the stage scale and stays flattened on the tilted floor', () => {
  const normal = impactShock(.1, 1, 1), large = impactShock(.1, 1, 1.5);
  assert.ok(Math.abs(large.radius - normal.radius * 1.5) < 1e-6, 'radius scales with the battle');
  assert.ok(normal.flatten < .45 && normal.flatten > .25, 'the ring lies on the ground, not upright');
});

test('bad inputs degrade to an expired ring instead of NaN geometry', () => {
  for (const [age, strength, scale] of [[NaN, NaN, NaN], [-5, 99, 0], [Infinity, -2, -1]] as const) {
    const shock = impactShock(age, strength, scale);
    assert.ok(Number.isFinite(shock.radius) && Number.isFinite(shock.lineWidth)
      && Number.isFinite(shock.opacity) && Number.isFinite(shock.flatten));
    assert.ok(shock.radius >= 0 && shock.opacity >= 0 && shock.opacity <= 1);
    assert.ok(shock.flatten > 0 && shock.flatten < 1);
  }
});
