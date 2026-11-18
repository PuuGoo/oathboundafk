// PROTOTYPE - NOT FOR PRODUCTION
/**
 * Chuỗi hiệu ứng khi một tướng gục: sàn tối lại dưới chân, một cột sáng dâng lên
 * rồi tan, kèm vài đốm sáng bốc theo. Simulation chỉ báo "ai chết"; toàn bộ nhịp
 * điệu dưới đây là trình diễn thuần và không chạm vào trạng thái trận.
 */
export interface DeathTide {
  /** Bán kính vệt tối dưới sàn (px canvas, đã nhân scale sân). */
  readonly stainRadius: number;
  readonly stainOpacity: number;
  /** Bán kính cột sáng dâng lên. */
  readonly columnRadius: number;
  readonly columnHeight: number;
  readonly columnOpacity: number;
  /** Đốm sáng bốc lên; toạ độ tương đối so với chân. */
  readonly motes: ReadonlyArray<{ x: number; y: number; r: number; alpha: number }>;
  readonly alive: boolean;
}

/** Toàn bộ chuỗi chết sống bao lâu (giây đồng hồ trình diễn). */
export const DEATH_TIDE_SECONDS = 1.15;
/** Mốc bắt đầu tan của cột sáng (giây). */
const DEATH_FADE_START = .7;

const smooth = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/**
 * Trạng thái chuỗi chết ở thời điểm `age`. Cột sáng dâng nhanh trong 0,35 s đầu,
 * đứng một nhịp rồi tan; vệt sàn lan chậm và mờ dần tới cuối cửa sổ.
 */
export function deathTide(age: number, scale = 1, ultimate = false): DeathTide {
  const stage = Math.max(.1, Number.isFinite(scale) ? scale : 1);
  const seconds = Number.isFinite(age) ? Math.max(0, age) : DEATH_TIDE_SECONDS;
  if (seconds >= DEATH_TIDE_SECONDS) {
    return Object.freeze({ stainRadius: 0, stainOpacity: 0, columnRadius: 0, columnHeight: 0,
      columnOpacity: 0, motes: [], alive: false });
  }
  const progress = seconds / DEATH_TIDE_SECONDS;
  const weight = ultimate ? 1.35 : 1;
  const rise = smooth(seconds / .35);
  const fall = 1 - smooth((seconds - .5) / (DEATH_FADE_START - .5));
  const columnOpacity = Math.max(0, Math.min(1, rise * (seconds < .5 ? 1 : fall))) * .55;
  const motes = [0, 1, 2, 3].map(index => {
    // Bốn đốm lệch pha; chúng chỉ sống trong khoảng 0,15–1,0 s.
    const local = Math.max(0, Math.min(1, (seconds - .12 - index * .07) / .7));
    const angle = index * 1.571 + seconds * .9;
    const spread = 16 * stage * weight * (.3 + local * .8);
    return {
      x: Math.cos(angle) * spread,
      y: -local * 46 * stage * weight,
      r: Math.max(.5, (2.6 - local * 1.8) * stage),
      alpha: local <= 0 || local >= 1 ? 0 : Math.sin(local * Math.PI) * .8,
    };
  });
  return Object.freeze({
    stainRadius: (18 + 26 * smooth(progress)) * stage * weight,
    stainOpacity: Math.max(0, 1 - progress) * .34,
    columnRadius: (9 + 5 * rise) * stage * weight,
    columnHeight: (52 * rise) * stage * weight,
    columnOpacity,
    motes,
    alive: true,
  });
}
