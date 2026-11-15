// PROTOTYPE - NOT FOR PRODUCTION
import * as THREE from 'three';
import { getSpriteFrame, resolveSpriteClip, type OathboundSpriteSpec } from './oathboundSprites';

export interface OathboundThreeSprite {
  object: THREE.Sprite;
  update: (clip: string, dt: number, facing: number, flash: boolean, petrified: boolean) => void;
  duration: (clip: string) => number;
  restart: () => void;
  dispose: () => void;
}

/** Creates one independently animated billboard; asynchronous failures retain the fallback rig. */
export function createOathboundThreeSprite(
  spec: OathboundSpriteSpec,
  fallback: THREE.Object3D,
): OathboundThreeSprite {
  let disposed = false;
  let ready = false;
  let clip = 'idle';
  let age = 0;
  let lastFrame = '';
  const material = new THREE.SpriteMaterial({
    transparent: true, alphaTest: 0.03, depthWrite: false, toneMapped: false, fog: false,
  });
  const object = new THREE.Sprite(material);
  object.name = `oathbound_${spec.sourceId}`;
  object.position.y = 0.04;
  object.visible = false;
  // Each rig owns UV state and its texture. Browser image caching avoids duplicate downloads.
  const texture = typeof document === 'undefined' ? new THREE.Texture() : new THREE.TextureLoader().load(spec.src, loaded => {
    if (disposed) { loaded.dispose(); return; }
    ready = true;
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.magFilter = THREE.LinearFilter;
    loaded.minFilter = THREE.LinearFilter;
    loaded.generateMipmaps = false;
    loaded.wrapS = THREE.ClampToEdgeWrapping;
    loaded.wrapT = THREE.ClampToEdgeWrapping;
    // Visibility changes in update only, after frame UVs and ground anchors are set.
  }, undefined, () => {
    if (!disposed) { fallback.visible = true; object.visible = false; }
  });
  material.map = texture;

  return {
    object,
    duration(requested) {
      const clip = spec.clips[resolveSpriteClip(spec, requested)];
      return clip.count / clip.fps;
    },
    restart() { age = 0; lastFrame = ''; },
    update(requested, dt, facing, flash, petrified) {
      if (disposed) return;
      const next = resolveSpriteClip(spec, requested);
      if (next !== clip) { clip = next; age = 0; }
      else age += Number.isFinite(dt) ? Math.max(0, dt) : 0;
      if (!ready) return;
      const mirrored = (spec.facing === 'left') !== (facing < 0);
      const frame = getSpriteFrame(spec, clip, age, mirrored);
      const key = `${clip}:${frame.index}:${mirrored}`;
      if (key !== lastFrame) {
        lastFrame = key;
        texture.repeat.set(frame.repeatX, frame.repeatY);
        texture.offset.set(frame.offsetX, frame.offsetY);
        texture.updateMatrix();
        object.center.set(frame.centerX, frame.centerY);
        // Normalize by the actual cell width: Estrilda's 181px cells must not
        // be shrunk again against the other heroes' 256px atlas convention.
        const width = spec.sourceId === 'lancer' ? 2.8 : 2.65;
        object.scale.set(width, width * frame.height / frame.width, 1);
      }
      fallback.visible = false;
      object.visible = true;
      material.color.setHex(petrified ? 0x94a3b8 : flash ? 0xffb2ad : 0xffffff);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      material.dispose();
      texture.dispose();
    },
  };
}
