// PROTOTYPE - NOT FOR PRODUCTION
import type { BattleUnitRuntime, CombatEvent } from './types';
import { getSpriteBattleScale, projectSpritePosition } from './spriteBattleRenderer';
import presentation from './spritePresentation.json';

export interface CombatText {
  id: number;
  targetId: string;
  kind: 'damage' | 'heal' | 'shield';
  critical: boolean;
  value: number;
  count: number;
  age: number;
  targetX: number;
  targetY: number;
}
export interface TextRectangle { x: number; y: number; width: number; height: number }
export interface CombatTextLabel extends TextRectangle {
  text: string;
  color: string;
  fontSize: number;
  alpha: number;
  critical: boolean;
}
const tuning = presentation.combatText;

/** Coalesces brief same-recipient bursts without changing simulation events or extending old labels. */
export function addCombatText(texts: CombatText[], event: CombatEvent, target: BattleUnitRuntime): void {
  if (!['damage', 'heal', 'shield'].includes(event.type) || !Number.isFinite(event.value) || event.value! <= 0) return;
  const kind = event.type as CombatText['kind'];
  const critical = kind === 'damage' && !!event.isCrit;
  const previous = [...texts].reverse().find(text => text.targetId === target.instanceId && text.kind === kind && text.critical === critical && text.age < tuning.mergeSeconds);
  if (previous) { previous.value += event.value!; previous.count++; return; }
  texts.push({ id: event.id, targetId: target.instanceId, kind, critical, value: event.value!, count: 1,
    age: 0, targetX: target.x, targetY: target.y });
  if (texts.length > tuning.maxCount) texts.splice(0, texts.length - tuning.maxCount);
}

/** Advances only presentation time and removes expired labels; zero/nonfinite deltas preserve pause. */
export function advanceCombatTexts(texts: CombatText[], seconds: number): void {
  const dt = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  for (let i = texts.length - 1; i >= 0; i--) {
    texts[i].age += dt;
    if (texts[i].age >= tuning.duration) texts.splice(i, 1);
  }
}

/** Deterministic viewport-aware label placement; crowded lower-priority labels are omitted, never stacked. */
export function layoutCombatTexts(texts: readonly CombatText[], width: number, height: number, reducedMotion: boolean,
  measure: (text: string, fontSize: number) => number, obstacles: readonly TextRectangle[] = []): CombatTextLabel[] {
  const labels: CombatTextLabel[] = [];
  const scale = getSpriteBattleScale(width, height);
  const padding = tuning.edgePadding;
  const gap = tuning.laneGap;
  const intersects = (a: TextRectangle, b: TextRectangle) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  const ordered = [...texts].sort((a, b) => Number(b.critical) - Number(a.critical) || a.age - b.age || a.id - b.id);
  for (const entry of ordered) {
    if (labels.length >= tuning.maxVisible) break;
    const text = `${entry.critical ? 'CRIT ' : entry.kind === 'shield' ? '◆ ' : ''}${entry.kind === 'damage' ? '−' : '+'}${Math.round(entry.value)}`;
    const fontSize = Math.max(11, (entry.critical ? tuning.criticalFontSize : tuning.fontSize) * Math.min(1, width / 390));
    const textWidth = Math.min(width - padding * 2, measure(text, fontSize) + 10);
    const textHeight = fontSize + 8;
    const point = projectSpritePosition(entry.targetX, entry.targetY, width, height);
    const baseY = point.y - 125 * scale - (reducedMotion ? 0 : entry.age / tuning.duration * tuning.risePixels);
    const alpha = Math.min(1, (tuning.duration - entry.age) / 0.25);
    for (let lane = 0; lane < 12; lane++) {
      // Try the column above its target, then adjacent columns, before dropping a label.
      const column = lane % 3 - 1;
      const row = Math.floor(lane / 3);
      const center = point.x + (lane % 3 === 0 ? 0 : column === 0 ? -1 : 1) * (textWidth + gap);
      const candidate = {
        x: Math.max(padding, Math.min(width - padding - textWidth, center - textWidth / 2)),
        y: Math.max(padding, Math.min(height - padding - textHeight, baseY - row * (textHeight + gap))),
        width: textWidth, height: textHeight,
      };
      if (obstacles.some(rect => intersects(candidate, rect)) || labels.some(rect => intersects(candidate, rect))) continue;
      labels.push({ ...candidate, text, fontSize, alpha, critical: entry.critical,
        color: entry.kind === 'heal' ? '#86ffc0' : entry.kind === 'shield' ? '#99dfff' : entry.critical ? '#ffe487' : '#fff5dc' });
      break;
    }
  }
  return labels;
}

/** Draws legible outlined labels with a compact dark backing for critical hits. */
export function drawCombatTexts(ctx: CanvasRenderingContext2D, labels: readonly CombatTextLabel[]): void {
  for (const label of labels) {
    ctx.save(); ctx.globalAlpha = label.alpha;
    if (label.critical) {
      ctx.fillStyle = '#34210cdd'; ctx.fillRect(label.x, label.y, label.width, label.height);
      ctx.strokeStyle = '#f7c86999'; ctx.lineWidth = 1; ctx.strokeRect(label.x, label.y, label.width, label.height);
    }
    ctx.font = `bold ${label.fontSize}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = '#241a16';
    const x = label.x + label.width / 2, y = label.y + label.height / 2;
    ctx.strokeText(label.text, x, y, label.width - 8);
    ctx.fillStyle = label.color; ctx.fillText(label.text, x, y, label.width - 8);
    ctx.restore();
  }
}
