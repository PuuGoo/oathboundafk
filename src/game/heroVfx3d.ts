// PROTOTYPE - NOT FOR PRODUCTION
import type * as Three from 'three';
import type { SpriteEffect } from './spriteBattleEffects';
import { getSpriteBattleScale, projectSpritePosition } from './spriteBattleRenderer';
import {
  HERO_VFX_DEFINITIONS, sampleVfxBatch, VFX_STYLE, VFX_CLIP_SECONDS, type HeroVfxSample,
} from './heroVfx';

/**
 * Plays the Blender-authored `<hero>.glb` skill effects inside the battle's
 * single shared WebGL buffer. Simulation time decides which clip and how far,
 * so pause, ×2 speed and death freezes apply without extra bookkeeping here.
 */
export interface HeroVfxFrame {
  width: number; height: number; reducedMotion: boolean; low: boolean;
  staffAnchors?: ReadonlyMap<string, { x: number; y: number }>;
}
export interface LoadedVfx { scene: Three.Object3D; animations: Three.AnimationClip[] }
export interface HeroVfxDependencies { loadModel?: (url: string) => Promise<LoadedVfx> }

/** Material classes are authored in Blender by name; opacity is set at runtime. */
const OPACITY_FACTOR: Readonly<Record<string, number>> = Object.freeze({
  vfx_core: 1, vfx_glow: 1, vfx_alt: .9, vfx_halo: .34,
});
const PRUNE_PASSES = 90;
const MAX_INSTANCES = 16;

type Namespace = typeof import('three');
type Record_ = {
  sourceId: string;
  url: string;
  state: 'idle' | 'loading' | 'ready' | 'failed';
  version: number;
  template?: Three.Object3D;
  clips?: Map<string, Three.AnimationClip>;
};
type Instance = {
  sourceId: string;
  root: Three.Object3D;
  mixer: Three.AnimationMixer;
  action?: Three.AnimationAction;
  clipName?: string;
  materials: Array<{ material: Three.Material; factor: number; halo: boolean }>;
  lastPass: number;
};

function disposeObject(THREE: Namespace, root: Three.Object3D): void {
  const geometries = new Set<Three.BufferGeometry>();
  const materials = new Set<Three.Material>();
  const textures = new Set<Three.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

/** Scene sở hữu cache và material hiệu ứng, mượn renderer của nhân vật. */
export function createHeroVfxScene(THREE: Namespace, dependencies: HeroVfxDependencies = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-240, 240, 340, -340, .1, 3000);
  camera.position.z = 1500;
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x241a3a, 1.6));
  const key = new THREE.DirectionalLight(0xfff0c8, 2.2); key.position.set(-260, 420, 520); scene.add(key);
  const records = new Map<string, Record_>(HERO_VFX_DEFINITIONS.map(definition => [definition.sourceId, {
    sourceId: definition.sourceId, url: definition.url, state: 'idle', version: 0,
  }]));
  const instances = new Map<number, Instance>();
  let disposed = false;
  let pass = 0;
  const queue: Record_[] = [];
  let loading = false;

  const load = async (record: Record_, version: number): Promise<void> => {
    let loaded: LoadedVfx | undefined;
    try {
      const loader = dependencies.loadModel
        ? dependencies.loadModel(record.url)
        : import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().loadAsync(record.url));
      loaded = await loader;
      const clips = new Map(loaded.animations.map(clip => [clip.name, clip] as const));
      const invalid = Object.entries(VFX_CLIP_SECONDS).some(([name, seconds]) => {
        const clip = clips.get(name);
        return !clip || !Number.isFinite(clip.duration) || Math.abs(clip.duration - seconds) > 1e-5;
      });
      if (disposed || version !== record.version || invalid) {
        disposeObject(THREE, loaded.scene);
        if (!disposed && version === record.version) record.state = 'failed';
        return;
      }
      record.template = loaded.scene;
      record.template.visible = false;
      record.clips = clips;
      record.state = 'ready';
    } catch {
      if (loaded) disposeObject(THREE, loaded.scene);
      if (!disposed && version === record.version) record.state = 'failed';
    }
  };

  const pump = (): void => {
    if (disposed || loading) return;
    const record = queue.shift();
    if (!record) return;
    loading = true;
    void load(record, record.version).finally(() => { loading = false; pump(); });
  };
  const request = (sourceId: string): Record_ | undefined => {
    const record = records.get(sourceId);
    if (!record || disposed || record.state !== 'idle') return record;
    record.state = 'loading';
    queue.push(record); pump();
    return record;
  };

  const dropInstance = (id: number): void => {
    const instance = instances.get(id);
    if (!instance) return;
    instance.mixer.stopAllAction(); instance.mixer.uncacheRoot(instance.root);
    instance.materials.forEach(entry => entry.material.dispose());
    scene.remove(instance.root);
    instances.delete(id);
  };

  const createInstance = (record: Record_, sample: HeroVfxSample): Instance | undefined => {
    if (!record.template || !record.clips) return;
    if (instances.size >= MAX_INSTANCES) {
      const oldest = [...instances].sort((a, b) => a[1].lastPass - b[1].lastPass)[0];
      dropInstance(oldest[0]);
    }
    const root = record.template.clone(true);
    root.visible = true;
    const materials: Instance['materials'] = [];
    const copies = new Map<Three.Material, Three.Material>();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      const cloned = list.map(material => {
        const existing = copies.get(material);
        if (existing) return existing;
        const copy = material.clone();
        copy.transparent = true; copy.depthWrite = false; copy.toneMapped = false; copy.side = THREE.DoubleSide;
        // Phát sáng giữ màu: strength từ Blender không được làm trắng toàn bộ hiệu ứng.
        if (copy instanceof THREE.MeshStandardMaterial) {
          copy.color.copy(copy.emissive).multiplyScalar(.25);
          copy.emissiveIntensity = material.name === 'vfx_halo' ? .4 : .85;
        }
        const name = material.name || '';
        const factor = OPACITY_FACTOR[name] ?? 1;
        materials.push({ material: copy, factor, halo: name === 'vfx_halo' });
        copies.set(material, copy);
        return copy;
      });
      object.material = Array.isArray(object.material) ? cloned : cloned[0];
    });
    scene.add(root);
    const instance: Instance = {
      sourceId: sample.sourceId, root, mixer: new THREE.AnimationMixer(root), materials, lastPass: pass,
    };
    instances.set(sample.id, instance);
    return instance;
  };

  const place = (instance: Instance, sample: HeroVfxSample, layer: 'ground' | 'front', frame: HeroVfxFrame): void => {
    const scale = getSpriteBattleScale(frame.width, frame.height);
    const origin = projectSpritePosition(sample.source.x, sample.source.y, frame.width, frame.height);
    const endpoint = projectSpritePosition(sample.target.x, sample.target.y, frame.width, frame.height);
    const toward = endpoint.x >= origin.x ? 1 : -1;
    const muzzle = (sample.sourceInstanceId && frame.staffAnchors?.get(sample.sourceInstanceId)) ||
      { x: origin.x + toward * 13 * scale, y: origin.y - 86 * scale };
    const chest = { x: endpoint.x, y: endpoint.y - 40 * scale };
    const impact = sample.clip === 'impact';
    let center: { x: number; y: number };
    let flatten = 1;
    if (sample.support) {
      center = layer === 'ground' ? endpoint : chest;
      flatten = layer === 'ground' ? .55 : 1;
    } else if (impact) {
      center = layer === 'ground' ? endpoint : chest;
      flatten = layer === 'ground' ? .55 : 1;
    } else if (layer === 'ground') {
      center = origin; flatten = .62;
    } else if (sample.phase === 'flight') {
      const travel = sample.travel;
      center = {
        x: muzzle.x + (chest.x - muzzle.x) * travel,
        y: muzzle.y + (chest.y - muzzle.y) * travel
          - (frame.reducedMotion ? 0 : Math.sin(travel * Math.PI) * VFX_STYLE.arcHeight * scale),
      };
    } else if (sample.phase === 'recovery') center = chest;
    else center = muzzle;
    const radius = VFX_STYLE.radius * scale * sample.magnitude;
    instance.root.position.set(center.x - frame.width / 2, frame.height / 2 - center.y, layer === 'ground' ? -12 : 0);
    instance.root.scale.set(radius, radius * flatten, radius);
    instance.root.visible = true;
    for (const entry of instance.materials) {
      entry.material.opacity = Math.max(0, Math.min(1, sample.opacity * entry.factor));
      if (frame.low && entry.halo) entry.material.opacity *= .5;
    }
  };

  return {
    diagnostics() { return { instances: instances.size, loaded: [...records.values()].filter(record => record.state === 'ready').length }; },
    status(sourceId: string): string {
      if (disposed) return 'failed';
      const record = records.get(sourceId);
      return record ? record.state : 'missing';
    },
    /** One draw call per layer keeps the shared 384×448 buffer as the only render target. */
    draw(renderer: Three.WebGLRenderer, ctx: CanvasRenderingContext2D, effects: readonly SpriteEffect[],
      layer: 'ground' | 'front', frame: HeroVfxFrame): Set<number> {
      const handled = new Set<number>();
      if (disposed) return handled;
      pass++;
      for (const [id, instance] of instances) if (pass - instance.lastPass > PRUNE_PASSES) dropInstance(id);
      const samples = sampleVfxBatch(effects, frame.width, frame.height, frame.reducedMotion);
      if (!samples.length) return handled;
      const drawn: Instance[] = [];
      for (const sample of samples) {
        let record = records.get(sample.sourceId);
        if (record?.state === 'idle') record = request(sample.sourceId);
        if (!record || record.state !== 'ready') continue;
        const instance = instances.get(sample.id) || createInstance(record, sample);
        if (!instance) continue;
        const clip = record.clips?.get(sample.clip);
        if (!clip) { dropInstance(sample.id); continue; }
        if (!instance.action || instance.clipName !== sample.clip) {
          instance.mixer.stopAllAction();
          instance.action = instance.mixer.clipAction(clip);
          instance.action.setLoop(THREE.LoopOnce, 1);
          instance.action.clampWhenFinished = true;
          instance.action.reset().play();
          instance.clipName = sample.clip;
        }
        instance.action.paused = false;
        instance.mixer.setTime((frame.reducedMotion ? .55 : sample.progress) * clip.duration);
        instance.lastPass = pass;
        place(instance, sample, layer, frame);
        drawn.push(instance);
        handled.add(sample.id);
      }
      for (const [id, instance] of instances) if (pass - instance.lastPass > PRUNE_PASSES) dropInstance(id);
      if (!drawn.length) return handled;
      if (renderer.getContext().isContextLost()) { for (const id of handled) dropInstance(id); throw new Error('VFX context lost'); }
      camera.left = -frame.width / 2; camera.right = frame.width / 2;
      camera.top = frame.height / 2; camera.bottom = -frame.height / 2; camera.updateProjectionMatrix();
      try {
        renderer.render(scene, camera);
        ctx.drawImage(renderer.domElement, 0, 0, frame.width, frame.height);
      } finally {
        for (const instance of drawn) instance.root.visible = false;
      }
      return handled;
    },
    /** Giải phóng cache khi đổi trận; load cũ về trễ không được chiếm cache mới. */
    reset(): void {
      for (const id of [...instances.keys()]) dropInstance(id);
      queue.length = 0;
      for (const record of records.values()) {
        record.version++;
        if (record.template) disposeObject(THREE, record.template);
        record.template = undefined; record.clips = undefined;
        if (record.state !== 'failed') record.state = 'idle';
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      queue.length = 0;
      for (const id of [...instances.keys()]) dropInstance(id);
      for (const record of records.values()) {
        if (record.template) { disposeObject(THREE, record.template); record.template = undefined; }
        record.clips = undefined; record.state = 'idle';
      }
      scene.clear();
    },
  };
}

export type HeroVfxScene = ReturnType<typeof createHeroVfxScene>;
