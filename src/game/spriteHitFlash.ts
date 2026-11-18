// PROTOTYPE - NOT FOR PRODUCTION
/**
 * Nhịp loé khi trúng đòn. Simulation không cung cấp "màu đòn"; ở đây chỉ suy ra từ
 * phía người trúng và độ mạnh của cú đánh để mắt đọc được ai vừa ăn đòn.
 */
export interface HitFlashInput {
  /** `actor.flash` còn lại (giây); ≤ 0 nghĩa là không loé. */
  readonly flash: number;
  /** Phía người trúng: đồng minh ăn đòn địch (đỏ), địch ăn đòn ta (vàng). */
  readonly team: 'ally' | 'enemy';
  /** Đang bị hoá đá: ưu tiên hơn mọi nhịp loé. */
  readonly petrified?: boolean;
  /** Preset thấp: bỏ phần nhuộm màu, chỉ giữ tăng sáng để đỡ tốn bộ lọc. */
  readonly low?: boolean;
}

/** Độ mạnh tối đa của một nhịp loé (giây), khớp `hit.flash` trong canvas. */
export const HIT_FLASH_SECONDS = .12;

/**
 * Chuỗi `ctx.filter` cho khung hiện tại. Trả `'none'` khi không loé để caller gán
 * thẳng mà không phải kiểm tra thêm. Hàm thuần: cùng đầu vào cho cùng chuỗi.
 */
export function hitFlashFilter(input: HitFlashInput): string {
  if (input.petrified) return 'grayscale(1)';
  const flash = Number.isFinite(input.flash) ? input.flash : 0;
  if (flash <= 0) return 'none';
  // Cú càng mạnh (flash càng gần HIT_FLASH_SECONDS) thì loé càng rõ.
  const power = Math.max(0, Math.min(1, flash / HIT_FLASH_SECONDS));
  const brightness = (1.35 + .5 * power).toFixed(2);
  if (input.low) return `brightness(${brightness})`;
  const tint = input.team === 'ally' ? 'rgba(255,120,96,.42)' : 'rgba(255,226,150,.38)';
  // Nhuộm màu bằng drop-shadow cùng kênh alpha: không đổi silhouette, chỉ thêm ánh.
  return `brightness(${brightness}) drop-shadow(0 0 ${Math.round(2 + 4 * power)}px ${tint})`;
}
