// Kiểm tra điểm nối idle trên GLB thật, không modulo thời gian cuối clip.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
const specs = JSON.parse(fs.readFileSync(new URL('./arena-themes.json', import.meta.url), 'utf8'));
for (const { id } of specs) {
  const bytes = fs.readFileSync(new URL(`../public/assets/arenas/${id}.glb`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const clip = gltf.animations.find(clip => clip.name === 'idle');
  assert.ok(clip);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  const snapshot = seconds => {
    action.reset().play(); mixer.setTime(seconds); gltf.scene.updateMatrixWorld(true);
    const matrices = [];
    gltf.scene.traverse(object => matrices.push(...object.matrixWorld.elements));
    return matrices;
  };
  const first = snapshot(0), last = snapshot(clip.duration);
  const maxDelta = first.reduce((max, value, index) => Math.max(max, Math.abs(value - last[index])), 0);
  assert.ok(maxDelta < .001, `${id}: idle seam jumps by ${maxDelta}`);
  console.log(JSON.stringify({ id, maxDelta, passed: true }));
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
}
