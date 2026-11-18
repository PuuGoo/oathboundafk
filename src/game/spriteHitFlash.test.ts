// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitFlashFilter, HIT_FLASH_SECONDS } from './spriteHitFlash';

test('a hit flashes brighter at its peak and fades with the remaining timer', () => {
  const peak = hitFlashFilter({ flash: HIT_FLASH_SECONDS, team: 'enemy' });
  const half = hitFlashFilter({ flash: HIT_FLASH_SECONDS * .5, team: 'enemy' });
  const brightness = (value: string): number => Number(/brightness\(([\d.]+)\)/.exec(value)![1]);
  assert.ok(brightness(peak) > brightness(half) && brightness(half) > 1, 'both are brighter than rest');
  const radius = (value: string): number => Number(/px\s/.exec(value)![0]?.trim() ?? 0);
  assert.ok(hitFlashFilter({ flash: 0, team: 'enemy' }) === 'none', 'no flash means no filter at all');
});

test('allies taking damage read red and enemies taking damage read warm, not the same hue', () => {
  const ally = hitFlashFilter({ flash: HIT_FLASH_SECONDS, team: 'ally' });
  const enemy = hitFlashFilter({ flash: HIT_FLASH_SECONDS, team: 'enemy' });
  assert.match(ally, /rgba\(255,120,96/);
  assert.match(enemy, /rgba\(255,226,150/);
  assert.notEqual(ally, enemy);
});

test('petrify wins over the flash, and the LOW preset skips the tint', () => {
  assert.equal(hitFlashFilter({ flash: HIT_FLASH_SECONDS, team: 'ally', petrified: true }), 'grayscale(1)');
  const low = hitFlashFilter({ flash: HIT_FLASH_SECONDS, team: 'ally', low: true });
  assert.match(low, /^brightness\(/);
  assert.doesNotMatch(low, /drop-shadow/, 'the LOW preset must stay cheap');
});

test('bad timers never emit a broken filter string', () => {
  for (const flash of [NaN, Infinity, -1]) {
    const filter = hitFlashFilter({ flash, team: 'ally' });
    assert.doesNotMatch(filter, /NaN|Infinity/);
  }
});
