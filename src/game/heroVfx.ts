// PROTOTYPE - NOT FOR PRODUCTION
import type { SpriteEffect } from './spriteBattleEffects';
import { OATHBOUND_HEROES } from './oathboundHeroes';
import authoredEffects from '../../tools/hero-vfx.json';

/**
 * Blender-authored skill effects. Each enabled hero owns one GLB whose clips are
 * baked by `tools/build-vfx.py`; this module only decides WHICH clip plays and
 * how far, so combat outcomes and timing stay owned by the simulation.
 */
export type VfxClip = 'basic' | 'active' | 'ultimate' | 'impact';

/** Authored clip lengths; `tools/build-vfx.py` asserts the exported GLB matches. */
export const VFX_CLIP_SECONDS: Readonly<Record<VfxClip, number>> = Object.freeze({
  basic: .4, active: 1.15, ultimate: 1.65, impact: .45,
});

export const VFX_STYLE = Object.freeze({
  radius: 34, arcHeight: 22, chargeFloor: .24, flightOpacity: .9, impactSeconds: .45, maxPerLayer: 8,
});

export interface HeroVfxDefinition {
  readonly heroId: string;
  readonly sourceId: string;
  readonly url: string;
}

/** Cùng manifest cho Blender và runtime; prebuild kiểm tra asset/source thật. */
const authoredByHero = new Map(authoredEffects.map(spec => [spec.heroId, spec]));

export const HERO_VFX_DEFINITIONS: readonly HeroVfxDefinition[] = Object.freeze(
  OATHBOUND_HEROES.filter(hero => authoredByHero.has(hero.heroId)).map(hero => Object.freeze({
    heroId: hero.heroId,
    sourceId: hero.sourceId,
    url: `/assets/vfx/${authoredByHero.get(hero.heroId)!.id}.glb`,
  })),
);

const byHeroId = new Map(HERO_VFX_DEFINITIONS.map(definition => [definition.heroId, definition]));

/** Resolves by stable runtime hero id, never by display name. */
export function getHeroVfx(heroId: string): HeroVfxDefinition | undefined {
  return byHeroId.get(heroId);
}

/** Damage alone owns this burst; heal/shield/control keep their semantic Canvas art. */
const OUTCOME_KINDS = new Set<SpriteEffect['kind']>(['impact']);

export type VfxPhase = 'charge' | 'flight' | 'recovery' | 'impact';
type Point = { x: number; y: number };

export interface HeroVfxSample {
  id: number;
  heroId: string;
  sourceId: string;
  sourceInstanceId?: string;
  support: boolean;
  clip: VfxClip;
  slot: 'basic' | 'active' | 'ultimate';
  phase: VfxPhase;
  /** Wall-clock age of the effect in seconds, already advanced by the battle clock. */
  age: number;
  /** 0..1 inside the selected clip. */
  progress: number;
  /** 0..1 of the cast's release → contact window; 1 once contact has happened. */
  travel: number;
  opacity: number;
  spin: number;
  grounded: boolean;
  source: Point;
  target: Point;
  /** Presentation-only scale multiplier; never feeds damage or cooldown. */
  magnitude: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothProgress(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function clipForEffect(effect: SpriteEffect): VfxClip | undefined {
  if (OUTCOME_KINDS.has(effect.kind)) return 'impact';
  if (effect.kind !== 'cast') return undefined;
  return effect.skillSlot === 'basic' || effect.skillSlot === 'active' || effect.skillSlot === 'ultimate'
    ? effect.skillSlot : undefined;
}

/**
 * Pure sampling of one effect into a clip request. Returns undefined for heroes
 * without a Blender effect, for stale ages, and for effects Canvas2D still owns.
 */
export function sampleHeroVfx(effect: SpriteEffect & { sourceId?: string }, width: number, height: number,
  reducedMotion: boolean): HeroVfxSample | undefined {
  const definition = getHeroVfx(effect.sourceHeroId);
  const clip = clipForEffect(effect);
  if (!definition || !clip) return;
  if (!Number.isFinite(effect.age) || effect.age < 0 || !Number.isFinite(effect.duration) || effect.duration <= 0) return;
  if (effect.age >= effect.duration) return;
  const impact = clip === 'impact';
  if (!impact && !effect.support && !effect.timeline && effect.skillSlot === undefined) return;
  const duration = impact ? Math.min(effect.duration, VFX_STYLE.impactSeconds) : effect.duration;
  const progress = clamp(effect.age / Math.max(.001, duration), 0, 1);
  // A cast can anticipate contact, but only a real outcome record produces a burst.
  const release = effect.timeline ? effect.timeline.releaseMs / 1000 : effect.duration * .24;
  const contact = effect.timeline?.hits[0]?.atMs !== undefined ? effect.timeline.hits[0].atMs / 1000 : effect.duration * .52;
  const phase: VfxPhase = impact ? 'impact'
    : effect.age < release ? 'charge' : effect.age < contact ? 'flight' : 'recovery';
  const travel = impact ? 1 : clamp((effect.age - release) / Math.max(.001, contact - release), 0, 1);
  const slot = effect.skillSlot === 'basic' || effect.skillSlot === 'ultimate' ? effect.skillSlot : 'active';
  const magnitude = impact ? (slot === 'ultimate' || effect.ultimate ? 1.15 : slot === 'basic' ? .7 : .95)
    : slot === 'ultimate' ? 1.55 : slot === 'active' ? 1.1 : .5;
  return {
    id: effect.id, heroId: effect.sourceHeroId, sourceId: definition.sourceId,
    sourceInstanceId: effect.sourceId, support: effect.support, clip, slot, phase,
    age: effect.age, progress, travel,
    opacity: impact ? (1 - progress) * .95
      : phase === 'recovery' ? VFX_STYLE.flightOpacity * (1 - smoothProgress(
        (effect.age - contact) / Math.max(.001, effect.duration - contact)))
        : phase === 'charge' ? VFX_STYLE.chargeFloor
          + (VFX_STYLE.flightOpacity - VFX_STYLE.chargeFloor) * smoothProgress(effect.age / Math.max(.001, release))
          : VFX_STYLE.flightOpacity,
    spin: reducedMotion ? 0 : effect.age * 2.6,
    grounded: impact || phase === 'charge',
    source: { x: effect.source.x, y: effect.source.y },
    target: { x: effect.target.x, y: effect.target.y },
    magnitude,
  };
}

function priority(sample: HeroVfxSample): number {
  return (sample.slot === 'ultimate' ? 30 : sample.slot === 'active' ? 20 : 10) + (sample.phase === 'impact' ? 5 : 0);
}

/**
 * Bounded per-layer batch: the newest, most expensive casts win the 3D pass and
 * everything else stays with Canvas2D, so a five-hero ultimate stack cannot
 * allocate an unbounded number of effect instances in one frame.
 */
export function sampleVfxBatch(effects: readonly SpriteEffect[], width: number, height: number,
  reducedMotion: boolean, limit: number = VFX_STYLE.maxPerLayer): HeroVfxSample[] {
  const samples: HeroVfxSample[] = [];
  for (const effect of effects) {
    const sample = sampleHeroVfx(effect, width, height, reducedMotion);
    if (sample) samples.push(sample);
  }
  samples.sort((a, b) => priority(b) - priority(a) || b.id - a.id);
  return samples.slice(0, Math.max(0, limit));
}

/** A handled id must be identical in every layer pass before Canvas2D yields it. */
export function vfxEffectsForFallback(effects: readonly SpriteEffect[], handled: ReadonlySet<number>): SpriteEffect[] {
  return effects.filter(effect => !handled.has(effect.id));
}
