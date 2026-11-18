// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  arenaLighting, arenaWeather, brazierGlow, weatherParticle, weatherParticleAlpha, weatherVertexColours,
  WEATHER_FAR_ALPHA, WEATHER_NEAR_ALPHA, ARENA_CLIP_SECONDS, ARENA_DEFINITIONS, resolveArenaScene, sampleArenaPulse,
} from './arena3d';
import authoredArenas from '../../tools/arena-themes.json';
import { getCampaignStage } from './campaign';
import { resolveSpriteArena } from './spriteBattleRenderer';

test('battle replacement clears the previous arena ultimate timestamp', () => {
  const source = readFileSync(new URL('../components/SpriteBattleCanvas.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('if (sim !== active) {');
  const end = source.indexOf('const playDt', start);
  assert.ok(start >= 0 && end > start, 'battle reset block exists');
  const reset = new Function(`
    const sim = null;
    let active = {}, lastUltimate = { atMs: 8000, tint: 0xff3322 }, accumulator = 0, impactShake = 0, visualClock = 0;
    const actors = new Map(), texts = [], effects = [], feed = [], shocks = [], dust = [];
    const lastDustAt = new Map(); let dustSeed = 0; const deaths = [];
    const heroes3d = { reset() {} }, publishAnnouncements = () => {};
    ${source.slice(start, end)}
    return lastUltimate;
  `);
  assert.equal(reset(), undefined, 'old cast must not replay when the new clock reaches 8000 ms');
});

test('every arena carries its own weather field that moves and stays inside the stage', () => {
  for (const definition of ARENA_DEFINITIONS) {
    const weather = arenaWeather(definition.id);
    assert.ok(Number.isInteger(weather.count) && weather.count > 20, `${definition.id}: weather needs particles`);
    assert.ok(weather.size > 0 && weather.size < 6, `${definition.id}: points stay small`);
    assert.ok(weather.opacity > 0 && weather.opacity <= .7, `${definition.id}: weather stays subordinate`);
    assert.ok(weather.speed > 0 && weather.speed < 1, `${definition.id}: weather needs a sane speed`);
    assert.ok(weather.color >= 0 && weather.color <= 0xffffff, `${definition.id}: weather needs a colour`);
    assert.notDeepEqual(weatherParticle(weather, 0, 0), weatherParticle(weather, 0, 1.5),
      `${definition.id}: particles must move`);
    for (const clock of [0, .7, 3.3, 12]) {
      for (let index = 0; index < weather.count; index += 7) {
        const particle = weatherParticle(weather, index, clock);
        assert.ok(Math.abs(particle.x) < 110 && particle.y > 1 && particle.y < 103
          && particle.z > -115 && particle.z < 45,
        `${definition.id}: particle ${index} left the stage at ${clock}s`);
      }
    }
    // Bố cục hạt là hàm thuần: cùng đầu vào cho cùng đầu ra, không phụ thuộc thứ tự gọi.
    assert.deepEqual(weatherParticle(weather, 3, .4), weatherParticle(weather, 3, .4));
    assert.notDeepEqual(weatherParticle(weather, 3, .4), weatherParticle(weather, 4, .4));
  }
  assert.equal(arenaWeather('storm').direction, -1, 'rain falls');
  assert.equal(arenaWeather('obsidian').direction, 1, 'embers rise');
});

test('the brazier glow borrows the theme rim colour and stays a soft accent', () => {
  for (const definition of ARENA_DEFINITIONS) {
    const rim = arenaLighting(definition.id).rim;
    const glow = brazierGlow(rim);
    assert.equal(glow.color, rim & 0xffffff, `${definition.id}: the glow takes the rim colour`);
    assert.ok(glow.size > 10 && glow.size < 60, `${definition.id}: the halo is a soft disc, not a blob`);
    assert.ok(glow.opacity > .1 && glow.opacity < .5, `${definition.id}: the glow must not wash out the fire`);
  }
  // Màu ngoài 24 bit bị cắt, không tràn sang kênh khác.
  assert.equal(brazierGlow(0xff00ff00).color, 0x00ff00);
});

test('weather particles fade with depth and vary per grain', () => {
  for (const definition of ARENA_DEFINITIONS) {
    const weather = arenaWeather(definition.id);
    const colours = weatherVertexColours(weather, weather.count);
    assert.equal(colours.length, weather.count * 4, `${definition.id}: one RGBA per grain`);
    // Alpha theo độ sâu phải nằm trong khoảng đã đặt và đơn điệu.
    assert.equal(weatherParticleAlpha(-110), WEATHER_FAR_ALPHA);
    assert.equal(weatherParticleAlpha(40), WEATHER_NEAR_ALPHA);
    assert.ok(weatherParticleAlpha(0) > weatherParticleAlpha(-80), 'nearer grains read stronger');
    const alphas: number[] = [];
    for (let index = 0; index < weather.count; index++) {
      const alpha = colours[index * 4 + 3];
      assert.ok(alpha >= WEATHER_FAR_ALPHA - 1e-6 && alpha <= WEATHER_NEAR_ALPHA + 1e-6,
        `${definition.id}: grain ${index} alpha ${alpha} outside the depth band`);
      alphas.push(alpha);
      for (let channel = 0; channel < 3; channel++) {
        assert.ok(colours[index * 4 + channel] >= 0 && colours[index * 4 + channel] <= 1,
          `${definition.id}: grain ${index} channel ${channel} out of range`);
      }
    }
    // Có hạt gần và hạt xa thật, không phải mọi hạt cùng độ sâu.
    assert.ok(Math.max(...alphas) - Math.min(...alphas) > .2, `${definition.id}: grains must span the depth range`);
    // Độ sáng khác nhau giữa các hạt, nhưng vẫn cùng họ màu.
    const tints = new Set(Array.from({ length: weather.count }, (_, index) => colours[index * 4].toFixed(3)));
    assert.ok(tints.size > weather.count * .5, `${definition.id}: grains must not share one flat brightness`);
    // Số hạt âm/không hợp lệ không sinh mảng rác.
    assert.equal(weatherVertexColours(weather, -4).length, 0);
    assert.equal(weatherVertexColours(weather, NaN).length, 0);
    assert.equal(weatherVertexColours(weather, 2.7).length, 8, 'counts are floored to whole grains');
  }
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

test('character lighting follows each arena palette instead of one white rig', () => {
  const seen = new Set<number>();
  for (const definition of ARENA_DEFINITIONS) {
    const lighting = arenaLighting(definition.id);
    const spec = authoredArenas.find(entry => entry.id === definition.id)!;
    assert.equal(lighting.key, Number.parseInt(spec.primary, 16), `${definition.id}: key light is the theme primary`);
    assert.equal(lighting.rim, Number.parseInt(spec.accent, 16), `${definition.id}: rim light is the theme accent`);
    assert.equal(lighting.ground, Number.parseInt(spec.secondary, 16), `${definition.id}: bounce is the theme secondary`);
    assert.ok(lighting.key > 0 && lighting.rim > 0 && lighting.ground > 0, `${definition.id}: no black lights`);
    seen.add(lighting.rim);
  }
  assert.equal(seen.size, ARENA_DEFINITIONS.length, 'every arena must rim-light characters differently');
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
