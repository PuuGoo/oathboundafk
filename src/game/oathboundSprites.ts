// PROTOTYPE - NOT FOR PRODUCTION
import manifest from './oathboundSprites.json';

export interface OathboundSpriteSpec {
  sourceId: string;
  unitId: number;
  name: string;
  src: string;
  width: number;
  height: number;
  cellWidth: number;
  anchorX: number;
  scale: number;
  facing?: 'left' | 'right';
  clips: Record<string, { y: number; height: number; count: number; groundY: number; fps: number }>;
  aliases: Record<string, string>;
  limitation: string;
}

export const OATHBOUND_SPRITES = manifest as unknown as OathboundSpriteSpec[];
const byUnitId = new Map(OATHBOUND_SPRITES.map(spec => [spec.unitId, spec]));

/** Looks up local artwork by canonical AFK identity, including awakened variants. */
export function getOathboundSprite(unitId: number | undefined): OathboundSpriteSpec | undefined {
  return unitId === undefined ? undefined : byUnitId.get(unitId);
}

/** Resolves authored clip aliases without treating padded atlas cells as frames. */
export function resolveSpriteClip(spec: OathboundSpriteSpec, requested: string): string {
  const seen = new Set<string>();
  let name = requested;
  while (!spec.clips[name] && spec.aliases[name] && !seen.has(name)) {
    seen.add(name);
    name = spec.aliases[name];
  }
  return spec.clips[name] ? name : 'idle';
}

/** Pure atlas crop/UV calculation; idle and run loop, other actions clamp. */
export function getSpriteFrame(spec: OathboundSpriteSpec, requested: string, seconds: number, mirrored: boolean) {
  const clipName = resolveSpriteClip(spec, requested);
  const clip = spec.clips[clipName];
  const frame = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * clip.fps);
  const looping = clipName === 'idle' || clipName === 'run';
  const index = looping ? frame % clip.count : Math.min(clip.count - 1, frame);
  const x = index * spec.cellWidth;
  const repeatX = spec.cellWidth / spec.width;
  return {
    index, x, y: clip.y, width: spec.cellWidth, height: clip.height,
    repeatX: mirrored ? -repeatX : repeatX,
    repeatY: clip.height / spec.height,
    offsetX: (x + (mirrored ? spec.cellWidth : 0)) / spec.width,
    offsetY: 1 - (clip.y + clip.height) / spec.height,
    centerX: mirrored ? 1 - spec.anchorX / spec.cellWidth : spec.anchorX / spec.cellWidth,
    centerY: 1 - clip.groundY / clip.height,
  };
}
