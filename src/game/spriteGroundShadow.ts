// PROTOTYPE - NOT FOR PRODUCTION
/**
 * Bóng tiếp đất dưới chân tướng. Simulation không biết gì về lớp này: chỉ màu,
 * độ mờ và bán kính được suy từ bảng màu sân + nhịp tuyệt kỹ đang cháy.
 */
export interface GroundShadow {
  /** Màu tâm bóng (rgba) — lấy từ `ground` của theme để bóng không bị xám lạnh. */
  readonly core: string;
  /** Màu rìa bóng; luôn trong suốt để bóng tan vào sàn. */
  readonly edge: string;
  /** Bán kính ngang theo scale của sân. */
  readonly radiusX: number;
  /** Bán kính dọc; sàn nghiêng nên bóng dẹt. */
  readonly radiusY: number;
  /** Dịch xuống dưới chân một chút để bóng nằm trên mặt sàn, không cắt ngang cổ chân. */
  readonly offsetY: number;
}

const toRgb = (hex: number): [number, number, number] => [
  (hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff,
];

/**
 * Bóng mềm, ngả theo màu sàn. Khi tuyệt kỹ đang cháy (`flash` 0..1) cả sân sáng lên
 * nên bóng nhạt và loang rộng ra; hero chết thì bóng mờ hẳn.
 */
export function groundShadow(groundHex: number, scale: number, flash = 0,
  alive = true): GroundShadow {
  const [r, g, b] = toRgb(groundHex >>> 0);
  const dark = [r * .22, g * .22, b * .24].map(channel => Math.round(Math.max(0, Math.min(255, channel))));
  const lift = Math.max(0, Math.min(1, Number.isFinite(flash) ? flash : 0));
  const shadowScale = Math.max(.1, Number.isFinite(scale) ? scale : 1);
  const coreAlpha = (alive ? .42 : .16) * (1 - .45 * lift);
  const spread = 1 + .35 * lift;
  return Object.freeze({
    core: `rgba(${dark[0]},${dark[1]},${dark[2]},${coreAlpha.toFixed(3)})`,
    edge: `rgba(${dark[0]},${dark[1]},${dark[2]},0)`,
    radiusX: 26 * shadowScale * spread,
    radiusY: 8 * shadowScale * spread,
    offsetY: 1.5 * shadowScale,
  });
}
