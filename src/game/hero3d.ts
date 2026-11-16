// PROTOTYPE - NOT FOR PRODUCTION
import type * as Three from 'three';
import type { BattleUnitRuntime } from './types';
import type { SpriteActor } from './spriteBattleRenderer';
import type { SpriteEffect } from './spriteBattleEffects';
import { createBelindaSpellScene, type BelindaSpellFrame } from './belindaSpell3d';
import { getHeroModel, HERO_MODEL_DEFINITIONS } from './heroModels';

export type HeroClip = 'idle' | 'run' | 'basic' | 'active' | 'ultimate' | 'hit' | 'death';
export type HeroModelStatus = 'idle' | 'loading' | 'ready' | 'failed';
export type HeroRendererStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'disposed';
export interface HeroPose { clip: HeroClip; seconds: number }

/** Asset contracts used when no simulation-owned cast timeline exists. */
export const HERO_CLIP_SECONDS: Readonly<Record<HeroClip, number>> = Object.freeze({
  idle: 2,
  run: .6,
  basic: .4,
  active: 1.15,
  ultimate: 1.65,
  hit: .3,
  death: 1.2,
});

const ACTION_CLIP: Readonly<Partial<Record<SpriteActor['actionKind'], HeroClip>>> = Object.freeze({
  basic: 'basic', skill: 'active', ultimate: 'ultimate', hit: 'hit',
});
const CONTROL_TYPES = new Set(['stun', 'petrify', 'isolation']);
const LOOPING_CLIPS = new Set<HeroClip>(['idle', 'run']);

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function idleOrRun(unit: BattleUnitRuntime, actor: SpriteActor, reducedMotion: boolean): HeroPose {
  const clip: HeroClip = unit.lastActionType === 'move' ? 'run' : 'idle';
  return { clip, seconds: reducedMotion ? 0 : Math.max(0, finite(actor.age)) };
}

/** Selects a presentation pose without mutating simulation or SpriteActor state. */
export function getHeroPose(unit: BattleUnitRuntime, actor: SpriteActor, elapsedMs: number,
  reducedMotion: boolean, previous?: HeroPose): HeroPose {
  if (!unit.isAlive || unit.hp <= 0) {
    return { clip: 'death', seconds: actor.clip === 'death' ? Math.max(0, finite(actor.age)) : 0 };
  }
  if (unit.statusEffects.some(status => status.remainingMs > 0 && CONTROL_TYPES.has(status.type))) {
    return previous || { clip: 'idle', seconds: 0 };
  }
  if (unit.currentCast) {
    const cast = unit.currentCast;
    const age = clamp(finite(elapsedMs) - cast.startedAtMs, 0, cast.timeline.durationMs);
    return { clip: cast.skillSlot, seconds: age / 1000 };
  }
  // A cast event can be cancelled after its SpriteActor was assigned. Never resurrect
  // that stale authored timeline from actor.age/actionRemaining on a later frame.
  if (actor.timeline) return idleOrRun(unit, actor, reducedMotion);
  if (actor.actionRemaining > 0) {
    const clip = ACTION_CLIP[actor.actionKind];
    if (clip) {
      const duration = HERO_CLIP_SECONDS[clip];
      const normalized = actor.actionDuration > 0 ? actor.age / actor.actionDuration : actor.age / duration;
      return { clip, seconds: clamp(finite(normalized), 0, 1) * duration };
    }
  }
  return idleOrRun(unit, actor, reducedMotion);
}

export interface HeroRenderBackend {
  /** Returns false when this hero is unavailable; Canvas2D remains responsible for fallback. */
  draw(ctx: CanvasRenderingContext2D, unit: BattleUnitRuntime, actor: SpriteActor, elapsedMs: number,
    reducedMotion: boolean, x: number, y: number, scale: number): boolean;
  /** Belinda-only spell pass. The backend must return no IDs until Belinda is ready. */
  drawSpells?(ctx: CanvasRenderingContext2D, effects: readonly SpriteEffect[], layer: 'ground' | 'front',
    frame: Omit<BelindaSpellFrame, 'staffAnchors'>): Set<number>;
  /** Releases all per-battle skeletons and cached models; retains the one shared renderer. */
  reset(): void;
  /** Releases all GPU resources. Safe to call exactly once or repeatedly. */
  dispose(): void;
  modelStatus?(heroId: string): HeroModelStatus;
}

export interface HeroModelDiagnostic { heroId: string; status: HeroModelStatus }
export interface Hero3DDiagnostic {
  status: HeroRendererStatus;
  heroes: readonly HeroModelDiagnostic[];
  renderedIds: readonly string[];
}

type LoadedGltf = { scene: Three.Object3D; animations: Three.AnimationClip[] };
export interface HeroBackendDependencies {
  renderer: Three.WebGLRenderer;
  loadModel: (url: string) => Promise<LoadedGltf>;
}
type ThreeNamespace = typeof import('three');
type ModelRecord = {
  heroId: string;
  url: string;
  state: HeroModelStatus;
  loadGeneration: number;
  inFlight: boolean;
  template?: Three.Object3D;
  clips?: Map<HeroClip, Three.AnimationClip>;
};
type HeroInstance = {
  heroId: string;
  root: Three.Object3D;
  mixer: Three.AnimationMixer;
  action?: Three.AnimationAction;
  pose?: HeroPose;
  staff?: Three.Object3D;
  staffLocal?: Three.Vector3;
};

const REQUIRED_CLIPS: readonly HeroClip[] = ['idle', 'run', 'basic', 'active', 'ultimate', 'hit', 'death'];

function disposeGltfResources(THREE: ThreeNamespace, root: Three.Object3D): void {
  const geometries = new Set<Three.BufferGeometry>();
  const materials = new Set<Three.Material>();
  const textures = new Set<Three.Texture>();
  const skeletons = new Set<Three.Skeleton>();
  root.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  skeletons.forEach(skeleton => skeleton.dispose());
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

/** One lazy model backend owns one renderer, one scene and all loaded model templates. */
export async function loadHeroBackend(dependencies?: HeroBackendDependencies): Promise<HeroRenderBackend> {
  const [THREE, { GLTFLoader }, { clone }] = await Promise.all([
    import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/utils/SkeletonUtils.js'),
  ]);
  const renderer = dependencies?.renderer ?? new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: false });
  renderer.setSize(384, 448); renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.8, 1.8, 2.1, -2.1, .1, 30);
  camera.position.set(-3, 2.1, 7); camera.lookAt(0, 1.35, 0); camera.updateMatrixWorld();
  const anchor = new THREE.Vector3();
  scene.add(new THREE.HemisphereLight(0xfff4db, 0x62557a, 2.5));
  const key = new THREE.DirectionalLight(0xffebcc, 3.5); key.position.set(-3, 6, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xc2e9ff, 2); rim.position.set(3, 4, -3); scene.add(rim);
  const records = new Map<string, ModelRecord>(HERO_MODEL_DEFINITIONS.map(model => [model.heroId, {
    heroId: model.heroId, url: model.url, state: 'idle', loadGeneration: 0, inFlight: false,
  }]));
  const queue: string[] = [];
  const instances = new Map<string, HeroInstance>();
  const staffAnchors = new Map<string, { x: number; y: number }>();
  const spells = createBelindaSpellScene(THREE);
  let queueBusy = false;
  let generation = 0;
  let disposed = false;
  let spellFailed = false;

  const disposeTemplate = (record: ModelRecord) => {
    if (!record.template) return;
    disposeGltfResources(THREE, record.template);
    record.template = undefined; record.clips = undefined;
  };
  const disposeInstance = (instance: HeroInstance) => {
    instance.mixer.stopAllAction(); instance.mixer.uncacheRoot(instance.root);
    const skeletons = new Set<Three.Skeleton>();
    instance.root.traverse(object => { if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton); });
    skeletons.forEach(skeleton => skeleton.dispose());
    scene.remove(instance.root);
  };
  const resetInstances = () => {
    for (const instance of instances.values()) disposeInstance(instance);
    instances.clear(); staffAnchors.clear();
  };
  const disposeLoaded = (gltf: LoadedGltf) => disposeGltfResources(THREE, gltf.scene);
  const loadRecord = async (record: ModelRecord, requestGeneration: number): Promise<void> => {
    let gltf: LoadedGltf | undefined;
    try {
      gltf = await (dependencies?.loadModel(record.url) ?? new GLTFLoader().loadAsync(record.url));
      const clips = new Map(gltf.animations
        .filter(animation => REQUIRED_CLIPS.includes(animation.name as HeroClip))
        .map(animation => [animation.name as HeroClip, animation] as const));
      if (REQUIRED_CLIPS.some(name => !clips.has(name) || !Number.isFinite(clips.get(name)!.duration) || clips.get(name)!.duration <= 0)) {
        throw new Error(`Incomplete ${record.heroId} animation asset`);
      }
      if (disposed || requestGeneration !== generation || record.loadGeneration !== requestGeneration) {
        disposeLoaded(gltf); if (!disposed) record.state = 'idle'; return;
      }
      record.template = gltf.scene; record.template.visible = false; record.clips = clips; record.state = 'ready';
    } catch {
      if (gltf) disposeLoaded(gltf);
      if (!disposed) record.state = requestGeneration === generation ? 'failed' : 'idle';
    }
  };
  const pump = () => {
    if (disposed || queueBusy) return;
    const heroId = queue.shift(); if (!heroId) return;
    const record = records.get(heroId);
    if (!record || record.state !== 'loading') { pump(); return; }
    queueBusy = true; record.inFlight = true;
    void loadRecord(record, record.loadGeneration).finally(() => {
      record.inFlight = false; queueBusy = false; pump();
    });
  };
  const requestModel = (heroId: string) => {
    const record = records.get(heroId);
    if (!record || disposed || record.state !== 'idle') return;
    record.state = 'loading'; record.loadGeneration = generation; queue.push(heroId); pump();
  };
  const status = (heroId: string): HeroModelStatus => disposed ? 'failed' : records.get(heroId)?.state || 'failed';

  return {
    modelStatus: status,
    drawSpells(ctx: CanvasRenderingContext2D, effects: readonly SpriteEffect[], layer: 'ground' | 'front', frame: Omit<BelindaSpellFrame, 'staffAnchors'>) {
      const handled = new Set<number>();
      if (disposed || spellFailed || status('belinda') !== 'ready') return handled;
      for (const effect of effects) {
        try {
          if (spells.draw(renderer, ctx, effect, layer, { ...frame, staffAnchors })) handled.add(effect.id);
        } catch { spellFailed = true; break; }
      }
      return handled;
    },
    draw(ctx: CanvasRenderingContext2D, unit: BattleUnitRuntime, actor: SpriteActor, elapsedMs: number,
      reducedMotion: boolean, x: number, y: number, scale: number): boolean {
      if (disposed || renderer.getContext().isContextLost()) throw new Error('Hero WebGL context lost');
      const definition = getHeroModel(unit.heroId), record = definition && records.get(unit.heroId);
      if (!record) return false;
      if (record.state !== 'ready' || !record.template || !record.clips) { requestModel(unit.heroId); return false; }
      let instance = instances.get(unit.instanceId);
      if (instance?.heroId !== unit.heroId) {
        if (instance) disposeInstance(instance);
        instances.delete(unit.instanceId); instance = undefined;
      }
      if (!instance) {
        const root = clone(record.template); root.visible = false; scene.add(root);
        root.updateMatrixWorld(true);
        const staff = unit.heroId === 'belinda' ? root.getObjectByName('hand.R') : undefined;
        const staffLocal = staff?.worldToLocal(new THREE.Vector3(.51, 2.59, .12));
        instance = { heroId: unit.heroId, root, staff, staffLocal, mixer: new THREE.AnimationMixer(root) };
        instances.set(unit.instanceId, instance);
      }
      const pose = getHeroPose(unit, actor, elapsedMs, reducedMotion, instance.pose);
      const clip = record.clips.get(pose.clip)!;
      if (!instance.action || instance.pose?.clip !== pose.clip) {
        instance.mixer.stopAllAction();
        instance.action = instance.mixer.clipAction(clip);
        instance.action.setLoop(LOOPING_CLIPS.has(pose.clip) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        instance.action.clampWhenFinished = true; instance.action.reset().play();
      }
      instance.action.paused = false;
      const expected = unit.currentCast?.skillSlot === pose.clip ? unit.currentCast.timeline.durationMs / 1000 : HERO_CLIP_SECONDS[pose.clip];
      const clipTime = expected > 0 ? pose.seconds / expected * clip.duration : pose.seconds;
      instance.mixer.setTime(LOOPING_CLIPS.has(pose.clip) ? clipTime % clip.duration : Math.min(clipTime, clip.duration));
      instance.pose = pose; instance.root.visible = true;
      // Expand only the crop; inverse-zoom compositing below preserves feet, scale and spell origin.
      camera.zoom = pose.clip === 'death' ? .55 : .9; camera.updateProjectionMatrix();
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
    reset() {
      if (disposed) return;
      generation++;
      resetInstances();
      queue.splice(0).forEach(heroId => { const record = records.get(heroId); if (record && !record.inFlight) record.state = 'idle'; });
      for (const record of records.values()) {
        if (record.state === 'ready') { disposeTemplate(record); record.state = 'idle'; }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation++; queue.length = 0; resetInstances();
      for (const record of records.values()) { if (record.state === 'ready') disposeTemplate(record); }
      spells.dispose(); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}

/** One canvas-facing lazy wrapper; backend creation is deferred until a known Oathbound hero is drawn. */
export function createHero3D(load: () => Promise<HeroRenderBackend> = loadHeroBackend) {
  let state: HeroRendererStatus = 'idle';
  let backend: HeroRenderBackend | undefined;
  const renderedIds = new Set<string>();
  const requestedHeroes = new Set<string>();
  const release = () => {
    const old = backend; backend = undefined;
    try { old?.dispose(); } catch { /* Canvas2D fallback remains available. */ }
  };
  const beginFrame = () => renderedIds.clear();
  const modelStatus = (heroId: string): HeroModelStatus => {
    if (state === 'disposed' || state === 'failed') return 'failed';
    if (backend?.modelStatus) return backend.modelStatus(heroId);
    if (requestedHeroes.has(heroId) && (state === 'loading' || state === 'ready')) return state;
    return 'idle';
  };
  const modelStatuses = (): HeroModelDiagnostic[] => HERO_MODEL_DEFINITIONS.map(model => ({ heroId: model.heroId, status: modelStatus(model.heroId) }));
  return {
    status: () => state,
    modelStatus,
    modelStatuses,
    beginFrame,
    diagnostics(): Hero3DDiagnostic { return { status: state, heroes: modelStatuses(), renderedIds: [...renderedIds] }; },
    draw(...args: Parameters<HeroRenderBackend['draw']>): boolean {
      const unit = args[1];
      if (!getHeroModel(unit.heroId) || state === 'disposed' || state === 'failed') return false;
      requestedHeroes.add(unit.heroId);
      if (state === 'idle') {
        state = 'loading';
        Promise.resolve().then(load).then(loaded => {
          if (state === 'disposed') { loaded.dispose(); return; }
          backend = loaded; state = 'ready';
        }).catch(() => { if (state !== 'disposed') { state = 'failed'; release(); } });
      }
      if (!backend) return false;
      try {
        const drawn = backend.draw(...args);
        if (drawn) renderedIds.add(unit.instanceId);
        return drawn;
      } catch { state = 'failed'; release(); return false; }
    },
    drawSpells(ctx: CanvasRenderingContext2D, effects: readonly SpriteEffect[], layer: 'ground' | 'front',
      frame: Omit<BelindaSpellFrame, 'staffAnchors'>): Set<number> {
      if (state !== 'ready' || modelStatus('belinda') !== 'ready' || !backend?.drawSpells) return new Set();
      try { return backend.drawSpells(ctx, effects, layer, frame); }
      catch { state = 'failed'; release(); return new Set(); }
    },
    reset() {
      beginFrame(); requestedHeroes.clear();
      try { backend?.reset(); } catch { state = 'failed'; release(); }
    },
    dispose() { if (state === 'disposed') return; state = 'disposed'; beginFrame(); release(); },
  };
}
