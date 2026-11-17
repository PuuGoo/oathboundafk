// PROTOTYPE - NOT FOR PRODUCTION
// Kiểm tra GLB sân đấu bằng GLTFLoader/AnimationMixer thật; không cần GPU hay trình duyệt.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARENA_CLIP_SECONDS, ARENA_DEFINITIONS, resolveArenaScene } from '../src/game/arena3d.ts';
import { getCampaignStage } from '../src/game/campaign.ts';
import { resolveSpriteArena } from '../src/game/spriteBattleRenderer.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const specs = JSON.parse(fs.readFileSync(path.join(root, 'tools/arena-themes.json'), 'utf8'));
assert.deepEqual(specs.map(spec => spec.id).sort(), ARENA_DEFINITIONS.map(entry => entry.id).sort(),
  'Every authored arena must be registered in src/game/arena3d.ts and vice versa');
assert.equal(new Set(specs.map(spec => spec.theme)).size, specs.length, 'one arena per stage theme');

// Mỗi theme trong campaign phải phân giải được một GLB thật.
const themes = new Set();
for (let stageId = 1; stageId <= 60; stageId++) {
  const stage = getCampaignStage(stageId);
  if (stage) themes.add(stage.theme);
}
assert.ok(themes.size >= 4, `expected several stage themes, got ${[...themes]}`);
for (const theme of themes) {
  const palette = resolveSpriteArena(theme, 'auto');
  const definition = resolveArenaScene(theme, palette);
  assert.ok(definition, `stage theme ${theme} has no authored arena`);
}

const selected = process.argv.slice(2);
const entries = selected.length ? specs.filter(spec => selected.includes(spec.id)) : specs;
if (selected.length) assert.equal(entries.length, new Set(selected).size, 'Unknown arena id');

const results = [];
for (const spec of entries) {
  const definition = ARENA_DEFINITIONS.find(entry => entry.id === spec.id);
  assert.ok(definition, `${spec.id}: missing runtime definition`);
  assert.equal(definition.theme, spec.theme);
  const file = path.join(root, 'public' + definition.url);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, spec.id);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.ok(json.buffers.every(buffer => !buffer.uri), 'Self-contained GLB');
  assert.equal(json.images?.length || 0, 0, 'No texture downloads');
  assert.ok((json.materials?.length || 0) >= 4, 'Arena needs distinct floor/trim/prop/glow materials');
  // Draw-call budget: static meshes are merged, only animated props stay separate.
  assert.ok(json.meshes.length <= 45, `${spec.id}: ${json.meshes.length} meshes exceeds the draw budget`);
  const provenance = JSON.parse(fs.readFileSync(file.replace('.glb', '.provenance.json'), 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.metrics.glbSha256, 'Hash matches provenance');
  assert.deepEqual(provenance.animations.map(animation => animation.name).sort(), Object.keys(ARENA_CLIP_SECONDS).sort());
  assert.ok(fs.statSync(path.join(root, provenance.source)).size > 0, 'Editable Blender source exists');
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  assert.deepEqual(gltf.animations.map(clip => clip.name).sort(), Object.keys(ARENA_CLIP_SECONDS).sort());
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const meshes = [];
  gltf.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
  assert.ok(meshes.length >= 20, `${spec.id}: arena needs more than a flat disc`);
  let samples = 0;
  const bounds = {};
  for (const clip of gltf.animations) {
    const expected = ARENA_CLIP_SECONDS[clip.name];
    assert.ok(Math.abs(clip.duration - expected) < 1e-4, `${spec.id}/${clip.name}: duration ${clip.duration}`);
    for (const track of clip.tracks) {
      assert.ok([...track.times, ...track.values].every(Number.isFinite), `${spec.id}/${clip.name}/${track.name}`);
      assert.equal(track.times[0], 0, `${spec.id}/${clip.name}/${track.name}: starts at zero`);
    }
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).setLoop(clip.name === 'idle' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true; action.reset().play();
    const envelope = new THREE.Box3();
    for (let step = 0; step <= 12; step++) {
      action.paused = false;
      mixer.setTime(clip.name === 'idle' ? clip.duration * step / 12 % clip.duration : clip.duration * step / 12);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite),
        `${spec.id}/${clip.name}/${object.name}`));
      for (const mesh of meshes) envelope.expandByObject(mesh);
      samples++;
    }
    const size = envelope.getSize(new THREE.Vector3());
    assert.ok(Math.max(...size.toArray()) < 420, `${spec.id}/${clip.name}: exploded bounds ${size.toArray()}`);
    assert.ok(size.y > 20, `${spec.id}/${clip.name}: arena has no height ${size.toArray()}`);
    // Đĩa sàn phải phủ gần đúng bán kính 100 ở cả hai trục X/Z.
    assert.ok(size.x > 170 && size.z > 170, `${spec.id}/${clip.name}: disc too small ${size.toArray()}`);
    bounds[clip.name] = { min: envelope.min.toArray().map(x => +x.toFixed(2)), max: envelope.max.toArray().map(x => +x.toFixed(2)) };
  }
  const record = { id: spec.id, theme: spec.theme, bytes: bytes.length, meshes: meshes.length,
    clips: gltf.animations.length, samples, bounds, passed: true };
  results.push(record);
  console.log(JSON.stringify({ id: record.id, theme: record.theme, bytes: record.bytes,
    meshes: record.meshes, samples, passed: true }));
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
  const geometries = new Set(), materials = new Set();
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
}

const summary = { expected: entries.length, verified: results.length, failed: 0,
  bytes: results.reduce((total, record) => total + record.bytes, 0), arenas: results };
const output = path.join(root, 'production/qa/evidence/arena3d');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, selected.length ? `asset-check-${selected.join('-')}.json` : 'asset-check.json'),
  JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ expected: summary.expected, verified: summary.verified, failed: 0, bytes: summary.bytes }));
