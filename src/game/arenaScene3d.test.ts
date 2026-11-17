// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createArenaScene, type LoadedArena } from './arenaScene3d';
import { ARENA_DEFINITIONS, ARENA_CLIP_SECONDS } from './arena3d';

const surface = () => {
  const stats = { renders: 0, draws: 0, lost: false };
  // Tách hộp bao của đĩa tĩnh và của vòng pulse/mote để test từng phần.
  const captures: { meshes: number; box: THREE.Box3; motes: THREE.Vector3[]; pulse?: THREE.Box3 }[] = [];
  const renderer = {
    domElement: {},
    getContext: () => ({ isContextLost: () => stats.lost }),
    render: (scene: THREE.Scene) => {
      stats.renders++;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3();
      const pulse = new THREE.Box3();
      const motes: THREE.Vector3[] = [];
      let meshes = 0;
      scene.traverseVisible(object => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes++;
        box.expandByObject(object);
        if (object.name.startsWith('Pulse')) pulse.expandByObject(object);
        if (object.name.startsWith('Mote')) motes.push(object.getWorldPosition(new THREE.Vector3()));
      });
      captures.push({ meshes, box, motes, pulse: pulse.isEmpty() ? undefined : pulse });
    },
  } as unknown as THREE.WebGLRenderer;
  const ctx = { drawImage: () => { stats.draws++; } } as unknown as CanvasRenderingContext2D;
  return { renderer, ctx, stats, captures };
};
const frame = (patch: Partial<Parameters<ReturnType<typeof createArenaScene>['draw']>[3]> = {}) => ({
  width: 480, height: 680, centerX: 240, centerY: 388,
  radiusX: 317, radiusY: 211, reducedMotion: false, wallClock: 1.5, ...patch,
});
const realArena = (id: string) => async (): Promise<LoadedArena> => {
  const bytes = readFileSync(new URL(`../../public/assets/arenas/${id}.glb`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return { scene: gltf.scene, animations: gltf.animations };
};
const ready = async (scene: { status(id: never): string }, id: string) => {
  for (let attempt = 0; attempt < 300 && scene.status(id as never) === 'loading'; attempt++) {
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  assert.equal(scene.status(id as never), 'ready');
};
/** Tra cứu định nghĩa arena đã đăng ký theo id. */
const at = (id: string) => ARENA_DEFINITIONS.find(entry => entry.id === id)!;

test('the committed temple arena loads and renders only after the asset is ready', async () => {
  const screen = surface();
  const scene = createArenaScene(THREE, { loadModel: realArena('temple') });
  const definition = ARENA_DEFINITIONS.find(entry => entry.id === 'temple')!;
  assert.equal(scene.draw(screen.renderer, screen.ctx, definition, frame()), false,
    'a loading arena must not draw a half-built scene');
  assert.equal(screen.stats.renders, 0);
  await ready(scene, 'temple');
  assert.equal(scene.draw(screen.renderer, screen.ctx, definition, frame()), true);
  assert.equal(screen.stats.renders, 1, 'one render per frame');
  assert.equal(screen.stats.draws, 1, 'one composite into the shared canvas');
  assert.ok(screen.captures.at(-1)!.meshes >= 20, 'arena needs real geometry');
  scene.dispose();
});

test('the arena is drawn on the ellipse the Canvas floor already uses', async () => {
  const screen = surface();
  const scene = createArenaScene(THREE, { loadModel: realArena('temple') });
  const definition = ARENA_DEFINITIONS.find(entry => entry.id === 'temple')!;
  scene.draw(screen.renderer, screen.ctx, definition, frame());
  await ready(scene, 'temple');
  // DISC: quét nhiều kích thước canvas để chắc tỷ lệ ellipse không lệ thuộc kích thước.
  for (const [width, height] of [[480, 680], [960, 1360], [360, 510]] as const) {
    scene.draw(screen.renderer, screen.ctx, definition, frame({ width, height,
      centerX: width / 2, centerY: height * .57, radiusX: width * .66, radiusY: height * .31 }));
    const box = screen.captures.at(-1)!.box;
    // Thế giới GLB: đĩa bán kính 100, vành và cột vượt ra ngoài một chút.
    const widthExtent = box.max.x - box.min.x;
    assert.ok(widthExtent >= 199 && widthExtent <= 260, `disc width ${widthExtent} at ${width}x${height}`);
    // Điểm quan trọng: mép đĩa phải rơi đúng trên ellipse mà Canvas2D đã vẽ.
    const view = { width, height, centerX: width / 2, centerY: height * .57,
      radiusX: width * .66, radiusY: height * .31, reducedMotion: false, wallClock: 1.5 };
    const right = scene.project(100, 0, 0, view), left = scene.project(-100, 0, 0, view);
    const near = scene.project(0, 0, 100, view), far = scene.project(0, 0, -100, view);
    assert.ok(Math.abs(right.x - (view.centerX + view.radiusX)) < 1.5, `right edge ${right.x}`);
    assert.ok(Math.abs(left.x - (view.centerX - view.radiusX)) < 1.5, `left edge ${left.x}`);
    assert.ok(Math.abs(near.y - (view.centerY + view.radiusY)) < 1.5, `near edge ${near.y}`);
    assert.ok(Math.abs(far.y - (view.centerY - view.radiusY)) < 1.5, `far edge ${far.y}`);
  }
  scene.dispose();
});

test('switching theme swaps the scene and keeps exactly one active arena', async () => {
  const screen = surface();
  let current = 'temple';
  const scene = createArenaScene(THREE, { loadModel: async () => realArena(current)() });
  const temple = ARENA_DEFINITIONS.find(entry => entry.id === 'temple')!;
  const shadow = ARENA_DEFINITIONS.find(entry => entry.id === 'shadow')!;
  scene.draw(screen.renderer, screen.ctx, at('temple'), frame());
  await ready(scene, 'temple');
  scene.draw(screen.renderer, screen.ctx, at('temple'), frame());
  assert.equal(scene.activeId(), 'temple');
  current = 'shadow';
  assert.equal(scene.draw(screen.renderer, screen.ctx, at('shadow'), frame()), false, 'the new theme loads first');
  await ready(scene, 'shadow');
  scene.draw(screen.renderer, screen.ctx, shadow, frame());
  assert.equal(scene.activeId(), 'shadow');
  assert.equal(scene.diagnostics().records.filter(record => record.state === 'ready').length, 2);
  scene.dispose();
});

test('the ultimate pulse advances one-shot, then idle loops on wall time', async () => {
  const screen = surface();
  const scene = createArenaScene(THREE, { loadModel: realArena('temple') });
  const definition = ARENA_DEFINITIONS.find(entry => entry.id === 'temple')!;
  scene.draw(screen.renderer, screen.ctx, definition, frame());
  await ready(scene, 'temple');
  const ringWidths: number[] = [];
  for (const pulseAge of [0, ARENA_CLIP_SECONDS.pulse * .5, ARENA_CLIP_SECONDS.pulse * .95]) {
    scene.draw(screen.renderer, screen.ctx, definition, frame({ pulseAge, wallClock: 0 }));
    const pulse = screen.captures.at(-1)!.pulse;
    assert.ok(pulse, 'pulse ring must exist while the pulse clip runs');
    ringWidths.push(pulse!.max.x - pulse!.min.x);
  }
  assert.ok(ringWidths[1] > ringWidths[0], `pulse must expand: ${ringWidths}`);
  assert.ok(ringWidths[2] >= ringWidths[1], `pulse keeps expanding: ${ringWidths}`);
  // Hết clip: vòng pulse không còn, mote vẫn chạy theo đồng hồ thực.
  scene.draw(screen.renderer, screen.ctx, definition, frame({ wallClock: 1 }));
  assert.equal(screen.captures.at(-1)!.pulse, undefined, 'pulse must end with its clip');
  const idleA = screen.captures.at(-1)!.motes;
  scene.draw(screen.renderer, screen.ctx, definition, frame({ wallClock: 2.4 }));
  const idleB = screen.captures.at(-1)!.motes;
  assert.ok(idleA.length > 0 && idleA.length === idleB.length);
  assert.ok(idleA.some((position, index) => position.distanceTo(idleB[index]) > .01),
    'idle must animate motes on wall time');
  scene.dispose();
});

test('returning from pulse samples the same idle pose as a repeated paused frame', async () => {
  const screen = surface();
  const scene = createArenaScene(THREE, { loadModel: realArena('temple') });
  scene.draw(screen.renderer, screen.ctx, at('temple'), frame());
  await ready(scene, 'temple');
  scene.draw(screen.renderer, screen.ctx, at('temple'), frame({ pulseAge: .8 }));
  scene.draw(screen.renderer, screen.ctx, at('temple'), frame({ wallClock: 1 }));
  const first = screen.captures.at(-1)!.motes;
  scene.draw(screen.renderer, screen.ctx, at('temple'), frame({ wallClock: 1 }));
  const repeated = screen.captures.at(-1)!.motes;
  assert.ok(first.length > 0);
  assert.ok(first.every((point, index) => point.distanceTo(repeated[index]) < 1e-6),
    'first idle frame must not blend the previous pulse action');
  scene.dispose();
});

test('reduced motion keeps the arena visible and static', async () => {
  const screen = surface();
  const scene = createArenaScene(THREE, { loadModel: realArena('forest') });
  const definition = ARENA_DEFINITIONS.find(entry => entry.id === 'forest')!;
  scene.draw(screen.renderer, screen.ctx, definition, frame({ reducedMotion: true }));
  await ready(scene, 'forest');
  scene.draw(screen.renderer, screen.ctx, definition, frame({ reducedMotion: true, wallClock: 1 }));
  const first = screen.captures.at(-1)!.motes;
  scene.draw(screen.renderer, screen.ctx, definition, frame({ reducedMotion: true, wallClock: 3 }));
  const second = screen.captures.at(-1)!.motes;
  assert.ok(first.length > 0, 'motes are still drawn');
  assert.ok(first.every((position, index) => position.distanceTo(second[index]) < 1e-6),
    'reduced motion must not animate the arena');
  assert.ok(screen.captures.at(-1)!.meshes >= 20, 'arena still drawn');
  scene.dispose();
});

test('a broken arena asset degrades to the Canvas floor without throwing', async () => {
  const screen = surface();
  const scene = createArenaScene(THREE, { loadModel: async () => { throw new Error('404'); } });
  const definition = ARENA_DEFINITIONS.find(entry => entry.id === 'storm')!;
  assert.equal(scene.draw(screen.renderer, screen.ctx, definition, frame()), false);
  for (let attempt = 0; attempt < 300 && scene.status('storm') === 'loading'; attempt++) {
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  assert.equal(scene.status('storm'), 'failed');
  assert.equal(scene.draw(screen.renderer, screen.ctx, definition, frame()), false);
  scene.dispose();
});

test('reset frees the cached template and dispose fails closed', async () => {
  const screen = surface();
  const scene = createArenaScene(THREE, { loadModel: realArena('obsidian') });
  const definition = ARENA_DEFINITIONS.find(entry => entry.id === 'obsidian')!;
  scene.draw(screen.renderer, screen.ctx, definition, frame());
  await ready(scene, 'obsidian');
  scene.draw(screen.renderer, screen.ctx, definition, frame());
  assert.equal(scene.diagnostics().active, 'obsidian');
  scene.reset();
  assert.equal(scene.activeId(), undefined);
  assert.equal(scene.status('obsidian'), 'idle', 'reset frees the cached template');
  // Trận mới tự tải lại từ đầu thay vì dùng template đã giải phóng.
  scene.draw(screen.renderer, screen.ctx, definition, frame());
  await ready(scene, 'obsidian');
  assert.equal(scene.draw(screen.renderer, screen.ctx, definition, frame()), true);
  scene.dispose(); scene.dispose();
  assert.equal(scene.status('obsidian'), 'failed');
  assert.equal(scene.draw(screen.renderer, screen.ctx, definition, frame()), false);
});
