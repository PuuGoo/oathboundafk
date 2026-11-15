// PROTOTYPE - NOT FOR PRODUCTION
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getOathboundSprite, getSpriteFrame } from './oathboundSprites';
import { BattleSimulation } from './battleEngine';
import { getCampaignStage } from './campaign';
import { createInitialData } from '../store/gameStore';
import { OATHBOUND_HEROES } from './oathboundHeroes';
import { HERO_ROSTER } from './heroes';
import { buildThreeHeroRig, disposeThreeHeroRig, updateThreeHeroAnimation } from './threeBattleScene';
import type { TeamFormationSlots } from './types';

/** Fixed fixture covers each transferred identity in a five-slot team. */
function teamAt(start: number): TeamFormationSlots {
  const ids = OATHBOUND_HEROES.slice(start, start + 5).map(hero => hero.heroId);
  while (ids.length < 5) ids.push(OATHBOUND_HEROES[ids.length].heroId);
  return ids as TeamFormationSlots;
}

for (let start = 0; start < OATHBOUND_HEROES.length; start += 5) {
  const team = teamAt(start);
  test(`transferred team ${start / 5 + 1} creates sprite rigs and finishes deterministic target combat`, () => {
    const initial = createInitialData();
    const make = () => new BattleSimulation({
      allyFormation: team,
      ownedHeroes: initial.ownedHeroes,
      enemies: getCampaignStage(1).enemies,
      seed: 2201,
      autoUltimate: true,
      maxDurationMs: 90000,
    });
    const first = make();
    const rigs = first.getUnits().filter(unit => unit.team === 'ally').map(unit => {
      const rig = buildThreeHeroRig(unit, false);
      assert.ok(rig.oathboundSprite, `${unit.heroId} must use imported sprite adapter`);
      assert.equal(rig.oathboundSprite.object.name, `oathbound_${OATHBOUND_HEROES.find(h => h.heroId === unit.heroId)!.sourceId}`);
      updateThreeHeroAnimation(rig, unit, 0, 0, 'running');
      return rig;
    });
    try {
      const second = make();
      for (let step = 0; step < 1800 && first.getStatus() === 'running'; step++) first.step(50);
      for (let step = 0; step < 1800 && second.getStatus() === 'running'; step++) second.step(50);
      assert.notEqual(first.getStatus(), 'running');
      assert.equal(first.getStatus(), second.getStatus());
      assert.deepEqual(first.getUnits().map(u => [u.instanceId, u.hp, u.energy, u.isAlive]),
        second.getUnits().map(u => [u.instanceId, u.hp, u.energy, u.isAlive]));
      for (const unit of first.getUnits()) {
        assert.ok(Number.isFinite(unit.hp) && Number.isFinite(unit.x) && Number.isFinite(unit.y));
      }
    } finally {
      rigs.forEach(disposeThreeHeroRig);
    }
  });
}

/** Checks visible character branches, not arena rings or combat effects. */
test('every catalog hero uses a flat battle body before loading, including enemy identities', () => {
  const initial = createInitialData();
  const simulation = new BattleSimulation({
    allyFormation: teamAt(0), ownedHeroes: initial.ownedHeroes,
    enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: true, maxDurationMs: 90000,
  });
  const template = simulation.getUnits()[0];
  for (const hero of HERO_ROSTER) for (const team of ['ally', 'enemy'] as const) {
    const unit: typeof template = { ...template, team, facing: team === 'enemy' ? -1 : 1,
      heroId: hero.id, heroClass: hero.heroClass, faction: hero.faction };
    const rig = buildThreeHeroRig(unit, false);
    try {
      assert.equal('hips' in rig, false, `${hero.id}: no articulated rig is allocated`);
      const assertEffectsOnly = () => {
        const meshes: THREE.Mesh[] = [];
        rig.root.traverse(node => { if (node instanceof THREE.Mesh) meshes.push(node); });
        assert.equal(meshes.length, 7, `${hero.id}: only shadow, rings and three stun stars`);
        assert.ok(meshes.every(mesh => mesh.material instanceof THREE.MeshBasicMaterial),
          `${hero.id}: no body armor, skin or weapon material`);
      };
      assertEffectsOnly();
      assert.ok(rig.portrait?.object instanceof THREE.Sprite);
      assert.equal(rig.portrait.object.visible, true, `${hero.id}: flat loading fallback`);
      updateThreeHeroAnimation(rig, unit, 0.1, 0.1, 'running');
      assertEffectsOnly();
      unit.isAlive = false; unit.hp = 0;
      updateThreeHeroAnimation(rig, unit, 0.1, 0.2, 'defeat');
      assertEffectsOnly();
      if (!rig.oathboundSprite) {
        assert.equal((rig.portrait.object.material as THREE.SpriteMaterial).opacity, 0.3);
      }
    } finally { disposeThreeHeroRig(rig); }
  }
});

test('actual rig forwards paused and crowd-control clocks without freezing a defeated unit', () => {
  const initial = createInitialData();
  const simulation = new BattleSimulation({
    allyFormation: teamAt(0), ownedHeroes: initial.ownedHeroes,
    enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: true,
    maxDurationMs: 90000,
  });
  const unit = simulation.getUnits().find(unit => unit.heroId === 'celestial_guardian')!;
  const rig = buildThreeHeroRig(unit, false);
  const adapter = rig.oathboundSprite!;
  const calls: Parameters<typeof adapter.update>[] = [];
  const original = adapter.update;
  adapter.update = (...args) => { calls.push(args); original(...args); };
  try {
    updateThreeHeroAnimation(rig, unit, 0, 0, 'running');
    assert.equal(calls.at(-1)![1], 0, 'paused frame passes no animation time');
    unit.statusEffects = [{ id: 'fixture-cc', type: 'petrify', durationMs: 1000,
      remainingMs: 1000, magnitude: 0, sourceUnitId: unit.instanceId }];
    updateThreeHeroAnimation(rig, unit, 0.2, 1, 'running');
    assert.equal(rig.animState, 'Stun');
    assert.equal(calls.at(-1)![1], 0);
    assert.equal(calls.at(-1)![4], true, 'petrify tint retained');
    unit.isAlive = false; unit.hp = 0;
    updateThreeHeroAnimation(rig, unit, 0.2, 2, 'running');
    assert.equal(rig.animState, 'Defeat');
    assert.equal(calls.at(-1)![0], 'death');
    assert.equal(calls.at(-1)![1], 0.2, 'death animation advances despite stale control status');
    assert.equal(rig.stunRing.visible, false);
    assert.equal(rig.shieldDome.visible, false);
  } finally { disposeThreeHeroRig(rig); }
});

test('loaded actual rig freezes paused and petrified atlas frames but completes death', () => {
  const initial = createInitialData();
  const simulation = new BattleSimulation({
    allyFormation: teamAt(0), ownedHeroes: initial.ownedHeroes,
    enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: true,
    maxDurationMs: 90000,
  });
  const unit = simulation.getUnits().find(unit => unit.heroId === 'celestial_guardian')!;
  const spec = getOathboundSprite(44)!;
  const originalLoad = THREE.TextureLoader.prototype.load;
  const originalDocument = globalThis.document;
  let finish: (() => void) | undefined;
  (globalThis as any).document = {};
  THREE.TextureLoader.prototype.load = function (_url, onLoad) {
    const texture = new THREE.Texture<HTMLImageElement>();
    finish = () => onLoad?.(texture);
    return texture;
  };
  let rig: ReturnType<typeof buildThreeHeroRig> | undefined;
  try {
    rig = buildThreeHeroRig(unit, false);
    assert.ok(finish, 'actual rig must request its imported texture');
    finish();
    const material = rig.oathboundSprite!.object.material as THREE.SpriteMaterial;
    const texture = material.map!;
    const assertFrame = (clip: string, seconds: number) => {
      const frame = getSpriteFrame(spec, clip, seconds, (spec.facing === 'left') !== (unit.facing < 0));
      assert.deepEqual(texture.offset.toArray(), [frame.offsetX, frame.offsetY]);
      assert.deepEqual(texture.repeat.toArray(), [frame.repeatX, frame.repeatY]);
    };
    unit.lastActionType = 'idle';
    updateThreeHeroAnimation(rig, unit, 0, 0, 'running');
    updateThreeHeroAnimation(rig, unit, 0.2, 0.2, 'running');
    assertFrame('idle', 0.2);
    updateThreeHeroAnimation(rig, unit, 0, 0.2, 'running');
    assertFrame('idle', 0.2);
    unit.statusEffects = [{ id: 'fixture-loaded-cc', type: 'petrify', durationMs: 1000,
      remainingMs: 1000, magnitude: 0, sourceUnitId: unit.instanceId }];
    updateThreeHeroAnimation(rig, unit, 0.2, 0.4, 'running');
    assertFrame('idle', 0.2);
    assert.equal(material.color.getHex(), 0x94a3b8);
    unit.statusEffects = [];
    updateThreeHeroAnimation(rig, unit, 0.2, 0.6, 'running');
    assertFrame('idle', 0.4);
    assert.equal(material.color.getHex(), 0xffffff);
    unit.statusEffects = [{ id: 'fixture-loaded-stun', type: 'stun', durationMs: 1000,
      remainingMs: 1000, magnitude: 0, sourceUnitId: unit.instanceId }];
    unit.isAlive = false; unit.hp = 0;
    updateThreeHeroAnimation(rig, unit, 0.2, 0.8, 'running');
    assertFrame('death', 0);
    updateThreeHeroAnimation(rig, unit, 0.2, 1, 'running');
    assertFrame('death', 0.2);
    const duration = rig.oathboundSprite!.duration('death');
    updateThreeHeroAnimation(rig, unit, duration, 1 + duration, 'running');
    assertFrame('death', duration + 0.2);
    const finalOffset = texture.offset.clone();
    updateThreeHeroAnimation(rig, unit, duration, 1 + duration * 2, 'running');
    assert.deepEqual(texture.offset, finalOffset, 'death holds its final frame');
    assert.equal(rig.oathboundSprite!.object.visible, true);
    assert.equal('hips' in rig, false);
    assert.equal(rig.stunRing.visible, false);
  } finally {
    if (rig) disposeThreeHeroRig(rig);
    THREE.TextureLoader.prototype.load = originalLoad;
    if (originalDocument === undefined) delete (globalThis as any).document;
    else globalThis.document = originalDocument;
  }
});
