// PROTOTYPE - NOT FOR PRODUCTION
import type { BattleUnitRuntime, CombatEvent, HeroSkillSpec, SkillTargetType } from './types';
import { projectSpritePosition } from './spriteBattleRenderer';
import presentation from './spritePresentation.json';
import { drawSpriteSkillArt, getSpriteSkillArt } from './spriteSkillArt';

export interface SpriteEffect {
  id: number;
  sourceHeroId: string;
  sourceTeam: BattleUnitRuntime['team'];
  kind: 'cast' | 'impact' | 'heal' | 'shield' | 'control' | 'death';
  shape: HeroSkillSpec['vfxShape'];
  color: string;
  ultimate: boolean;
  basic: boolean;
  skillSlot?: CombatEvent['skillSlot'];
  support: boolean;
  /** Actual stat-support outcome; a buff is not evidence of shield HP. */
  supportBuff?: CombatEvent['buffType'];
  recovery?: 'lifesteal';
  /** Applied control from the actual outcome event, never inferred from a cast name. */
  ccType?: CombatEvent['ccType'];
  age: number;
  duration: number;
  source: { x: number; y: number };
  target: { x: number; y: number };
  /** Actual recipient identity for body-depth ordering; older effects without it stay in front. */
  targetId?: string;
}

/** Resolves presentation targets from cast outcomes rather than incidental self-support events. */
export function resolveSpriteEffectTarget(event: CombatEvent, entries: readonly CombatEvent[], units: readonly BattleUnitRuntime[], source: BattleUnitRuntime,
  targetType: SkillTargetType): BattleUnitRuntime {
  const casts = ['basic_attack', 'active_skill', 'ultimate_cast'];
  if (!casts.includes(event.type)) return units.find(u => u.instanceId === event.targetId) || source;
  const support = ['all_allies', 'lowest_hp_ally', 'self'].includes(targetType);
  const nextCast = entries.find(e => e.id > event.id && e.sourceId === event.sourceId && casts.includes(e.type));
  const outcomes = entries.filter(e => e.sourceId === event.sourceId && e.targetId && !casts.includes(e.type) &&
    (event.castId !== undefined ? e.castId === event.castId :
      e.id > event.id && (!nextCast || e.id < nextCast.id) && e.skillName === event.skillName));
  const result = outcomes.find(e => support ? ['heal', 'shield', 'buff'].includes(e.type) : ['damage', 'crowd_control', 'knockback'].includes(e.type));
  if (result) return units.find(u => u.instanceId === result.targetId) || source;
  if (support) return targetType === 'lowest_hp_ally' ?
    units.filter(u => u.isAlive && u.team === source.team).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] || source : source;
  return units.find(u => u.instanceId === (event.targetId || source.targetInstanceId)) || source;
}

/** Advances a cosmetic timeline only while unpaused; finite clocks drive shake and banners too. */
export function advancePresentationClock(clock: number, seconds: number, paused: boolean): number {
  return clock + (paused || !Number.isFinite(seconds) ? 0 : Math.max(0, seconds));
}

/** Builds purely cosmetic effects from real combat events; never invents damage or targets. */
export function createSpriteEffect(event: CombatEvent, source: BattleUnitRuntime, target: BattleUnitRuntime): SpriteEffect | undefined {
  const cast = ['basic_attack', 'active_skill', 'ultimate_cast'].includes(event.type);
  const kind: SpriteEffect['kind'] | undefined = cast ? 'cast' : event.type === 'damage' ? 'impact' :
    event.type === 'heal' ? 'heal' : event.type === 'shield' || event.type === 'buff' ? 'shield' :
    event.type === 'crowd_control' ? 'control' : event.type === 'death' ? 'death' : undefined;
  if (!kind) return;
  const skillSlot = event.type === 'ultimate_cast' ? 'ultimate' : event.type === 'active_skill' ? 'active' :
    event.type === 'basic_attack' ? 'basic' : event.skillSlot;
  const ultimate = skillSlot === 'ultimate', basic = skillSlot === 'basic';
  const support = kind === 'heal' || kind === 'shield' || (cast && source.team === target.team);
  const recovery = event.type === 'heal' && event.skillName === 'Lifesteal' && source.instanceId === target.instanceId &&
    Number.isFinite(event.value) && event.value! > 0 ? 'lifesteal' : undefined;
  const duration = recovery ? presentation.effects.recoverySeconds : cast ? ultimate ? presentation.effects.ultimateSeconds : basic ? presentation.effects.basicSeconds : presentation.effects.skillSeconds :
    kind === 'impact' ? presentation.effects.impactSeconds : presentation.effects.supportSeconds;
  return { id: event.id, sourceHeroId: source.heroId, sourceTeam: source.team, kind, shape: event.vfxShape || (source.isRanged ? 'arrow' : 'slash'),
    color: kind === 'heal' ? '#6dffc2' : kind === 'shield' ? '#9edfff' : event.vfxColor || '#ffdc84',
    ultimate, basic, skillSlot, support, supportBuff: event.type === 'buff' ? event.buffType : undefined,
    recovery, ccType: event.type === 'crowd_control' ? event.ccType : undefined,
    age: 0, duration, source: { x: source.x, y: source.y }, target: { x: target.x, y: target.y }, targetId: target.instanceId };
}

/** Reports live allied active casts, optionally restricted to a normalized [start, end) phase. */
export function getActiveSkillSources(effects: readonly SpriteEffect[], phaseWindow: readonly [number, number] = [0, 1]): string[] {
  return [...new Set(effects.filter(effect => effect.sourceTeam === 'ally' && effect.kind === 'cast' && effect.skillSlot === 'active' &&
    Number.isFinite(effect.age) && Number.isFinite(effect.duration) && effect.duration > 0 && effect.age > 0 && effect.age < effect.duration &&
    effect.age / effect.duration >= phaseWindow[0] && effect.age / effect.duration < phaseWindow[1])
    .map(effect => effect.sourceHeroId))];
}

/** Reports only live allied active-skill damage accents, never casts or support feedback. */
export function getActiveImpactSources(effects: readonly SpriteEffect[]): string[] {
  return [...new Set(effects.filter(effect => effect.sourceTeam === 'ally' && effect.kind === 'impact' &&
    effect.skillSlot === 'active' && !effect.support && !effect.basic && !effect.ultimate &&
    Number.isFinite(effect.age) && Number.isFinite(effect.duration) && effect.duration > 0 &&
    effect.age > 0 && effect.age < effect.duration).map(effect => effect.sourceHeroId))];
}

/** Paused/nonfinite time cannot advance effects; completed entries are removed in place. */
export function advanceSpriteEffects(effects: SpriteEffect[], seconds: number): void {
  const dt = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  for (let i = effects.length - 1; i >= 0; i--) {
    effects[i].age += dt;
    if (effects[i].age >= effects[i].duration) effects.splice(i, 1);
  }
}

/** Draws battle bodies and spell passes without advancing their simulation or cosmetic clocks. */
export function drawSpriteBattleLayers(units: readonly BattleUnitRuntime[], effects: readonly SpriteEffect[], reducedMotion: boolean,
  drawBody: (unit: BattleUnitRuntime) => void,
  drawEffects: (batch: readonly SpriteEffect[], layer: 'ground' | 'front') => void): void {
  drawEffects(effects, 'ground');
  const recipients = new Map(units.filter(unit => unit.isAlive).map(unit => [unit.instanceId, unit]));
  const props = new Map<string, SpriteEffect[]>(), front: SpriteEffect[] = [];
  for (const effect of effects) {
    const recipient = effect.targetId && recipients.get(effect.targetId);
    if (!reducedMotion && recipient && effect.kind === 'cast' && effect.support && !effect.basic &&
      (effect.skillSlot === 'active' || effect.skillSlot === 'ultimate') && getSpriteSkillArt(effect.sourceHeroId)) {
      const batch = props.get(recipient.instanceId) || [];
      // Re-anchor only the drawn blessing; immutable cast snapshots still own attacks and outcomes.
      batch.push({ ...effect, target: { x: recipient.x, y: recipient.y } }); props.set(recipient.instanceId, batch);
    } else front.push(effect);
  }
  for (const unit of [...units].sort((a, b) => a.y - b.y || a.x - b.x)) {
    drawBody(unit);
    const batch = props.get(unit.instanceId);
    if (batch) drawEffects(batch, 'front');
  }
  drawEffects(front, 'front');
}

/** Draws layered, deterministic Canvas2D spell choreography with no images or GPU models. */
export function drawSpriteEffects(ctx: CanvasRenderingContext2D, effects: readonly SpriteEffect[], width: number, height: number,
  reducedMotion: boolean, layer: 'ground' | 'front', lowQuality = false): void {
  const scale = Math.min(width / 480, height / 680);
  const circle = (x: number, y: number, r: number, fill = false) => {
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); fill ? ctx.fill() : ctx.stroke();
  };
  const line = (ax: number, ay: number, bx: number, by: number) => {
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  };
  const star = (x: number, y: number, r: number) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, radius = i % 2 ? r * 0.25 : r;
      const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  };
  for (const effect of effects) {
    if (effect.kind === 'control') {
      if (layer === 'ground') continue;
      const p = Math.max(0, Math.min(1, effect.age / effect.duration));
      const target = projectSpritePosition(effect.target.x, effect.target.y, width, height);
      const r = 11 * scale;
      ctx.save(); ctx.translate(target.x, target.y - 48 * scale);
      ctx.globalAlpha *= Math.min(1, p * 12) * Math.min(1, (1 - p) * 4) * 0.7;
      ctx.shadowBlur = 0; ctx.strokeStyle = effect.color; ctx.lineWidth = Math.max(1, scale * 1.5);
      switch (effect.ccType) {
        case 'stun':
          // Three tiny static sparks acknowledge the application; the status label owns its duration.
          for (const side of [-1, 0, 1]) {
            const x = side * r * 0.65, y = Math.abs(side) * r * 0.3 - r * 0.55;
            line(x - r * 0.18, y, x + r * 0.18, y);
            line(x, y - r * 0.18, x, y + r * 0.18);
          }
          break;
        case 'silence':
          ctx.beginPath(); ctx.arc(0, 0, r * 0.65, 0.2, Math.PI * 2 - 0.2); ctx.stroke();
          line(-r * 0.75, r * 0.75, r * 0.75, -r * 0.75);
          break;
        case 'slow':
          line(-r * 0.6, -r * 0.7, r * 0.6, -r * 0.7);
          line(-r * 0.6, r * 0.7, r * 0.6, r * 0.7);
          ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.55); ctx.lineTo(r * 0.5, r * 0.55);
          ctx.moveTo(r * 0.5, -r * 0.55); ctx.lineTo(-r * 0.5, r * 0.55); ctx.stroke();
          break;
        case 'knockback': {
          // Outward recoil brackets mark displacement without claiming a direction from stale source coordinates.
          for (const side of [-1, 1]) {
            const x = side * r * 0.35;
            ctx.beginPath(); ctx.moveTo(x - side * r * 0.25, -r * 0.45);
            ctx.lineTo(x + side * r * 0.25, 0); ctx.lineTo(x - side * r * 0.25, r * 0.45); ctx.stroke();
          }
          break;
        }
        case 'petrify':
          ctx.beginPath(); ctx.moveTo(0, -r * 0.8); ctx.lineTo(r * 0.65, -r * 0.2);
          ctx.lineTo(r * 0.5, r * 0.7); ctx.lineTo(-r * 0.5, r * 0.7);
          ctx.lineTo(-r * 0.65, -r * 0.2); ctx.closePath(); ctx.stroke();
          line(0, -r * 0.8, -r * 0.12, 0); line(-r * 0.12, 0, r * 0.5, r * 0.7);
          break;
        default:
          // Legacy untyped events retain neutral feedback without inventing a control category.
          line(-r * 0.4, -r * 0.2, 0, -r * 0.6); line(0, -r * 0.6, r * 0.4, -r * 0.2);
      }
      ctx.restore(); continue;
    }
    if (effect.recovery === 'lifesteal') {
      if (layer === 'ground') continue;
      const p = Math.max(0, Math.min(1, effect.age / effect.duration));
      const target = projectSpritePosition(effect.target.x, effect.target.y, width, height);
      const r = presentation.effects.recoveryRadius * scale;
      const lift = reducedMotion ? 0 : p * presentation.effects.recoveryRise * scale;
      ctx.save(); ctx.translate(target.x, target.y - 48 * scale - lift);
      ctx.globalAlpha *= Math.min(1, p * 12) * (1 - p) * 0.7;
      ctx.shadowBlur = 0; ctx.strokeStyle = effect.color; ctx.lineWidth = Math.max(1, scale * 1.5);
      ctx.beginPath(); ctx.arc(0, 0, r, -2.6, 0.6); ctx.stroke();
      line(-r * 0.35, 0, r * 0.35, 0); line(0, -r * 0.35, 0, r * 0.35);
      if (!reducedMotion && !lowQuality) {
        circle(-r * 0.75, -r * 0.45, Math.max(0.5, scale));
        circle(r * 0.7, r * 0.35, Math.max(0.5, scale));
      }
      ctx.restore(); continue;
    }
    if (effect.basic && effect.kind === 'impact') {
      if (layer === 'ground') continue;
      const p = Math.max(0, Math.min(1, effect.age / effect.duration));
      const target = projectSpritePosition(effect.target.x, effect.target.y, width, height);
      const source = projectSpritePosition(effect.source.x, effect.source.y, width, height);
      const size = 8 * scale;
      ctx.save(); ctx.translate(target.x, target.y - 48 * scale);
      ctx.globalAlpha *= Math.min(1, p * 12) * Math.min(1, (1 - p) * 4) * 0.7;
      ctx.shadowBlur = 0; ctx.strokeStyle = effect.color; ctx.lineWidth = Math.max(1, scale * 1.5);
      if (!reducedMotion) ctx.rotate(Math.atan2(target.y - 48 * scale - (source.y - 52 * scale), target.x - source.x));
      line(-size * 0.7, 0, size * 0.7, 0);
      line(0, -size * 0.45, 0, size * 0.45);
      ctx.restore(); continue;
    }
    if (layer === 'front' && effect.basic && effect.kind === 'cast' && !effect.support && effect.shape === 'beam' &&
      !reducedMotion && getSpriteSkillArt(effect.sourceHeroId)) {
      const p = Math.max(0, Math.min(1, effect.age / effect.duration));
      const a = projectSpritePosition(effect.source.x, effect.source.y, width, height);
      const b = projectSpritePosition(effect.target.x, effect.target.y, width, height);
      const ay = a.y - 52 * scale, by = b.y - 48 * scale;
      const travel = Math.max(0, Math.min(1, (p - 0.12) / 0.38));
      const length = Math.min(12 * scale, Math.hypot(b.x - a.x, by - ay) * 0.2);
      ctx.save(); ctx.translate(a.x + (b.x - a.x) * travel, ay + (by - ay) * travel);
      ctx.rotate(Math.atan2(by - ay, b.x - a.x));
      ctx.globalAlpha *= Math.min(1, p * 12) * Math.min(1, (1 - p) * 4) * 0.7;
      ctx.shadowBlur = 0; ctx.lineCap = 'round'; ctx.strokeStyle = effect.color; ctx.lineWidth = Math.max(1, 2 * scale);
      line(-length, 0, length * 0.35, 0);
      ctx.strokeStyle = '#fff8e6'; ctx.lineWidth = Math.max(0.75, scale);
      line(-length * 0.45, 0, length * 0.35, 0);
      ctx.restore(); continue;
    }
    if (layer === 'front' && drawSpriteSkillArt(ctx, effect, width, height, reducedMotion, lowQuality)) continue;
    const p = Math.min(1, effect.age / effect.duration);
    if (layer === 'ground' && (effect.kind !== 'cast' || effect.basic || p >= presentation.effects.groundChargeEnd)) continue;
    const a = projectSpritePosition(effect.source.x, effect.source.y, width, height);
    const b = projectSpritePosition(effect.target.x, effect.target.y, width, height);
    const radius = (effect.kind === 'cast' && effect.ultimate ? 76 : effect.basic || effect.kind === 'impact' ? 22 : 36) * scale;
    const strength = Math.min(1, effect.age / 0.07) * Math.min(1, (1 - p) * 4);
    if (strength <= 0) continue;
    ctx.save();
    ctx.globalAlpha = (layer === 'ground' ? ctx.globalAlpha : 1) * strength * (reducedMotion ? 0.6 : 0.88);
    ctx.strokeStyle = effect.color; ctx.fillStyle = effect.color;
    ctx.lineWidth = (effect.ultimate ? 3 : 2) * scale;
    ctx.shadowColor = effect.color; ctx.shadowBlur = layer === 'ground' || lowQuality || reducedMotion ? 0 : (effect.ultimate ? 22 : 12) * scale;
    if (layer === 'ground') {
      // Only the caster's brief anticipation owns a floor accent; outcomes already have front feedback.
      ctx.globalAlpha *= presentation.effects.groundOpacity * (1 - p / presentation.effects.groundChargeEnd);
      ctx.save(); ctx.translate(a.x, a.y); ctx.scale(1, 0.32);
      const ring = radius * (reducedMotion ? 0.65 : 0.5 + p * 0.4);
      circle(0, 0, ring);
      if (effect.ultimate && !lowQuality) {
        for (let i = 0; i < 4; i++) {
          const angle = i * Math.PI / 2;
          line(Math.cos(angle) * ring * 0.88, Math.sin(angle) * ring * 0.88,
            Math.cos(angle) * ring * 1.08, Math.sin(angle) * ring * 1.08);
        }
      }
      ctx.restore(); ctx.restore(); continue;
    }
    const ay = a.y - 52 * scale, by = b.y - 48 * scale;
    if (effect.kind === 'cast' && !effect.support) {
      if (reducedMotion) { circle(a.x, ay, radius * 0.38); circle(b.x, by, radius * 0.5); }
      else {
        // Wind-up sigil, then release, then an expanding impact crown.
        if (!effect.basic && p < 0.3) {
          circle(a.x, ay, radius * (0.25 + p));
          star(a.x, ay, 10 * scale);
        }
        const travel = Math.max(0, Math.min(1, (p - 0.12) / 0.38));
        const tx = a.x + (b.x - a.x) * travel, ty = ay + (by - ay) * travel;
        ctx.globalAlpha *= p < 0.12 ? 0.35 : 1;
        switch (effect.shape) {
          case 'slash': {
            const x = a.x + (b.x - a.x) * 0.7, y = ay + (by - ay) * 0.7;
            ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(by - ay, b.x - a.x));
            ctx.lineWidth = (effect.ultimate ? 12 : effect.basic ? 4 : 7) * scale * (1 - p * 0.7);
            ctx.beginPath(); ctx.ellipse(0, 0, radius * 0.85, radius * 0.65, p * 0.8, -1.4, 1.6); ctx.stroke();
            ctx.strokeStyle = '#fff7df'; ctx.lineWidth = 2 * scale;
            ctx.beginPath(); ctx.ellipse(3, 0, radius * 0.8, radius * 0.6, p * 0.8, -1.4, 1.6); ctx.stroke();
            if (effect.ultimate) { ctx.rotate(Math.PI * 0.65); line(-radius, 0, radius, 0); }
            ctx.restore(); break;
          }
          case 'beam': {
            ctx.lineWidth = (effect.ultimate ? 18 : 8) * scale * Math.sin(Math.PI * p);
            line(a.x, ay, b.x, by);
            ctx.strokeStyle = '#fff8e6'; ctx.lineWidth = 2.5 * scale; line(a.x, ay, b.x, by);
            circle(b.x, by, radius * 0.3); break;
          }
          case 'lightning': {
            const count = effect.ultimate ? 3 : 1;
            for (let bolt = 0; bolt < count; bolt++) {
              const ex = b.x + (bolt - (count - 1) / 2) * 24 * scale;
              ctx.beginPath(); ctx.moveTo(ex - 12 * scale, by - radius * 2.6);
              for (let i = 1; i <= 7; i++) {
                const zig = Math.sin(effect.id * 3 + i * 7 + Math.floor(p * 12)) * 14 * scale;
                ctx.lineTo(ex + zig, by - radius * 2.6 * (1 - i / 7));
              }
              ctx.lineWidth = (bolt === 1 ? 5 : 3) * scale; ctx.stroke();
            }
            star(b.x, by, radius * 0.5); break;
          }
          case 'meteor': {
            const mx = b.x + (1 - travel) * radius, my = by - (1 - travel) * radius * 3.2;
            ctx.lineWidth = radius * 0.28; line(mx + radius * 0.5, my - radius, mx, my);
            ctx.fillStyle = '#fff2b6'; circle(mx, my, radius * 0.22, true);
            if (travel === 1) circle(b.x, by, radius * (p - 0.3)); break;
          }
          case 'arrow': {
            const angle = Math.atan2(by - ay, b.x - a.x);
            ctx.save(); ctx.translate(tx, ty); ctx.rotate(angle);
            line(-30 * scale, 0, 12 * scale, 0);
            ctx.beginPath(); ctx.moveTo(15 * scale, 0); ctx.lineTo(2 * scale, -5 * scale); ctx.lineTo(2 * scale, 5 * scale); ctx.closePath(); ctx.fill();
            if (effect.ultimate) { line(-24 * scale, -12 * scale, 10 * scale, -12 * scale); line(-24 * scale, 12 * scale, 10 * scale, 12 * scale); }
            ctx.restore(); break;
          }
          case 'serpent': {
            ctx.beginPath();
            for (let i = 0; i <= 28; i++) {
              const t = i / 28 * Math.max(0.05, travel);
              const x = a.x + (b.x - a.x) * t, y = ay + (by - ay) * t + Math.sin(t * 16 - p * 10) * 14 * scale;
              if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
            }
            ctx.lineWidth = 7 * scale; ctx.stroke(); circle(tx, ty, 7 * scale, true); break;
          }
          case 'shadow': {
            ctx.save(); ctx.translate(b.x, by); ctx.rotate(p * Math.PI);
            for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI * 2 / 3); line(-radius * 0.6, -radius * 0.5, radius * 0.5, radius * 0.5); }
            ctx.restore(); circle(b.x, by, radius * (0.3 + p * 0.5)); break;
          }
          case 'nova': {
            for (let i = 0; i < 3; i++) circle(b.x, by, radius * Math.max(0.03, (p * 1.5 + i / 3) % 1));
            star(b.x, by, radius * (0.15 + 0.15 * Math.sin(p * Math.PI))); break;
          }
        }
        if (p > 0.48 && !effect.basic) {
          ctx.lineWidth = 2 * scale;
          circle(b.x, by, radius * (p - 0.4) * 1.4);
        }
      }
    } else if (effect.support) {
      ctx.save(); ctx.translate(b.x, by);
      if (effect.kind === 'heal') {
        const lift = reducedMotion ? 0 : p * 24 * scale;
        ctx.lineWidth = 4 * scale;
        line(-9 * scale, -lift, 9 * scale, -lift); line(0, -9 * scale - lift, 0, 9 * scale - lift);
        circle(0, 0, radius * (0.4 + p * 0.25));
      } else {
        ctx.beginPath(); ctx.ellipse(0, 0, radius * 0.65, radius, 0, 0, Math.PI * 2); ctx.stroke();
        star(0, -radius * 0.65, 8 * scale);
      }
      ctx.restore();
    } else {
      const r = radius * (0.2 + p * 0.8);
      circle(b.x, by, r);
      if (!reducedMotion) {
        const count = lowQuality ? presentation.effects.lowParticles : presentation.effects.particles;
        for (let i = 0; i < count; i++) {
          const angle = i / count * Math.PI * 2 + effect.id;
          const distance = r * (0.8 + (i % 3) * 0.25);
          star(b.x + Math.cos(angle) * distance, by + Math.sin(angle) * distance, (1 - p) * 5 * scale);
        }
      }
    }
    ctx.restore();
  }
}
