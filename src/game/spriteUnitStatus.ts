// PROTOTYPE - NOT FOR PRODUCTION
import type { BattleSnapshot, BattleUnitRuntime } from './types';
import { getUltimateReadiness } from './ultimateReadiness';
import { getOathboundSprite } from './oathboundSprites';
import { getHeroById } from './heroes';
import type { TextRectangle } from './spriteCombatText';
import presentation from './spritePresentation.json';
import { getSpriteBattleScale, projectSpritePosition } from './spriteBattleRenderer';

/** A compact, foot-projected label rectangle shared by drawing and combat-text avoidance. */
export interface SpriteUnitStatus {
  kind: 'ready' | 'blocked';
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

/** Show actual control blocks for either team, but readiness hints only for player-controlled allies. */
export function getSpriteUnitStatus(unit: BattleUnitRuntime, width: number, height: number, battleStatus: BattleSnapshot['status']): SpriteUnitStatus | undefined {
  const readiness = getUltimateReadiness(unit, battleStatus);
  if (readiness.state !== 'blocked' && !(unit.team === 'ally' && readiness.state === 'ready')) return undefined;
  const point = projectSpritePosition(unit.x, unit.y, width, height);
  const scale = getSpriteBattleScale(width, height);
  const spec = getOathboundSprite(getHeroById(unit.heroId).unitId);
  const fontSize = Math.max(9, Math.min(12, 10 * scale));
  const labelWidth = Math.min(width, fontSize * 6 + 8), labelHeight = fontSize + 6;
  return { kind: readiness.state, text: readiness.state === 'ready' ? '★ ULT' : readiness.label.toUpperCase(),
    x: Math.max(0, Math.min(width - labelWidth, point.x - labelWidth / 2)),
    y: Math.max(0, Math.min(height - labelHeight, point.y - (spec?.sourceId === 'lancer' ? 112 : 100) * scale - labelHeight - 4)),
    width: labelWidth, height: labelHeight, fontSize };
}

/** Place control labels before readiness hints, staying close to the actor; omit crowded hints rather than overlap. */
export function layoutSpriteUnitStatuses(units: readonly BattleUnitRuntime[], width: number, height: number,
  battleStatus: BattleSnapshot['status'], obstacles: readonly TextRectangle[] = []): Array<SpriteUnitStatus & { unitId: string }> {
  const placed: Array<SpriteUnitStatus & { unitId: string }> = [];
  const tuning = presentation.unitStatus;
  const candidates = units.map(unit => ({ unitId: unit.instanceId, label: getSpriteUnitStatus(unit, width, height, battleStatus) }))
    .filter((entry): entry is { unitId: string; label: SpriteUnitStatus } => !!entry.label)
    .sort((a, b) => Number(b.label.kind === 'blocked') - Number(a.label.kind === 'blocked') ||
      a.label.y - b.label.y || a.unitId.localeCompare(b.unitId));
  const intersects = (a: TextRectangle, b: TextRectangle) => a.x < b.x + b.width + tuning.gap &&
    a.x + a.width + tuning.gap > b.x && a.y < b.y + b.height + tuning.gap && a.y + a.height + tuning.gap > b.y;
  for (const { unitId, label } of candidates) {
    let selected: SpriteUnitStatus | undefined;
    for (let row = 0; row < tuning.rows && !selected; row++) {
      for (const direction of [0, -1, 1]) {
        const x = Math.max(0, Math.min(width - label.width, label.x + direction * tuning.maxHorizontalShift));
        const y = Math.max(0, label.y - row * (label.height + tuning.gap));
        const candidate = { ...label, x, y };
        if (obstacles.some(obstacle => intersects(candidate, obstacle)) || placed.some(other => intersects(candidate, other))) continue;
        selected = candidate; break;
      }
    }
    if (selected) placed.push({ ...selected, unitId });
  }
  return placed;
}

/** Shared overlay footprint for combat text and status-label avoidance. */
export function getSpriteUnitOverlayBounds(unit: BattleUnitRuntime, width: number, height: number): TextRectangle {
  const point = projectSpritePosition(unit.x, unit.y, width, height);
  const scale = getSpriteBattleScale(width, height);
  const spec = getOathboundSprite(getHeroById(unit.heroId).unitId);
  const shielded = unit.isAlive && Number.isFinite(unit.shield) && unit.shield > 0;
  const marked = unit.isAlive && unit.statusEffects.some(status => status.type === 'mark' && status.remainingMs > 0);
  return { x: point.x - (marked ? 28 : 23) * scale - 2, y: point.y - (spec?.sourceId === 'lancer' ? 112 : 100) * scale - 16,
    width: (marked ? shielded ? 65 : 56 : shielded ? 60 : 46) * scale + 4,
    height: Math.max(shielded ? Math.max(28, 19 + 6 * scale) : 28, marked ? 26 * scale + 16 : 0) };
}

/** Draw a static shield badge beside the health bar only while real shield HP remains. */
export function drawSpriteShieldStatus(ctx: CanvasRenderingContext2D, unit: Pick<BattleUnitRuntime, 'shield' | 'isAlive'>,
  x: number, y: number, scale: number): boolean {
  if (!unit.isAlive || !Number.isFinite(unit.shield) || !(unit.shield > 0)) return false;
  const r = 5 * scale;
  ctx.save(); ctx.fillStyle = '#102b3b'; ctx.strokeStyle = '#b9edff';
  ctx.lineWidth = Math.max(1, scale); ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x - r * 0.8, y - r * 0.75);
  ctx.lineTo(x, y - r); ctx.lineTo(x + r * 0.8, y - r * 0.75);
  ctx.lineTo(x + r * 0.65, y + r * 0.35); ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.65, y + r * 0.35); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - r * 0.45); ctx.lineTo(x, y + r * 0.45); ctx.stroke();
  ctx.restore(); return true;
}

/** Draw one static countdown for a live hostile mark, with no cosmetic clock or damage implication. */
export function drawSpriteMarkStatus(ctx: CanvasRenderingContext2D, unit: BattleUnitRuntime,
  units: readonly BattleUnitRuntime[], x: number, y: number, scale: number): boolean {
  if (!unit.isAlive) return false;
  const mark = unit.statusEffects.find(status => status.type === 'mark' && status.remainingMs > 0 &&
    units.some(source => source.instanceId === status.sourceUnitId && source.isAlive && source.team !== unit.team));
  if (!mark) return false;
  ctx.save(); ctx.font = `bold ${Math.max(9, 10 * scale)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#321b15'; ctx.fillRect(x - 26 * scale, y - 7 * scale, 52 * scale, 14 * scale);
  ctx.strokeStyle = '#ffd28c'; ctx.lineWidth = Math.max(1, scale);
  ctx.strokeRect(x - 26 * scale, y - 7 * scale, 52 * scale, 14 * scale);
  ctx.fillStyle = '#ffe3b5'; ctx.fillText(`MARK ${Math.ceil(mark.remainingMs / 1000)}s`, x, y, 50 * scale);
  ctx.restore(); return true;
}

/** Captivity artwork follows the applied status clock; reduced motion has no closing/breathing motion. */
export function drawSpriteIsolation(ctx: CanvasRenderingContext2D, unit: BattleUnitRuntime,
  x: number, y: number, scale: number, reducedMotion = true, lowQuality = false): boolean {
  const isolation = unit.isAlive && unit.statusEffects.find(status => status.type === 'isolation' && status.remainingMs > 0);
  if (!isolation) return false;
  const age = Math.max(0, isolation.durationMs - isolation.remainingMs);
  const close = reducedMotion ? 1 : Math.min(1, age / 240);
  const settle = close * close * (3 - 2 * close);
  const breath = reducedMotion ? 0 : Math.sin(age / 360) * 0.07;
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.lineJoin = 'round'; ctx.shadowBlur = 0;
  const outline = (inset = 0) => {
    ctx.beginPath(); ctx.moveTo(-16 + inset, -88 + inset); ctx.lineTo(16 - inset, -88 + inset);
    ctx.lineTo(27 - inset, -67); ctx.lineTo(21 - inset, -5 - inset);
    ctx.lineTo(-21 + inset, -5 - inset); ctx.lineTo(-27 + inset, -67); ctx.closePath();
  };
  // Grounded cast shadow, beveled outer frame and deep velvet cavity; no arena-sized glow.
  ctx.fillStyle = '#130f21'; ctx.strokeStyle = '#806285'; ctx.lineWidth = 3;
  outline(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#e6c897'; ctx.lineWidth = 1.5; outline(3); ctx.stroke();
  if (!lowQuality) {
    ctx.fillStyle = '#39253e';
    ctx.beginPath(); ctx.moveTo(-23, -65); ctx.lineTo(-18, -82); ctx.lineTo(-12, -82);
    ctx.lineTo(-18, -65); ctx.lineTo(-14, -12); ctx.lineTo(-18, -12); ctx.closePath(); ctx.fill();
  }
  // Hinged halves physically close across the cavity after actual capture, not before contact.
  const gap = (1 - settle) * 21;
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * gap, 0);
    ctx.fillStyle = side < 0 ? '#30263b' : '#211c30'; ctx.strokeStyle = '#ba9a72'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -83); ctx.lineTo(side * 14, -83);
    ctx.lineTo(side * 22, -65); ctx.lineTo(side * 17, -10); ctx.lineTo(0, -10); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (!lowQuality) {
      ctx.strokeStyle = '#69506c'; ctx.beginPath(); ctx.moveTo(side * 6, -76);
      ctx.lineTo(side * 15, -62); ctx.lineTo(side * 11, -17); ctx.stroke();
      for (const y of [-68, -30]) { ctx.fillStyle = '#d9b57e'; ctx.fillRect(side < 0 ? -23 : 18, y, 5, 4); }
    }
    ctx.restore();
  }
  ctx.globalAlpha = 0.75 + breath; ctx.strokeStyle = '#b7daf2'; ctx.lineWidth = 1.5;
  // Two interlocked angular bindings tighten with the door movement, leaving the countdown clear.
  const spread = 4 * (1 - settle);
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(-22 - spread, side < 0 ? -67 : -32);
    ctx.lineTo(-6, -49); ctx.lineTo(6, -49); ctx.lineTo(22 + spread, side < 0 ? -32 : -67); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.fillStyle = '#173342'; ctx.strokeStyle = '#e9d7a3'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(0, -61); ctx.lineTo(9, -50); ctx.lineTo(0, -39); ctx.lineTo(-9, -50); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#c2f1ee'; ctx.beginPath(); ctx.moveTo(0, -55); ctx.lineTo(0, -45);
  ctx.moveTo(-3, -51); ctx.lineTo(3, -51); ctx.stroke();
  ctx.fillStyle = '#100f1b'; ctx.fillRect(-13, -27, 26, 15);
  ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff0d3';
  ctx.fillText(`${Math.ceil(isolation.remainingMs / 1000)}s`, 0, -19, 24);
  ctx.restore(); return true;
}

/** Paint a stable high-contrast label; no animation means pause and reduced motion stay quiet. */
export function drawSpriteUnitStatus(ctx: CanvasRenderingContext2D, label: SpriteUnitStatus): void {
  ctx.save();
  ctx.fillStyle = label.kind === 'ready' ? '#35270a' : '#391c31';
  ctx.fillRect(label.x, label.y, label.width, label.height);
  ctx.strokeStyle = label.kind === 'ready' ? '#f7d46b' : '#efb4d1';
  ctx.lineWidth = 1;
  ctx.strokeRect(label.x + 0.5, label.y + 0.5, label.width - 1, label.height - 1);
  ctx.fillStyle = label.kind === 'ready' ? '#fff0ab' : '#ffe3f1';
  ctx.font = `bold ${label.fontSize}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label.text, label.x + label.width / 2, label.y + label.height / 2, label.width - 4);
  ctx.restore();
}
