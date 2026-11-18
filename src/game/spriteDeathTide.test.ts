// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deathTide, DEATH_TIDE_SECONDS } from './spriteDeathTide';

test('a fallen hero gets a rising light column that fades before the window ends', () => {
  const start = deathTide(0), rising = deathTide(.2), peak = deathTide(.5);
  const late = deathTide(DEATH_TIDE_SECONDS * .85);
  assert.ok(start.columnHeight < rising.columnHeight, 'the column rises out of the floor');
  assert.ok(peak.columnHeight >= rising.columnHeight, 'it reaches full height at the peak');
  assert.ok(peak.columnOpacity > 0 && late.columnOpacity < peak.columnOpacity, 'then it fades');
  assert.ok(late.columnHeight <= peak.columnHeight, 'and stops growing');
  assert.equal(deathTide(DEATH_TIDE_SECONDS).alive, false);
  assert.equal(deathTide(DEATH_TIDE_SECONDS * 3).columnOpacity, 0);
});

test('the floor stain spreads and always outlives the column', () => {
  const early = deathTide(.1), late = deathTide(DEATH_TIDE_SECONDS * .9);
  assert.ok(late.stainRadius > early.stainRadius, 'the stain creeps outward');
  assert.ok(late.stainOpacity < early.stainOpacity, 'while it thins');
  assert.ok(late.stainOpacity > 0, 'the stain is still there when the column is gone');
  assert.ok(late.columnOpacity < .1);
});

test('motes rise in sequence and none is visible before or after its turn', () => {
  const tide = deathTide(.35);
  assert.equal(tide.motes.length, 4);
  const alphas = tide.motes.map(mote => mote.alpha);
  assert.ok(new Set(alphas.map(alpha => alpha.toFixed(3))).size > 1, 'motes must not share a phase');
  for (const mote of tide.motes) {
    assert.ok(mote.alpha >= 0 && mote.alpha <= .8);
    assert.ok(mote.r > 0 && mote.y <= 0, 'motes only go up');
  }
  const tooEarly = deathTide(.05).motes.every(mote => mote.alpha === 0);
  assert.equal(tooEarly, true, 'nothing floats before the body even lands');
});

test('an ultimate kill is bigger, and the shape follows the battle scale', () => {
  const normal = deathTide(.4, 1, false), ultimate = deathTide(.4, 1, true);
  assert.ok(ultimate.columnHeight > normal.columnHeight && ultimate.stainRadius > normal.stainRadius);
  const large = deathTide(.4, 1.5);
  assert.ok(Math.abs(large.columnHeight - normal.columnHeight * 1.5) < 1e-6, 'height follows the scale');
});

test('bad clocks and scales never emit NaN geometry', () => {
  for (const [age, scale] of [[NaN, NaN], [-4, 0], [Infinity, -3]] as const) {
    const tide = deathTide(age, scale);
    assert.ok(Number.isFinite(tide.stainRadius) && Number.isFinite(tide.columnHeight)
      && Number.isFinite(tide.columnOpacity) && Number.isFinite(tide.stainOpacity));
    assert.ok(tide.stainRadius >= 0 && tide.columnHeight >= 0);
    for (const mote of tide.motes) {
      assert.ok(Number.isFinite(mote.x) && Number.isFinite(mote.y) && Number.isFinite(mote.alpha));
    }
  }
});
