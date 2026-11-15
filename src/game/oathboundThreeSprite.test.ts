// PROTOTYPE - NOT FOR PRODUCTION
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOathboundThreeSprite } from './oathboundThreeSprite';
import { OATHBOUND_SPRITES } from './oathboundSprites';

/** Supplies a controlled image loader, without DOM, filesystem or GPU access. */
function withLoader(run: (loaded: () => void, failed: () => void) => void) {
  const original = THREE.TextureLoader.prototype.load;
  const originalDocument = globalThis.document;
  let finish: (() => void) | undefined;
  let fail: (() => void) | undefined;
  (globalThis as any).document = {};
  THREE.TextureLoader.prototype.load = function (_url, onLoad, _progress, onError) {
    const texture = new THREE.Texture<HTMLImageElement>();
    finish = () => onLoad?.(texture);
    fail = () => onError?.(new Error('fixture missing image'));
    return texture;
  };
  try { run(() => finish?.(), () => fail?.()); }
  finally {
    THREE.TextureLoader.prototype.load = original;
    if (originalDocument === undefined) delete (globalThis as any).document;
    else globalThis.document = originalDocument;
  }
}

test('sprite becomes visible only after a single valid atlas frame is configured', () => {
  withLoader(loaded => {
    const fallback = new THREE.Group();
    const rig = createOathboundThreeSprite(OATHBOUND_SPRITES[1], fallback);
    assert.equal(rig.object.visible, false);
    loaded();
    assert.equal(rig.object.visible, false, 'loading callback must not flash the entire sheet');
    rig.update('idle', 0, 1, false, false);
    assert.equal(rig.object.visible, true);
    assert.equal((rig.object.material as THREE.SpriteMaterial).fog, false,
      'character artwork must not be washed out by arena distance fog');
    assert.equal(fallback.visible, false);
    const texture = (rig.object.material as THREE.SpriteMaterial).map!;
    assert.ok(texture.repeat.x < 1);
    rig.dispose();
  });
});

test('nonfinite deltas do not poison future animation and pause keeps the same crop', () => {
  withLoader(loaded => {
    const rig = createOathboundThreeSprite(OATHBOUND_SPRITES[1], new THREE.Group());
    loaded(); rig.update('idle', 0, 1, false, false);
    rig.update('idle', Number.NaN, 1, false, false);
    rig.update('idle', Number.POSITIVE_INFINITY, 1, false, false);
    rig.update('idle', 0.2, 1, false, false);
    const texture = (rig.object.material as THREE.SpriteMaterial).map!;
    const offset = texture.offset.x;
    assert.ok(offset > 0, 'animation should advance after invalid deltas');
    rig.update('idle', 0, 1, false, false);
    assert.equal(texture.offset.x, offset);
    rig.restart(); rig.update('idle', 0, 1, false, false);
    assert.equal(texture.offset.x, 0);
    rig.dispose();
  });
});

test('failed image retains fallback and a disposed rig ignores late image completion', () => {
  withLoader((loaded, failed) => {
    const fallback = new THREE.Group();
    const rig = createOathboundThreeSprite(OATHBOUND_SPRITES[1], fallback);
    failed();
    assert.equal(fallback.visible, true);
    assert.equal(rig.object.visible, false);
    rig.dispose(); loaded();
    assert.equal(fallback.visible, true);
    assert.equal(rig.object.visible, false);
    rig.dispose();
  });
});

test('two copies of the same hero keep independent texture, facing and animation lifetimes', () => {
  withLoader(loaded => {
    const spec = OATHBOUND_SPRITES[1];
    const first = createOathboundThreeSprite(spec, new THREE.Group());
    loaded(); first.update('idle', 0, 1, false, false);
    const second = createOathboundThreeSprite(spec, new THREE.Group());
    loaded(); second.update('idle', 0, -1, false, false);
    const firstMap = (first.object.material as THREE.SpriteMaterial).map!;
    const secondMap = (second.object.material as THREE.SpriteMaterial).map!;
    assert.notEqual(firstMap, secondMap);
    const secondOffset = secondMap.offset.clone();
    first.update('idle', 0.2, 1, false, false);
    assert.ok(firstMap.offset.x > 0);
    assert.ok(firstMap.repeat.x > 0);
    assert.ok(secondMap.repeat.x < 0);
    assert.deepEqual(secondMap.offset, secondOffset);
    first.dispose();
    second.update('idle', 0.2, -1, false, false);
    assert.equal(second.object.visible, true);
    assert.notEqual(secondMap.offset.x, secondOffset.x);
    second.dispose();
  });
});

test('disposing a loaded sprite releases owned GPU resources once and detaches its object', () => {
  withLoader(loaded => {
    const rig = createOathboundThreeSprite(OATHBOUND_SPRITES[1], new THREE.Group());
    const parent = new THREE.Group(); parent.add(rig.object);
    loaded(); rig.update('idle', 0, 1, false, false);
    const material = rig.object.material as THREE.SpriteMaterial;
    let materialsDisposed = 0, texturesDisposed = 0;
    material.addEventListener('dispose', () => materialsDisposed++);
    material.map!.addEventListener('dispose', () => texturesDisposed++);
    rig.dispose(); rig.dispose();
    assert.equal(materialsDisposed, 1);
    assert.equal(texturesDisposed, 1);
    assert.equal(rig.object.parent, null);
    assert.deepEqual(parent.children, []);
  });
});

test('all imported loaded clips and both facings retain finite in-bounds texture state', () => {
  withLoader(loaded => {
    for (const spec of OATHBOUND_SPRITES) {
      const rig = createOathboundThreeSprite(spec, new THREE.Group());
      loaded();
      const texture = (rig.object.material as THREE.SpriteMaterial).map!;
      for (const clip of [...Object.keys(spec.clips), ...Object.keys(spec.aliases)]) {
        for (const facing of [-1, 1]) {
          rig.restart();
          rig.update(clip, 0, facing, false, false);
          rig.update(clip, 1000, facing, false, false);
          const values = [...texture.offset.toArray(), ...texture.repeat.toArray(), ...rig.object.scale.toArray(), ...rig.object.center.toArray()];
          assert.ok(values.every(Number.isFinite), `${spec.sourceId}/${clip}/${facing}`);
          for (const [offset, repeat] of [[texture.offset.x, texture.repeat.x], [texture.offset.y, texture.repeat.y]]) {
            assert.ok(Math.min(offset, offset + repeat) >= -Number.EPSILON * 4);
            assert.ok(Math.max(offset, offset + repeat) <= 1 + Number.EPSILON * 4);
          }
          assert.equal(rig.object.visible, true);
        }
      }
      rig.dispose();
    }
  });
});

test('mounted Estrilda keeps full character scale instead of shrinking its 181px cells to 256px', () => {
  withLoader(loaded => {
    const spec = OATHBOUND_SPRITES.find(s => s.sourceId === 'lancer')!;
    const rig = createOathboundThreeSprite(spec, new THREE.Group());
    try {
      loaded(); rig.update('idle', 0, 1, false, false);
      assert.equal(rig.object.scale.x, 2.8);
      assert.equal(rig.object.scale.y, 2.8 * spec.clips.idle.height / spec.cellWidth);
      rig.update('skillArc', 0, 1, false, false);
      assert.equal(rig.object.scale.x, 2.8, 'effects row must not shrink the rider');
      assert.equal(rig.object.scale.y, 2.8 * spec.clips.skillArc.height / spec.cellWidth);
    } finally { rig.dispose(); }
  });
});

test('authored action duration includes every frame rather than procedural timer truncation', () => {
  const sonja = OATHBOUND_SPRITES.find(s => s.sourceId === 'sonja')!;
  const rig = createOathboundThreeSprite(sonja, new THREE.Group());
  assert.equal(rig.duration('attack'), sonja.clips.attack.count / sonja.clips.attack.fps);
  assert.ok(rig.duration('attack') > 0.34);
  rig.dispose();
});
