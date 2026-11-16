// PROTOTYPE - NOT FOR PRODUCTION
import type * as Three from 'three';
import type { SpriteEffect } from './spriteBattleEffects';
import { getSpriteBattleScale, projectSpritePosition } from './spriteBattleRenderer';

/** Presentation-only tuning; none of these values affect combat outcomes or cast speed. */
export const SPELL_STYLE = Object.freeze({
  gold: 0xffcf62, ivory: 0xfff4ce, blue: 0x70dfff,
  radius: 28, orbRadius: 7, columnHeight: 128, arcHeight: 20,
  sparks: 10, lowSparks: 4, chargeFloor: .24, impactSeconds: .42,
});
type Point = { x: number; y: number };
export interface BelindaSpellSample {
  id: number; sourceId?: string; targetId?: string; slot: 'basic' | 'active' | 'ultimate';
  phase: 'charge' | 'flight' | 'recovery' | 'impact';
  source: Point; target: Point; age: number; progress: number;
  travel: number; spin: number; arc: number; opacity: number; impact: boolean;
}

/** Pure sampling: a cast can anticipate a hit, but only a real damage record creates an impact. */
export function sampleBelindaSpell(effect: SpriteEffect & { sourceId?: string }, width: number, height: number,
  reducedMotion: boolean): BelindaSpellSample | undefined {
  if (effect.sourceHeroId !== 'belinda' || effect.support || !['cast', 'impact'].includes(effect.kind) ||
    !Number.isFinite(effect.age) || effect.age < 0 || effect.age >= effect.duration ||
    !['basic', 'active', 'ultimate'].includes(effect.skillSlot ?? '')) return;
  const impact = effect.kind === 'impact';
  if (!impact && (!effect.timeline || !effect.timeline.hits.length)) return;
  const release = (effect.timeline?.releaseMs ?? 0) / 1000;
  const contact = (effect.timeline?.hits[0]?.atMs ?? 0) / 1000;
  const phase = impact ? 'impact' : effect.age < release ? 'charge' : effect.age < contact ? 'flight' : 'recovery';
  const progress = Math.min(1, effect.age / (impact ? Math.min(effect.duration, SPELL_STYLE.impactSeconds) : effect.duration));
  // Keep a successfully replaced impact handled through its original lifetime, even after fade-out.
  // Otherwise a late Canvas2D spark would reappear after the 3D burst has faded.
  const travel = Math.max(0, Math.min(1, (effect.age - release) / Math.max(.001, contact - release)));
  return { id: effect.id, sourceId: effect.sourceId, targetId: effect.targetId,
    slot: effect.skillSlot as BelindaSpellSample['slot'], phase, impact,
    source: projectSpritePosition(effect.source.x, effect.source.y, width, height),
    target: projectSpritePosition(effect.target.x, effect.target.y, width, height),
    age: effect.age, progress, travel, spin: reducedMotion ? 0 : effect.age * 2.8,
    arc: reducedMotion ? 0 : Math.sin(travel * Math.PI) * SPELL_STYLE.arcHeight,
    opacity: impact ? (1 - progress) * .9 : phase === 'recovery' ? Math.max(0, (1 - progress) * .65) : .85,
  };
}

/** Keep the old renderer unless this exact effect was handled successfully in the current 3D pass. */
export function spellEffectsForFallback(effects: readonly SpriteEffect[], handled: ReadonlySet<number>): SpriteEffect[] {
  return effects.filter(effect => !handled.has(effect.id));
}

export interface BelindaSpellFrame {
  width: number; height: number; reducedMotion: boolean; low: boolean;
  staffAnchors: ReadonlyMap<string, Point>;
}

/** Reusable real-mesh spell scene. It borrows, never owns, the character's WebGL renderer. */
export function createBelindaSpellScene(THREE: typeof Three) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-240, 240, 340, -340, .1, 3000);
  camera.position.z = 1500;
  scene.add(new THREE.HemisphereLight(0xfff6dc, 0x294a71, .8));
  const light = new THREE.DirectionalLight(0xffe2a0, 1.8); light.position.set(-300, 450, 600); scene.add(light);
  // Shared geometry and a fixed mesh pool: no resource allocation per event, hit or frame.
  const geometries = {
    ring: new THREE.TorusGeometry(1, .026, 6, 48),
    orb: new THREE.IcosahedronGeometry(1, 1),
    ray: new THREE.CylinderGeometry(.12, 1, 1, 8, 1, true),
    spark: new THREE.OctahedronGeometry(1),
  };
  const materials = [SPELL_STYLE.gold, SPELL_STYLE.ivory, SPELL_STYLE.blue].map(color =>
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .35,
      metalness: .4, roughness: .22, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.NormalBlending }));
  const root = new THREE.Group(); scene.add(root);
  const rings = Array.from({ length: 4 }, (_, i) => new THREE.Mesh(geometries.ring, materials[i % 3]));
  const orb = new THREE.Mesh(geometries.orb, materials[1]);
  const ray = new THREE.Mesh(geometries.ray, materials[2]);
  const sparks = Array.from({ length: SPELL_STYLE.sparks }, (_, i) => new THREE.Mesh(geometries.spark, materials[i % 3]));
  root.add(...rings, orb, ray, ...sparks);
  let disposed = false;
  const point = (p: Point, frame: BelindaSpellFrame, z = 0) => new THREE.Vector3(p.x - frame.width / 2, frame.height / 2 - p.y, z);
  return {
    /** One effect at a time keeps pooling bounded. Canvas composition preserves ground/body/front ordering. */
    draw(renderer: Three.WebGLRenderer, ctx: CanvasRenderingContext2D, effect: SpriteEffect,
      layer: 'ground' | 'front', frame: BelindaSpellFrame): boolean {
      if (disposed) return false;
      const sample = sampleBelindaSpell(effect, frame.width, frame.height, frame.reducedMotion);
      if (!sample) return false;
      if (renderer.getContext().isContextLost()) throw new Error('Belinda spell context lost');
      root.children.forEach(child => { child.visible = false; });
      const scale = getSpriteBattleScale(frame.width, frame.height);
      const big = sample.slot === 'ultimate' ? 1.4 : sample.slot === 'active' ? 1.05 : .45;
      const radius = SPELL_STYLE.radius * scale * big;
      for (const material of materials) material.opacity = sample.opacity;
      const isGround = layer === 'ground';
      const staff = sample.sourceId && frame.staffAnchors.get(sample.sourceId);
      const muzzle = staff || { x: sample.source.x + (sample.target.x >= sample.source.x ? 13 : -13) * scale, y: sample.source.y - 86 * scale };
      const chest = { x: sample.target.x, y: sample.target.y - 40 * scale };
      let center: Point;
      if (sample.impact) center = isGround ? sample.target : chest;
      else if (isGround) center = sample.source;
      else if (sample.phase === 'flight') center = {
        x: muzzle.x + (chest.x - muzzle.x) * sample.travel,
        y: muzzle.y + (chest.y - muzzle.y) * sample.travel - sample.arc * scale,
      };
      else center = muzzle;
      root.position.copy(point(center, frame));
      if (isGround) {
        const count = frame.low || sample.slot === 'basic' ? 1 : 3;
        for (let i = 0; i < count; i++) {
          const mesh = rings[i]; mesh.visible = true;
          const r = radius * (1 + i * .22) * (sample.impact ? .65 + sample.progress : .8 + sample.progress * .2);
          mesh.scale.setScalar(r); mesh.position.set(0, 0, i * 2);
          mesh.rotation.set(1.06, .08, sample.spin * (i % 2 ? -1 : 1));
        }
      } else if (sample.impact) {
        const count = frame.low || frame.reducedMotion ? SPELL_STYLE.lowSparks : SPELL_STYLE.sparks;
        const spread = radius * (1 + sample.progress * 1.2);
        orb.visible = true; orb.scale.setScalar((1 - sample.progress) * radius * .42);
        orb.position.set(0, 0, 4); orb.rotation.set(sample.spin, sample.spin, 0);
        for (let i = 0; i < count; i++) {
          const a = i / count * Math.PI * 2;
          const mesh = sparks[i]; mesh.visible = true;
          mesh.position.set(Math.cos(a) * spread, Math.sin(a) * spread * .7, Math.sin(a * 2) * radius * .5);
          mesh.scale.set(2 * scale, (sample.slot === 'ultimate' ? 10 : 5) * scale * (1 - sample.progress), 2 * scale);
          mesh.rotation.set(a, sample.spin, -a);
        }
        if (sample.slot === 'ultimate') {
          ray.visible = true;
          const h = SPELL_STYLE.columnHeight * scale * (frame.reducedMotion ? .65 : 1);
          ray.scale.set(radius * .22 * (1 - sample.progress), h, radius * .22 * (1 - sample.progress));
          ray.position.set(0, h / 2 - 40 * scale, -8); ray.rotation.set(0, sample.spin, 0);
          rings[3].visible = true; rings[3].scale.setScalar(radius * (1 + sample.progress * .4));
          rings[3].position.set(0, h * .65 - 40 * scale, 0); rings[3].rotation.set(1.1, .2, -sample.spin);
        }
      } else {
        orb.visible = sample.phase !== 'recovery';
        const charge = sample.phase === 'charge' ? SPELL_STYLE.chargeFloor + sample.progress : 1;
        orb.scale.setScalar(SPELL_STYLE.orbRadius * scale * big * charge);
        orb.position.set(0, 0, 4); orb.rotation.set(sample.spin, sample.spin * .6, sample.spin);
        const count = frame.low || sample.slot === 'basic' ? 1 : 3;
        if (sample.phase === 'flight') {
          const trailCount = frame.low || frame.reducedMotion ? SPELL_STYLE.lowSparks : SPELL_STYLE.sparks;
          for (let i = 0; i < trailCount; i++) {
            const mesh = sparks[i], lag = (i + 1) / trailCount * .24;
            const t = Math.max(0, sample.travel - lag);
            mesh.visible = true;
            const trail = { x: muzzle.x + (chest.x - muzzle.x) * t,
              y: muzzle.y + (chest.y - muzzle.y) * t - (frame.reducedMotion ? 0 : Math.sin(t * Math.PI) * SPELL_STYLE.arcHeight * scale) };
            mesh.position.set(trail.x - center.x, center.y - trail.y, 3 + Math.sin(i) * 5);
            mesh.scale.setScalar((1 - i / trailCount) * 2.4 * scale * big);
            mesh.rotation.set(sample.spin + i, i, -sample.spin);
          }
        }
        for (let i = 0; i < count && sample.phase !== 'recovery'; i++) {
          const mesh = rings[i]; mesh.visible = true;
          mesh.scale.setScalar(radius * (.45 + i * .17));
          mesh.position.set(0, 0, i * 5);
          mesh.rotation.set(.4 + i * .7, .45 + i * .4, sample.spin * (i % 2 ? -1 : 1));
        }
      }
      camera.left = -frame.width / 2; camera.right = frame.width / 2;
      camera.top = frame.height / 2; camera.bottom = -frame.height / 2; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      ctx.drawImage(renderer.domElement, 0, 0, frame.width, frame.height);
      return true;
    },
    /** Geometry/material ownership stays here; renderer lifetime remains with the character backend. */
    dispose() {
      if (disposed) return; disposed = true;
      Object.values(geometries).forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose()); root.clear(); scene.clear();
    },
  };
}
