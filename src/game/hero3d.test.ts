// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OATHBOUND_HEROES } from './oathboundHeroes';
import { createHero3D, getHeroPose, loadHeroBackend, HERO_CLIP_SECONDS, type HeroRenderBackend } from './hero3d';
import { createSpriteActor } from './spriteBattleRenderer';
import { getCombatTimeline } from './skillTimelines';
import type { BattleUnitRuntime } from './types';
import * as THREE from 'three';
import type { SpriteEffect } from './spriteBattleEffects';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getHeroModel } from './heroModels';
import { arenaLighting, arenaWeather, ARENA_DEFINITIONS } from './arena3d';
import type { ArenaFrame } from './arenaScene3d';

const unit = (patch: Partial<BattleUnitRuntime> = {}) => ({
  instanceId: 'ally-rowan', heroId: 'rowan', isAlive: true, hp: 100,
  facing: 1, lastActionType: 'idle', statusEffects: [], ...patch,
} as BattleUnitRuntime);
const actor = () => createSpriteActor(unit());
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const drawContext = {} as CanvasRenderingContext2D;

test('all 22 identities resolve distinct GLBs by canonical hero ID, including awakened variants', async () => {
  const models = await import('./heroModels').catch(() => undefined);
  assert.ok(models?.getHeroModel, 'missing generic Oathbound model registry');
  const overrides: Record<string, string> = { lancer: 'estrilda', warden: 'lucius', ranger: 'raine', mage: 'belinda', healer: 'fawkes' };
  const urls = OATHBOUND_HEROES.map(hero => {
    const model = models.getHeroModel(hero.heroId);
    assert.equal(model?.url, `/assets/models/${overrides[hero.sourceId] || hero.sourceId}.glb`);
    assert.equal(model?.heroId, hero.heroId);
    return model!.url;
  });
  assert.equal(urls.length, 22);
  assert.equal(new Set(urls).size, 22);
  assert.equal(models.getHeroModel('unrelated'), undefined);
  assert.equal(models.getHeroModel('lucius'), undefined);
});

test('non-timeline actor actions use normalized ages and expired actions return to movement', () => {
  const u = unit();
  for (const [kind, clip] of [['basic', 'basic'], ['skill', 'active'], ['ultimate', 'ultimate']] as const) {
    const a = { ...actor(), actionKind: kind, actionDuration: 4, age: 1, actionRemaining: 3 };
    assert.deepEqual(getHeroPose(u, a, 9999, false), { clip, seconds: HERO_CLIP_SECONDS[clip] / 4 });
    assert.deepEqual(getHeroPose(u, a, 9999, true), { clip, seconds: HERO_CLIP_SECONDS[clip] / 4 },
      'reduced motion must not desynchronize action progress');
    assert.equal(getHeroPose({ ...u, lastActionType: 'move' }, { ...a, actionRemaining: 0 }, 0, false).clip, 'run');
  }
});

test('timeline casts preserve exact contact clocks, control freeze and stale-cast cancellation', () => {
  const timeline = getCombatTimeline('belinda', 'ultimate')!;
  const u = unit({ heroId: 'belinda', currentCast: { castId: 1, skillId: 'ult', skillSlot: 'ultimate',
    startedAtMs: 1000, timeline, targetIds: ['enemy'] } });
  const a = { ...actor(), actionKind: 'ultimate' as const, age: .5, actionDuration: 1.65, actionRemaining: 1, timeline };
  for (const hit of timeline.hits) {
    assert.deepEqual(getHeroPose(u, a, 1000 + hit.atMs, false), { clip: 'ultimate', seconds: hit.atMs / 1000 });
  }
  const pose = getHeroPose(u, a, 1650, false);
  assert.deepEqual(getHeroPose(u, a, 1650, false), pose, 'pause uses identical input');
  assert.equal(getHeroPose(u, a, 1850, false).seconds, .85, 'x2 advances the supplied clock only');
  assert.deepEqual(getHeroPose({ ...u, statusEffects: [{ type: 'stun', remainingMs: 100 } as never] }, a, 1850, false, pose), pose);
  assert.equal(getHeroPose({ ...u, currentCast: undefined }, a, 1850, false, pose).clip, 'idle');
  assert.deepEqual(getHeroPose({ ...u, hp: 0 }, { ...a, clip: 'death', age: .4 }, 1850, false, pose), { clip: 'death', seconds: .4 });
});

test('generic wrapper never loads unrelated heroes, survives reset and disposes late initialization once', async () => {
  let resolve!: (backend: HeroRenderBackend) => void;
  let loads = 0, disposed = 0;
  const view = createHero3D(() => { loads++; return new Promise(r => { resolve = r; }); });
  assert.equal(view.draw(drawContext, unit({ heroId: 'unrelated' }), actor(), 0, false, 0, 0, 1), false);
  assert.equal(loads, 0);
  view.draw(drawContext, unit(), actor(), 0, false, 0, 0, 1);
  await Promise.resolve(); view.reset(); view.dispose();
  resolve({ draw: () => true, reset() {}, dispose() { disposed++; } });
  await flush(); view.dispose();
  assert.equal(view.status(), 'disposed'); assert.equal(loads, 1); assert.equal(disposed, 1);
});

function asset() {
  const scene = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'hand.R'; scene.add(bone);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 1, 0, 0], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture });
  const skeleton = new THREE.Skeleton([bone]);
  for (let i = 0; i < 2; i++) { const mesh = new THREE.SkinnedMesh(geometry, material); mesh.bind(skeleton); scene.add(mesh); }
  const animations = Object.entries(HERO_CLIP_SECONDS).map(([name, duration]) =>
    new THREE.AnimationClip(name, duration, [new THREE.NumberKeyframeTrack('hand.R.position[x]', [0, duration], [0, duration])]));
  const disposals = { geometry: 0, material: 0, texture: 0, skeleton: 0 };
  geometry.addEventListener('dispose', () => disposals.geometry++);
  material.addEventListener('dispose', () => disposals.material++);
  texture.addEventListener('dispose', () => disposals.texture++);
  const original = skeleton.dispose.bind(skeleton);
  skeleton.dispose = () => { disposals.skeleton++; original(); };
  return { scene, animations, disposals, geometry, material, skeleton };
}

function surface() {
  const roots: THREE.Object3D[] = [], scales: number[] = [], sizes: number[][] = [];
  /** Màu đèn nhân vật theo thứ tự scene: hemisphere, key, rim. */
  const lights: Array<Array<{ colour: string; ground: string; intensity: number }>> = [];
  let renders = 0, disposals = 0, losses = 0, lost = false;
  const renderer = {
    domElement: {}, setSize: (w: number, h: number) => sizes.push([w, h]), setPixelRatio() {}, setClearColor() {},
    getContext: () => ({ isContextLost: () => lost }),
    render(scene: THREE.Scene, camera: THREE.Camera) {
      renders++; scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      const found = scene.children.filter(child => child instanceof THREE.HemisphereLight
        || child instanceof THREE.DirectionalLight) as Array<THREE.HemisphereLight | THREE.DirectionalLight>;
      if (found.length) {
        lights.push(found.map(light => ({ colour: light.color.getHexString(),
          ground: light instanceof THREE.HemisphereLight ? light.groundColor.getHexString() : '',
          intensity: light.intensity })));
      }
      const visible = scene.children.filter(child => child.visible && child instanceof THREE.Group);
      if (visible.length) { assert.equal(visible.length, 1); roots.push(visible[0]); }
    },
    dispose() { disposals++; }, forceContextLoss() { losses++; },
  } as unknown as THREE.WebGLRenderer;
  const ctx = { save() {}, restore() {}, translate() {}, scale(x: number) { scales.push(x); }, drawImage() {} } as unknown as CanvasRenderingContext2D;
  return { renderer, ctx, roots, scales, sizes, lights,
    stats: () => ({ renders, disposals, losses }), lose: () => { lost = true; } };
}

test('actual backend serializes lazy requests, isolates a missing GLB and gates Belinda spells', async () => {
  const screen = surface();
  const requests: { url: string; resolve: (value: ReturnType<typeof asset>) => void; reject: (error: Error) => void }[] = [];
  const backend = await loadHeroBackend({ renderer: screen.renderer,
    loadModel: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })) });
  const draw = (heroId: string) => backend.draw(screen.ctx, unit({ heroId, instanceId: heroId }), actor(), 0, false, 100, 200, 1);
  assert.equal(requests.length, 0);
  assert.equal(draw('rowan'), false); assert.equal(draw('cecilia'), false); assert.equal(draw('belinda'), false);
  assert.equal(requests.length, 1); assert.match(requests[0].url, /rowan\.glb$/);
  requests[0].reject(new Error('404')); await flush();
  assert.equal(backend.modelStatus!('rowan'), 'failed'); assert.equal(requests.length, 2);
  const cecilia = asset(); requests[1].resolve(cecilia); await flush();
  assert.equal(requests.length, 3); assert.equal(draw('cecilia'), true);
  for (let i = 0; i < 10; i++) assert.equal(draw('rowan'), false);
  assert.equal(requests.length, 3, 'failed asset is not retried per frame');
  const frame = { width: 480, height: 680, low: false, reducedMotion: false };
  const effect = { id: 1, sourceHeroId: 'belinda', skillSlot: 'basic', kind: 'impact',
    age: 0, duration: .4, source: { x: 200, y: 200 }, target: { x: 500, y: 200 } } as SpriteEffect;
  assert.equal(backend.drawSpells!(screen.ctx, [effect], 'front', frame).size, 0);
  const belinda = asset(); requests[2].resolve(belinda); await flush();
  assert.deepEqual([...backend.drawSpells!(screen.ctx, [effect, { ...effect, id: 2, sourceHeroId: 'rowan' }], 'front', frame)], [1]);
  assert.deepEqual(screen.sizes, [[384, 448]], 'body/spell passes reuse the fixed single buffer');
  backend.reset(); assert.equal(backend.modelStatus!('cecilia'), 'idle');
  assert.equal(backend.modelStatus!('rowan'), 'failed', 'reset does not re-request missing assets');
  assert.deepEqual(cecilia.disposals, { geometry: 1, material: 1, texture: 1, skeleton: 1 });
  assert.equal(backend.drawSpells!(screen.ctx, [effect], 'front', frame).size, 0);
  backend.dispose(); backend.dispose();
  assert.deepEqual(belinda.disposals, { geometry: 1, material: 1, texture: 1, skeleton: 1 });
  assert.equal(screen.stats().disposals, 1); assert.equal(screen.stats().losses, 1);
});

test('actual mixers keep repeated identity skeletons independent and sample complete/restarted actions', async () => {
  const screen = surface(), model = asset();
  const backend = await loadHeroBackend({ renderer: screen.renderer, loadModel: async () => model });
  const first = unit(), second = unit({ instanceId: 'enemy-rowan', facing: -1 });
  const a = { ...actor(), actionKind: 'skill' as const, actionRemaining: 1, actionDuration: 2, age: .5 };
  backend.draw(screen.ctx, first, a, 0, false, 100, 200, 1); await flush();
  assert.equal(backend.draw(screen.ctx, first, a, 0, false, 100, 200, 1), true);
  const root1 = screen.roots.at(-1)!;
  backend.draw(screen.ctx, second, { ...a, age: 1.5 }, 0, false, 300, 200, 1);
  const root2 = screen.roots.at(-1)!;
  assert.notEqual(root1, root2);
  assert.ok(Math.abs(root1.getObjectByName('hand.R')!.position.x - 1.15 / 4) < 1e-6);
  assert.ok(Math.abs(root2.getObjectByName('hand.R')!.position.x - 1.15 * .75) < 1e-6);
  assert.deepEqual(screen.scales, [1, -1]);
  const skeletons = new Set<THREE.Skeleton>();
  for (const root of [root1, root2]) root.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) { skeletons.add(object.skeleton); assert.equal(object.geometry, model.geometry); }
  });
  assert.ok(skeletons.size >= 2); assert.ok(!skeletons.has(model.skeleton));
  const disposeCounts = new Map<THREE.Skeleton, number>();
  skeletons.forEach(skeleton => { const dispose = skeleton.dispose.bind(skeleton); skeleton.dispose = () => {
    disposeCounts.set(skeleton, (disposeCounts.get(skeleton) || 0) + 1); dispose();
  }; });
  backend.draw(screen.ctx, first, { ...a, age: 2 }, 0, false, 100, 200, 1);
  backend.draw(screen.ctx, first, { ...a, age: .5 }, 0, false, 100, 200, 1);
  assert.ok(Math.abs(root1.getObjectByName('hand.R')!.position.x - 1.15 / 4) < 1e-6, 'completed clip restarts from absolute age');
  backend.reset(); backend.dispose();
  assert.ok([...disposeCounts.values()].every(count => count === 1));
  assert.equal(disposeCounts.size, skeletons.size);
  assert.deepEqual(model.disposals, { geometry: 1, material: 1, texture: 1, skeleton: 1 });
});

test('the shared 3D buffer follows the canvas resolution and keeps the 384:448 crop', async () => {
  const screen = surface();
  const backend = await loadHeroBackend({ renderer: screen.renderer, loadModel: async () => asset() });
  assert.deepEqual(screen.sizes.at(-1), [384, 448], 'the authored default buffer');
  backend.resize!(480, 680, 2);
  assert.deepEqual(screen.sizes.at(-1), [960, 1120], 'buffer follows CSS size x DPR');
  const allocations = screen.sizes.length;
  backend.resize!(480, 680, 2);
  assert.equal(screen.sizes.length, allocations, 'the same size must not reallocate the buffer');
  backend.resize!(5000, 5000, 2);
  const capped = screen.sizes.at(-1)!;
  assert.equal(capped[0], 1024, 'the buffer is capped so weak GPUs keep their memory');
  assert.ok(Math.abs(capped[1] / capped[0] - 448 / 384) < 1e-3, 'the body crop aspect must not change');
  backend.resize!(200, 200, 1);
  assert.deepEqual(screen.sizes.at(-1), [384, 448], 'tiny canvases fall back to the authored minimum');
  backend.dispose();
});

test('a loaded body fades in over its sprite instead of swapping instantly', async () => {
  const screen = surface();
  const backend = await loadHeroBackend({ renderer: screen.renderer, loadModel: async () => asset() });
  const u = unit();
  assert.equal(backend.bodyReveal!(u.instanceId), 0, 'no body before the first 3D frame');
  backend.draw(screen.ctx, u, actor(), 0, false, 0, 0, 1); await flush();
  backend.draw(screen.ctx, u, actor(), 0, false, 0, 0, 1);
  assert.equal(backend.bodyReveal!(u.instanceId), 0, 'the first model frame starts fully transparent');
  backend.draw(screen.ctx, u, actor(), 130, false, 0, 0, 1);
  const half = backend.bodyReveal!(u.instanceId);
  assert.ok(half > .3 && half < .7, `halfway through the fade the body is half visible (${half})`);
  backend.draw(screen.ctx, u, actor(), 400, false, 0, 0, 1);
  assert.equal(backend.bodyReveal!(u.instanceId), 1, 'the body is solid after 260 ms');
  backend.draw(screen.ctx, u, actor(), 900, false, 0, 0, 1);
  assert.equal(backend.bodyReveal!(u.instanceId), 1, 'and stays solid for the rest of the battle');
  backend.reset();
  assert.equal(backend.bodyReveal!(u.instanceId), 0, 'reset drops the body with its reveal');
  backend.dispose();
});

test('a canvas size reported before the backend exists is applied once it loads', async () => {
  let resolve!: (backend: HeroRenderBackend) => void;
  const sizes: number[][] = [];
  const view = createHero3D(() => new Promise(r => { resolve = r; }));
  view.resize(480, 680, 2);
  view.draw(drawContext, unit(), actor(), 0, false, 0, 0, 1);
  await Promise.resolve();
  resolve({ draw: () => true, reset() {}, dispose() {},
    resize: (width, height, ratio) => sizes.push([width, height, ratio]) });
  await flush();
  assert.deepEqual(sizes, [[480, 680, 2]], 'the pending canvas size must reach the backend');
  view.dispose();
});

test('the arena theme recolours the hero lights before its asset finishes loading', async () => {
  const screen = surface();
  const backend = await loadHeroBackend({ renderer: screen.renderer,
    loadModel: async () => asset(), loadArena: () => new Promise(() => {}) });
  const storm = ARENA_DEFINITIONS.find(entry => entry.id === 'storm')!;
  const temple = ARENA_DEFINITIONS.find(entry => entry.id === 'temple')!;
  const frame = { width: 480, height: 680, centerX: 240, centerY: 388,
    radiusX: 317, radiusY: 211, reducedMotion: false, wallClock: 0 };
  backend.draw(screen.ctx, unit(), actor(), 0, false, 0, 0, 1); await flush();
  const before = screen.lights.at(-1)!;
  backend.drawArena!(screen.ctx, storm, frame);
  backend.draw(screen.ctx, unit(), actor(), 0, false, 0, 0, 1);
  const stormy = screen.lights.at(-1)!;
  backend.drawArena!(screen.ctx, temple, frame);
  backend.draw(screen.ctx, unit(), actor(), 0, false, 0, 0, 1);
  const warm = screen.lights.at(-1)!;
  const stormLighting = arenaLighting('storm'), templeLighting = arenaLighting('temple');
  assert.equal(stormy[0].colour, stormLighting.sky.toString(16).padStart(6, '0'));
  assert.equal(stormy[0].ground, stormLighting.ground.toString(16).padStart(6, '0'));
  assert.equal(stormy[1].colour, stormLighting.key.toString(16).padStart(6, '0'));
  assert.equal(stormy[2].colour, stormLighting.rim.toString(16).padStart(6, '0'));
  assert.notEqual(warm[1].colour, stormy[1].colour, 'changing arena must change the hero key light');
  assert.equal(warm[1].colour, templeLighting.key.toString(16).padStart(6, '0'));
  assert.notDeepEqual(before, stormy);
  backend.dispose();
});

test('hero bodies catch the arena pulse flare, then settle back to the palette rig', async () => {
  const screen = surface();
  const realTemple = async () => {
    const bytes = readFileSync(new URL('../../public/assets/arenas/temple.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    return { scene: gltf.scene, animations: gltf.animations };
  };
  const backend = await loadHeroBackend({ renderer: screen.renderer,
    loadModel: async () => asset(), loadArena: realTemple });
  const temple = ARENA_DEFINITIONS.find(entry => entry.id === 'temple')!;
  const frame = (patch: Partial<ArenaFrame> = {}): ArenaFrame => ({ width: 480, height: 680,
    centerX: 240, centerY: 388, radiusX: 317, radiusY: 211, reducedMotion: false, wallClock: 0, ...patch });
  // Lần vẽ đầu chỉ đăng ký model; lần sau mới thật sự render scene thân nhân vật.
  const drawHero = async () => {
    backend.draw(screen.ctx, unit(), actor(), 0, false, 0, 0, 1); await flush();
    backend.draw(screen.ctx, unit(), actor(), 0, false, 0, 0, 1); await flush();
  };
  try {
    assert.equal(backend.drawArena!(screen.ctx, temple, frame()), false, 'loading arena must not flash anything');
    for (let attempt = 0; attempt < 300 && backend.arenaStatus!('temple') === 'loading'; attempt++) {
      await new Promise<void>(resolve => setTimeout(resolve, 5));
    }
    assert.equal(backend.arenaStatus!('temple'), 'ready');
    assert.equal(backend.drawArena!(screen.ctx, temple, frame()), true);
    assert.equal(backend.arenaWeatherCount!(), arenaWeather('temple').count,
      'the weather field is reported once the stage draws');
    await drawHero();
    const idle = screen.lights.at(-1)!;
    // Thứ tự scene: hemisphere, key, rim.
    assert.equal(idle[0].intensity, 2.5);
    assert.equal(idle[1].intensity, 3.5);
    assert.equal(idle[2].intensity, 2);
    assert.equal(idle[1].colour, arenaLighting('temple').key.toString(16).padStart(6, '0'));

    // Tuyệt kỹ đang chạy: thân nhân vật bừng lên và ngả màu chiêu.
    assert.equal(backend.drawArena!(screen.ctx, temple, frame({ pulseAge: .12, pulseTint: 0xff3322 })), true);
    await drawHero();
    const lit = screen.lights.at(-1)!;
    assert.ok(lit[1].intensity > idle[1].intensity + 1, `hero key light must flare (${lit[1].intensity})`);
    assert.ok(lit[2].intensity > idle[2].intensity, 'hero rim light follows the same pulse');
    assert.notEqual(lit[1].colour, idle[1].colour, 'the flare carries the caster colour');

    // Hết clip: rig trở lại đúng như trước khi tung.
    assert.equal(backend.drawArena!(screen.ctx, temple, frame({ wallClock: 2.6 })), true);
    await drawHero();
    const settled = screen.lights.at(-1)!;
    assert.deepEqual(settled, idle, 'hero lighting returns to the arena palette after the pulse');

    // Reduced motion: không flash dù có pulseAge.
    assert.equal(backend.drawArena!(screen.ctx, temple,
      frame({ pulseAge: .12, pulseTint: 0xff3322, reducedMotion: true })), true);
    await drawHero();
    assert.deepEqual(screen.lights.at(-1), idle, 'reduced motion never flares the heroes');

    // Reset giữa lúc flash không được để đèn sáng dính sang trận sau.
    backend.drawArena!(screen.ctx, temple, frame({ pulseAge: .12, pulseTint: 0xff3322 }));
    backend.reset();
    assert.equal(backend.drawArena!(screen.ctx, temple, frame()), false, 'reset drops the arena cache');
    for (let attempt = 0; attempt < 300 && backend.arenaStatus!('temple') === 'loading'; attempt++) {
      await new Promise<void>(resolve => setTimeout(resolve, 5));
    }
    assert.equal(backend.drawArena!(screen.ctx, temple, frame()), true);
    await drawHero();
    assert.deepEqual(screen.lights.at(-1), idle, 'reset clears the flare');
  } finally { backend.dispose(); }
});

test('reset and unmount discard late models, cancel queued requests and never leak loaded resources', async () => {
  const screen = surface();
  const resolvers: ((model: ReturnType<typeof asset>) => void)[] = [];
  const backend = await loadHeroBackend({ renderer: screen.renderer, loadModel: () => new Promise(resolve => resolvers.push(resolve)) });
  backend.draw(screen.ctx, unit(), actor(), 0, false, 0, 0, 1);
  backend.draw(screen.ctx, unit({ heroId: 'cecilia' }), actor(), 0, false, 0, 0, 1);
  backend.reset();
  const late = asset(); resolvers[0](late); await flush();
  assert.deepEqual(late.disposals, { geometry: 1, material: 1, texture: 1, skeleton: 1 });
  assert.equal(resolvers.length, 1, 'queued old-battle models are cancelled');
  assert.equal(backend.modelStatus!('rowan'), 'idle');
  backend.draw(screen.ctx, unit({ heroId: 'cecilia' }), actor(), 0, false, 0, 0, 1);
  backend.dispose(); const unmounted = asset(); resolvers[1](unmounted); await flush();
  assert.deepEqual(unmounted.disposals, { geometry: 1, material: 1, texture: 1, skeleton: 1 });
  assert.equal(screen.stats().disposals, 1);
});

test('active canvas uses generic model diagnostics and retains filtered Belinda observation', () => {
  const canvas = readFileSync(new URL('../components/SpriteBattleCanvas.tsx', import.meta.url), 'utf8');
  assert.match(canvas, /const heroes3d = createHero3D\(\)/);
  assert.match(canvas, /canvas\.dataset\.heroes3d/);
  assert.match(canvas, /models: Object\.fromEntries\(heroes3d\.modelStatuses/);
  assert.match(canvas, /drawn: drawn3D\.filter\(id => belindaIds\.has\(id\)\)/);
  assert.match(canvas, /heroes3d\.bodyReveal\(unit\.instanceId\)/,
    'the canvas must fade the sprite under a freshly loaded 3D body');
  assert.doesNotMatch(canvas, /createBelinda3D\(/);
});

test('all real GLBs sample through the live backend with projected skinned bounds inside the crop', async t => {
  const screen = surface();
  const clipped: string[] = [];
  let label = '', samples = 0;
  screen.renderer.render = (scene, camera) => {
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    for (const root of scene.children.filter(child => child.visible)) root.traverse(object => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      object.skeleton.update();
      const position = object.geometry.getAttribute('position');
      const vertex = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        object.getVertexPosition(i, vertex).applyMatrix4(object.matrixWorld).project(camera);
        if (!Number.isFinite(vertex.x + vertex.y) || Math.abs(vertex.x) > 1.001 || Math.abs(vertex.y) > 1.001) {
          clipped.push(`${label}: ${vertex.x.toFixed(3)},${vertex.y.toFixed(3)}`); break;
        }
      }
    });
    samples++;
  };
  const backend = await loadHeroBackend({ renderer: screen.renderer, loadModel: async url => {
    const bytes = readFileSync(new URL(`../../public${url}`, import.meta.url));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  } });
  try {
    for (const hero of OATHBOUND_HEROES) {
      const u = unit({ heroId: hero.heroId, instanceId: hero.heroId });
      backend.draw(screen.ctx, u, actor(), 0, false, 0, 0, 1); await flush();
      assert.equal(backend.modelStatus!(hero.heroId), 'ready', getHeroModel(hero.heroId)!.url);
      for (const [clip, duration] of Object.entries(HERO_CLIP_SECONDS)) {
        for (let step = 0; step <= 12; step++) {
          const fraction = step / 12;
          const age = duration * fraction;
          const a = { ...actor(), age, clip, actionDuration: duration, actionRemaining: 1,
            actionKind: (clip === 'active' ? 'skill' : clip === 'basic' || clip === 'ultimate' || clip === 'hit' ? clip : '') as ReturnType<typeof actor>['actionKind'] };
          const timeline = ['basic', 'active', 'ultimate'].includes(clip) ? getCombatTimeline(hero.heroId, clip as 'basic') : undefined;
          const currentCast = timeline ? { castId: 1, skillId: clip, skillSlot: clip as 'basic', startedAtMs: 0, timeline, targetIds: [] } : undefined;
          label = `${hero.sourceId}/${clip}/${fraction}`;
          assert.equal(backend.draw(screen.ctx, { ...u, isAlive: clip !== 'death', hp: clip === 'death' ? 0 : 100,
            lastActionType: clip === 'run' ? 'move' : 'idle', currentCast }, a, age * 1000, false, 0, 0, 1), true);
        }
      }
      backend.reset();
    }
    assert.equal(samples, OATHBOUND_HEROES.length * Object.keys(HERO_CLIP_SECONDS).length * 13);
    assert.deepEqual(clipped, [], 'live camera clips authored vertices');
    t.diagnostic(`${OATHBOUND_HEROES.length} real models, ${samples} projected poses, ${clipped.length} clipped primitives`);
  } finally { backend.dispose(); }
});
