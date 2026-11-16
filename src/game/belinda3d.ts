// PROTOTYPE - NOT FOR PRODUCTION
import type { BattleUnitRuntime } from './types';
import type { SpriteActor } from './spriteBattleRenderer';
import type { SpriteEffect } from './spriteBattleEffects';
import { createBelindaSpellScene, type BelindaSpellFrame } from './belindaSpell3d';

export type BelindaClip = 'idle' | 'run' | 'basic' | 'active' | 'ultimate' | 'hit' | 'death';
export interface BelindaPose { clip: BelindaClip; seconds: number }

/** Pure presentation selection. The engine remains the sole owner of combat outcomes. */
export function getBelindaPose(unit: BattleUnitRuntime, actor: SpriteActor, elapsedMs: number,
  reducedMotion: boolean, previous?: BelindaPose): BelindaPose {
  if (!unit.isAlive || unit.hp <= 0) return { clip: 'death', seconds: actor.clip === 'death' ? actor.age : 0 };
  if (unit.statusEffects.some(status => status.remainingMs > 0 && ['stun', 'petrify', 'isolation'].includes(status.type))) {
    return previous || { clip: 'idle', seconds: 0 };
  }
  if (unit.currentCast) {
    const cast = unit.currentCast;
    return { clip: cast.skillSlot, seconds: Math.max(0, Math.min(cast.timeline.durationMs, elapsedMs - cast.startedAtMs)) / 1000 };
  }
  if (actor.actionKind === 'hit' && actor.actionRemaining > 0) return { clip: 'hit', seconds: actor.age };
  return { clip: unit.lastActionType === 'move' ? 'run' : 'idle', seconds: reducedMotion ? 0 : Math.max(0, actor.age) };
}

export interface BelindaRenderBackend {
  /** Returns false on unavailable rendering; caller draws the original sprite instead. */
  draw(ctx: CanvasRenderingContext2D, unit: BattleUnitRuntime, actor: SpriteActor, elapsedMs: number,
    reducedMotion: boolean, x: number, y: number, scale: number): boolean;
  /** Successful IDs alone may replace their Canvas2D counterparts; failures keep fallback intact. */
  drawSpells?(ctx: CanvasRenderingContext2D, effects: readonly SpriteEffect[], layer: 'ground' | 'front',
    frame: Omit<BelindaSpellFrame, 'staffAnchors'>): Set<number>;
  /** Releases per-battle instances, retaining the shared model and renderer. */
  reset(): void;
  /** Releases GPU resources and all instances. Must not mutate combat state. */
  dispose(): void;
}

/** Lazy, failure-contained lifetime wrapper; injectable backend keeps unit tests GPU-independent. */
export function createBelinda3D(load: () => Promise<BelindaRenderBackend> = loadBelindaBackend) {
  let state: 'idle' | 'loading' | 'ready' | 'failed' | 'disposed' = 'idle';
  let backend: BelindaRenderBackend | undefined;
  const release = () => { const old = backend; backend = undefined; try { old?.dispose(); } catch { /* fallback must remain available */ } };
  return {
    status: () => state,
    draw(...args: Parameters<BelindaRenderBackend['draw']>): boolean {
      if (args[1].heroId !== 'belinda' || state === 'disposed' || state === 'failed') return false;
      if (state === 'idle') {
        state = 'loading';
        // A promise boundary also contains synchronous WebGL initialization exceptions.
        Promise.resolve().then(load).then(loaded => {
          if (state === 'disposed') { loaded.dispose(); return; }
          backend = loaded; state = 'ready';
        }).catch(() => { if (state !== 'disposed') { state = 'failed'; release(); } });
      }
      if (!backend) return false;
      try { return backend.draw(...args); }
      catch { state = 'failed'; release(); return false; }
    },
    drawSpells(ctx: CanvasRenderingContext2D, effects: readonly SpriteEffect[], layer: 'ground' | 'front',
      frame: Omit<BelindaSpellFrame, 'staffAnchors'>): Set<number> {
      if (state !== 'ready' || !backend?.drawSpells) return new Set();
      try { return backend.drawSpells(ctx, effects, layer, frame); }
      catch { state = 'failed'; release(); return new Set(); }
    },
    reset() { try { backend?.reset(); } catch { state = 'failed'; release(); } },
    dispose() { if (state === 'disposed') return; state = 'disposed'; release(); },
  };
}

async function loadBelindaBackend(): Promise<BelindaRenderBackend> {
  const [THREE, { GLTFLoader }, { clone }] = await Promise.all([
    import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/utils/SkeletonUtils.js'),
  ]);
  // Exactly one reusable offscreen renderer for the active battle, not one context per hero.
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: false });
  renderer.setSize(384, 448); renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.8, 1.8, 2.1, -2.1, .1, 30);
  camera.position.set(-3, 2.1, 7); camera.lookAt(0, 1.35, 0); camera.updateMatrixWorld();
  const anchor = new THREE.Vector3();
  scene.add(new THREE.HemisphereLight(0xfff4db, 0x62557a, 2.5));
  const key = new THREE.DirectionalLight(0xffebcc, 3.5); key.position.set(-3, 6, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xc2e9ff, 2); rim.position.set(3, 4, -3); scene.add(rim);
  let gltf: Awaited<ReturnType<InstanceType<typeof GLTFLoader>['loadAsync']>>;
  try { gltf = await new GLTFLoader().loadAsync('/assets/models/belinda.glb'); }
  catch (error) { renderer.dispose(); renderer.forceContextLoss(); throw error; }
  const clips = new Map(gltf.animations.map(clip => [clip.name, clip]));
  const required: BelindaClip[] = ['idle', 'run', 'basic', 'active', 'ultimate', 'hit', 'death'];
  const resources = () => {
    gltf.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
          material.dispose();
        }
      }
    });
  };
  if (required.some(name => !clips.has(name))) {
    resources(); renderer.dispose(); renderer.forceContextLoss(); throw new Error('Incomplete Belinda animation asset');
  }
  const spells = createBelindaSpellScene(THREE);
  const staffAnchors = new Map<string, { x: number; y: number }>();
  let spellFailed = false;
  type Instance = { root: import('three').Object3D; mixer: import('three').AnimationMixer;
    staff?: import('three').Object3D; staffLocal?: import('three').Vector3;
    pose?: BelindaPose; action?: import('three').AnimationAction };
  const instances = new Map<string, Instance>();
  const reset = () => {
    for (const instance of instances.values()) {
      instance.mixer.stopAllAction(); instance.mixer.uncacheRoot(instance.root);
      instance.root.traverse(object => { if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose(); });
      scene.remove(instance.root);
    }
    instances.clear(); staffAnchors.clear();
  };
  return {
    drawSpells(ctx, effects, layer, frame) {
      const handled = new Set<number>();
      if (spellFailed) return handled;
      // Fixed shared buffer avoids resizing/reallocating the context between body and spell passes.
      for (const effect of effects) {
        try {
          if (spells.draw(renderer, ctx, effect, layer, { ...frame, staffAnchors })) handled.add(effect.id);
        } catch { spellFailed = true; break; } // Preserve already composited IDs; never retry a failed spell pass each frame.
      }
      return handled;
    },
    draw(ctx, unit, actor, elapsedMs, reducedMotion, x, y, scale) {
      if (renderer.getContext().isContextLost()) throw new Error('Belinda WebGL context lost');
      let instance = instances.get(unit.instanceId);
      if (!instance) {
        const root = clone(gltf.scene); root.visible = false; scene.add(root);
        root.updateMatrixWorld(true);
        const staff = root.getObjectByName('hand.R');
        // Authoring gem center converted from Blender Z-up to glTF Y-up, then into rest-bone space.
        const staffLocal = staff?.worldToLocal(new THREE.Vector3(.51, 2.59, .12));
        instance = { root, staff, staffLocal, mixer: new THREE.AnimationMixer(root) }; instances.set(unit.instanceId, instance);
      }
      const pose = getBelindaPose(unit, actor, elapsedMs, reducedMotion, instance.pose);
      const clip = clips.get(pose.clip)!;
      if (!instance.action || instance.pose?.clip !== pose.clip) {
        instance.mixer.stopAllAction();
        instance.action = instance.mixer.clipAction(clip);
        instance.action.setLoop(pose.clip === 'idle' || pose.clip === 'run' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        instance.action.clampWhenFinished = true;
        instance.action.reset().play();
      }
      // Absolute sampling supports pause, x2 and render-rate-independent contact poses.
      instance.action.paused = false;
      instance.mixer.setTime(pose.clip === 'idle' || pose.clip === 'run' ? pose.seconds % clip.duration : Math.min(pose.seconds, clip.duration));
      instance.pose = pose; instance.root.visible = true;
      // Expand the offscreen crop for a horizontal defeat pose without shrinking world scale.
      camera.zoom = pose.clip === 'death' ? .55 : 1;
      camera.updateProjectionMatrix();
      anchor.set(0, 0, 0).project(camera);
      const footX = (anchor.x + 1) / 2, footY = (1 - anchor.y) / 2;
      try { renderer.render(scene, camera); } finally { instance.root.visible = false; }
      const w = 122 * scale / camera.zoom, h = w * 448 / 384;
      if (instance.staff && instance.staffLocal) {
        instance.root.updateMatrixWorld(true);
        const tip = instance.staff.localToWorld(instance.staffLocal.clone()).project(camera);
        staffAnchors.set(unit.instanceId, { x: x + (unit.facing < 0 ? -1 : 1) * ((tip.x + 1) / 2 - footX) * w,
          y: y + ((1 - tip.y) / 2 - footY) * h });
      }
      ctx.save();
      try {
        ctx.translate(x, y); ctx.scale(unit.facing < 0 ? -1 : 1, 1);
        if (unit.statusEffects.some(status => status.type === 'petrify')) ctx.filter = 'grayscale(1)';
        else if (actor.flash > 0) ctx.filter = 'brightness(1.65)';
        ctx.drawImage(renderer.domElement, -footX * w, -footY * h, w, h);
      } finally { ctx.restore(); }
      return true;
    },
    reset,
    dispose() { reset(); spells.dispose(); resources(); renderer.dispose(); renderer.forceContextLoss(); },
  };
}
