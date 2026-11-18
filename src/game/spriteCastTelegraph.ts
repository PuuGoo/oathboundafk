// PROTOTYPE - NOT FOR PRODUCTION
/**
 * Vòng niệm dưới chân người tung chiêu: đầy dần tới mốc phóng chiêu (release) rồi
 * tan khi đòn đã ra. Simulation đã có timeline thật nên lớp này chỉ đọc lại mốc đó,
 * không tự đặt nhịp và không đổi bất kỳ con số nào của trận.
 */
export interface CastTelegraph {
  /** Bán kính vòng theo scale sân. */
  readonly radius: number;
  /** 0..1 phần vòng đã đầy (tới mốc phóng chiêu). */
  readonly charge: number;
  /** 0..1 độ mờ tổng; tan nhanh sau khi chiêu đã ra. */
  readonly opacity: number;
  readonly lineWidth: number;
  /** Vòng còn hiển thị hay đã xong. */
  readonly alive: boolean;
  /** Đã qua mốc phóng chiêu: dùng để vẽ nhịp loé ở tâm. */
  readonly released: boolean;
}

/** Vòng tan trong bao lâu sau mốc phóng chiêu (giây đồng hồ trình diễn). */
export const CAST_TELEGRAPH_FADE = .22;

const smooth = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/**
 * Trạng thái vòng niệm ở thời điểm `age` (giây kể từ lúc bắt đầu niệm).
 * `release` là mốc phóng chiêu trong timeline thật; thiếu thì lấy 40 % thời lượng.
 */
export function castTelegraph(age: number, duration: number, release: number,
  scale = 1, focus = 1): CastTelegraph {
  const total = Number.isFinite(duration) && duration > 0 ? duration : .3;
  // Tuổi hoặc thời lượng hỏng thì coi như vòng đã niệm xong, không để NaN lan vào hình học.
  const seconds = Number.isFinite(age) ? Math.max(0, age) : total;
  const fire = Number.isFinite(release) && release > 0 ? Math.min(release, total) : total * .4;
  const stage = Math.max(.1, Number.isFinite(scale) ? scale : 1);
  const weight = Math.max(.3, Math.min(1.6, Number.isFinite(focus) ? focus : 1));
  if (seconds >= fire + CAST_TELEGRAPH_FADE) {
    return Object.freeze({ radius: 0, charge: 1, opacity: 0, lineWidth: 0, alive: false, released: true });
  }
  const released = seconds >= fire - 1e-9;
  const charge = smooth(seconds / Math.max(.001, fire));
  const fade = released ? 1 - (seconds - fire) / CAST_TELEGRAPH_FADE : 1;
  return Object.freeze({
    radius: (22 + 10 * weight) * stage * (1 + .12 * charge),
    charge,
    opacity: Math.max(0, Math.min(1, (.28 + .42 * charge) * fade)),
    lineWidth: Math.max(.7, (1.6 + 1.8 * weight) * stage * (.6 + .4 * charge)),
    alive: true,
    released,
  });
}
