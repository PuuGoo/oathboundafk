// PROTOTYPE - NOT FOR PRODUCTION
/** Arena themes that have a Blender-authored scene in `public/assets/arenas`. */
import authoredArenas from '../../tools/arena-themes.json';
import authoredFog from '../../tools/arena-fog.json';
import authoredWeather from '../../tools/arena-weather.json';

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

/**
 * Ánh sáng cho nhân vật, lấy đúng bảng màu của sân: tướng ấm dưới đền thánh,
 * lạnh dưới bão, tím dưới hầm mộ — để nhân vật hoà vào sân thay vì bị chiếu trắng.
 */
export interface ArenaLighting {
  /** Đèn chính (directional key): màu `primary` của theme. */
  readonly key: number;
  /** Đèn viền phía sau: màu `accent`. */
  readonly rim: number;
  /** Bầu trời của hemisphere: `primary`. */
  readonly sky: number;
  /** Ánh phản chiếu từ sàn: `secondary`. */
  readonly ground: number;
}

const hexToRgb = (value: string): number => Number.parseInt(value.slice(0, 6), 16) & 0xffffff;

export function arenaLighting(id: ArenaSceneId): ArenaLighting {
  const spec = authoredArenas.find(entry => entry.id === id) ?? authoredArenas[0];
  return Object.freeze({
    key: hexToRgb(spec.primary), rim: hexToRgb(spec.accent),
    sky: hexToRgb(spec.primary), ground: hexToRgb(spec.secondary),
  });
}

/** Sương khoảng cách theo theme, đọc từ `tools/arena-fog.json` như mọi giá trị trình diễn. */
export interface ArenaFogDepth {
  /** Camera-space depth (world units) where haze starts. */
  readonly near: number;
  /** Depth where distant geometry fully takes the arena colour. */
  readonly far: number;
}

export function arenaFogDepth(id: ArenaSceneId): ArenaFogDepth {
  const spec = authoredFog.find(entry => entry.id === id) ?? authoredFog[0];
  return Object.freeze({ near: spec.near, far: spec.far });
}

/**
 * Quầng sáng quanh đài lửa. Hình dạng lấy từ chính GLB (mesh tên `Brazier*`) nên
 * không hardcode toạ độ; đây là giả-bloom chạy một draw call cho cả sân.
 */
export interface BrazierGlow {
  /** Kích thước điểm (pixel buffer, camera ortho nên không giảm theo khoảng cách). */
  readonly size: number;
  readonly color: number;
  readonly opacity: number;
}

export function brazierGlow(accentHex: number): BrazierGlow {
  return Object.freeze({ size: 30, color: accentHex & 0xffffff, opacity: .34 });
}

/** Thời tiết riêng của từng sân: bụi, bào tử, mưa hay tàn lửa trôi trong khung. */
export interface ArenaWeather {
  readonly count: number;
  readonly color: number;
  /** Kích thước điểm (pixel buffer; không giảm theo khoảng cách vì camera ortho). */
  readonly size: number;
  /** 1 là bốc lên, −1 là rơi xuống. */
  readonly direction: 1 | -1;
  /** Phần chiều cao đi được mỗi giây (0..1). */
  readonly speed: number;
  /** Biên độ đong đưa ngang. */
  readonly drift: number;
  readonly opacity: number;
}

const WEATHER_FLOOR = 2, WEATHER_SPAN = 100, WEATHER_HALF_WIDTH = 90;
const WEATHER_Z_FAR = -110, WEATHER_Z_NEAR = 40;

export function arenaWeather(id: ArenaSceneId): ArenaWeather {
  const spec = authoredWeather.find(entry => entry.id === id) ?? authoredWeather[0];
  return Object.freeze({
    count: spec.count, color: hexToRgb(spec.color), size: spec.size,
    direction: spec.direction < 0 ? -1 : 1, speed: spec.speed, drift: spec.drift, opacity: spec.opacity,
  });
}

/** Hash ổn định theo chỉ số hạt, để mỗi sân có cùng một bố cục hạt ở mọi lần chạy. */
function weatherHash(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Vị trí một hạt ở thời điểm `wallClock`. Hàm thuần: cùng đầu vào cho cùng đầu ra,
 * nên test đo được chuyển động mà không cần giữ trạng thái hạt trong scene.
 */
export function weatherParticle(weather: ArenaWeather, index: number,
  wallClock: number): { x: number; y: number; z: number } {
  const clock = Number.isFinite(wallClock) ? Math.max(0, wallClock) : 0;
  const cycle = (weatherHash(index, 3) + clock * weather.speed) % 1;
  const rise = weather.direction > 0 ? cycle : 1 - cycle;
  return {
    x: (weatherHash(index, 1) - .5) * 2 * WEATHER_HALF_WIDTH + Math.sin(clock * .6 + index) * weather.drift,
    y: WEATHER_FLOOR + rise * WEATHER_SPAN,
    z: WEATHER_Z_FAR + weatherHash(index, 2) * (WEATHER_Z_NEAR - WEATHER_Z_FAR),
  };
}

/** Hạt gần camera sáng hơn hạt phía sau, nên cả trường hạt có chiều sâu thay vì một mức mờ. */
export const WEATHER_NEAR_ALPHA = 1, WEATHER_FAR_ALPHA = .28;

/**
 * Hệ số alpha theo độ sâu của hạt (`z` càng lớn càng gần camera).
 * Nhân vào alpha đỉnh của mỗi hạt trong buffer `color`, nên material.opacity vẫn
 * giữ nguyên vai trò điều khiển cả lớp (reveal, tuyệt kỹ, LOW preset).
 */
export function weatherParticleAlpha(z: number): number {
  const span = WEATHER_Z_NEAR - WEATHER_Z_FAR;
  const depth = Number.isFinite(z) ? Math.max(0, Math.min(1, (z - WEATHER_Z_FAR) / span)) : 0;
  // Đường cong nhẹ: hạt xa vẫn còn thấy, không biến mất thành bụi mờ vô hình.
  return WEATHER_FAR_ALPHA + (WEATHER_NEAR_ALPHA - WEATHER_FAR_ALPHA) * depth ** 1.35;
}

/**
 * Màu đỉnh cho trường hạt: mỗi hạt một chút sáng/tối theo hash, và alpha theo độ sâu.
 * Trả mảng phẳng RGBA (Float32) đúng thứ tự three cần cho `BufferAttribute(..., 4)`.
 */
export function weatherVertexColours(weather: ArenaWeather, count: number): Float32Array {
  const total = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  const colours = new Float32Array(total * 4);
  const r = ((weather.color >> 16) & 0xff) / 255;
  const g = ((weather.color >> 8) & 0xff) / 255;
  const b = (weather.color & 0xff) / 255;
  for (let index = 0; index < total; index++) {
    // ±22 % độ sáng: đủ để hạt không đều nhau, chưa tới mức hai màu khác nhau.
    const brightness = .78 + .44 * weatherHash(index, 4);
    const z = WEATHER_Z_FAR + weatherHash(index, 2) * (WEATHER_Z_NEAR - WEATHER_Z_FAR);
    colours[index * 4] = Math.min(1, r * brightness);
    colours[index * 4 + 1] = Math.min(1, g * brightness);
    colours[index * 4 + 2] = Math.min(1, b * brightness);
    colours[index * 4 + 3] = weatherParticleAlpha(z);
  }
  return colours;
}

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
