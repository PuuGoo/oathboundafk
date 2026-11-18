// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vignetteFor, vignetteStops } from './spriteVignette';
import { arenaLighting } from './arena3d';

const alpha = (rgba: string): number => Number(rgba.slice(rgba.lastIndexOf(',') + 1, -1));
const channels = (rgba: string): string => rgba.slice(rgba.indexOf('(') + 1, rgba.lastIndexOf(','));

test('the vignette darkens the corners and leaves the middle of the stage untouched', () => {
  const vignette = vignetteFor(480, 680, arenaLighting('temple').ground);
  const stops = vignetteStops(vignette);
  assert.equal(stops[0].at, 0);
  assert.equal(alpha(stops[0].color), 0, 'the centre must stay pixel-identical');
  for (let index = 1; index < stops.length; index++) {
    assert.ok(alpha(stops[index].color) > alpha(stops[index - 1].color), 'darkness grows outward');
  }
  assert.ok(alpha(stops.at(-1)!.color) > .3 && alpha(stops.at(-1)!.color) <= .85, 'the corner is shaded, not black');
});

test('the vignette takes the stage colour so the frame does not go grey', () => {
  for (const id of ['temple', 'forest', 'shadow', 'storm', 'obsidian'] as const) {
    const ground = arenaLighting(id).ground;
    const vignette = vignetteFor(960, 720, ground);
    const corner = vignetteStops(vignette).at(-1)!.color;
    assert.equal(channels(corner),
      `${(ground >> 16) & 0xff},${(ground >> 8) & 0xff},${ground & 0xff}`, `${id}: vignette colour`);
  }
});

test('a tall phone frame is shaded less than a desktop frame, and a flare lightens it', () => {
  const ground = arenaLighting('temple').ground;
  const desktop = vignetteFor(960, 720, ground).strength;
  const phone = vignetteFor(420, 900, ground).strength;
  const lit = vignetteFor(960, 720, ground, 1).strength;
  assert.ok(phone < desktop, 'a narrow frame must keep its sides readable');
  assert.ok(lit < desktop, 'an ultimate flare lights the stage so the vignette backs off');
  assert.ok(vignetteFor(960, 720, ground, .5).strength < desktop, 'the lift is continuous');
});

test('bad sizes and colours never produce NaN or an opaque frame', () => {
  for (const [width, height, hex, flash] of [
    [NaN, NaN, NaN, NaN], [0, 0, -1, -3], [-480, 8, 0xffffff, 99],
  ] as const) {
    const vignette = vignetteFor(width, height, hex, flash);
    for (const stop of vignetteStops(vignette)) {
      assert.doesNotMatch(stop.color, /NaN|Infinity/);
      assert.ok(alpha(stop.color) >= 0 && alpha(stop.color) < .9);
    }
    assert.ok(vignette.outer > vignette.inner);
  }
});
