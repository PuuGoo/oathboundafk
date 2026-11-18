// PROTOTYPE - NOT FOR PRODUCTION
/**
 * Lớp tối bốn góc (vignette) cho sân đấu. Mục đích: hạ sáng phần viền để mắt
 * bám vào hai hàng tướng ở giữa, và làm sân 3D trông "có ống kính" thay vì phẳng.
 * Không đổi pixel của tướng hay HUD — chỉ một lớp gradient vẽ trên nền sân.
 */
export interface Vignette {
  /** Toạ độ tâm sáng theo tỷ lệ khung (0..1). */
  readonly centerX: number;
  readonly centerY: number;
  /** Bán kính trong cùng còn sáng hoàn toàn, tính theo bội số của nửa đường chéo. */
  readonly inner: number;
  /** Bán kính ngoài đã tối hết. */
  readonly outer: number;
  /** Độ đậm tối đa 0..1 ở góc. */
  readonly strength: number;
  /** Màu tối lấy từ bảng màu sân để không bị xám lạnh. */
  readonly color: string;
}

const toCss = (hex: number, alpha: number): string => {
  const value = (Number.isFinite(hex) ? hex : 0) >>> 0;
  return `rgba(${(value >> 16) & 0xff},${(value >> 8) & 0xff},${value & 0xff},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
};

/**
 * Vignette theo khung + bảng màu sân. Sân hẹp (mobile) tối ít hơn để không bóp
 * mất hai bên; tuyệt kỹ đang cháy (`flash`) thì nhẹ đi vì cả sân đã sáng.
 */
export function vignetteFor(width: number, height: number, groundHex: number,
  flash = 0): Vignette {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const lift = Math.max(0, Math.min(1, Number.isFinite(flash) ? flash : 0));
  // Khung dọc (tỷ lệ < 1) giữ vignette nhẹ hơn khung ngang để không ăn hai bên.
  const aspect = w / h;
  const narrow = aspect < .8 ? .72 : 1;
  return Object.freeze({
    centerX: .5,
    // Tâm sáng thấp hơn giữa khung vì hai hàng tướng đứng ở 0,57 chiều cao.
    centerY: .55,
    inner: .46,
    outer: 1.08,
    strength: Math.max(0, Math.min(.85, .52 * narrow * (1 - .45 * lift))),
    color: toCss(groundHex, 1),
  });
}

/** Stops của gradient tâm→góc, đã tính alpha theo `strength`. */
export function vignetteStops(vignette: Vignette): Array<{ at: number; color: string }> {
  const rgb = vignette.color.slice(0, vignette.color.lastIndexOf(','));
  const stops = [0, .55, .8, 1].map(at => ({
    at,
    color: `${rgb},${Math.max(0, Math.min(1, vignette.strength * at ** 2.2)).toFixed(3)})`,
  }));
  return stops;
}
