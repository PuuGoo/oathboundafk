// PROTOTYPE - NOT FOR PRODUCTION
import type * as Three from 'three';
import type { BattleUnitRuntime } from './types';
import type { SpriteActor } from './spriteBattleRenderer';
import type { SpriteEffect } from './spriteBattleEffects';
import { createBelindaSpellScene, type BelindaSpellFrame } from './belindaSpell3d';
import { getHeroModel, HERO_MODEL_DEFINITIONS } from './heroModels';
import { createHeroVfxScene, type HeroVfxFrame, type LoadedVfx } from './heroVfx3d';
import { getHeroVfx, HERO_VFX_DEFINITIONS } from './heroVfx';
import { createArenaScene, type ArenaFrame, type LoadedArena } from './arenaScene3d';
import type { ArenaDefinition, ArenaSceneId } from './arena3d';
import { arenaLighting, arenaPulseOpacity, ARENA_CLIP_SECONDS } from './arena3d';

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
/** Model vừa tải xong hiện dần đè lên sprite trong bao lâu (mili-giây trận đấu). */
const BODY_REVEAL_MS = 260;

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
  /** Effect pass: Blender GLBs first, then Belinda's legacy procedural spell scene. */
  drawSpells?(ctx: CanvasRenderingContext2D, effects: readonly SpriteEffect[], layer: 'ground' | 'front',
    frame: Omit<BelindaSpellFrame, 'staffAnchors'>): Set<number>;
  /** Clears the per-frame Blender-effect id set; the caller owns frame order. */
  beginFrame?(): void;
  /** Ids the committed GLB effects actually drew in this frame, never Canvas2D art. */
  vfxDrawnIds?(): readonly number[];
  /** Releases all per-battle skeletons and cached models; retains the one shared renderer. */
  reset(): void;
  /** Releases all GPU resources. Safe to call exactly once or repeatedly. */
  dispose(): void;
  modelStatus?(heroId: string): HeroModelStatus;
  /** Blender effect-asset status per hero; separate from the body-model status. */
  vfxStatus?(heroId: string): string;
  /** 0..1 body fade-in for an instance; 1 once the model has fully replaced the sprite. */
  bodyReveal?(instanceId: string): number;
  /** Draws the Blender arena behind the fighters; false when no scene is ready. */
  drawArena?(ctx: CanvasRenderingContext2D, definition: ArenaDefinition, frame: ArenaFrame): boolean;
  arenaStatus?(id: ArenaSceneId): string;
  /** Matches the shared buffer to the canvas resolution; the crop aspect stays 384:448. */
  resize?(width: number, height: number, pixelRatio: number): void;
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
  /** Optional override for Blender effect GLBs so body-model tests stay isolated. */
  loadVfx?: (url: string) => Promise<LoadedVfx>;
  /** Optional override for arena GLBs; the arena shares this backend's renderer. */
  loadArena?: (url: string) => Promise<LoadedArena>;
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
  /** Mốc trận đấu của khung vẽ 3D đầu tiên và độ hiện 0..1 của model so với sprite. */
  bornMs?: number;
  reveal?: number;
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
  /**
   * Một buffer duy nhất cho thân/tướng/hiệu ứng/sân. Tỷ lệ 384:448 là khung của thân nhân vật
   * nên phải giữ nguyên; `resize` chỉ tăng độ phân giải theo canvas để hình không bị nhoè.
   */
  const BUFFER_ASPECT = 448 / 384;
  const BUFFER_MIN_WIDTH = 384, BUFFER_MAX_WIDTH = 1024;
  let bufferWidth = 384;
  renderer.setSize(384, 448); renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.8, 1.8, 2.1, -2.1, .1, 30);
  camera.position.set(-3, 2.1, 7); camera.lookAt(0, 1.35, 0); camera.updateMatrixWorld();
  const anchor = new THREE.Vector3();
  /** Cường độ rig gốc của thân nhân vật; flash tuyệt kỹ cộng thêm rồi trả lại. */
  const HEMI_INTENSITY = 2.5, KEY_INTENSITY = 3.5, RIM_INTENSITY = 2;
  const PULSE_KEY_GAIN = 2.2, PULSE_RIM_GAIN = 1.4, PULSE_HEMI_GAIN = .5, PULSE_TINT_MIX = .55;
  const hemi = new THREE.HemisphereLight(0xfff4db, 0x62557a, HEMI_INTENSITY);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffebcc, KEY_INTENSITY); key.position.set(-3, 6, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xc2e9ff, RIM_INTENSITY); rim.position.set(3, 4, -3); scene.add(rim);
  // Nhân vật lấy màu đèn từ sân đang đấu để hoà vào bảng màu thay vì bị chiếu trắng.
  let lightingId: ArenaSceneId | undefined;
  /** 0..1 của nhịp pulse sân; 0 là rig trung tính. Màu chiêu chỉ áp khi flash > 0. */
  let pulseFlash = 0;
  let pulseTint: number | undefined;
  const skyBase = new THREE.Color(0xfff4db), groundBase = new THREE.Color(0x62557a);
  const keyBase = new THREE.Color(0xffebcc), rimBase = new THREE.Color(0xc2e9ff);
  const flashTint = new THREE.Color();
  const applyLighting = (): void => {
    hemi.color.copy(skyBase); hemi.groundColor.copy(groundBase);
    key.color.copy(keyBase); rim.color.copy(rimBase);
    hemi.intensity = HEMI_INTENSITY + PULSE_HEMI_GAIN * pulseFlash;
    key.intensity = KEY_INTENSITY + PULSE_KEY_GAIN * pulseFlash;
    rim.intensity = RIM_INTENSITY + PULSE_RIM_GAIN * pulseFlash;
    if (pulseFlash <= 0 || pulseTint === undefined) return;
    flashTint.setHex(pulseTint >>> 0);
    key.color.lerp(flashTint, PULSE_TINT_MIX * pulseFlash);
    rim.color.lerp(flashTint, PULSE_TINT_MIX * pulseFlash * .7);
  };
  const applyArenaLighting = (id: ArenaSceneId | undefined): void => {
    if (id === lightingId) return;
    lightingId = id;
    const lighting = id ? arenaLighting(id) : undefined;
    skyBase.setHex(lighting?.sky ?? 0xfff4db);
    groundBase.setHex(lighting?.ground ?? 0x62557a);
    keyBase.setHex(lighting?.key ?? 0xffebcc);
    rimBase.setHex(lighting?.rim ?? 0xc2e9ff);
    applyLighting();
  };
  /** Dùng đúng bao hình pulse của sân để thân nhân vật bừng lên cùng lúc, không lệch nhịp. */
  const applyPulseFlash = (frame: ArenaFrame): void => {
    const next = frame.pulseAge !== undefined && Number.isFinite(frame.pulseAge) && !frame.reducedMotion
      ? arenaPulseOpacity(Math.max(0, Math.min(1, frame.pulseAge / ARENA_CLIP_SECONDS.pulse))) : 0;
    const tint = next > 0 ? frame.pulseTint : undefined;
    if (next === pulseFlash && tint === pulseTint) return;
    pulseFlash = next; pulseTint = tint; applyLighting();
  };
  const records = new Map<string, ModelRecord>(HERO_MODEL_DEFINITIONS.map(model => [model.heroId, {
    heroId: model.heroId, url: model.url, state: 'idle', loadGeneration: 0, inFlight: false,
  }]));
  const queue: string[] = [];
  const instances = new Map<string, HeroInstance>();
  const staffAnchors = new Map<string, { x: number; y: number }>();
  const spells = createBelindaSpellScene(THREE);
  const vfx = createHeroVfxScene(THREE, { loadModel: dependencies?.loadVfx });
  const arena = createArenaScene(THREE, {
    loadModel: dependencies?.loadArena ?? (url =>
      import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().loadAsync(url))),
  });
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
  const vfxHandled = new Set<number>();

  return {
    modelStatus: status,
    vfxStatus: (heroId: string): string => {
      if (disposed) return 'failed';
      const definition = getHeroVfx(heroId);
      return definition ? vfx.status(definition.sourceId) : 'disabled';
    },
    arenaStatus: (id: ArenaSceneId): string => disposed ? 'failed' : arena.status(id),
    /** Độ hiện của model thân: 0 khi chưa có, tăng dần trong 260 ms rồi đứng ở 1. */
    bodyReveal(instanceId: string): number {
      if (disposed) return 1;
      return instances.get(instanceId)?.reveal ?? 0;
    },
    /** Khớp độ phân giải buffer với canvas thật (CSS × DPR), có trần để máy yếu không vỡ RAM GPU. */
    resize(width: number, _height: number, pixelRatio: number): void {
      if (disposed) return;
      const ratio = Number.isFinite(pixelRatio) ? Math.max(1, Math.min(2, pixelRatio)) : 1;
      const wanted = Math.round(Math.max(BUFFER_MIN_WIDTH, Math.min(BUFFER_MAX_WIDTH,
        (Number.isFinite(width) ? Math.max(1, width) : 0) * ratio)));
      if (wanted === bufferWidth) return;
      bufferWidth = wanted;
      renderer.setSize(wanted, Math.round(wanted * BUFFER_ASPECT));
    },
    drawArena(ctx: CanvasRenderingContext2D, definition: ArenaDefinition, frame: ArenaFrame): boolean {
      if (disposed) return false;
      // Đổi màu đèn nhân vật ngay khi biết sân, kể cả lúc asset sân còn đang tải.
      applyArenaLighting(definition.id);
      try {
        const drawn = arena.draw(renderer, ctx, definition, frame);
        // Chỉ bừng khi lớp sân 3D thật sự đang vẽ; nếu không thì chẳng có vòng sáng nào để khớp nhịp.
        applyPulseFlash(drawn ? frame : { ...frame, pulseAge: undefined, pulseTint: undefined });
        return drawn;
      }
      catch { return false; }
    },
    beginFrame() { vfxHandled.clear(); },
    vfxDrawnIds() { return [...vfxHandled]; },
    drawSpells(ctx: CanvasRenderingContext2D, effects: readonly SpriteEffect[], layer: 'ground' | 'front', frame: Omit<BelindaSpellFrame, 'staffAnchors'>) {
      const handled = new Set<number>();
      if (disposed) return handled;
      // Blender effect GLBs draw first; whatever they cannot handle keeps its Canvas2D art.
      try {
        const frameWithAnchors: HeroVfxFrame = { ...frame, staffAnchors };
        for (const id of vfx.draw(renderer, ctx, effects, layer, frameWithAnchors)) {
          handled.add(id); vfxHandled.add(id);
        }
      } catch { /* Canvas2D effects remain the fallback for a broken VFX asset. */ }
      if (spellFailed || status('belinda') !== 'ready') return handled;
      for (const effect of effects) {
        if (handled.has(effect.id)) continue;
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
      // Khung vẽ 3D đầu tiên mở đồng hồ hiện dần; sprite mờ đi đúng nhịp này.
      const now = Number.isFinite(elapsedMs) ? elapsedMs : 0;
      if (instance.bornMs === undefined) instance.bornMs = now;
      const revealT = Math.max(0, Math.min(1, (now - instance.bornMs) / BODY_REVEAL_MS));
      instance.reveal = revealT * revealT * (3 - 2 * revealT);
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
      vfx.reset();
      arena.reset();
      pulseFlash = 0; pulseTint = undefined; applyLighting();
      queue.splice(0).forEach(heroId => { const record = records.get(heroId); if (record && !record.inFlight) record.state = 'idle'; });
      for (const record of records.values()) {
        if (record.state === 'ready') { disposeTemplate(record); record.state = 'idle'; }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation++; queue.length = 0; resetInstances();
      for (const record of records.values()) { if (record.state === 'ready') disposeTemplate(record); }
      arena.dispose(); vfx.dispose(); spells.dispose(); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}

/** One canvas-facing lazy wrapper; backend creation is deferred until a known Oathbound hero is drawn. */
export function createHero3D(load: () => Promise<HeroRenderBackend> = loadHeroBackend) {
  let state: HeroRendererStatus = 'idle';
  let backend: HeroRenderBackend | undefined;
  const renderedIds = new Set<string>();
  const requestedHeroes = new Set<string>();
  /** Kích thước canvas biết được trước khi backend tải xong; áp ngay khi backend sẵn sàng. */
  let pendingSize: [number, number, number] | undefined;
  const applyPendingSize = (target: HeroRenderBackend): void => {
    if (!pendingSize || !target.resize) return;
    try { target.resize(...pendingSize); } catch { /* Canvas2D fallback vẫn vẽ được. */ }
  };
  const release = () => {
    const old = backend; backend = undefined;
    try { old?.dispose(); } catch { /* Canvas2D fallback remains available. */ }
  };
  const beginFrame = () => {
    renderedIds.clear();
    try { backend?.beginFrame?.(); } catch { /* Canvas2D fallback remains available. */ }
  };
  const modelStatus = (heroId: string): HeroModelStatus => {
    if (state === 'disposed' || state === 'failed') return 'failed';
    if (backend?.modelStatus) return backend.modelStatus(heroId);
    if (requestedHeroes.has(heroId) && (state === 'loading' || state === 'ready')) return state;
    return 'idle';
  };
  const modelStatuses = (): HeroModelDiagnostic[] => HERO_MODEL_DEFINITIONS.map(model => ({ heroId: model.heroId, status: modelStatus(model.heroId) }));
  const vfxModelStatus = (heroId: string): HeroModelStatus => {
    if (state === 'disposed' || state === 'failed') return 'failed';
    if (!getHeroVfx(heroId)) return 'idle';
    if (backend?.vfxStatus) {
      const status = backend.vfxStatus(heroId);
      return status === 'ready' || status === 'loading' || status === 'failed' ? status : 'idle';
    }
    return 'idle';
  };
  const vfxModelStatuses = (): HeroModelDiagnostic[] => HERO_VFX_DEFINITIONS.map(definition => ({
    heroId: definition.heroId, status: vfxModelStatus(definition.heroId),
  }));
  return {
    status: () => state,
    modelStatus,
    modelStatuses,
    vfxModelStatus,
    vfxModelStatuses,
    vfxDrawnIds: (): readonly number[] => {
      try { return backend?.vfxDrawnIds?.() || []; } catch { return []; }
    },
    /** 0..1 model-vs-sprite fade for one unit; 1 when no backend is ready yet. */
    bodyReveal: (instanceId: string): number => {
      try { return backend?.bodyReveal?.(instanceId) ?? 1; } catch { return 1; }
    },
    arenaStatus: (id: ArenaSceneId): string => {
      if (state === 'disposed' || state === 'failed') return 'failed';
      try { return backend?.arenaStatus?.(id) || 'idle'; } catch { return 'failed'; }
    },
    /** Loads the backend on demand so the arena can render before any hero body does. */
    drawArena(ctx: CanvasRenderingContext2D, definition: ArenaDefinition, frame: ArenaFrame): boolean {
      if (state === 'disposed' || state === 'failed') return false;
      if (state === 'idle') {
        state = 'loading';
        Promise.resolve().then(load).then(loaded => {
          if (state === 'disposed') { loaded.dispose(); return; }
          backend = loaded; state = 'ready';
          applyPendingSize(loaded);
        }).catch(() => { if (state !== 'disposed') { state = 'failed'; release(); } });
      }
      if (!backend?.drawArena) return false;
      try { return backend.drawArena(ctx, definition, frame); }
      catch { state = 'failed'; release(); return false; }
    },
    beginFrame,
    /** Canvas báo kích thước thật; buffer 3D đi theo để hình không bị nhoè khi phóng to. */
    resize(width: number, height: number, pixelRatio: number): void {
      pendingSize = [width, height, pixelRatio];
      try { backend?.resize?.(width, height, pixelRatio); } catch { /* Canvas2D fallback vẫn vẽ được. */ }
    },
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
          applyPendingSize(loaded);
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
      if (state !== 'ready' || !backend?.drawSpells) return new Set();
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
