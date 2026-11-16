// PROTOTYPE - NOT FOR PRODUCTION
import { getSpriteFrame, resolveSpriteClip, type OathboundSpriteSpec } from './oathboundSprites';
import presentation from './spritePresentation.json';
import type { BattleUnitRuntime, CombatTimeline } from './types';
import { getTimelineVisualPhase } from './skillTimelines';

export type SpriteActionStyle = Exclude<keyof typeof presentation.action.choreography, 'anticipationEnd' | 'releaseEnd'>;

export interface SpriteActor {
  clip: string;
  age: number;
  action: string;
  actionRemaining: number;
  flash: number;
  actionKind: 'basic' | 'skill' | 'ultimate' | 'hit' | '';
  actionDuration: number;
  actionStyle?: SpriteActionStyle;
  timeline?: CombatTimeline;
}

/** Selects distinct authored skill rows when available; static sources retain their real fallback. */
export function selectSpriteActionClip(spec: OathboundSpriteSpec | undefined, kind: SpriteActor['actionKind'], shape = '', preferredClip?: string): string {
  if (kind === 'basic') return 'attack';
  if (kind === 'hit') return 'hit';
  if (!spec) return 'skill';
  if (preferredClip && spec.clips[preferredClip]) return preferredClip;
  const names = Object.keys(spec.clips).filter(name => /^skill[A-Z]/.test(name) && spec.clips[name].count > 1);
  const preferred = kind === 'ultimate' ? names.at(-1) :
    names.find(name => shape === 'nova' && /Aura|Shield|Dome/.test(name)) || names[0];
  return preferred || 'skill';
}

/** Starts a visible action without allowing basic/hit events to interrupt a skill's authored frames. */
export function startSpriteAction(actor: SpriteActor, kind: Exclude<SpriteActor['actionKind'], ''>, spec?: OathboundSpriteSpec, shape = '', style?: SpriteActionStyle, preferredClip?: string, timeline?: CombatTimeline): boolean {
  const priority = { '': 0, hit: 0, basic: 1, skill: 2, ultimate: 3 };
  if (actor.actionRemaining > 0 && priority[kind] < priority[actor.actionKind]) return false;
  if (kind === 'hit' && actor.actionRemaining > 0) return false;
  const clip = selectSpriteActionClip(spec, kind, shape, preferredClip);
  const authored = spec?.clips[resolveSpriteClip(spec, clip)];
  const minimum = kind === 'ultimate' ? presentation.action.ultimateSeconds : kind === 'skill' ? presentation.action.skillSeconds :
    kind === 'hit' ? presentation.action.hitSeconds : presentation.action.basicSeconds;
  actor.action = clip; actor.clip = clip; actor.age = 0; actor.actionKind = kind;
  actor.actionStyle = kind === 'skill' || kind === 'ultimate' ? style : undefined;
  actor.timeline = timeline;
  actor.actionDuration = actor.actionRemaining = timeline ? timeline.durationMs / 1000 :
    Math.max(minimum, authored ? authored.count / authored.fps : 0);
  return true;
}

/** Cosmetic recoil/lunge only: simulation position and sorting remain unchanged. */
export function getSpriteActionPose(actor: SpriteActor, facing: number, reducedMotion: boolean) {
  if (reducedMotion || actor.actionRemaining <= 0 || !actor.actionDuration) return { x: 0, y: 0, rotation: 0, scale: 1 };
  const progress = actor.timeline ? getTimelineVisualPhase(actor.timeline, actor.age) : Math.min(1, actor.age / actor.actionDuration);
  const pulse = Math.sin(Math.PI * progress);
  const ultimate = actor.actionKind === 'ultimate';
  if (actor.actionStyle && (actor.actionKind === 'skill' || ultimate)) {
    const choreography = presentation.action.choreography;
    const style = choreography[actor.actionStyle];
    const neutral = [0, 0, 0, 1];
    const [from, to, fraction]: [number[], number[], number] = progress < choreography.anticipationEnd ?
      [neutral, style.anticipation, progress / choreography.anticipationEnd] : progress < choreography.releaseEnd ?
      [style.anticipation, style.release, (progress - choreography.anticipationEnd) / (choreography.releaseEnd - choreography.anticipationEnd)] :
      [style.release, neutral, (progress - choreography.releaseEnd) / (1 - choreography.releaseEnd)];
    const blend = fraction * fraction * (3 - 2 * fraction);
    const values = from.map((value, index) => value + (to[index] - value) * blend);
    const strength = ultimate ? 1 + presentation.action.ultimateScale : 1;
    return { x: facing * values[0] * presentation.action.lungePixels * strength,
      y: values[1] * strength, rotation: facing * values[2] * strength,
      scale: 1 + (values[3] - 1) * strength };
  }
  return {
    x: facing * pulse * presentation.action.lungePixels * (actor.actionKind === 'hit' ? -0.3 : ultimate ? 1 : 0.6),
    y: -pulse * (ultimate ? 7 : 2),
    rotation: facing * pulse * (actor.actionKind === 'basic' ? 0.07 : -0.025),
    scale: 1 + pulse * (ultimate ? presentation.action.ultimateScale : 0.025),
  };
}

/** Independent animation lifetime for one combatant, including repeated identities. */
export function createSpriteActor(_unit: BattleUnitRuntime): SpriteActor {
  return { clip: 'idle', age: 0, action: '', actionRemaining: 0, flash: 0, actionKind: '', actionDuration: 0 };
}

/** Advances authored frame clocks, without inventing movement for missing source clips. */
export function advanceSpriteActor(actor: SpriteActor, unit: BattleUnitRuntime, seconds: number): void {
  const dt = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const controlled = unit.isAlive && unit.statusEffects.some(s => s.type === 'stun' || s.type === 'petrify' || s.type === 'isolation');
  actor.flash = Math.max(0, actor.flash - dt);
  if (controlled) return;
  const clip = !unit.isAlive || unit.hp <= 0 ? 'death' : actor.actionRemaining > 0 ? actor.action :
    unit.lastActionType === 'move' ? 'run' : 'idle';
  if (clip !== actor.clip) { actor.clip = clip; actor.age = 0; }
  else actor.age += dt;
  actor.actionRemaining = Math.max(0, actor.actionRemaining - dt);
}

/** Resolves the visible floor palette independently from combat rules. */
export function resolveSpriteArena(theme: string, override?: 'auto' | 'enchanted_forest' | 'celestial_temple' | 'shadow_realm'): 'forest' | 'shadow' | 'temple' {
  if (override === 'enchanted_forest') return 'forest';
  if (override === 'shadow_realm') return 'shadow';
  if (override === 'celestial_temple') return 'temple';
  return theme === 'sylvan' ? 'forest' : theme === 'catacombs' || theme === 'obsidian' ? 'shadow' : 'temple';
}

/** Maps simulation coordinates to a portrait 2D battlefield; no camera or 3D projection. */
export function projectSpritePosition(x: number, y: number, width: number, height: number) {
  return { x: width * (0.1 + x / 1000 * 0.8), y: height * 0.37 + (y - 140) / 300 * height * 0.32 };
}

/** Shared 140% character scale for sprites, portraits, overlays and pointer targets. */
export function getSpriteBattleScale(width: number, height: number): number {
  return presentation.characterScale * Math.min(width / 480, height / 680);
}

/** Draws a cropped source frame at its foot anchor using Oathbound-style Canvas2D transforms. */
export function drawSpriteActor(
  ctx: CanvasRenderingContext2D, actor: SpriteActor, unit: BattleUnitRuntime,
  spec: OathboundSpriteSpec, image: HTMLImageElement, x: number, y: number, scale: number,
): void {
  const frame = getSpriteFrame(spec, actor.clip, actor.age, false);
  const width = (spec.sourceId === 'lancer' ? 108 : 96) * scale;
  const height = width * frame.height / frame.width;
  const mirrored = (spec.facing === 'left') !== (unit.facing < 0);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(mirrored ? -1 : 1, 1);
  const staticDefeat = (!unit.isAlive || unit.hp <= 0) &&
    spec.clips[resolveSpriteClip(spec, 'death')].count === 1;
  // A static reference has no authored fall: mark it defeated without fabricating frames.
  if (staticDefeat) ctx.globalAlpha *= presentation.action.staticDefeatOpacity;
  if (staticDefeat || unit.statusEffects.some(s => s.type === 'petrify')) ctx.filter = 'grayscale(1)';
  else if (actor.flash > 0) ctx.filter = 'brightness(1.65)';
  ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height,
    -spec.anchorX / spec.cellWidth * width, -(1 - frame.centerY) * height,
    width, height);
  ctx.restore();
}
