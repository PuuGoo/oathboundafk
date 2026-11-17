// PROTOTYPE - NOT FOR PRODUCTION
import { Color, SRGBColorSpace } from 'three';

/**
 * Giá trị `fogColor` mà three upload lên GPU khi render thẳng ra canvas.
 *
 * `WebGLMaterials.refreshFogUniforms` dùng `fog.color.getRGB(target, getUnlitUniformColorSpace(renderer))`;
 * với render target mặc định, `getUnlitUniformColorSpace` trả `renderer.outputColorSpace`, và hero3d.ts
 * đặt `outputColorSpace = SRGBColorSpace`. Vì `Fog` nhận hex qua `setHex` (coi là sRGB, lưu linear-sRGB),
 * kênh upload là sRGB — không phải working (linear-sRGB) như `new Color(hex).toArray()`.
 *
 * @param {number} groundHex
 * @param {string} [outputColorSpace]
 * @returns {number[]}
 */
export function canvasFogColor(groundHex, outputColorSpace = SRGBColorSpace) {
  return new Color().setHex(groundHex).getRGB(new Color(), outputColorSpace).toArray();
}
