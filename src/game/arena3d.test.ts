// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ARENA_CLIP_SECONDS, ARENA_DEFINITIONS, resolveArenaScene, sampleArenaPulse,
} from './arena3d';
import { getCampaignStage } from './campaign';
import { resolveSpriteArena } from './spriteBattleRenderer';

test('battle replacement clears the previous arena ultimate timestamp', () => {
  const source = readFileSync(new URL('../components/SpriteBattleCanvas.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('if (sim !== active) {');
  const end = source.indexOf('const playDt', start);
  assert.ok(start >= 0 && end > start, 'battle reset block exists');
  const reset = new Function(`
    const sim = null;
    let active = {}, lastUltimateAtMs = 8000, accumulator = 0, impactShake = 0, visualClock = 0;
    const actors = new Map(), texts = [], effects = [], feed = [];
    const heroes3d = { reset() {} }, publishAnnouncements = () => {};
    ${source.slice(start, end)}
    return lastUltimateAtMs;
  `);
  assert.equal(reset(), undefined, 'old cast must not replay when the new clock reaches 8000 ms');
});

test('every stage theme resolves a distinct authored arena', () => {
  const themes = new Set<string>();
  for (let stageId = 1; stageId <= 60; stageId++) {
    const stage = getCampaignStage(stageId);
    if (stage) themes.add(stage.theme);
  }
  assert.ok(themes.size >= 4, `expected several themes, got ${[...themes]}`);
  const used = new Map<string, string>();
  for (const theme of themes) {
    const definition = resolveArenaScene(theme, resolveSpriteArena(theme, 'auto'));
    assert.ok(definition, `${theme} has no arena`);
    // Hai theme khác nhau không được dùng chung một file trừ khi đó là cùng một bối cảnh.
    const previous = used.get(definition.id);
    assert.ok(previous === undefined || previous === theme, `${theme} and ${previous} share ${definition.id}`);
    used.set(definition.id, theme);
  }
  const ids = [...used.keys()];
  assert.equal(ids.length, themes.size, 'each theme needs its own scene');
});

test('the arena override wins over the stage theme, like the Canvas palette does', () => {
  const stage = getCampaignStage(1);
  assert.equal(resolveArenaScene(stage.theme, resolveSpriteArena(stage.theme, 'shadow_realm'))?.id, 'shadow');
  assert.equal(resolveArenaScene(stage.theme, resolveSpriteArena(stage.theme, 'enchanted_forest'))?.id, 'forest');
  assert.equal(resolveArenaScene(stage.theme, resolveSpriteArena(stage.theme, 'celestial_temple'))?.id, 'temple');
});

test('explicit overrides win on every campaign theme including tempest and obsidian', () => {
  for (const theme of ['sanctuary', 'sylvan', 'catacombs', 'tempest', 'obsidian']) {
    for (const [override, expected] of [['enchanted_forest', 'forest'], ['celestial_temple', 'temple'], ['shadow_realm', 'shadow']] as const) {
      assert.equal(resolveArenaScene(theme, resolveSpriteArena(theme, override), override)?.id, expected,
        `${theme}/${override}`);
    }
  }
  assert.equal(resolveArenaScene('tempest', 'temple', 'auto')?.id, 'storm');
  assert.equal(resolveArenaScene('obsidian', 'shadow', 'auto')?.id, 'obsidian');
});

test('unknown themes degrade to the palette scene instead of throwing', () => {
  assert.equal(resolveArenaScene('not_a_theme', 'temple')?.id, 'temple');
  assert.equal(resolveArenaScene('not_a_theme', 'forest')?.id, 'forest');
});

test('arena URLs and clip lengths are complete for every registered scene', () => {
  assert.equal(ARENA_DEFINITIONS.length, 5);
  for (const definition of ARENA_DEFINITIONS) {
    assert.match(definition.url, /^\/assets\/arenas\/[a-z]+\.glb$/);
    assert.ok(ARENA_CLIP_SECONDS.idle > 0 && ARENA_CLIP_SECONDS.pulse > 0);
  }
  assert.equal(new Set(ARENA_DEFINITIONS.map(entry => entry.url)).size, ARENA_DEFINITIONS.length);
  assert.equal(new Set(ARENA_DEFINITIONS.map(entry => entry.theme)).size, ARENA_DEFINITIONS.length);
});

test('an ultimate pulse owns the pulse clip, then the arena returns to its idle loop', () => {
  assert.deepEqual(sampleArenaPulse(undefined, 3.5, false), { clip: 'idle', seconds: 3.5, progress: 0 });
  const mid = sampleArenaPulse(ARENA_CLIP_SECONDS.pulse / 2, 9, false)!;
  assert.equal(mid.clip, 'pulse');
  assert.equal(mid.progress, .5);
  assert.equal(mid.seconds, ARENA_CLIP_SECONDS.pulse / 2);
  // Hết clip là quay lại idle; không giữ pulse vĩnh viễn.
  assert.equal(sampleArenaPulse(ARENA_CLIP_SECONDS.pulse, 9, false)?.clip, 'idle');
  assert.equal(sampleArenaPulse(ARENA_CLIP_SECONDS.pulse + 5, 9, false)?.clip, 'idle');
});

test('reduced motion suppresses the expanding pulse and freezes ambience', () => {
  assert.deepEqual(sampleArenaPulse(undefined, 2.25, true), { clip: 'idle', seconds: 0, progress: 0 });
  for (const age of [0, .4, 1.2]) {
    assert.deepEqual(sampleArenaPulse(age, 2.25, true), { clip: 'idle', seconds: 0, progress: 0 });
  }
});

test('invalid pulse timestamps cannot invent an ultimate flash', () => {
  for (const age of [NaN, Infinity, -Infinity, -5]) {
    assert.deepEqual(sampleArenaPulse(age, 2, false), { clip: 'idle', seconds: 2, progress: 0 });
  }
});

test('bad clocks never produce NaN geometry', () => {
  for (const [age, wall] of [[NaN, 1], [Infinity, 1], [-5, 1], [undefined, NaN]] as const) {
    const sample = sampleArenaPulse(age as number | undefined, wall as number, false)!;
    assert.ok(Number.isFinite(sample.seconds) && Number.isFinite(sample.progress));
    assert.ok(sample.seconds >= 0 && sample.progress >= 0 && sample.progress <= 1);
  }
});
