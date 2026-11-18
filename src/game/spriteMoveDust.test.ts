// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dustPuff, MOVE_DUST_SECONDS } from './spriteMoveDust';

const alpha = (rgba: string): number => Number(rgba.slice(rgba.lastIndexOf(',') + 1, -1));

test('a dust puff grows, lifts and fades inside its window', () => {
  const early = dustPuff(0, 1), mid = dustPuff(MOVE_DUST_SECONDS * .45, 1);
  const late = dustPuff(MOVE_DUST_SECONDS * .95, 1);
  assert.equal(early.opacity, .5, 'a fresh puff starts at its authored density');
  assert.ok(mid.radius > early.radius && late.radius > mid.radius, 'the puff spreads outward');
  assert.ok(mid.opacity < early.opacity && late.opacity < mid.opacity, 'and thins as it spreads');
  assert.ok(late.dy < early.dy, 'it lifts off the floor');
  assert.equal(dustPuff(MOVE_DUST_SECONDS, 1).alive, false);
  assert.equal(dustPuff(MOVE_DUST_SECONDS * 3, 1).radius, 0);
});

test('dust drifts behind the runner, never ahead of the feet', () => {
  // facing 1 = chạy sang phải: bụi phải bị bỏ lại phía sau (dx < 0).
  for (let seed = 0; seed < 12; seed++) {
    const puff = dustPuff(MOVE_DUST_SECONDS * .5, seed, 1, 0x8d7250, 1);
    assert.ok(puff.dx < 0, `seed ${seed} drifted ahead of the runner (${puff.dx})`);
  }
  // Quay mặt sang trái thì bụi bị bỏ lại phía ngược lại.
  for (let seed = 0; seed < 12; seed++) {
    assert.ok(dustPuff(MOVE_DUST_SECONDS * .5, seed, 1, 0x8d7250, -1).dx > 0, 'seed ' + seed);
  }
});

test('each puff leaves in a slightly different direction', () => {
  const angles = new Set<number>();
  for (let seed = 0; seed < 20; seed++) angles.add(Number(dustPuff(.1, seed).dx.toFixed(2)));
  assert.ok(angles.size > 5, `puffs must not all follow one line (${angles.size} distinct offsets)`);
});

test('dust is lighter than the floor it puffs off, and follows the stage scale', () => {
  const ground = 0x8d7250;
  const puff = dustPuff(.08, 2, 1, ground);
  const channels = puff.color.slice(puff.color.indexOf('(') + 1, puff.color.lastIndexOf(','))
    .split(',').map(Number);
  assert.ok(channels[0] > ((ground >> 16) & 0xff), 'dust catches more light than the stone');
  const big = dustPuff(.08, 2, 1.5, ground);
  assert.ok(Math.abs(big.radius - puff.radius * 1.5) < 1e-6, 'radius follows the battle scale');
});

test('bad clocks and seeds never emit NaN geometry or colour', () => {
  for (const [age, seed, scale] of [[NaN, NaN, NaN], [-3, -1, 0], [Infinity, 9, -2]] as const) {
    const puff = dustPuff(age, seed, scale);
    assert.doesNotMatch(puff.color, /NaN|Infinity/);
    assert.ok(Number.isFinite(puff.dx) && Number.isFinite(puff.dy) && Number.isFinite(puff.radius));
    assert.ok(alpha(puff.color) >= 0 && alpha(puff.color) <= 1 && puff.radius >= 0);
  }
});
