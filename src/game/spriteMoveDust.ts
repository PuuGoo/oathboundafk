// PROTOTYPE - NOT FOR PRODUCTION
/**
 * Bụi cuốn dưới chân khi tướng di chuyển. Simulation chỉ nói "đang chạy"; hình
 * dạng, màu và nhịp tan ở đây là trình diễn thuần, không đổi tốc độ hay vị trí.
 */
export interface DustPuff {
  /** Dịch ngang so với chân, px canvas (đã nhân scale sân). */
  readonly dx: number;
  /** Dịch dọc (âm là bốc lên). */
  readonly dy: number;
  readonly radius: number;
  readonly opacity: number;
  readonly color: string;
  readonly alive: boolean;
}

/** Một hạt bụi sống bao lâu (giây đồng hồ trình diễn). */
export const MOVE_DUST_SECONDS = .34;
/** Khoảng cách giữa hai hạt khi đang chạy. */
export const MOVE_DUST_INTERVAL = .09;

const toRgb = (hex: number): [number, number, number] => [
  (hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff,
];

/** Hash ổn định để mỗi hạt lệch hướng mà không cần RNG trong vòng vẽ. */
const hash = (seed: number, salt: number): number => {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * Trạng thái một hạt bụi ở thời điểm `age`. Bụi sáng hơn sàn một chút — như thể ánh
 * sân hắt lên hạt cát — rồi tan hẳn; hạt nặng hơn (gần chân) rơi xuống chậm.
 */
export function dustPuff(age: number, seed: number, scale = 1, groundHex = 0x8d7250,
  facing = 1): DustPuff {
  const stage = Math.max(.1, Number.isFinite(scale) ? scale : 1);
  const seconds = Number.isFinite(age) ? Math.max(0, age) : MOVE_DUST_SECONDS;
  const [r, g, b] = toRgb(groundHex >>> 0);
  const lift = .55;
  const color = `rgba(${Math.round(Math.min(255, r * 1.35 + 24))},`
    + `${Math.round(Math.min(255, g * 1.32 + 22))},`
    + `${Math.round(Math.min(255, b * 1.3 + 20))},`;
  if (seconds >= MOVE_DUST_SECONDS) {
    return Object.freeze({ dx: 0, dy: 0, radius: 0, opacity: 0, color: `${color}0)`, alive: false });
  }
  const progress = seconds / MOVE_DUST_SECONDS;
  // Bụi bung ra rồi chậm lại; hướng ngược chiều chạy để đọc được đang lao tới đâu.
  const spread = (1 - (1 - progress) ** 2.2);
  const drift = (hash(seed, 2) - .5) * 2;
  // Độ lệch chỉ làm hạt bụi toả rộng hơn, không bao giờ vượt lên trước bàn chân.
  const back = Math.max(.8, 3 + 9 * spread + drift * 1.2 * spread);
  return Object.freeze({
    dx: -facing * back * stage,
    dy: -lift * progress * 7 * stage,
    radius: (1.6 + 3.4 * spread) * stage,
    opacity: Math.max(0, (1 - progress) ** 1.7 * .5),
    color: `${color}${Math.max(0, Math.min(1, (1 - progress) ** 1.7 * .5)).toFixed(3)})`,
    alive: true,
  });
}
