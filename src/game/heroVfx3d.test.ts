// PROTOTYPE - NOT FOR PRODUCTION
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHeroVfxScene, type LoadedVfx } from './heroVfx3d';
import { createSpriteEffect } from './spriteBattleEffects';
import { getCombatTimeline } from './skillTimelines';
import type { BattleUnitRuntime, CombatEvent } from './types';
import type { SpriteEffect } from './spriteBattleEffects';
import { VFX_CLIP_SECONDS } from './heroVfx';
import { HERO_VFX_DEFINITIONS, getHeroVfx } from './heroVfx';
import { OATHBOUND_HEROES } from './oathboundHeroes';

const source = { instanceId: 'mage', heroId: 'belinda', team: 'ally', x: 250, y: 230 } as BattleUnitRuntime;
const target = { instanceId: 'locked', heroId: 'lucius', team: 'enemy', x: 650, y: 260 } as BattleUnitRuntime;
const event = (slot: 'basic' | 'active' | 'ultimate') => ({
  id: 1, timestampMs: 1000, sourceId: source.instanceId, targetId: target.instanceId,
  type: slot === 'basic' ? 'basic_attack' : slot === 'active' ? 'active_skill' : 'ultimate_cast',
  skillSlot: slot, castId: 7, timeline: getCombatTimeline('belinda', slot),
} as CombatEvent);
const cast = (slot: 'basic' | 'active' | 'ultimate', age = 0, id = 1) =>
  ({ ...createSpriteEffect(event(slot), source, target)!, id, age });
const frame = { width: 480, height: 680, reducedMotion: false, low: false };
/** Records are keyed by source id; Belinda's authored file is `belinda.glb`. */
const BOOT = 'mage';
/** A roster hero with no committed effect, chosen at runtime so later heroes cannot break this. */
const disabledHero = OATHBOUND_HEROES.find(hero => !getHeroVfx(hero.heroId));
const settle = async (scene: { status(id: string): string }, id = BOOT) => {
  for (let attempt = 0; attempt < 200 && scene.status(id) === 'loading'; attempt++) {
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  assert.equal(scene.status(id), 'ready');
};

const realAsset = async (): Promise<LoadedVfx> => {
  const bytes = readFileSync(new URL('../../public/assets/vfx/belinda.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return { scene: gltf.scene, animations: gltf.animations };
};
const surface = () => {
  const stats = { renders: 0, draws: 0, lost: false };
  const ops: Array<{ composite: string; filter: string; alpha: number }> = [];
  const captures: Array<{ meshes: THREE.Mesh[]; matrices: number[][] }> = [];
  const renderer = {
    domElement: {},
    getContext: () => ({ isContextLost: () => stats.lost }),
    render: (scene: THREE.Scene) => {
      stats.renders++;
      scene.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      scene.traverseVisible(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
      captures.push({ meshes, matrices: meshes.map(mesh => mesh.matrixWorld.toArray()) });
    },
  } as unknown as THREE.WebGLRenderer;
  const stack: Array<{ composite: string; filter: string; alpha: number }> = [];
  const ctx = {
    globalCompositeOperation: 'source-over', filter: 'none', globalAlpha: 1,
    save() {
      const self = ctx as unknown as { globalCompositeOperation: string; filter: string; globalAlpha: number };
      stack.push({ composite: self.globalCompositeOperation, filter: self.filter, alpha: self.globalAlpha });
    },
    restore() {
      const previous = stack.pop();
      if (!previous) return;
      const self = ctx as unknown as { globalCompositeOperation: string; filter: string; globalAlpha: number };
      self.globalCompositeOperation = previous.composite; self.filter = previous.filter; self.globalAlpha = previous.alpha;
    },
    drawImage: () => {
      stats.draws++;
      ops.push({
        composite: (ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation,
        filter: (ctx as unknown as { filter: string }).filter,
        alpha: (ctx as unknown as { globalAlpha: number }).globalAlpha,
      });
    },
  } as unknown as CanvasRenderingContext2D;
  return { renderer, ctx, stats, captures, ops };
};

test('Raine gunfire mirrors toward the enemy without mirroring ground rings', async () => {
  const screen = surface();
  const scene = createHeroVfxScene(THREE, { loadModel: async () => {
    const bytes = readFileSync(new URL('../../public/assets/vfx/raine.glb', import.meta.url));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  } });
  const effect = { ...cast('active', .4), sourceHeroId: 'raine' };
  scene.draw(screen.renderer, screen.ctx, [effect], 'front', frame);
  await settle(scene, 'ranger');
  const rootScale = () => {
    let root: THREE.Object3D = screen.captures.at(-1)!.meshes[0];
    while (root.parent && !(root.parent instanceof THREE.Scene)) root = root.parent;
    return root.scale.x;
  };
  scene.draw(screen.renderer, screen.ctx, [effect], 'front', frame);
  const right = rootScale();
  const reversed = { ...effect, source: effect.target, target: effect.source };
  scene.draw(screen.renderer, screen.ctx, [reversed], 'front', frame);
  assert.equal(rootScale(), -right, 'enemy shots must mirror their authored local X direction');
  scene.draw(screen.renderer, screen.ctx, [reversed], 'ground', frame);
  assert.equal(rootScale(), right, 'floor geometry retains its orientation');
  scene.dispose();
});

test('spell light layers blend additively and keep their authored hue', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  scene.draw(screen.renderer, screen.ctx, [cast('ultimate', .5)], 'front', frame);
  await settle(scene);
  scene.draw(screen.renderer, screen.ctx, [cast('ultimate', .5)], 'front', frame);
  const named = new Map<string, THREE.Material>();
  for (const mesh of screen.captures.at(-1)!.meshes) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      named.set(material.name, material);
    }
  }
  for (const name of ['vfx_core', 'vfx_glow', 'vfx_alt', 'vfx_halo']) {
    const material = named.get(name);
    assert.ok(material, `${name} must survive the clone`);
    assert.equal(material!.blending, THREE.AdditiveBlending, `${name} must add light, not paint over the scene`);
    assert.equal(material!.depthWrite, false, `${name} cannot occlude the fighters`);
    const color = (material as THREE.MeshBasicMaterial).color;
    assert.ok(color.r + color.g + color.b > .05, `${name} must keep the colour authored in Blender`);
  }
  assert.notEqual(named.get('vfx_core')!.blending, THREE.NormalBlending, 'flat alpha kills the glow read');
  scene.dispose();
});

test('a crowded additive layer reaches the screen dimmer than a lone cast', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const peak = () => {
    let best = 0;
    for (const mesh of screen.captures.at(-1)!.meshes) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        best = Math.max(best, material.opacity);
      }
    }
    return best;
  };
  scene.draw(screen.renderer, screen.ctx, [cast('ultimate', .6, 1)], 'front', frame);
  await settle(scene);
  scene.draw(screen.renderer, screen.ctx, [cast('ultimate', .6, 1)], 'front', frame);
  const alone = peak();
  const crowd = [2, 3, 4, 5, 6, 7].map(id => cast('ultimate', .6, id));
  scene.draw(screen.renderer, screen.ctx, crowd, 'front', frame);
  const stacked = peak();
  assert.ok(alone > 0);
  assert.ok(stacked < alone * .6, `six additive ultimates must dim (${stacked} vs ${alone})`);
  assert.ok(stacked > 0, 'a dimmed layer still renders');
  scene.dispose();
});

test('front casts get one additive blur halo and the canvas state is restored', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const effect = cast('active', .5);
  screen.ctx.globalAlpha = .42;
  screen.ctx.filter = 'contrast(1.2)';
  scene.draw(screen.renderer, screen.ctx, [effect], 'front', frame);
  await settle(scene);
  screen.ops.length = 0;
  scene.draw(screen.renderer, screen.ctx, [effect], 'front', frame);
  assert.equal(screen.ops.length, 2, 'a cast composites itself plus one halo');
  assert.equal(screen.ops[0].composite, 'source-over');
  assert.equal(screen.ops[1].composite, 'lighter', 'the halo must add light');
  assert.match(screen.ops[1].filter, /blur\(/, 'the halo must be soft, not a second hard copy');
  assert.ok(screen.ops[1].alpha > 0 && screen.ops[1].alpha < .5, 'the halo must stay subordinate');
  assert.equal(screen.ctx.globalAlpha, .42, 'caller alpha survives the pass');
  assert.equal(screen.ctx.filter, 'contrast(1.2)', 'caller filter survives the pass');
  assert.equal(screen.ctx.globalCompositeOperation, 'source-over');
  screen.ops.length = 0;
  scene.draw(screen.renderer, screen.ctx, [effect], 'ground', frame);
  assert.equal(screen.ops.length, 1, 'ground rings do not bloom into the fighters');
  scene.dispose();
});

test('the LOW preset skips the halo pass to protect weak GPUs', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const effect = cast('active', .5);
  scene.draw(screen.renderer, screen.ctx, [effect], 'front', frame);
  await settle(scene);
  screen.ops.length = 0;
  scene.draw(screen.renderer, screen.ctx, [effect], 'front', { ...frame, low: true });
  assert.equal(screen.ops.length, 1, 'LOW keeps the single shared composite');
  screen.ops.length = 0;
  scene.draw(screen.renderer, screen.ctx, [effect], 'front', { ...frame, reducedMotion: true });
  assert.equal(screen.ops.length, 1, 'reduced motion keeps the frame cheap and steady');
  scene.dispose();
});

test('projectile remains at contact instead of snapping back during recovery', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  scene.draw(screen.renderer, screen.ctx, [cast('active', .599)], 'front', frame);
  await settle(scene);
  const positions: THREE.Vector3[] = [];
  for (const age of [.599, .6, .7]) {
    scene.draw(screen.renderer, screen.ctx, [cast('active', age)], 'front', frame);
    let root: THREE.Object3D = screen.captures.at(-1)!.meshes[0];
    while (root.parent && !(root.parent instanceof THREE.Scene)) root = root.parent;
    positions.push(root.position.clone());
  }
  assert.ok(positions[0].distanceTo(positions[1]) < 2, 'contact must not teleport to caster');
  assert.ok(positions[1].distanceTo(positions[2]) < .001, 'recovery stays at recipient');
  scene.dispose();
});

test('the committed Blender effect is only handled after it really loads', async () => {
  const { renderer, ctx, stats } = surface();
  const scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const effect = cast('active', .2);
  assert.equal(scene.status(BOOT), 'idle');
  assert.equal(scene.draw(renderer, ctx, [effect], 'front', frame).size, 0, 'a loading asset never claims the effect');
  await settle(scene);
  assert.deepEqual([...scene.draw(renderer, ctx, [effect], 'front', frame)], [effect.id]);
  assert.equal(stats.draws, 2, 'one shared composite plus its halo, never one draw per effect');
  scene.dispose();
});

test('a full layer batch costs a single render, and ground plus front share the same instance', async () => {
  const { renderer, ctx, stats } = surface();
  const scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const first = cast('basic', .1, 1), second = cast('ultimate', .3, 2);
  scene.draw(renderer, ctx, [first], 'front', frame); await settle(scene);
  const handled = scene.draw(renderer, ctx, [first, second], 'front', frame);
  assert.deepEqual([...handled].sort(), [1, 2]);
  assert.equal(stats.renders, 1, 'a loading asset renders nothing; the batch costs one render');
  const ground = scene.draw(renderer, ctx, [first, second], 'ground', frame);
  assert.deepEqual([...ground].sort(), [1, 2], 'ground rings reuse the pooled instance');
  scene.dispose();
});

test('heroes without a Blender effect, settled ages and unrelated effects stay out', async () => {
  const { renderer, ctx } = surface();
  const scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const ready = cast('active', .2); scene.draw(renderer, ctx, [ready], 'front', frame);
  await settle(scene);
  const foreign = { ...cast('active', .2, 3), sourceHeroId: disabledHero?.heroId ?? 'not-a-hero' };
  const settled = cast('active', VFX_CLIP_SECONDS.active, 4);
  const negative = cast('active', -1, 5);
  assert.equal(scene.draw(renderer, ctx, [foreign, settled, negative], 'front', frame).size, 0);
  if (disabledHero) assert.equal(scene.status(disabledHero.sourceId), 'missing');
  scene.dispose();
});

test('reduced motion and the LOW preset still draw without changing the handled set', async () => {
  const { renderer, ctx } = surface();
  const scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const effect = cast('ultimate', .4);
  scene.draw(renderer, ctx, [effect], 'front', frame); await settle(scene);
  const still = scene.draw(renderer, ctx, [effect], 'front', { ...frame, reducedMotion: true });
  const low = scene.draw(renderer, ctx, [effect], 'front', { ...frame, low: true });
  assert.deepEqual([...still], [effect.id]);
  assert.deepEqual([...low], [effect.id]);
  scene.dispose();
});

test('a lost context keeps the effect unclaimed and reset reloads clean resources', async () => {
  const { renderer, ctx, stats } = surface();
  const scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const effect = cast('active', .2);
  scene.draw(renderer, ctx, [effect], 'front', frame); await settle(scene);
  stats.lost = true;
  assert.throws(() => scene.draw(renderer, ctx, [effect], 'front', frame), /VFX context lost/);
  stats.lost = false;
  scene.reset();
  assert.equal(scene.status(BOOT), 'idle', 'reset frees the previous battle cache');
  scene.draw(renderer, ctx, [effect], 'front', frame); await settle(scene);
  assert.deepEqual([...scene.draw(renderer, ctx, [effect], 'front', frame)], [effect.id]);
  scene.dispose(); scene.dispose();
  assert.equal(scene.status(BOOT), 'failed');
});

test('a broken effect asset degrades to Canvas2D instead of throwing', async () => {
  const { renderer, ctx } = surface();
  const scene = createHeroVfxScene(THREE, { loadModel: async () => { throw new Error('404'); } });
  const effect = cast('active', .2);
  assert.equal(scene.draw(renderer, ctx, [effect], 'front', frame).size, 0);
  for (let attempt = 0; attempt < 200 && scene.status(BOOT) === 'loading'; attempt++) {
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  assert.equal(scene.status(BOOT), 'failed');
  assert.equal(scene.draw(renderer, ctx, [effect], 'front', frame).size, 0);
  scene.dispose();
});

test('LOW basics stay visible and reduced motion freezes authored mesh motion', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  scene.draw(screen.renderer, screen.ctx, [cast('basic', .1)], 'front', frame); await settle(scene);
  scene.draw(screen.renderer, screen.ctx, [cast('basic', .1)], 'front', { ...frame, low: true });
  assert.ok(screen.captures.at(-1)!.meshes.length > 0, 'handled LOW basic must contain visible geometry');
  scene.draw(screen.renderer, screen.ctx, [cast('active', .1, 4)], 'front', { ...frame, reducedMotion: true });
  const first = screen.captures.at(-1)!.matrices;
  scene.draw(screen.renderer, screen.ctx, [cast('active', .2, 4)], 'front', { ...frame, reducedMotion: true });
  assert.deepEqual(screen.captures.at(-1)!.matrices, first, 'reduced mode must freeze baked ring rotations');
  scene.dispose();
});

test('long effect spam has a fixed instance bound and disposes private materials', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  scene.draw(screen.renderer, screen.ctx, [cast('active', .2)], 'front', frame); await settle(scene);
  scene.draw(screen.renderer, screen.ctx, [cast('active', .2)], 'front', frame);
  const materials = new Set(screen.captures.at(-1)!.meshes.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
  let released = 0;
  materials.forEach(material => material.addEventListener('dispose', () => released++));
  for (let id = 2; id < 40; id++) scene.draw(screen.renderer, screen.ctx, [cast('active', .2, id)], 'front', frame);
  assert.ok(scene.diagnostics().instances <= 16, 'pool must not grow with event IDs');
  scene.reset();
  assert.equal(released, materials.size, 'clone materials must be disposed exactly once');
  assert.equal(scene.diagnostics().instances, 0);
  scene.dispose();
});
