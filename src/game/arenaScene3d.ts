// PROTOTYPE - NOT FOR PRODUCTION
import type * as Three from 'three';
import {
  ARENA_CLIP_SECONDS, ARENA_DEFINITIONS, sampleArenaPulse, type ArenaDefinition, type ArenaSceneId,
} from './arena3d';

/**
 * Draws the Blender arena scene behind the fighters using the body backend's
 * WebGL context. Nothing here touches simulation state: the arena is a picture
 * whose disc is stretched onto the same ellipse the Canvas2D floor uses.
 */
export interface ArenaFrame {
  width: number; height: number;
  /** Canvas position of the arena ellipse centre. */
  centerX: number; centerY: number;
  /** Ellipse radii in canvas pixels; the GLB uses a 100-unit radius disc. */
  radiusX: number; radiusY: number;
  reducedMotion: boolean;
  /** Seconds since the current ultimate cast started, when one is running. */
  pulseAge?: number;
  wallClock: number;
}
export interface LoadedArena { scene: Three.Object3D; animations: Three.AnimationClip[] }
export interface ArenaDependencies { loadModel(url: string): Promise<LoadedArena> }

type Namespace = typeof import('three');
type Record_ = {
  definition: ArenaDefinition;
  state: 'idle' | 'loading' | 'ready' | 'failed';
  version: number;
  template?: Three.Object3D;
  clips?: Map<string, Three.AnimationClip>;
};
type Active = {
  id: ArenaSceneId;
  root: Three.Object3D;
  mixer: Three.AnimationMixer;
  actions: Map<string, Three.AnimationAction>;
  /** Objects that belong to the one-shot pulse clip and must not linger afterwards. */
  pulseObjects: Three.Object3D[];
};

/**
 * Elevation chosen from the target ellipse instead of a fixed angle: the studio
 * camera used to author the GLB never ships, so the runtime must derive the tilt
 * from `radiusY / radiusX` or the disc will not sit on the painted floor.
 * A disc seen by an orthographic camera tilted by `e` projects to an ellipse with
 * vertical semi-axis `R·sin(e)`, so the tilt is `asin(radiusY / radiusX)`.
 */
export function elevationForEllipse(radiusX: number, radiusY: number): number {
  if (!(radiusX > 0) || !(radiusY > 0)) return Math.PI / 3;
  return Math.asin(Math.max(.1, Math.min(.995, radiusY / radiusX)));
}
const AUTHORED_RADIUS = 100;
const CAMERA_DISTANCE = 400;

function disposeObject(THREE: Namespace, root: Three.Object3D): void {
  const geometries = new Set<Three.BufferGeometry>();
  const materials = new Set<Three.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

export function createArenaScene(THREE: Namespace, dependencies: ArenaDependencies) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 4000);
  let elevation = elevationForEllipse(.66, .31);
  const placeCamera = (): void => {
    camera.position.set(0, Math.sin(elevation) * CAMERA_DISTANCE, Math.cos(elevation) * CAMERA_DISTANCE);
    // Camera mặc định nhìn theo -Z; xoay -elevation quanh X cho hướng nhìn trỏ về gốc.
    camera.rotation.set(-elevation, 0, 0);
  };
  placeCamera();
  /** Camera không nằm trong scene graph, nên ma trận phải được cập nhật tường minh. */
  const syncCamera = (): void => {
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  };
  syncCamera();
  // Ánh sáng trung tính: màu theme đã nằm trong material của GLB.
  scene.add(new THREE.AmbientLight(0xffffff, .55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-140, 260, 180); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xbcd4ff, .7);
  rim.position.set(160, 120, -200); scene.add(rim);

  const records = new Map<ArenaSceneId, Record_>(ARENA_DEFINITIONS.map(definition => [definition.id, {
    definition, state: 'idle', version: 0,
  }]));
  const queue: Record_[] = [];
  let loading = false;
  let active: Active | undefined;
  let pass = 0;
  let disposed = false;
  let failed = false;

  const load = async (record: Record_, version: number): Promise<void> => {
    let loaded: LoadedArena | undefined;
    try {
      loaded = await dependencies.loadModel(record.definition.url);
      const clips = new Map(loaded.animations.map(clip => [clip.name, clip] as const));
      const invalid = Object.entries(ARENA_CLIP_SECONDS).some(([name, seconds]) => {
        const clip = clips.get(name);
        return !clip || !Number.isFinite(clip.duration) || Math.abs(clip.duration - seconds) > 1e-4;
      });
      if (disposed || version !== record.version || invalid) {
        disposeObject(THREE, loaded.scene);
        if (!disposed && version === record.version) record.state = 'failed';
        return;
      }
      record.template = loaded.scene; record.template.visible = false;
      record.clips = clips; record.state = 'ready';
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
  const request = (id: ArenaSceneId): Record_ | undefined => {
    const record = records.get(id);
    if (!record || disposed || record.state !== 'idle') return record;
    record.state = 'loading';
    queue.push(record); pump();
    return record;
  };

  const dropActive = (): void => {
    if (!active) return;
    active.mixer.stopAllAction(); active.mixer.uncacheRoot(active.root);
    active.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      list.forEach(material => material.dispose());
    });
    scene.remove(active.root);
    active = undefined;
  };

  const activate = (record: Record_, id: ArenaSceneId): Active | undefined => {
    if (!record.template || !record.clips) return;
    dropActive();
    const root = record.template.clone(true);
    root.visible = true;
    // Alpha nhẹ để lớp sàn 3D hoà vào bầu trời Canvas2D phía sau thay vì cắt cứng.
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      const cloned = list.map(material => {
        const copy = material.clone();
        copy.transparent = true;
        copy.side = THREE.DoubleSide;
        if (copy instanceof THREE.MeshStandardMaterial) copy.emissiveIntensity *= .8;
        return copy;
      });
      object.material = Array.isArray(object.material) ? cloned : cloned[0];
    });
    scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, Three.AnimationAction>();
    const pulseObjects: Three.Object3D[] = [];
    root.traverse(object => { if (object.name.startsWith('Pulse')) pulseObjects.push(object); });
    for (const [name] of Object.entries(ARENA_CLIP_SECONDS)) {
      const clip = record.clips.get(name);
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      action.setLoop(name === 'idle' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.play();
      actions.set(name, action);
    }
    active = { id, root, mixer, actions, pulseObjects };
    return active;
  };

  return {
    status(id: ArenaSceneId): string {
      if (disposed || failed) return 'failed';
      return records.get(id)?.state || 'missing';
    },
    activeId(): ArenaSceneId | undefined { return active?.id; },
    /** One render per frame; returns false when no scene is ready yet. */
    draw(renderer: Three.WebGLRenderer, ctx: CanvasRenderingContext2D,
      definition: ArenaDefinition, frame: ArenaFrame): boolean {
      if (disposed || failed) return false;
      if (!(frame.width > 0) || !(frame.height > 0)) return false;
      let record = records.get(definition.id);
      if (record?.state === 'idle') record = request(definition.id);
      if (!record || record.state !== 'ready') return false;
      const current = active?.id === definition.id ? active : activate(record, definition.id);
      if (!current) return false;
      if (renderer.getContext().isContextLost()) throw new Error('Arena context lost');
      pass++;
      const sample = sampleArenaPulse(frame.pulseAge, frame.wallClock, frame.reducedMotion);
      for (const [name, action] of current.actions) {
        const wanted = name === sample.clip;
        action.enabled = wanted;
        if (wanted) action.paused = false;
      }
      // Tắt toàn bộ action cũ trước khi lấy mẫu, tránh trộn pulse vào frame idle đầu.
      const clip = record.clips!.get(sample.clip)!;
      current.mixer.setTime(sample.clip === 'idle' ? sample.seconds % clip.duration : Math.min(clip.duration, sample.seconds));
      // Đặt clip không chạy thì mixer không còn lái transform của nó: phải ẩn tay,
      // nếu không vòng pulse sẽ đứng nguyên ở pose cuối sau khi clip kết thúc.
      const pulseVisible = sample.clip === 'pulse';
      for (const object of current.pulseObjects) object.visible = pulseVisible;
      // Một world-unit trên mỗi pixel: đĩa bán kính 100 phủ đúng radiusX pixel.
      // Góc nghiêng lấy từ ellipse của frame, nên đĩa luôn khớp cả hai trục.
      const wantedElevation = elevationForEllipse(frame.radiusX, frame.radiusY);
      if (Math.abs(wantedElevation - elevation) > 1e-6) {
        elevation = wantedElevation; placeCamera();
      }
      const perPixel = AUTHORED_RADIUS / frame.radiusX;
      const shiftX = (frame.centerX - frame.width / 2) * perPixel;
      const shiftY = (frame.centerY - frame.height / 2) * perPixel;
      camera.left = -frame.width / 2 * perPixel - shiftX;
      camera.right = frame.width / 2 * perPixel - shiftX;
      camera.top = frame.height / 2 * perPixel + shiftY;
      camera.bottom = -frame.height / 2 * perPixel + shiftY;
      camera.updateProjectionMatrix();
      syncCamera();
      current.root.position.set(0, 0, 0);
      current.root.scale.setScalar(1);
      try {
        renderer.render(scene, camera);
        ctx.drawImage(renderer.domElement, 0, 0, frame.width, frame.height);
      } finally { /* Không giữ trạng thái scene giữa các frame. */ }
      return true;
    },
    /** Drops the active instance but keeps the cached template. */
    /** Screen position of a world point using the camera from the last draw. */
    project(x: number, y: number, z: number, frame: ArenaFrame): { x: number; y: number } {
      syncCamera();
      const point = new THREE.Vector3(x, y, z).project(camera);
      return { x: (point.x + 1) / 2 * frame.width, y: (1 - point.y) / 2 * frame.height };
    },
    reset(): void {
      dropActive();
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
      disposed = true; queue.length = 0; dropActive();
      for (const record of records.values()) {
        if (record.template) { disposeObject(THREE, record.template); record.template = undefined; }
        record.clips = undefined; record.state = 'idle';
      }
      scene.clear();
    },
    diagnostics() { return { pass, active: active?.id, records: [...records.values()].map(r => ({ id: r.definition.id, state: r.state })) }; },
  };
}

export type ArenaScene = ReturnType<typeof createArenaScene>;
