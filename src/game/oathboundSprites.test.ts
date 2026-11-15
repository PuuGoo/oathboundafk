// PROTOTYPE - NOT FOR PRODUCTION
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpriteFrame, resolveSpriteClip, OATHBOUND_SPRITES, type OathboundSpriteSpec } from './oathboundSprites';
import { OATHBOUND_HEROES } from './oathboundHeroes';

test('packaged manifest covers all identities and every authored frame stays within its image', () => {
  assert.equal(OATHBOUND_SPRITES.length, OATHBOUND_HEROES.length);
  assert.equal(new Set(OATHBOUND_SPRITES.map(s => s.unitId)).size, 22);
  for (const hero of OATHBOUND_HEROES) {
    const spec = OATHBOUND_SPRITES.find(s => s.unitId === hero.unitId);
    assert.ok(spec, hero.name);
    assert.equal(spec.sourceId, hero.sourceId);
    assert.ok(spec.src.startsWith('/assets/oathbound/'));
    assert.ok(spec.clips.idle);
    for (const [name, clip] of Object.entries(spec.clips)) {
      assert.ok(Number.isInteger(clip.count) && clip.count > 0, `${hero.name}/${name} count`);
      assert.ok(clip.count * spec.cellWidth <= spec.width, `${hero.name}/${name} width`);
      assert.ok(clip.y >= 0 && clip.y + clip.height <= spec.height, `${hero.name}/${name} height`);
      assert.ok(clip.groundY >= 0 && clip.groundY <= clip.height, `${hero.name}/${name} anchor`);
      assert.ok(clip.fps > 0, `${hero.name}/${name} fps`);
    }
  }
});

function atlas(): OathboundSpriteSpec {
  return {
    sourceId: 'fixture', unitId: 0, name: 'Fixture', src: '/fixture.png',
    width: 1086, height: 1448, cellWidth: 181, anchorX: 85, scale: 1,
    clips: {
      idle: { y: 0, height: 183, count: 6, groundY: 176, fps: 8 },
      attack: { y: 183, height: 174, count: 6, groundY: 166, fps: 15 },
      death: { y: 541, height: 182, count: 6, groundY: 171, fps: 12 },
    },
    aliases: { skill: 'attack' }, limitation: 'Test fixture',
  };
}

test('irregular atlas crops preserve row, ground anchor and texture orientation', () => {
  const spec = atlas();
  const frame = getSpriteFrame(spec, 'attack', 0, false);
  assert.equal(frame.x, 0);
  assert.equal(frame.y, 183);
  assert.equal(frame.height, 174);
  assert.equal(frame.centerX, 85 / 181);
  assert.equal(frame.centerY, 1 - 166 / 174);
  assert.equal(frame.offsetY, 1 - (183 + 174) / 1448);
});

test('idle loops but non-looping action/death hold their last authored frame', () => {
  const spec = atlas();
  assert.equal(getSpriteFrame(spec, 'idle', 6 / 8, false).index, 0);
  assert.equal(getSpriteFrame(spec, 'attack', 100, false).index, 5);
  assert.equal(getSpriteFrame(spec, 'death', 100, false).index, 5);
});

test('mirrored UV stays inside exactly the same atlas cell', () => {
  const spec = atlas();
  const normal = getSpriteFrame(spec, 'attack', 1 / 15, false);
  const mirrored = getSpriteFrame(spec, 'attack', 1 / 15, true);
  assert.equal(mirrored.repeatX, -normal.repeatX);
  assert.equal(mirrored.offsetX, normal.offsetX + normal.repeatX);
  assert.equal(mirrored.centerX, 1 - normal.centerX);
});

test('missing clips and circular aliases safely fall back to idle', () => {
  const spec = atlas();
  assert.equal(resolveSpriteClip(spec, 'skill'), 'attack');
  assert.equal(resolveSpriteClip(spec, 'run'), 'idle');
  spec.aliases.a = 'b'; spec.aliases.b = 'a';
  assert.equal(resolveSpriteClip(spec, 'a'), 'idle');
});

test('static portraits never sample padded cells even after long battles', () => {
  const spec = atlas();
  spec.clips = { idle: { y: 0, height: 256, count: 1, groundY: 220, fps: 8 } };
  assert.equal(getSpriteFrame(spec, 'skill', 1000, false).index, 0);
  assert.equal(getSpriteFrame(spec, 'skill', -1, false).index, 0);
});
