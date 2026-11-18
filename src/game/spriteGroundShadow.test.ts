// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundShadow } from './spriteGroundShadow';
import { arenaLighting, ARENA_DEFINITIONS } from './arena3d';

const alpha = (rgba: string): number => Number(rgba.slice(rgba.lastIndexOf(',') + 1, -1));
const channels = (rgba: string): number[] => rgba.slice(5, rgba.indexOf(')')).split(',')
  .slice(0, 3).map(Number);

test('the ground shadow takes the arena floor colour instead of a grey cut-out', () => {
  for (const definition of ARENA_DEFINITIONS) {
    const ground = arenaLighting(definition.id).ground;
    const shadow = groundShadow(ground, 1);
    const [r, g, b] = channels(shadow.core);
    // Bóng phải là bản tối của chính màu sàn: giữ tỷ lệ giữa các kênh, không xám hoá.
    const source = [(ground >> 16) & 0xff, (ground >> 8) & 0xff, ground & 0xff];
    // Bóng là bản tối của chính màu sàn (kênh lam nhỉnh hơn một chút cho bóng lạnh tự nhiên).
    const factors = [.22, .22, .24];
    for (let index = 0; index < 3; index++) {
      assert.ok(Math.abs([r, g, b][index] - source[index] * factors[index]) <= 1.5,
        `${definition.id}: channel ${index} drifted`);
    }
    assert.ok(alpha(shadow.core) > .3 && alpha(shadow.core) < .5, `${definition.id}: shadow stays readable`);
    assert.equal(alpha(shadow.edge), 0, `${definition.id}: the edge dissolves into the floor`);
  }
});

test('a casting stage lifts and widens the shadow instead of keeping it fixed', () => {
  const ground = arenaLighting('temple').ground;
  const idle = groundShadow(ground, 1, 0);
  const lit = groundShadow(ground, 1, 1);
  assert.ok(alpha(lit.core) < alpha(idle.core), 'a bright stage needs a lighter shadow');
  assert.ok(lit.radiusX > idle.radiusX && lit.radiusY > idle.radiusY, 'the shadow spreads as the light grows');
  assert.ok(alpha(groundShadow(ground, 1, .5).core) > alpha(lit.core), 'the lift is continuous');
});

test('dead units keep a faint shadow and the geometry follows the battle scale', () => {
  const ground = arenaLighting('storm').ground;
  const alive = groundShadow(ground, 1), dead = groundShadow(ground, 1, 0, false);
  assert.ok(alpha(dead.core) < alpha(alive.core) * .5, 'a fallen body casts almost nothing');
  const big = groundShadow(ground, 1.4);
  assert.ok(Math.abs(big.radiusX - groundShadow(ground, 1).radiusX * 1.4) < 1e-6, 'radius scales with the stage');
  assert.ok(big.radiusY < big.radiusX * .4, 'the shadow is flattened onto the tilted floor');
});

test('bad numbers never produce NaN colour or a zero-size shadow', () => {
  for (const [scale, flash] of [[NaN, NaN], [0, -3], [-1, 9]] as const) {
    const shadow = groundShadow(0x8d7250, scale, flash);
    assert.doesNotMatch(shadow.core, /NaN|Infinity/);
    assert.ok(shadow.radiusX > 0 && shadow.radiusY > 0 && shadow.offsetY >= 0);
  }
});
