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
  /** Tổng độ sáng cộng dồn cho một lớp; vượt ngưỡng thì giảm đều thay vì cháy trắng. */
  brightnessBudget: 3.6,
});

export interface HeroVfxDefinition {
  readonly heroId: string;
  readonly sourceId: string;
  readonly url: string;
  readonly directional: boolean;
  /** Hào quang nở tại chỗ, đòn chém xảy ra tại mục tiêu, đạn bay qua sân. */
  readonly travelMode: VfxTravelMode;
}

export type VfxTravelMode = 'projectile' | 'melee' | 'aura';

/** Chia theo họ chiêu đã tác giả trong manifest, không đoán theo tên tướng. */
const TRAVEL_BY_FAMILY: Readonly<Record<string, VfxTravelMode | undefined>> = Object.freeze({
  gunfire: 'projectile', volley: 'projectile', lance: 'projectile',
  strike: 'melee',
  sigil: 'aura', bloom: 'aura', storm: 'aura',
});

/** Cùng manifest cho Blender và runtime; prebuild kiểm tra asset/source thật. */
const authoredByHero = new Map(authoredEffects.map(spec => [spec.heroId, spec]));

export const HERO_VFX_DEFINITIONS: readonly HeroVfxDefinition[] = Object.freeze(
  OATHBOUND_HEROES.filter(hero => authoredByHero.has(hero.heroId)).map(hero => Object.freeze({
    heroId: hero.heroId,
    sourceId: hero.sourceId,
    url: `/assets/vfx/${authoredByHero.get(hero.heroId)!.id}.glb`,
    directional: ['gunfire', 'volley', 'strike', 'lance'].includes(authoredByHero.get(hero.heroId)!.family),
    travelMode: TRAVEL_BY_FAMILY[authoredByHero.get(hero.heroId)!.family] ?? 'aura',
  })),
);

const byHeroId = new Map(HERO_VFX_DEFINITIONS.map(definition => [definition.heroId, definition]));

/** Resolves by stable runtime hero id, never by display name. */
export function getHeroVfx(heroId: string): HeroVfxDefinition | undefined {
  return byHeroId.get(heroId);
}

/**
 * Màu nhận diện của hiệu ứng (`primary` trong manifest), dùng cho sân khi tuyệt kỹ
 * vừa tung: vòng sáng dưới sàn đổi theo màu chiêu thay vì chỉ theo theme.
 * Trả `undefined` cho tướng không có GLB hiệu ứng.
 */
export function heroVfxTint(heroId: string): number | undefined {
  const spec = authoredByHero.get(heroId);
  if (!spec || typeof spec.primary !== 'string' || !/^[0-9a-f]{6}$/i.test(spec.primary)) return undefined;
  return Number.parseInt(spec.primary, 16) & 0xffffff;
}

/** Bảng ba màu của hiệu ứng, đọc cùng manifest; dùng để nhuộm riêng cú tuyệt kỹ. */
export interface HeroVfxPalette { readonly primary: number; readonly accent: number }

const paletteOf = (value: unknown): number | undefined =>
  typeof value === 'string' && /^[0-9a-f]{6}$/i.test(value) ? Number.parseInt(value, 16) & 0xffffff : undefined;

export function heroVfxPalette(heroId: string): HeroVfxPalette | undefined {
  const spec = authoredByHero.get(heroId);
  if (!spec) return undefined;
  const primary = paletteOf(spec.primary), accent = paletteOf(spec.accent);
  if (primary === undefined) return undefined;
  return Object.freeze({ primary, accent: accent ?? primary });
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
  directional: boolean;
  travelMode: VfxTravelMode;
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
  /** Per-sample dimmer set by the batch; 1 while the layer fits its light budget. */
  brightness: number;
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
  // Hào quang ở lại quanh người niệm; đòn chém đã ở mục tiêu; chỉ đạn/thương/tên mới bay.
  const flight = clamp((effect.age - release) / Math.max(.001, contact - release), 0, 1);
  const travel = impact ? 1 : definition.travelMode === 'aura' ? 0
    : definition.travelMode === 'melee' ? 1 : flight;
  const slot = effect.skillSlot === 'basic' || effect.skillSlot === 'ultimate' ? effect.skillSlot : 'active';
  const base = impact ? (slot === 'ultimate' || effect.ultimate ? 1.15 : slot === 'basic' ? .7 : .95)
    : slot === 'ultimate' ? 1.55 : slot === 'active' ? 1.1 : .5;
  // Burst punches out from the contact point, then settles; a flight path keeps one size.
  const magnitude = impact ? base * (1 + .75 * Math.sin(progress * Math.PI / 2)) : base;
  return {
    id: effect.id, heroId: effect.sourceHeroId, sourceId: definition.sourceId,
    sourceInstanceId: effect.sourceId, support: effect.support, directional: definition.directional,
    travelMode: definition.travelMode, clip, slot, phase,
    age: effect.age, progress, travel,
    opacity: impact ? .95 * Math.pow(1 - progress, 2)
      : phase === 'recovery' ? VFX_STYLE.flightOpacity * (1 - smoothProgress(
        (effect.age - contact) / Math.max(.001, effect.duration - contact)))
        : phase === 'charge' ? VFX_STYLE.chargeFloor
          + (VFX_STYLE.flightOpacity - VFX_STYLE.chargeFloor) * smoothProgress(effect.age / Math.max(.001, release))
          : VFX_STYLE.flightOpacity,
    brightness: 1,
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

/** Additive light adds up by covered area, so area (magnitude²) weights the cost. */
export function vfxLightEnergy(sample: HeroVfxSample): number {
  return sample.opacity * sample.magnitude * sample.magnitude * sample.brightness;
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
  const kept = samples.slice(0, Math.max(0, limit));
  // Additive layers stack; past the budget every sample dims evenly instead of blowing out to white.
  const energy = kept.reduce((sum, entry) => sum + vfxLightEnergy(entry), 0);
  const scale = energy > VFX_STYLE.brightnessBudget ? VFX_STYLE.brightnessBudget / energy : 1;
  return scale < 1 ? kept.map(entry => ({ ...entry, brightness: scale })) : kept;
}

/** A handled id must be identical in every layer pass before Canvas2D yields it. */
export function vfxEffectsForFallback(effects: readonly SpriteEffect[], handled: ReadonlySet<number>): SpriteEffect[] {
  return effects.filter(effect => !handled.has(effect.id));
}
