// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castTelegraph, CAST_TELEGRAPH_FADE } from './spriteCastTelegraph';

test('the cast ring charges up to the real release moment, then fades out', () => {
  const start = castTelegraph(0, 1.15, .3);
  const mid = castTelegraph(.15, 1.15, .3);
  const atRelease = castTelegraph(.3, 1.15, .3);
  const after = castTelegraph(.3 + CAST_TELEGRAPH_FADE * .5, 1.15, .3);
  assert.ok(start.charge < .05, 'the ring starts empty');
  assert.ok(mid.charge > start.charge && mid.charge < 1, 'it fills over the cast');
  assert.equal(atRelease.charge, 1, 'the ring is full exactly at release');
  assert.equal(atRelease.released, true);
  assert.ok(after.opacity < atRelease.opacity, 'and drains right after the spell leaves');
  assert.ok(atRelease.opacity > mid.opacity, 'brightest at the release moment');
  assert.ok(atRelease.radius > start.radius, 'the circle widens as the cast builds');
});

test('the ring follows the authored release instead of a guessed fraction', () => {
  const early = castTelegraph(.2, 1.65, .2);
  const late = castTelegraph(.2, 1.65, 1.2);
  assert.equal(early.charge, 1, 'a fast cast is already full at 0.2 s');
  assert.ok(late.charge < .5, 'a slow wind-up is still building at 0.2 s');
  // Thiếu release thì lấy 40 % thời lượng — vẫn là mốc xác định, không phải 0.
  const fallback = castTelegraph(.6, 1.5, 0);
  assert.equal(fallback.charge, 1);
});

test('heavier casts get a bigger, thicker ring and the ring ends inside its window', () => {
  const light = castTelegraph(.15, 1, .3, 1, .4);
  const heavy = castTelegraph(.15, 1, .3, 1, 1.6);
  assert.ok(heavy.radius > light.radius && heavy.lineWidth > light.lineWidth);
  const done = castTelegraph(.3 + CAST_TELEGRAPH_FADE + .01, 1, .3);
  assert.equal(done.alive, false);
  assert.equal(done.opacity, 0);
});

test('bad clocks never produce NaN or negative rings', () => {
  for (const [age, duration, release, scale, focus] of [
    [NaN, NaN, NaN, NaN, NaN], [-2, 0, -1, 0, 9], [Infinity, -3, Infinity, -1, -5],
  ] as const) {
    const ring = castTelegraph(age, duration, release, scale, focus);
    assert.ok(Number.isFinite(ring.radius) && Number.isFinite(ring.opacity));
    assert.ok(ring.radius >= 0 && ring.opacity >= 0 && ring.opacity <= 1 && ring.charge >= 0 && ring.charge <= 1);
  }
});
