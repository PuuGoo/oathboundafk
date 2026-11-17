// PROTOTYPE - NOT FOR PRODUCTION
// Regression: QA runtime phải so fogColor với kênh sRGB mà three upload cho canvas,
// không phải kênh linear-sRGB của `new Color(hex).toArray()`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Color, Fog, SRGBColorSpace } from 'three';
import { WebGLMaterials } from 'three/src/renderers/webgl/WebGLMaterials.js';
import { arenaLighting, ARENA_DEFINITIONS } from '../src/game/arena3d.ts';
import { canvasFogColor } from './arena-fog-colour.mjs';

// Dung sai verifier đang dùng cho từng kênh fogColor.
const TOLERANCE = 1e-5;

/** Đường upload thật của three khi vẽ thẳng ra canvas: chưa có render target, output sRGB. */
function uploadedFogColor(ground) {
  const renderer = { getRenderTarget: () => null, outputColorSpace: SRGBColorSpace };
  const uniforms = { fogColor: { value: new Color() }, fogNear: { value: 0 }, fogFar: { value: 0 } };
  WebGLMaterials(renderer).refreshFogUniforms(uniforms, new Fog(ground, 400, 610));
  return uniforms.fogColor.value.toArray();
}

const matches = (expected, actual) => expected.every((channel, index) => Math.abs(channel - actual[index]) <= TOLERANCE);

test('the verifier expects the sRGB fogColor three uploads for a direct canvas', () => {
  for (const { id } of ARENA_DEFINITIONS) {
    const ground = arenaLighting(id).ground;
    assert.ok(matches(canvasFogColor(ground), uploadedFogColor(ground)), `wrong fogColor expectation for ${id}`);
  }
});

test('the linear-sRGB toArray expectation is rejected at the verifier tolerance', () => {
  // temple ground 0x8d7250: linear ≈ .266/.168/.080, sRGB upload ≈ .553/.447/.314.
  const ground = arenaLighting('temple').ground;
  const uploaded = uploadedFogColor(ground);
  const linear = new Color(ground).toArray();
  assert.equal(matches(linear, uploaded), false, 'linear-sRGB must not match the sRGB upload');
  assert.equal(matches(canvasFogColor(ground), uploaded), true);
});
