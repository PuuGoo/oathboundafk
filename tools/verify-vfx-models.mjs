// PROTOTYPE - NOT FOR PRODUCTION
// Kiểm tra GLB hiệu ứng bằng GLTFLoader/AnimationMixer thật; không cần GPU hay trình duyệt.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OATHBOUND_HEROES } from '../src/game/oathboundHeroes.ts';
import { HERO_VFX_DEFINITIONS, VFX_CLIP_SECONDS } from '../src/game/heroVfx.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const specs = JSON.parse(fs.readFileSync(path.join(root, 'tools/hero-vfx.json'), 'utf8'));
const heroes = new Map(OATHBOUND_HEROES.map(hero => [hero.heroId, hero]));
for (const spec of specs) {
  assert.ok(heroes.has(spec.heroId), `${spec.id}: hero id must exist in the roster`);
  assert.ok(['sigil', 'strike', 'lance', 'volley', 'bloom', 'storm'].includes(spec.family), `${spec.id}: unknown family`);
}
assert.equal(new Set(specs.map(spec => spec.id)).size, specs.length, 'duplicate effect id');
const enabled = new Set(HERO_VFX_DEFINITIONS.map(definition => definition.heroId));
assert.deepEqual([...enabled].sort(), specs.map(spec => spec.heroId).sort(),
  'Every authored effect must be enabled in src/game/heroVfx.ts and vice versa');

const selected = process.argv.slice(2);
const entries = selected.length ? specs.filter(spec => selected.includes(spec.id)) : specs;
if (selected.length) assert.equal(entries.length, new Set(selected).size, 'Unknown effect id');

/** Coverage of glowing pixels in a Blender preview; PNG decode stays local and dependency-free. */
function pngCoverage(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt32BE(0), 0x89504e47, `${file}: not a PNG`);
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  assert.equal(bitDepth, 8, `${file}: only 8-bit previews are inspected`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `${file}: unexpected colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let lit = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = row[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const i = y * stride + x * channels;
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 40) lit++;
    }
  }
  return +(lit / (width * height)).toFixed(4);
}

const results = [];
for (const spec of entries) {
  const file = path.join(root, 'public/assets/vfx', spec.id + '.glb');
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, spec.id);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.ok(json.buffers.every(buffer => !buffer.uri), 'Self-contained GLB');
  assert.equal(json.images?.length || 0, 0, 'No texture downloads');
  assert.ok((json.materials?.length || 0) >= 3, 'Authored materials');
  const provenance = JSON.parse(fs.readFileSync(file.replace('.glb', '.provenance.json'), 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.metrics.glbSha256, 'Hash matches provenance');
  assert.deepEqual(provenance.animations.map(animation => animation.name).sort(), Object.keys(VFX_CLIP_SECONDS).sort());
  assert.ok(fs.statSync(path.join(root, provenance.source)).size > 0, 'Editable Blender source exists');
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  assert.deepEqual(gltf.animations.map(clip => clip.name).sort(), Object.keys(VFX_CLIP_SECONDS).sort());
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const meshes = [];
  gltf.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
  assert.ok(meshes.length >= 8, `${spec.id}: effect needs more than a single primitive`);
  let samples = 0;
  const bounds = {};
  for (const clip of gltf.animations) {
    const expected = VFX_CLIP_SECONDS[clip.name];
    assert.ok(Math.abs(clip.duration - expected) < 1e-5, `${spec.id}/${clip.name}: duration ${clip.duration}`);
    assert.ok(clip.tracks.length >= 6, `${spec.id}/${clip.name}: animated channels`);
    for (const track of clip.tracks) {
      assert.ok([...track.times, ...track.values].every(Number.isFinite), `${spec.id}/${clip.name}/${track.name}`);
      assert.equal(track.times[0], 0, `${spec.id}/${clip.name}/${track.name}: starts at zero`);
    }
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true; action.reset().play();
    const envelope = new THREE.Box3();
    for (let step = 0; step <= 10; step++) {
      action.paused = false; mixer.setTime(clip.duration * step / 10);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite),
        `${spec.id}/${clip.name}/${object.name}`));
      for (const mesh of meshes) envelope.expandByObject(mesh);
      samples++;
    }
    const size = envelope.getSize(new THREE.Vector3());
    assert.ok(Math.max(...size.toArray()) < 8, `${spec.id}/${clip.name}: exploded bounds ${size.toArray()}`);
    assert.ok(Math.max(...size.toArray()) > .2, `${spec.id}/${clip.name}: collapsed to nothing ${size.toArray()}`);
    bounds[clip.name] = { min: envelope.min.toArray().map(x => +x.toFixed(3)), max: envelope.max.toArray().map(x => +x.toFixed(3)) };
  }
  const evidence = path.join(root, 'production/qa/evidence/vfx3d', spec.id);
  const previews = {};
  for (const clip of Object.keys(VFX_CLIP_SECONDS)) {
    const preview = path.join(evidence, `${clip}.png`);
    if (fs.existsSync(preview)) previews[clip] = pngCoverage(preview);
  }
  const record = { id: spec.id, heroId: spec.heroId, family: spec.family, bytes: bytes.length,
    primitives: meshes.length, clips: gltf.animations.length, samples, bounds, previews, passed: true };
  results.push(record);
  console.log(JSON.stringify({ id: record.id, bytes: record.bytes, primitives: record.primitives,
    samples, previews, passed: true }));
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
  bytes: results.reduce((total, record) => total + record.bytes, 0),
  sampledPoses: results.reduce((total, record) => total + record.samples, 0), effects: results };
const output = path.join(root, 'production/qa/evidence/vfx3d');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, selected.length ? `asset-check-${selected.join('-')}.json` : 'asset-check.json'),
  JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ expected: summary.expected, verified: summary.verified, failed: 0,
  bytes: summary.bytes, sampledPoses: summary.sampledPoses }));
