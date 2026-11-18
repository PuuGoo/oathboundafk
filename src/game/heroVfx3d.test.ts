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
import { HERO_VFX_DEFINITIONS, getHeroVfx, heroVfxPalette } from './heroVfx';
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
const hit = (age = 0, id = 9) => ({ ...createSpriteEffect(
  { ...event('active'), id, type: 'damage', value: 12 }, source, target)!, id, age });
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

test('a flying projectile drags two fading ghosts, and they vanish when it lands', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const raine = getHeroVfx('raine')!;
  const flight = { ...cast('active', .5), sourceHeroId: 'raine' };
  /** Root của từng bản sao trong khung vừa vẽ, kèm độ mờ lớn nhất. */
  const copies = (): Array<{ root: THREE.Object3D; opacity: number }> => {
    const map = new Map<THREE.Object3D, number>();
    for (const mesh of screen.captures.at(-1)!.meshes) {
      let root: THREE.Object3D = mesh;
      while (root.parent && !(root.parent instanceof THREE.Scene)) root = root.parent;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      map.set(root, Math.max(map.get(root) ?? 0, Math.max(...materials.map(entry => entry.opacity))));
    }
    return [...map].map(([root, opacity]) => ({ root, opacity }));
  };
  scene.draw(screen.renderer, screen.ctx, [flight], 'front', frame);
  await settle(scene, raine.sourceId);
  screen.captures.length = 0;
  scene.draw(screen.renderer, screen.ctx, [flight], 'front', frame);
  const drawn = copies().sort((a, b) => a.root.position.x - b.root.position.x);
  assert.equal(drawn.length, 3, 'one projectile plus two trail ghosts');
  // Nguồn ở x=250, mục tiêu x=650: vệt phải nằm sau viên đạn, xa dần theo thứ tự.
  assert.ok(drawn[0].root.position.x < drawn[1].root.position.x, 'ghosts trail behind the shot');
  assert.ok(drawn[1].root.position.x < drawn[2].root.position.x, 'the second ghost is further back');
  assert.ok(drawn[2].opacity > drawn[1].opacity && drawn[1].opacity > drawn[0].opacity,
    'trail ghosts must fade the further back they sit');
  // Hết bay: vệt không được ở lại một mình.
  const frames = screen.captures.length;
  for (let pass = 0; pass < 4; pass++) scene.draw(screen.renderer, screen.ctx, [], 'front', frame);
  assert.equal(screen.captures.length, frames, 'no ghost is left drawing after the shot lands');
  // Reduced motion: không vệt.
  screen.captures.length = 0;
  scene.draw(screen.renderer, screen.ctx, [flight], 'front', { ...frame, reducedMotion: true });
  assert.equal(copies().length, 1, 'reduced motion keeps the single authored effect');
  // LOW preset: vệt là trang trí, cắt để đỡ hai bản sao mỗi viên đạn.
  screen.captures.length = 0;
  scene.draw(screen.renderer, screen.ctx, [flight], 'front', { ...frame, low: true });
  assert.equal(copies().length, 1, 'the LOW preset drops the decorative trail');
  scene.dispose();
});

test('the floor light under a projectile travels with the spell instead of staying at the caster', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const raine = getHeroVfx('raine')!, belinda = getHeroVfx('belinda')!;
  const rootOf = (): THREE.Object3D => {
    let root: THREE.Object3D = screen.captures.at(-1)!.meshes[0];
    while (root.parent && !(root.parent instanceof THREE.Scene)) root = root.parent;
    return root;
  };
  const groundAt = async (heroId: string, sourceId: string, age: number): Promise<THREE.Vector3> => {
    const effect = { ...cast('active', age), sourceHeroId: heroId };
    scene.draw(screen.renderer, screen.ctx, [effect], 'ground', frame);
    await settle(scene, sourceId);
    screen.captures.length = 0;
    scene.draw(screen.renderer, screen.ctx, [effect], 'ground', frame);
    return rootOf().position.clone();
  };
  // Đạn đang bay: vệt sáng dưới sàn rời chân người niệm và trượt tới mục tiêu.
  const charge = await groundAt('raine', raine.sourceId, .05);
  const recovery = await groundAt('raine', raine.sourceId, .9);
  assert.ok(recovery.x - charge.x > 100, `projectile floor light must travel (${charge.x} -> ${recovery.x})`);
  // Hào quang: cùng một chỗ trên sân, không bay theo ai.
  const auraCharge = await groundAt('belinda', belinda.sourceId, .05);
  const auraRecovery = await groundAt('belinda', belinda.sourceId, .9);
  assert.ok(Math.abs(auraRecovery.x - auraCharge.x) < 5,
    `aura floor light must stay with the caster (${auraCharge.x} -> ${auraRecovery.x})`);
  // Lớp sàn là ánh sáng hắt xuống: mờ hơn lớp trước, và nằm dưới chân (z âm, dẹt theo trục dọc).
  const effect = { ...cast('active', .6), sourceHeroId: 'raine' };
  const peak = (): number => {
    let best = 0;
    rootOf().traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) best = Math.max(best, material.opacity);
    });
    return best;
  };
  screen.captures.length = 0;
  scene.draw(screen.renderer, screen.ctx, [effect], 'ground', frame);
  // Cùng một instance bị đặt lại cho layer khác, nên phải đo ngay trong khung của từng layer.
  const ground = { z: rootOf().position.z, scaleX: rootOf().scale.x, scaleY: rootOf().scale.y, peak: peak() };
  screen.captures.length = 0;
  scene.draw(screen.renderer, screen.ctx, [effect], 'front', frame);
  const front = { z: rootOf().position.z, peak: peak() };
  assert.ok(ground.z < front.z, 'the floor copy sits behind the body layer');
  assert.ok(ground.scaleY < ground.scaleX * .7, 'the floor copy is flattened onto the ground');
  assert.ok(ground.peak < front.peak * .75, 'the floor spill must stay subordinate to the cast');
  scene.dispose();
});

test('an ultimate wears the hero accent colour while a basic cast keeps the authored one', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  /** Màu của các material đang vẽ, tính cả mesh của vệt (không có vệt ở basic). */
  const colours = (): THREE.Color[] => screen.captures.at(-1)!.meshes.map(mesh => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return (materials[0] as THREE.MeshBasicMaterial).color;
  });
  const basic = cast('basic', .2);
  scene.draw(screen.renderer, screen.ctx, [basic], 'front', frame);
  await settle(scene);
  scene.draw(screen.renderer, screen.ctx, [basic], 'front', frame);
  const authored = colours().map(colour => colour.getHex());
  const palette = heroVfxPalette('belinda')!;

  const ultimate = cast('ultimate', .2, 2);
  scene.draw(screen.renderer, screen.ctx, [ultimate], 'front', frame);
  const tinted = colours().map(colour => colour.getHex());
  assert.notDeepEqual(tinted, authored, 'the ultimate must not look identical to a basic cast');
  // Mỗi material của cú tuyệt kỹ phải gần accent hơn (hoặc bằng) chính nó ở đòn thường.
  const target = new THREE.Color(palette.accent);
  let moved = 0;
  tinted.forEach((hex, index) => {
    const before = new THREE.Color(authored[index]);
    const colour = new THREE.Color(hex);
    const toAccent = Math.abs(colour.r - target.r) + Math.abs(colour.g - target.g) + Math.abs(colour.b - target.b);
    const wasAccent = Math.abs(before.r - target.r) + Math.abs(before.g - target.g) + Math.abs(before.b - target.b);
    assert.ok(toAccent <= wasAccent + 1e-6, `material ${index} drifted away from the hero accent`);
    if (toAccent < wasAccent - 1e-6) moved++;
  });
  assert.ok(moved >= 3, `the accent must actually reach the effect (${moved} materials moved)`);
  // Trở lại basic: màu tác giả phải được phục hồi, không dính màu tuyệt kỹ.
  scene.draw(screen.renderer, screen.ctx, [basic], 'front', frame);
  assert.deepEqual(colours().map(colour => colour.getHex()), authored);
  scene.dispose();
});

test('a ground impact keeps dissolving on the floor after its effect ends', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const effect = hit(.2);
  /** Độ mờ lớn nhất trong lớp vừa vẽ; vệt tan phải thấp hơn frame đang chạy. */
  const peakOpacity = (): number => Math.max(...screen.captures.at(-1)!.meshes.map(mesh => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return Math.max(...materials.map(material => material.opacity));
  }));
  scene.draw(screen.renderer, screen.ctx, [effect], 'ground', { ...frame, clock: 0 });
  await settle(scene);
  scene.draw(screen.renderer, screen.ctx, [effect], 'ground', { ...frame, clock: .2 });
  const alive = peakOpacity();
  assert.ok(alive > 0, 'the impact itself is visible');

  // Effect đã hết: vệt vẫn còn trên sàn ở đúng frame cuối.
  const drawsBefore = screen.stats.draws;
  scene.draw(screen.renderer, screen.ctx, [], 'ground', { ...frame, clock: .3 });
  assert.equal(screen.stats.draws - drawsBefore, 1, 'the fading impact still composites one layer');
  assert.ok(Math.abs(peakOpacity() - alive) < 1e-6, 'the tail starts at the opacity the effect ended with');

  // Nửa đường: mờ dần chứ không giữ nguyên.
  scene.draw(screen.renderer, screen.ctx, [], 'ground', { ...frame, clock: .55 });
  const fading = peakOpacity();
  assert.ok(fading > 0 && fading < alive * .8, `the tail must fade (${fading} vs ${alive})`);

  // Quá thời lượng vệt: không còn gì để vẽ.
  const idleDraws = screen.stats.draws;
  scene.draw(screen.renderer, screen.ctx, [], 'ground', { ...frame, clock: .95 });
  assert.equal(screen.stats.draws, idleDraws, 'the tail is gone after 0.55 s of presentation time');

  // Reduced motion không để lại vệt: sân đứng yên, không thêm chuyển động.
  scene.draw(screen.renderer, screen.ctx, [effect], 'ground', { ...frame, clock: 1.2 });
  const before = screen.stats.draws;
  scene.draw(screen.renderer, screen.ctx, [], 'ground', { ...frame, clock: 1.3, reducedMotion: true });
  assert.equal(screen.stats.draws, before, 'reduced motion never leaves a dissolving tail');
  scene.dispose();
});

test('an ultimate adds a wider haze on top of the tight halo, still from one render', async () => {
  const screen = surface(), scene = createHeroVfxScene(THREE, { loadModel: realAsset });
  const ultimate = cast('ultimate', .3), basic = cast('basic', .3, 2);
  scene.draw(screen.renderer, screen.ctx, [ultimate], 'front', frame);
  await settle(scene);
  const rendersBefore = screen.stats.renders;
  screen.ops.length = 0;
  scene.draw(screen.renderer, screen.ctx, [ultimate], 'front', frame);
  assert.equal(screen.ops.length, 3, 'ultimate composites itself plus a tight halo plus a wide haze');
  assert.equal(screen.stats.renders - rendersBefore, 1, 'the extra haze must not cost a second render');
  const blurs = screen.ops.slice(1).map(op => {
    const radius = /blur\(([\d.]+)px\)/.exec(op.filter);
    assert.ok(radius, `halo filter must be a blur (${op.filter})`);
    return Number(radius[1]);
  });
  assert.ok(blurs[1] > blurs[0] * 1.5, `the haze must be wider than the halo (${blurs.join(' vs ')})`);
  assert.ok(screen.ops[2].alpha < screen.ops[1].alpha, 'the wide haze stays subordinate to the tight halo');
  assert.equal(screen.ops[2].composite, 'lighter', 'the haze adds light instead of veiling the stage');
  // Đòn thường không kéo theo lớp rộng: chi phí cũ giữ nguyên.
  screen.ops.length = 0;
  scene.draw(screen.renderer, screen.ctx, [basic], 'front', frame);
  assert.equal(screen.ops.length, 2, 'a basic cast keeps the single halo');
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

test('auras stay on the caster while sword slashes land on the target', async () => {
  const rootX = async (heroId: string, asset: string, age: number) => {
    const screen = surface();
    const bytes = readFileSync(new URL(`../../public/assets/vfx/${asset}.glb`, import.meta.url));
    const scene = createHeroVfxScene(THREE, { loadModel: async () =>
      new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '') });
    const effect = { ...cast('active', age), sourceHeroId: heroId };
    scene.draw(screen.renderer, screen.ctx, [effect], 'front', frame);
    for (let attempt = 0; attempt < 200 && scene.status(getHeroVfx(heroId)!.sourceId) === 'loading'; attempt++) {
      await new Promise<void>(resolve => setTimeout(resolve, 5));
    }
    scene.draw(screen.renderer, screen.ctx, [effect], 'front', frame);
    let root: THREE.Object3D = screen.captures.at(-1)!.meshes[0];
    while (root.parent && !(root.parent instanceof THREE.Scene)) root = root.parent;
    const x = root.position.x;
    scene.dispose();
    return x;
  };
  const aura = await rootX('belinda', 'belinda', .6);
  const melee = await rootX('astral_blademaster', 'thane', .6);
  assert.ok(melee - aura > 100, `a slash must land near the enemy (${melee}) not at the caster (${aura})`);
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
