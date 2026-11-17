// PROTOTYPE - NOT FOR PRODUCTION
/** Arena themes that have a Blender-authored scene in `public/assets/arenas`. */
export type ArenaSceneId = 'temple' | 'forest' | 'shadow' | 'storm' | 'obsidian';

export interface ArenaDefinition {
  readonly id: ArenaSceneId;
  readonly theme: string;
  readonly url: string;
}

/** Authored clip lengths; `tools/build-arena.py` asserts the exported GLB matches. */
export const ARENA_CLIP_SECONDS: Readonly<Record<'idle' | 'pulse', number>> = Object.freeze({
  idle: 4, pulse: 1.65,
});

/** Blender theme name -> scene asset. `resolveSpriteArena` yields forest/shadow/temple. */
const ARENA_SCENES: Readonly<Record<'forest' | 'shadow' | 'temple', ArenaSceneId>> = Object.freeze({
  forest: 'forest', shadow: 'shadow', temple: 'temple',
});

/** Stage themes outside the three palettes get their own authored scene. */
const THEME_SCENES: Readonly<Record<string, ArenaSceneId>> = Object.freeze({
  tempest: 'storm',
  obsidian: 'obsidian',
});

export const ARENA_DEFINITIONS: readonly ArenaDefinition[] = Object.freeze([
  { id: 'temple', theme: 'sanctuary', url: '/assets/arenas/temple.glb' },
  { id: 'forest', theme: 'sylvan', url: '/assets/arenas/forest.glb' },
  { id: 'shadow', theme: 'catacombs', url: '/assets/arenas/shadow.glb' },
  { id: 'storm', theme: 'tempest', url: '/assets/arenas/storm.glb' },
  { id: 'obsidian', theme: 'obsidian', url: '/assets/arenas/obsidian.glb' },
]);

const byId = new Map(ARENA_DEFINITIONS.map(entry => [entry.id, entry]));

/** Nhịp sáng sân: lên nhanh, giữ ngắn, tan mềm trước khi clip kết thúc. */
export function arenaPulseOpacity(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) return 0;
  const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
  return .85 * smooth(progress / .12) * (1 - smooth((progress - .45) / .55));
}

/** Resolves the authored scene for a stage theme plus the player's arena override. */
export function resolveArenaScene(theme: string, palette: 'forest' | 'shadow' | 'temple',
  override?: 'auto' | 'enchanted_forest' | 'celestial_temple' | 'shadow_realm'): ArenaDefinition | undefined {
  if (override && override !== 'auto') {
    const id = override === 'enchanted_forest' ? 'forest' : override === 'shadow_realm' ? 'shadow' : 'temple';
    return byId.get(id);
  }
  return byId.get(THEME_SCENES[theme] || ARENA_SCENES[palette]);
}

/** Effect-centred pulse: the ultimate cast is the only thing that drives it. */
export interface ArenaPulseSample {
  clip: 'idle' | 'pulse';
  seconds: number;
  /** 0..1 inside the selected clip; idle loops on wall time, pulse runs once. */
  progress: number;
}

/** Chỉ phát pulse từ tuổi cast hợp lệ; giảm chuyển động giữ toàn sân ở pose tĩnh. */
export function sampleArenaPulse(pulseAge: number | undefined, wallClock: number,
  reducedMotion: boolean): ArenaPulseSample {
  if (!reducedMotion && pulseAge !== undefined && Number.isFinite(pulseAge)
    && pulseAge >= 0 && pulseAge < ARENA_CLIP_SECONDS.pulse) {
    return { clip: 'pulse', seconds: pulseAge, progress: pulseAge / ARENA_CLIP_SECONDS.pulse };
  }
  const wall = Number.isFinite(wallClock) ? Math.max(0, wallClock) : 0;
  // Hạt và lửa đứng yên khi người dùng giảm chuyển động; không thay đổi màu hay bố cục.
  return { clip: 'idle', seconds: reducedMotion ? 0 : wall, progress: 0 };
}
