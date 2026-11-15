// PROTOTYPE - NOT FOR PRODUCTION
import * as THREE from 'three';
import type { HeroDefinition } from './types';

/** Flat identity portrait for heroes without an authored atlas; never a 3D body. */
export function createBattlePortrait(hero: HeroDefinition) {
  const pixels = new Uint8Array(16 * 24 * 4);
  const color = new THREE.Color(hero.visual.primaryColor);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) {
    const head = (x - 7.5) ** 2 + (y - 5) ** 2 < 13;
    const body = y >= 9 && y < 22 && Math.abs(x - 7.5) < (y < 16 ? 5 : 3);
    if (!head && !body) continue;
    const i = (y * 16 + x) * 4;
    pixels.set([Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255), 255], i);
  }
  const placeholder = new THREE.DataTexture(pixels, 16, 24);
  placeholder.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: placeholder, transparent: true,
    alphaTest: 0.03, depthWrite: false, toneMapped: false, fog: false });
  const object = new THREE.Sprite(material);
  object.name = `portrait_${hero.id}`;
  object.center.set(0.5, 0);
  object.position.y = 0.04;
  object.scale.set(1.5, 2.25, 1);
  let disposed = false;
  let image: THREE.Texture | undefined;
  if (typeof document !== 'undefined') {
    image = new THREE.TextureLoader().load(hero.battleUrl || `/assets/heroes/${hero.id}_battle.webp`, texture => {
      if (disposed) return;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      material.map = texture;
      material.needsUpdate = true;
    }, undefined, () => { /* Keep the flat placeholder when local artwork is unavailable. */ });
  }
  return { object, dispose() {
    if (disposed) return;
    disposed = true;
    object.removeFromParent();
    material.dispose(); placeholder.dispose(); image?.dispose();
  } };
}
