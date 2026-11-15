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
  return { x: point.x - 23 * scale - 2, y: point.y - (spec?.sourceId === 'lancer' ? 112 : 100) * scale - 16,
    width: (shielded ? 60 : 46) * scale + 4, height: shielded ? Math.max(28, 19 + 6 * scale) : 28 };
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
