// PROTOTYPE - NOT FOR PRODUCTION
// Kiểm tra model bằng GLTFLoader/AnimationMixer thật; không cần GPU hoặc trình duyệt.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { OATHBOUND_HEROES } from '../src/game/oathboundHeroes.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const specs = JSON.parse(fs.readFileSync(path.join(root, 'tools/hero-models.json'), 'utf8'));
const all = [...specs, { id: 'belinda', heroId: 'belinda' }];
assert.equal(all.length, OATHBOUND_HEROES.length);
assert.deepEqual(all.map(s => s.heroId).sort(), OATHBOUND_HEROES.map(s => s.heroId).sort());
assert.equal(new Set(all.map(s => s.id)).size, all.length);
const selected = process.argv.slice(2);
const entries = selected.length ? all.filter(s => selected.includes(s.id)) : all;
if (selected.length) assert.equal(entries.length, new Set(selected).size, 'Unknown model id');
const durations = { idle: 2, run: .6, basic: .4, active: 1.15, ultimate: 1.65, hit: .3, death: 1.2 };
const results = [];
for (const spec of entries) {
  const file = path.join(root, 'public/assets/models', spec.id + '.glb');
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, spec.id);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.ok(json.buffers.every(b => !b.uri), 'Self-contained GLB');
  assert.equal(json.images?.length || 0, 0, 'No texture downloads');
  assert.equal(json.skins.length, 1);
  assert.equal(json.meshes.length, 1);
  const provenance = JSON.parse(fs.readFileSync(file.replace('.glb', '.provenance.json'), 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.metrics.glbSha256);
  assert.ok(fs.statSync(path.join(root, provenance.source)).size > 0);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  assert.deepEqual(gltf.animations.map(c => c.name).sort(), Object.keys(durations).sort());
  const other = clone(gltf.scene);
  const skins = [], secondSkins = [];
  gltf.scene.traverse(o => { if (o.isSkinnedMesh) skins.push(o); });
  other.traverse(o => { if (o.isSkinnedMesh) secondSkins.push(o); });
  assert.ok(skins.length && skins.length === secondSkins.length);
  for (let i = 0; i < skins.length; i++) {
    assert.notEqual(skins[i].skeleton, secondSkins[i].skeleton);
    assert.notEqual(skins[i].skeleton.bones[0], secondSkins[i].skeleton.bones[0]);
  }
  const mixer = new THREE.AnimationMixer(gltf.scene);
  let samples = 0;
  const bounds = {};
  for (const clip of gltf.animations) {
    assert.ok(Math.abs(clip.duration - durations[clip.name]) < 1e-5, `${spec.id}/${clip.name}: duration`);
    for (const track of clip.tracks) {
      assert.ok([...track.times, ...track.values].every(Number.isFinite));
      assert.equal(track.times[0], 0);
    }
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true; action.reset().play();
    const envelope = new THREE.Box3();
    for (let step = 0; step <= 12; step++) {
      action.paused = false; mixer.setTime(clip.duration * step / 12);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(o => assert.ok(o.matrixWorld.elements.every(Number.isFinite), `${spec.id}/${clip.name}/${o.name}`));
      for (const skin of skins) {
        skin.skeleton.update(); assert.ok(skin.skeleton.boneMatrices.every(Number.isFinite));
        skin.computeBoundingBox();
        assert.ok([...skin.boundingBox.min.toArray(), ...skin.boundingBox.max.toArray()].every(Number.isFinite));
        envelope.union(skin.boundingBox.clone().applyMatrix4(skin.matrixWorld));
      }
      samples++;
    }
    const size = envelope.getSize(new THREE.Vector3());
    assert.ok(Math.max(...size.toArray()) < 7, `${spec.id}/${clip.name}: exploded skeleton ${size.toArray()}`);
    bounds[clip.name] = { min: envelope.min.toArray().map(x => +x.toFixed(3)), max: envelope.max.toArray().map(x => +x.toFixed(3)) };
  }
  const record = { id: spec.id, heroId: spec.heroId, bytes: bytes.length, clips: gltf.animations.length,
    skinnedPrimitives: skins.length, bones: json.skins[0].joints.length, samples, bounds, passed: true };
  results.push(record);
  console.log(JSON.stringify({ id: record.id, bytes: record.bytes, clips: record.clips, bones: record.bones, samples, passed: true }));
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
  const geometries = new Set(), materials = new Set(), skeletons = new Set();
  for (const scene of [gltf.scene, other]) scene.traverse(o => {
    if (o.isMesh) { geometries.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m)); }
    if (o.isSkinnedMesh) skeletons.add(o.skeleton);
  });
  skeletons.forEach(s => s.dispose()); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
const summary = { expected: entries.length, verified: results.length, failed: 0,
  bytes: results.reduce((n,r) => n+r.bytes,0), sampledPoses: results.reduce((n,r) => n+r.samples,0), models: results };
const output = path.join(root, 'production/qa/evidence/roster3d'); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, selected.length ? `asset-check-${selected.join('-')}.json` : 'asset-check.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ expected: summary.expected, verified: summary.verified, failed: 0, bytes: summary.bytes, sampledPoses: summary.sampledPoses }));
