// PROTOTYPE - NOT FOR PRODUCTION
/**
 * Hào quang "tuyệt kỹ đã sẵn sàng" dưới chân tướng. Chỉ đọc trạng thái thật của
 * simulation (`getUltimateReadiness`) và biến nó thành một nhịp thở chậm, để người
 * chơi thấy ai đang giữ chiêu cuối mà không phải liếc lên HUD.
 */
export interface ReadyAura {
  /** Bán kính vòng ngoài (px canvas, đã nhân scale sân). */
  readonly radius: number;
  /** Bán kính vòng trong, luôn nhỏ hơn `radius`. */
  readonly inner: number;
  readonly opacity: number;
  readonly lineWidth: number;
  /** Ba hạt sáng bay lên quanh chân; toạ độ tương đối theo bán kính vòng. */
  readonly motes: ReadonlyArray<{ x: number; y: number; r: number; alpha: number }>;
  /** Chỉ vẽ khi 0..1; 0 nghĩa là không vẽ gì. */
  readonly visible: boolean;
}

/** Nhịp thở của hào quang sẵn sàng (rad/giây) và biên độ. */
export const READY_AURA_SPEED = 2.6;
export const READY_AURA_BREATH = .16;

/**
 * Hào quang sẵn sàng ở thời điểm `clock` (giây trình diễn). `charge` 0..1 là độ đầy
 * năng lượng, dùng để vòng còn lớn dần khi gần đầy; `canCast` mới bật hào quang đầy đủ.
 */
export function readyAura(clock: number, charge: number, scale = 1, canCast = true): ReadyAura {
  const stage = Math.max(.1, Number.isFinite(scale) ? scale : 1);
  const seconds = Number.isFinite(clock) ? Math.max(0, clock) : 0;
  const filled = Math.max(0, Math.min(1, Number.isFinite(charge) ? charge : 0));
  if (!canCast) {
    return Object.freeze({ radius: 0, inner: 0, opacity: 0, lineWidth: 0, motes: [], visible: false });
  }
  const breath = 1 + READY_AURA_BREATH * Math.sin(seconds * READY_AURA_SPEED);
  const radius = (30 + 4 * filled) * stage * breath;
  const motes = [0, 1, 2].map(index => {
    // Ba hạt lệch pha 1/3 vòng nên luôn có hạt đang bay, không nhấp nháy cùng lúc.
    const phase = (seconds * .55 + index / 3) % 1;
    const angle = index * 2.094 + seconds * .8;
    return {
      x: Math.cos(angle) * radius * .78,
      y: -phase * radius * .95,
      r: Math.max(.6, (2.2 - phase * 1.4) * stage),
      alpha: Math.max(0, Math.sin(phase * Math.PI)) * .85,
    };
  });
  return Object.freeze({
    radius,
    inner: radius * .72,
    opacity: .3 + .16 * Math.sin(seconds * READY_AURA_SPEED * .5),
    lineWidth: Math.max(.7, 1.3 * stage),
    motes,
    visible: true,
  });
}
