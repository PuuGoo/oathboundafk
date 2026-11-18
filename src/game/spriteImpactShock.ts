// PROTOTYPE - NOT FOR PRODUCTION
/**
 * Vòng xung kích dưới điểm chạm. Simulation chỉ cho biết ai trúng đòn; hình dạng,
 * màu và nhịp tan ở đây là trình diễn thuần và không đổi bất kỳ con số nào của trận.
 */
export interface ImpactShock {
  /** Bán kính hiện tại (px canvas, đã nhân scale sân). */
  readonly radius: number;
  /** Độ dày nét; bẹp dần khi vòng loang ra. */
  readonly lineWidth: number;
  /** Độ mờ 0..1 của vòng. */
  readonly opacity: number;
  /** Độ dẹt theo trục dọc cho khớp mặt sàn nghiêng. */
  readonly flatten: number;
  readonly alive: boolean;
}

/** Vòng chỉ tồn tại trong khoảng này (giây đồng hồ trình diễn). */
export const IMPACT_SHOCK_SECONDS = .42;

/**
 * Một vòng xung kích loang từ điểm chạm rồi tan. `strength` 0..1 cho biết đòn nặng
 * đến đâu: đòn thường là vòng nhỏ, tuyệt kỹ bung rộng gấp đôi. Hàm thuần để test
 * được nhịp tan mà không cần canvas.
 */
export function impactShock(age: number, strength = 1, scale = 1): ImpactShock {
  const seconds = Number.isFinite(age) ? Math.max(0, age) : IMPACT_SHOCK_SECONDS;
  const power = Math.max(0, Math.min(1.6, Number.isFinite(strength) ? strength : 1));
  const stage = Math.max(.1, Number.isFinite(scale) ? scale : 1);
  if (seconds >= IMPACT_SHOCK_SECONDS) {
    return Object.freeze({ radius: 0, lineWidth: 0, opacity: 0, flatten: .34, alive: false });
  }
  const progress = seconds / IMPACT_SHOCK_SECONDS;
  // Nhanh lúc đầu, chậm dần về cuối: cùng một cú nện nhưng đọc ra lực.
  const eased = 1 - (1 - progress) ** 3;
  return Object.freeze({
    radius: (10 + 44 * power) * stage * eased,
    lineWidth: Math.max(.6, (3.4 - 2.6 * progress) * stage * Math.min(1, power + .35)),
    opacity: (1 - progress) ** 1.6 * Math.min(1, .5 + .5 * power),
    flatten: .32 + .06 * progress,
    alive: progress < 1,
  });
}
