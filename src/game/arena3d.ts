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

/** Resolves the authored scene for a stage theme plus the player's arena override. */
export function resolveArenaScene(theme: string, palette: 'forest' | 'shadow' | 'temple'): ArenaDefinition | undefined {
  return byId.get(THEME_SCENES[theme] || ARENA_SCENES[palette]);
}

/** Effect-centred pulse: the ultimate cast is the only thing that drives it. */
export interface ArenaPulseSample {
  clip: 'idle' | 'pulse';
  seconds: number;
  /** 0..1 inside the selected clip; idle loops on wall time, pulse runs once. */
  progress: number;
}

export function sampleArenaPulse(pulseAge: number | undefined, wallClock: number,
  reducedMotion: boolean): ArenaPulseSample {
  const age = Number.isFinite(pulseAge) ? Math.max(0, pulseAge as number) : 0;
  if (pulseAge !== undefined && age < ARENA_CLIP_SECONDS.pulse) {
    return { clip: 'pulse', seconds: age, progress: age / ARENA_CLIP_SECONDS.pulse };
  }
  const wall = Number.isFinite(wallClock) ? Math.max(0, wallClock) : 0;
  // Hạt và lửa đứng yên khi người dùng giảm chuyển động; không thay đổi màu hay bố cục.
  return { clip: 'idle', seconds: reducedMotion ? 0 : wall, progress: 0 };
}
