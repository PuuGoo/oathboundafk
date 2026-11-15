// PROTOTYPE - NOT FOR PRODUCTION
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeroUltimateBar, ClassicSettingsModal, PopupModal } from '../components/ClassicUiKit';
import assert from 'node:assert/strict';
import { getOathboundSprite } from './oathboundSprites';
import { createSpriteActor, advanceSpriteActor, drawSpriteActor, projectSpritePosition, getSpriteBattleScale, startSpriteAction, getSpriteActionPose, resolveSpriteArena, selectSpriteActionClip } from './spriteBattleRenderer';
import { createSpriteEffect, advanceSpriteEffects, drawSpriteEffects, resolveSpriteEffectTarget, advancePresentationClock, getActiveSkillSources, getActiveImpactSources } from './spriteBattleEffects';
import { addCombatText, advanceCombatTexts, layoutCombatTexts } from './spriteCombatText';
import { addUltimateAnnouncement, advanceUltimateAnnouncements, getUltimateAnnouncementView, type UltimateAnnouncement } from './spriteUltimateAnnouncements';
import { getSpriteUnitStatus, drawSpriteUnitStatus, layoutSpriteUnitStatuses, drawSpriteShieldStatus, getSpriteUnitOverlayBounds } from './spriteUnitStatus';
import { getUltimateReadiness } from './ultimateReadiness';
import presentation from './spritePresentation.json';
import type { CombatEvent, TeamFormationSlots } from './types';
import { getHeroById } from './heroes';
import { BattleSimulation } from './battleEngine';
import { getCampaignStage } from './campaign';
import { createInitialData } from '../store/gameStore';
import { containDialogFocus } from '../components/dialogFocus';
import { BattlePauseModal } from '../components/BattlePauseModal';
import { OATHBOUND_HEROES } from './oathboundHeroes';
import { getSpriteSkillArt, drawSpriteSkillArt } from './spriteSkillArt';

test('all 22 imported heroes route actual active and ultimate choreography through their real outcomes', () => {
  for (const hero of OATHBOUND_HEROES) {
    const initial = createInitialData();
    const formation = [hero.heroId, ...initial.formation.filter(id => id !== hero.heroId)].slice(0, 5) as TeamFormationSlots;
    const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, owned]) => [id,
      { ...owned, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
    const makeSimulation = () => new BattleSimulation({ allyFormation: formation, ownedHeroes,
      enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    for (const slot of ['active', 'ultimate'] as const) {
      const sim = makeSimulation();
      const source = sim.getUnits().find(unit => unit.heroId === hero.heroId && unit.team === 'ally')!;
      sim.consumeEvents();
      let entries: CombatEvent[] = [];
      if (slot === 'ultimate') {
        assert.equal(sim.triggerUltimate(source.instanceId, true), true, `${hero.name}: controlled ultimate must execute`);
        entries = sim.consumeEvents();
      } else {
        for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
          sim.step(50); entries = sim.consumeEvents();
          if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
        }
      }
      const cast = entries.find(event => event.sourceId === source.instanceId && event.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
      assert.ok(cast, `${hero.name}/${slot}: real event required`);
      const skill = getHeroById(hero.heroId).skills[slot];
      const supportive = ['all_allies', 'lowest_hp_ally', 'self'].includes(skill.targetType);
      const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, skill.targetType);
      assert.equal(target.team === source.team, supportive, `${hero.name}/${slot}: real target category`);
      const outcomes = entries.filter(event => event.sourceId === source.instanceId && event.castId === cast.id && event.targetId);
      assert.ok(outcomes.some(event => event.targetId === target.instanceId &&
        (supportive ? ['heal', 'shield', 'buff'] : ['damage', 'crowd_control', 'knockback']).includes(event.type)),
        `${hero.name}/${slot}: anchor must be an actual outcome recipient`);
      const effect = createSpriteEffect(cast, source, target)!;
      assert.equal(effect.support, supportive);
      assert.equal(effect.sourceHeroId, hero.heroId);
      assert.equal(effect.skillSlot, slot);
      assert.deepEqual(effect.target, { x: target.x, y: target.y });
      for (const event of outcomes) {
        const recipient = sim.getUnits().find(unit => unit.instanceId === event.targetId)!;
        assert.ok(recipient, `${hero.name}/${slot}: no invented recipient`);
        const outcome = createSpriteEffect(event, source, recipient);
        if (!outcome) continue;
        assert.equal(outcome.sourceHeroId, hero.heroId);
        assert.equal(outcome.skillSlot, slot);
        assert.deepEqual(outcome.target, { x: recipient.x, y: recipient.y });
        if (event.type === 'buff') assert.equal(outcome.supportBuff, event.buffType);
        if (event.type === 'shield') assert.equal(outcome.supportBuff, undefined, 'shield HP is not a stat buff');
      }
    }
  }
});

test('active skill diagnostics include only live cast choreography, deduplicate identities and never mutate effects', () => {
  const source = fixture();
  const enemy = { ...source, instanceId: 'enemy', team: 'enemy' as const };
  const active = createSpriteEffect({ id: 710, timestampMs: 0, type: 'active_skill', sourceId: source.instanceId, sourceName: source.name }, source, enemy)!;
  active.age = active.duration * 0.42;
  const effects = [active, { ...active, id: 711 }, { ...active, id: 712, sourceHeroId: 'second-hero' },
    { ...active, id: 713, kind: 'impact' as const }, { ...active, id: 714, skillSlot: 'ultimate' as const },
    { ...active, id: 717, sourceHeroId: 'enemy-copy', sourceTeam: 'enemy' as const },
    { ...active, id: 715, sourceHeroId: 'expired', age: active.duration },
    { ...active, id: 716, sourceHeroId: 'not-visible-yet', age: 0 }];
  const before = structuredClone(effects);
  assert.deepEqual(getActiveSkillSources(effects), [source.heroId, 'second-hero']);
  assert.deepEqual(getActiveSkillSources([]), []);
  assert.deepEqual(effects, before);
  advanceSpriteEffects(effects, active.duration);
  assert.deepEqual(getActiveSkillSources(effects), []);
});

test('active release diagnostics enforce the actual live effect phase rather than wall-clock delay', () => {
  const source = fixture(), target = { ...source, instanceId: 'phase-target', team: 'enemy' as const };
  const effect = createSpriteEffect({ id: 1220, timestampMs: 0, type: 'active_skill', sourceId: source.instanceId, sourceName: source.name }, source, target)!;
  for (const [phase, expected] of [[0.12, false], [0.36, true], [0.42, true], [0.56, false], [0.9, false]] as const) {
    effect.age = effect.duration * phase;
    const before = structuredClone(effect);
    assert.deepEqual(getActiveSkillSources([effect], [0.36, 0.56]), expected ? [source.heroId] : []);
    assert.deepEqual(effect, before);
  }
});

test('active impact diagnostics exclude casts basics ultimates allies and expired effects without advancing time', () => {
  const source = { ...fixture(), heroId: 'belinda' };
  const target = { ...source, instanceId: 'opponent', team: 'enemy' as const, x: 750 };
  const damage = createSpriteEffect({ id: 901, timestampMs: 0, type: 'damage', skillSlot: 'active',
    sourceId: source.instanceId, sourceName: source.name, targetId: target.instanceId, value: 12 }, source, target)!;
  damage.age = damage.duration * 0.4;
  const effects = [damage, { ...damage }, { ...damage, age: 0 }, { ...damage, age: damage.duration },
    { ...damage, age: Number.NaN }, { ...damage, duration: Number.POSITIVE_INFINITY },
    { ...damage, skillSlot: 'basic' as const }, { ...damage, skillSlot: 'ultimate' as const },
    { ...damage, sourceTeam: 'enemy' as const }, { ...damage, kind: 'cast' as const },
    { ...damage, kind: 'shield' as const, support: true }];
  const before = structuredClone(effects);
  assert.deepEqual(getActiveImpactSources(effects), ['belinda']);
  assert.deepEqual(getActiveImpactSources(effects.filter(effect => effect !== damage && effect !== effects[1])), []);
  assert.deepEqual(effects, before);
});

test('active anticipation and arrival diagnostics exclude all other live cast phases', () => {
  const source = fixture(), target = { ...source, instanceId: 'phase-window-target', team: 'enemy' as const };
  const effect = createSpriteEffect({ id: 1221, timestampMs: 0, type: 'active_skill', sourceId: source.instanceId, sourceName: source.name }, source, target)!;
  for (const phase of [0.02, 0.06, 0.12, 0.16, 0.42, 0.66, 0.72, 0.82, 0.95]) {
    effect.age = effect.duration * phase;
    for (const window of [[0.06, 0.16], [0.66, 0.82]] as const) {
      const expected = phase >= window[0] && phase < window[1];
      assert.deepEqual(getActiveSkillSources([effect], window), expected ? [source.heroId] : []);
    }
  }
});

test('every imported hero declares separate active and ultimate delivery plus an honest support emblem', () => {
  const deliveries = new Set(['thrust', 'volley', 'arc', 'pillar', 'orbit', 'rift']);
  const emblems = new Set(['crest', 'sun', 'coin', 'petal', 'crystal', 'scripture', 'flame', 'eye']);
  for (const hero of OATHBOUND_HEROES) {
    const art = getSpriteSkillArt(hero.heroId)!;
    assert.ok(deliveries.has(art.activeDelivery), `${hero.name}: active delivery`);
    assert.ok(deliveries.has(art.ultimateDelivery), `${hero.name}: ultimate delivery`);
    assert.notEqual(art.activeDelivery, art.ultimateDelivery, `${hero.name}: ultimate is not just a scaled active`);
    assert.ok(emblems.has(art.supportEmblem), `${hero.name}: support emblem`);
  }
});

test('active and ultimate deliveries render distinct finite geometry for every hero and quality mode', () => {
  for (const hero of OATHBOUND_HEROES) {
    const source = { ...fixture(), heroId: hero.heroId };
    const target = { ...source, instanceId: 'opponent', team: 'enemy' as const, x: 750, y: 260 };
    const trace = (ultimate: boolean, reduced: boolean, low: boolean, phase: number) => {
      const effect = createSpriteEffect({ id: 90, timestampMs: 0, type: ultimate ? 'ultimate_cast' : 'active_skill',
        sourceId: source.instanceId, sourceName: source.name }, source, target)!;
      effect.age = effect.duration * phase;
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, {
        get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
          calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
        }, set: (_, name, value) => { calls.push(['set', String(name), typeof value === 'object' ? 'gradient' : value]); return true; },
      }) as CanvasRenderingContext2D;
      const before = structuredClone(effect);
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      assert.equal(calls.filter(c => c[0] === 'save').length, calls.filter(c => c[0] === 'restore').length);
      for (const c of calls) for (const value of c.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${hero.name}/${String(c[0])}`);
      if (reduced) assert.equal(calls.some(c => c[0] === 'rotate'), false);
      assert.deepEqual(effect, before);
      return calls;
    };
    for (const phase of [0.2, 0.42, 0.72]) for (const [reduced, low] of [[false, false], [false, true], [true, false]]) {
      const active = trace(false, reduced, low, phase), ultimate = trace(true, reduced, low, phase);
      assert.notDeepEqual(active, ultimate, `${hero.name}/${phase}: distinct active/ultimate`);
      assert.deepEqual(trace(false, reduced, low, phase), active, 'same phase is deterministic');
    }
  }
});

test('authored per-hero skill rows are selected explicitly and static references never invent frames', () => {
  const expected: Record<string, [string, string]> = {
    estrilda: ['skillArc', 'skillAura'], celestial_guardian: ['skillShield', 'skillAura'],
    raine: ['skill', 'skillArc'], belinda: ['skillArc', 'skillAura'], fawkes: ['skillArc', 'skillAura'],
    astral_blademaster: ['skillDash', 'skillArc'], iron_bastion: ['skillSlam', 'skillShield'],
    rowan: ['skillStaff', 'skillStaff'], gwyneth: ['skillFlame', 'skillVolley'], rosaline: ['skillTea', 'skillTea'],
    cecilia: ['skill1', 'skill1'], hero_68_rigby: ['skillSpit', 'skillBarrel'], oscar: ['skill1', 'skill1'],
    eluard: ['skill1', 'skill1'], hero_248_eluard: ['skillFate', 'skillDome'],
    hero_107_peggy: ['skillGift', 'skillCrown'], walker: ['skillDash', 'skillBarrage'],
    morrow: ['skill1', 'skill3'], scarlet: ['skillBolt', 'skillStorm'],
    hero_134_thane: ['skillThrust', 'skillWhirl'], sonja: ['skillAura', 'skillRoses'], dawn_oracle: ['skill1', 'skill3'],
  };
  for (const hero of OATHBOUND_HEROES) {
    const art = getSpriteSkillArt(hero.heroId)!;
    const spec = getOathboundSprite(hero.unitId)!;
    assert.deepEqual([art.activeClip, art.ultimateClip], expected[hero.heroId], hero.name);
    for (const [kind, clip] of [['skill', art.activeClip], ['ultimate', art.ultimateClip]] as const) {
      assert.ok(spec.clips[clip], `${hero.name}: row must exist in the real atlas`);
      assert.equal(selectSpriteActionClip(spec, kind, 'nova', clip), clip);
      const actor = createSpriteActor(fixture());
      startSpriteAction(actor, kind, spec, 'nova', 'pillar', clip);
      assert.equal(actor.clip, clip);
      if (hero.heroId === 'cecilia' || hero.heroId === 'eluard') assert.equal(spec.clips[clip].count, 1);
    }
  }
  assert.equal(selectSpriteActionClip(getOathboundSprite(4), 'skill', 'nova', 'missing-row'), 'skillShield', 'invalid overrides retain safe authored fallback');
});

test('actual Sonja active blessing blooms roses at the allied recipient without offensive travel', () => {
  const initial = createInitialData();
  const formation = ['sonja', ...initial.formation.filter(id => id !== 'sonja')].slice(0, 5) as TeamFormationSlots;
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes,
    enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
  const source = sim.getUnits().find(unit => unit.heroId === 'sonja' && unit.team === 'ally')!;
  sim.consumeEvents();
  let entries: CombatEvent[] = [];
  for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
    sim.step(50); entries = sim.consumeEvents();
    if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
  }
  const cast = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
  assert.ok(cast, 'actual simulation must trigger the active');
  const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById('sonja').skills.active.targetType);
  assert.equal(target.team, source.team);
  assert.ok(entries.some(event => event.castId === cast.castId && event.type === 'heal' && event.targetId === target.instanceId));
  const effect = createSpriteEffect(cast, source, target)!;
  assert.equal(effect.support, true);
  effect.age = effect.duration * 0.42;
  const before = structuredClone(effect);
  for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: () => true }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
    const petals = calls.filter(call => call[0] === 'ellipse');
    const petalLimit = 43 * Math.min(390 / 480, 530 / 680) * 0.29 * 0.5;
    assert.equal(petals.length, 5, 'five-petal rose remains recognizable without a shared recipient halo on LOW/reduced');
    assert.ok(petals.every(call => Number(call[3]) > 0 && Number(call[3]) <= petalLimit &&
      Number(call[4]) > 0 && Number(call[4]) <= petalLimit), 'only compact flower petals, never a body-sized envelope');
    assert.ok(calls.filter(call => call[0] === 'fill').length >= 5, 'rose petals retain a compact colored surface on LOW/reduced');
    assert.equal(calls.some(call => ['rotate', 'quadraticCurveTo', 'bezierCurveTo'].includes(String(call[0]))), false, 'no weapon or attack ribbon sent at ally');
    const b = projectSpritePosition(target.x, target.y, 390, 530), scale = Math.min(390 / 480, 530 / 680);
    assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
    assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
    assert.deepEqual(effect, before);
  }
});

test('actual Rowan Palmer Rosaline and Peggy support casts deliver recipient-local prop signatures', () => {
  for (const heroId of ['rowan', 'dawn_oracle', 'rosaline', 'hero_107_peggy']) {
    const initial = createInitialData();
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
      { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const active = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
    assert.ok(active, `${heroId}: natural active must occur`);
    const batches = [{ cast: active, entries, skill: getHeroById(heroId).skills.active }];
    assert.equal(sim.triggerUltimate(source.instanceId, true), true);
    const ultimateEntries = sim.consumeEvents();
    batches.push({ cast: ultimateEntries.find(event => event.sourceId === source.instanceId && event.type === 'ultimate_cast')!,
      entries: ultimateEntries, skill: getHeroById(heroId).skills.ultimate });
    for (const batch of batches) {
      assert.ok(batch.cast);
      const target = resolveSpriteEffectTarget(batch.cast, batch.entries, sim.getUnits(), source, batch.skill.targetType);
      assert.equal(target.team, source.team);
      assert.ok(batch.entries.some(event => event.castId === batch.cast.castId && event.type === 'heal' && event.targetId === target.instanceId));
      const effect = createSpriteEffect(batch.cast, source, target)!;
      effect.age = effect.duration * 0.42;
      const before = structuredClone(effect);
      for (const [reduced, low] of [[false, false], [false, true], [true, true]]) {
        const calls: unknown[][] = [];
        const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
          calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
        }, set: () => true }) as CanvasRenderingContext2D;
        drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
        const closed = calls.filter(call => call[0] === 'closePath').length;
        const filled = calls.filter(call => call[0] === 'fill').length;
        const minShapes = heroId === 'rowan' || heroId === 'rosaline' ? 1 : 2;
        assert.ok(closed >= minShapes && filled >= minShapes,
          `${heroId}: recognizable solid prop silhouette must survive LOW/reduced`);
        assert.equal(calls.some(call => ['rotate', 'quadraticCurveTo', 'bezierCurveTo'].includes(String(call[0]))), false);
        const b = projectSpritePosition(target.x, target.y, 390, 530), scale = Math.min(390 / 480, 530 / 680);
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
        assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
        for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
        assert.deepEqual(effect, before);
      }
    }
  }
});

test('actual Lucius Raine and Rigby allied ultimates use local light rally and barrel signatures', () => {
  for (const heroId of ['celestial_guardian', 'raine', 'hero_68_rigby']) {
    const initial = createInitialData();
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes: initial.ownedHeroes,
      enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    assert.equal(sim.triggerUltimate(source.instanceId, true), true);
    const events = sim.consumeEvents(), cast = events.find(event => event.type === 'ultimate_cast')!;
    const target = resolveSpriteEffectTarget(cast, events, sim.getUnits(), source, getHeroById(heroId).skills.ultimate.targetType);
    assert.equal(target.team, source.team);
    const effect = createSpriteEffect(cast, source, target)!;
    effect.age = effect.duration * 0.42;
    const before = structuredClone(effect);
    for (const [reduced, low] of [[false, false], [false, true], [true, true]]) {
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: () => true }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      assert.ok(calls.some(call => call[0] === 'fill'), `${heroId}: small solid badge remains on LOW/reduced`);
      assert.equal(calls.some(call => ['rotate', 'quadraticCurveTo', 'bezierCurveTo'].includes(String(call[0]))), false);
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      assert.deepEqual(effect, before);
    }
  }
});

test('actual allied ultimate cast props avoid shared body-sized floor rings and crown ellipses', () => {
  for (const heroId of ['celestial_guardian', 'raine', 'rowan', 'rosaline', 'hero_68_rigby', 'hero_107_peggy', 'sonja', 'dawn_oracle']) {
    const initial = createInitialData();
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes: initial.ownedHeroes,
      enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    assert.equal(sim.triggerUltimate(source.instanceId, true), true);
    const events = sim.consumeEvents(), cast = events.find(event => event.type === 'ultimate_cast')!;
    const target = resolveSpriteEffectTarget(cast, events, sim.getUnits(), source, getHeroById(heroId).skills.ultimate.targetType);
    assert.equal(target.team, source.team);
    assert.ok(events.some(event => event.castId === cast.castId && event.targetId === target.instanceId &&
      ['heal', 'shield', 'buff'].includes(event.type)), 'actual supported recipient required');
    const effect = createSpriteEffect(cast, source, target)!;
    for (const phase of [0.15, 0.5, 0.85]) for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      effect.age = effect.duration * phase;
      const before = structuredClone(effect), calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { if (name === 'shadowBlur') assert.equal(value, 0); return true; } }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      const scale = Math.min(390 / 480, 530 / 680), b = projectSpritePosition(target.x, target.y, 390, 530);
      assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
      for (const call of calls.filter(call => call[0] === 'ellipse')) {
        assert.ok(Number(call[3]) <= 62 * scale * 0.4 && Number(call[4]) <= 62 * scale * 0.4,
          `${heroId}: only small prop ellipses, not a body envelope`);
      }
      assert.ok(calls.some(call => call[0] === 'fill'), 'hero prop stays visible on LOW and reduced motion');
      assert.equal(calls.some(call => ['rotate', 'createRadialGradient'].includes(String(call[0]))), false);
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual Palmer stat buffs retain their type and never imitate a shielding outcome', () => {
  const initial = createInitialData();
  const formation = ['dawn_oracle', ...initial.formation.filter(id => id !== 'dawn_oracle')].slice(0, 5) as TeamFormationSlots;
  const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes: initial.ownedHeroes,
    enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false });
  const source = sim.getUnits().find(unit => unit.heroId === 'dawn_oracle' && unit.team === 'ally')!;
  sim.consumeEvents();
  assert.equal(sim.triggerUltimate(source.instanceId, true), true);
  const events = sim.consumeEvents(), buffs = events.filter(event => event.type === 'buff');
  assert.equal(buffs.length, sim.getUnits().filter(unit => unit.team === 'ally' && unit.isAlive).length);
  for (const event of buffs) {
    const target = sim.getUnits().find(unit => unit.instanceId === event.targetId)!;
    const effect = createSpriteEffect(event, source, target)!;
    assert.equal(effect.supportBuff, 'atk_up');
    assert.equal(effect.supportBuff, event.buffType);
    effect.age = effect.duration * 0.42;
    const before = structuredClone(effect);
    for (const [reduced, low] of [[false, false], [false, true], [true, true]]) {
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      assert.equal(calls.some(call => ['ellipse', 'rotate', 'createRadialGradient'].includes(String(call[0]))), false, 'stat buff is not a ward or weapon');
      assert.ok(calls.filter(call => call[0] === 'lineTo').length >= 2, 'upward chevrons retain stat-gain feedback');
      const b = projectSpritePosition(target.x, target.y, 390, 530), scale = Math.min(390 / 480, 530 / 680);
      assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      assert.ok(calls.filter(call => call[0] === 'set' && call[1] === 'shadowBlur').every(call => call[2] === 0));
      assert.deepEqual(effect, before);
    }
  }
  const tank = sim.getUnits().find(unit => unit.heroId === 'celestial_guardian' && unit.team === 'ally')!;
  assert.equal(sim.triggerUltimate(tank.instanceId, true), true);
  const ward = sim.consumeEvents().find(event => event.type === 'shield')!;
  assert.ok(ward, 'negative control uses an actual tank shield');
  const recipient = sim.getUnits().find(unit => unit.instanceId === ward.targetId)!;
  assert.equal(createSpriteEffect(ward, tank, recipient)!.supportBuff, undefined);
});

test('real opening and ultimate shield outcomes use small local crests without replaying body wards', () => {
  let openingCount = 0, ultimateCount = 0;
  for (const hero of OATHBOUND_HEROES) {
    const initial = createInitialData();
    const formation = [hero.heroId, ...initial.formation.filter(id => id !== hero.heroId)].slice(0, 5) as TeamFormationSlots;
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes: initial.ownedHeroes,
      enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === hero.heroId && unit.team === 'ally')!;
    const opening = sim.consumeEvents().filter(event => event.sourceId === source.instanceId && event.type === 'shield');
    assert.equal(sim.triggerUltimate(source.instanceId, true), true);
    const ultimate = sim.consumeEvents().filter(event => event.sourceId === source.instanceId && event.type === 'shield');
    openingCount += opening.length; ultimateCount += ultimate.length;
    for (const event of [...opening, ...ultimate]) {
      assert.ok(event.value! > 0);
      const target = sim.getUnits().find(unit => unit.instanceId === event.targetId)!;
      const effect = createSpriteEffect(event, source, target)!;
      assert.equal(effect.kind, 'shield'); assert.equal(effect.support, true); assert.equal(effect.supportBuff, undefined);
      effect.age = effect.duration * 0.5;
      const before = structuredClone(effect), scale = Math.min(390 / 480, 530 / 680);
      for (const [reduced, low] of [[false, false], [false, true], [true, true]]) {
        const calls: unknown[][] = [];
        const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
          calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
        }, set: (_, name, value) => { if (name === 'shadowBlur') assert.equal(value, 0); return true; } }) as CanvasRenderingContext2D;
        drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
        const b = projectSpritePosition(target.x, target.y, 390, 530);
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
        assert.equal(calls.some(call => ['ellipse', 'arc', 'rotate', 'fill', 'createRadialGradient'].includes(String(call[0]))), false, 'no body halo or opaque cast replay');
        assert.equal(calls.filter(call => call[0] === 'closePath').length, 1, 'one readable ward crest');
        for (const call of calls.filter(call => call[0] === 'moveTo' || call[0] === 'lineTo')) {
          assert.ok(Math.abs(Number(call[1])) <= 14 * scale && Math.abs(Number(call[2])) <= 14 * scale, 'shield accent stays compact');
        }
        assert.ok(calls.some(call => call[0] === 'stroke'));
        assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
        for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
        assert.deepEqual(effect, before);
      }
    }
  }
  assert.ok(openingCount > 0, 'actual passive opening wards exercised');
  assert.ok(ultimateCount > 0, 'actual ultimate shield recipients exercised');
});

test('healing outcomes remain compact recipient accents instead of repeating body-sized support halos', () => {
  for (const hero of OATHBOUND_HEROES) for (const [reduced, low] of [[false, false], [false, true], [true, true]]) {
    const source = { ...fixture(), heroId: hero.heroId };
    const target = { ...source, instanceId: 'healed-ally', x: 320, y: 280 };
    const effect = createSpriteEffect({ id: 1245, timestampMs: 0, type: 'heal', skillSlot: 'ultimate',
      sourceId: source.instanceId, sourceName: source.name, targetId: target.instanceId, value: 100 }, source, target)!;
    effect.age = effect.duration * 0.42;
    const before = structuredClone(effect), calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
    assert.equal(calls.some(call => call[0] === 'ellipse'), false, `${hero.name}: a heal outcome cannot repeat the body halo`);
    assert.equal(calls.some(call => call[0] === 'rotate' || call[0] === 'createRadialGradient'), false);
    const scale = Math.min(390 / 480, 530 / 680);
    assert.ok(calls.filter(call => call[0] === 'arc').every(call => Number(call[3]) <= 12 * scale));
    assert.ok(calls.filter(call => call[0] === 'set' && call[1] === 'shadowBlur').every(call => call[2] === 0));
    assert.ok(calls.some(call => call[0] === 'stroke'), 'actual heal retains visible feedback');
    assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
    assert.deepEqual(effect, before);
  }
});

test('offensive weapon anticipation aims its own compact weapon at the actual bearing instead of spinning diamonds', () => {
  for (const heroId of ['estrilda', 'astral_blademaster', 'gwyneth', 'cecilia', 'oscar', 'walker', 'hero_134_thane']) {
    for (const reverse of [false, true]) for (const low of [false, true]) {
      const source = { ...fixture(), heroId, x: reverse ? 740 : 180, y: 210 };
      const target = { ...source, instanceId: 'weapon-recipient', team: 'enemy' as const, x: reverse ? 180 : 740, y: 300 };
      const effect = createSpriteEffect({ id: 1250, timestampMs: 0, type: 'active_skill', sourceId: source.instanceId,
        sourceName: source.name }, source, target)!;
      effect.age = effect.duration * 0.12;
      const before = structuredClone(effect), calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: () => true }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, false, low);
      const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
      const scale = Math.min(390 / 480, 530 / 680), bearing = Math.atan2(b.y - a.y + 5 * scale, b.x - a.x);
      const rotations = calls.filter(call => call[0] === 'rotate');
      assert.ok(rotations.length > 0, `${heroId}: aimed weapon is present`);
      assert.ok(rotations.every(call => Math.abs(Number(call[1]) - bearing) < 1e-10), `${heroId}: no generic rotating diamond wheel`);
      assert.ok(calls.some(call => call[0] === 'translate' && call[1] === a.x && call[2] === a.y - 53 * scale), 'charge remains caster-local');
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual Eluard active charge unfolds a caster-local faceted prism without generic spinning diamonds', () => {
  for (const heroId of ['eluard', 'hero_248_eluard']) {
    const initial = createInitialData();
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
      { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
    assert.ok(cast, `${heroId}: actual active must occur`);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills.active.targetType);
    assert.notEqual(target.team, source.team);
    assert.ok(entries.some(event => event.castId === cast.castId && event.type === 'damage' && event.targetId === target.instanceId));
    const effect = createSpriteEffect(cast, source, target)!;
    effect.age = effect.duration * 0.12;
    const before = structuredClone(effect);
    for (const [reduced, low] of [[false, false], [false, true], [true, true]]) {
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: () => true }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      assert.equal(calls.some(call => call[0] === 'rotate'), false, 'charge is a growing prism, not a rotating diamond wheel');
      if (!reduced) {
        assert.ok(calls.filter(call => call[0] === 'closePath').length >= 3, 'three outlined crystal facets remain on LOW');
        const a = projectSpritePosition(source.x, source.y, 390, 530), scale = Math.min(390 / 480, 530 / 680);
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === a.x && call[2] === a.y - 53 * scale));
      }
      assert.ok(calls.some(call => call[0] === 'stroke'), 'reduced motion retains static feedback');
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual Eluard active release and arrival retain transparent recipient facets without generic filled glyphs', () => {
  for (const heroId of ['eluard', 'hero_248_eluard']) {
    const initial = createInitialData();
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
      { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
    assert.ok(cast);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills.active.targetType);
    assert.ok(entries.some(event => event.castId === cast.castId && event.targetId === target.instanceId && event.type === 'damage'));
    const effect = createSpriteEffect(cast, source, target)!;
    for (const phase of [0.4, 0.74, 0.92]) {
    effect.age = effect.duration * phase;
    const before = structuredClone(effect);
    for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: () => true }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      assert.equal(calls.some(call => ['fill', 'ellipse', 'rotate', 'createRadialGradient'].includes(String(call[0]))), false, 'transparent unspun release and arrival, no shared filled glyph');
      if (!reduced) {
        const b = projectSpritePosition(target.x, target.y, 390, 530), scale = Math.min(390 / 480, 530 / 680);
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
        const expectedFacets = phase === 0.4 ? heroId === 'eluard' ? 3 : 2 : heroId === 'eluard' ? 3 : 4;
        assert.equal(calls.filter(call => call[0] === 'closePath').length, expectedFacets, 'base and awakened preserve their outlined facet counts on LOW');
        for (const call of calls.filter(call => call[0] === 'moveTo' || call[0] === 'lineTo')) {
          assert.ok(Math.abs(Number(call[1])) <= 43 * scale && Math.abs(Number(call[2])) <= 43 * scale);
        }
      }
      assert.ok(calls.some(call => call[0] === 'stroke'));
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
    }
  }
});

test('actual coffin eye flame and bastion active anticipation has a caster-local signature instead of a shared wheel', () => {
  for (const heroId of ['fawkes', 'morrow', 'hero_68_rigby', 'iron_bastion']) {
    const initial = createInitialData();
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
      { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } } ]));
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
    assert.ok(cast, `${heroId}: natural active occurs`);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills.active.targetType);
    assert.notEqual(target.team, source.team);
    assert.ok(entries.some(event => event.castId === cast.castId && event.targetId === target.instanceId &&
      ['damage', 'crowd_control', 'knockback'].includes(event.type)), 'anchor is a real affected enemy');
    const effect = createSpriteEffect(cast, source, target)!;
    effect.age = effect.duration * 0.12;
    const before = structuredClone(effect);
    for (const [reduced, low] of [[false, false], [false, true], [true, true]]) {
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: () => true }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      assert.equal(calls.some(call => call[0] === 'rotate'), false, `${heroId}: no shared spinning wheel`);
      if (!reduced) {
        const a = projectSpritePosition(source.x, source.y, 390, 530), scale = Math.min(390 / 480, 530 / 680);
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === a.x && call[2] === a.y - 53 * scale));
        if (heroId === 'morrow' || heroId === 'hero_68_rigby') {
          assert.ok(calls.filter(call => call[0] === 'quadraticCurveTo').length >= 2, 'curved eye or flame signature survives LOW');
        } else {
          assert.equal(calls.filter(call => call[0] === 'closePath').length, 1, 'one outlined coffin or shield, no diamond cloud');
        }
      }
      assert.ok(calls.some(call => call[0] === 'stroke'), 'static reduced feedback retained');
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('Fawkes and Morrow open distinct recipient-local coffin doors and an eye during rift delivery', () => {
  for (const heroId of ['fawkes', 'morrow']) for (const low of [false, true]) {
    const source = { ...fixture(), heroId, x: 180, y: 210 };
    const target = { ...source, instanceId: 'rift-recipient', team: 'enemy' as const, x: 740, y: 300 };
    const effect = createSpriteEffect({ id: 1230, timestampMs: 0, type: 'active_skill', sourceId: source.instanceId, sourceName: source.name }, source, target)!;
    effect.age = effect.duration * 0.42;
    const before = structuredClone(effect), calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: () => true }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 390, 530, false, low);
    if (heroId === 'fawkes') {
      assert.equal(calls.filter(call => call[0] === 'closePath').length, 2, 'two outlined coffin doors, never an opaque rectangle over the victim');
      assert.equal(calls.some(call => call[0] === 'fill'), false);
    } else {
      assert.equal(calls.filter(call => call[0] === 'quadraticCurveTo').length, 2, 'eye opens along two curved lids');
      assert.ok(calls.some(call => call[0] === 'arc'), 'eye has a visible pupil');
    }
    const b = projectSpritePosition(target.x, target.y, 390, 530), scale = Math.min(390 / 480, 530 / 680);
    assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
    assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
    for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    assert.deepEqual(effect, before);
  }
});

test('Belinda and Scarlet anticipation uses a caster-local sun or vortex rather than shared spinning diamonds', () => {
  for (const heroId of ['belinda', 'scarlet']) for (const low of [false, true]) {
    const source = { ...fixture(), heroId, x: 180, y: 210 };
    const target = { ...source, instanceId: 'charge-recipient', team: 'enemy' as const, x: 740, y: 300 };
    const effect = createSpriteEffect({ id: 1210, timestampMs: 0, type: 'active_skill', sourceId: source.instanceId, sourceName: source.name }, source, target)!;
    effect.age = effect.duration * 0.12;
    const before = structuredClone(effect), calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: () => true }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 390, 530, false, low);
    assert.equal(calls.some(call => call[0] === 'rotate'), false, 'charge does not rotate a generic diamond wheel');
    assert.equal(calls.filter(call => call[0] === 'fill').length, 1, 'only the restrained caster halo is filled');
    if (heroId === 'belinda') assert.ok(calls.filter(call => call[0] === 'lineTo').length >= 4, 'sun has distinct radial light marks');
    else assert.ok(calls.filter(call => call[0] === 'arc').length >= 3, 'vortex has separate open coils');
    const a = projectSpritePosition(source.x, source.y, 390, 530), scale = Math.min(390 / 480, 530 / 680);
    assert.ok(calls.some(call => call[0] === 'translate' && call[1] === a.x && call[2] === a.y - 53 * scale));
    assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
    assert.deepEqual(effect, before);
  }
});

test('Belinda and Scarlet release distinct light and vortex projectiles instead of a shared spell ribbon', () => {
  for (const heroId of ['belinda', 'scarlet']) for (const reverse of [false, true]) for (const low of [false, true]) {
    const source = { ...fixture(), heroId, x: reverse ? 740 : 180, y: 210 };
    const target = { ...source, instanceId: 'mage-recipient', team: 'enemy' as const, x: reverse ? 180 : 740, y: 300 };
    const effect = createSpriteEffect({ id: 1200, timestampMs: 0, type: 'active_skill', sourceId: source.instanceId, sourceName: source.name }, source, target)!;
    effect.age = effect.duration * 0.42;
    const before = structuredClone(effect);
    const trace = (reduced: boolean) => {
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      return calls;
    };
    const calls = trace(false);
    if (heroId === 'belinda') assert.ok(calls.filter(call => call[0] === 'bezierCurveTo').length >= 2, 'light projectile has two swept wings');
    else assert.ok(calls.filter(call => call[0] === 'arc').length >= 3, 'dark projectile has a core and separate orbital coils');
    assert.equal(calls.some(call => call[0] === 'quadraticCurveTo'), false, 'no long generic ribbon connects caster and victim');
    const scale = Math.min(390 / 480, 530 / 680);
    const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
    const travel = (0.42 - 0.18) / 0.32, radius = 43 * scale;
    const tangent = Math.atan2(b.y - a.y + 5 * scale - radius * 0.45 * Math.PI * Math.cos(travel * Math.PI), b.x - a.x);
    assert.ok(calls.some(call => call[0] === 'rotate' && Math.abs((call[1] as number) - tangent) < 1e-10), 'projectile follows the curved trajectory in either direction');
    const reduced = trace(true);
    assert.equal(reduced.some(call => ['rotate', 'bezierCurveTo'].includes(String(call[0]))), false);
    assert.deepEqual(effect, before);
  }
});

test('actual cast ground anticipation respects caller opacity without changing its geometry', () => {
  const initial = createInitialData();
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  for (const hero of OATHBOUND_HEROES) for (const slot of ['active', 'ultimate'] as const) {
    const formation = [hero.heroId, ...initial.formation.filter(id => id !== hero.heroId)].slice(0, 5) as TeamFormationSlots;
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(u => u.heroId === hero.heroId && u.team === 'ally')!;
    sim.consumeEvents(); let entries: CombatEvent[] = [];
    if (slot === 'ultimate') { assert.equal(sim.triggerUltimate(source.instanceId, true), true); entries = sim.consumeEvents(); }
    else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(e => e.sourceId === source.instanceId && e.type === 'active_skill')) break;
    }
    const cast = entries.find(e => e.sourceId === source.instanceId && e.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
    assert.ok(cast);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(hero.heroId).skills[slot].targetType);
    const effect = createSpriteEffect(cast, source, target)!; effect.age = effect.duration * 0.2;
    const before = structuredClone(effect);
    for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      const trace = (callerAlpha: number) => {
        let state: Record<string, unknown> = { globalAlpha: callerAlpha };
        const stack: Array<typeof state> = [], alphas: number[] = [], geometry: unknown[][] = [];
        const ctx = new Proxy({}, {
          get: (_, key) => {
            if (key in state) return state[String(key)];
            if (key === 'save') return () => stack.push({ ...state });
            if (key === 'restore') return () => { assert.ok(stack.length); state = stack.pop()!; };
            if (key === 'stroke' || key === 'fill') return () => alphas.push(Number(state.globalAlpha));
            return (...args: unknown[]) => { geometry.push([String(key), ...args]); };
          },
          set: (_, key, value) => { state[String(key)] = value; return true; },
        }) as CanvasRenderingContext2D;
        drawSpriteEffects(ctx, [effect], 390, 530, reduced, 'ground', low);
        assert.equal(stack.length, 0); assert.deepEqual(state, { globalAlpha: callerAlpha });
        return { alphas, geometry };
      };
      const full = trace(1), dim = trace(0.25), hidden = trace(0);
      assert.ok(full.alphas.length && full.alphas.every(a => a > 0 && a <= 1));
      assert.deepEqual(dim.geometry, full.geometry); assert.deepEqual(hidden.geometry, full.geometry);
      assert.deepEqual(dim.alphas, full.alphas.map(a => a * 0.25), 'ground charge multiplies caller opacity instead of replacing it');
      assert.ok(hidden.alphas.every(a => a === 0), 'a transparent caller cannot produce a visible floor charge');
      assert.deepEqual(effect, before);
    }
  }
});

test('actual Fawkes ultimate release converges outlined coffin seals without generic orbit diamonds', () => {
  const initial = createInitialData(), heroId = 'fawkes';
  const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
    seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
  const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
  sim.consumeEvents(); assert.equal(sim.triggerUltimate(source.instanceId, true), true);
  const entries = sim.consumeEvents(), cast = entries.find(e => e.sourceId === source.instanceId && e.type === 'ultimate_cast')!;
  assert.ok(cast);
  const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills.ultimate.targetType);
  assert.notEqual(target.team, source.team);
  assert.ok(entries.some(e => e.sourceId === source.instanceId && e.castId === cast.castId &&
    e.targetId === target.instanceId && e.type === 'damage' && e.value! > 0));
  assert.ok(entries.some(e => e.sourceId === source.instanceId && e.castId === cast.castId &&
    e.targetId === target.instanceId && e.type === 'crowd_control' && e.ccType === 'slow'));
  const effect = createSpriteEffect(cast, source, target)!;
  for (const low of [false, true]) {
    let earlierDistance = 0;
    for (const phase of [0.36, 0.42]) {
      effect.age = effect.duration * phase;
      const before = structuredClone(effect), calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, false, low);
      const scale = Math.min(390 / 480, 530 / 680), radius = 62 * scale, count = low ? 2 : 3;
      const b = projectSpritePosition(target.x, target.y, 390, 530);
      const translations = calls.filter(c => c[0] === 'translate');
      assert.deepEqual(translations[0], ['translate', b.x, b.y - 48 * scale]);
      assert.equal(translations.length, count + 1, 'each seal has a local offset under the actual recipient');
      const distances = translations.slice(1).map(c => Math.hypot(Number(c[1]), Number(c[2])));
      assert.ok(distances.every(d => d > radius * 0.25 && d < radius * 0.6));
      if (phase === 0.36) earlierDistance = distances[0];
      else assert.ok(distances[0] < earlierDistance, 'seals converge instead of spinning around the body');
      assert.equal(calls.some(c => ['fill', 'arc', 'ellipse', 'rotate', 'createRadialGradient'].includes(String(c[0]))), false);
      assert.equal(calls.filter(c => c[0] === 'closePath').length, count, 'one six-sided outline per coffin seal');
      assert.equal(calls.filter(c => c[0] === 'stroke').length, count * 3, 'coffin contour and two cross marks survive LOW');
      for (const c of calls.filter(c => ['moveTo', 'lineTo'].includes(String(c[0]))))
        assert.ok(Math.hypot(Number(c[1]), Number(c[2])) <= radius * 0.32);
      assert.equal(calls.filter(c => c[0] === 'save').length, calls.filter(c => c[0] === 'restore').length);
      assert.deepEqual(effect, before);
    }
  }
});

test('actual Lucius active release converges transparent shield faces at the real opponent without magic diamonds', () => {
  const initial = createInitialData(), heroId = 'celestial_guardian';
  const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
    seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
  const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
  sim.consumeEvents(); let entries: CombatEvent[] = [];
  for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
    sim.step(50); entries = sim.consumeEvents();
    if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
  }
  const cast = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
  assert.ok(cast);
  const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills.active.targetType);
  assert.notEqual(target.team, source.team);
  assert.ok(entries.some(event => event.sourceId === source.instanceId && event.castId === cast.castId &&
    event.targetId === target.instanceId && event.type === 'damage' && event.value! > 0));
  const effect = createSpriteEffect(cast, source, target)!;
  for (const low of [false, true]) {
    let earlierDistance = 0;
    for (const phase of [0.36, 0.42]) {
      effect.age = effect.duration * phase;
      const before = structuredClone(effect), calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, false, low);
      const scale = Math.min(390 / 480, 530 / 680), radius = 43 * scale;
      const b = projectSpritePosition(target.x, target.y, 390, 530), count = low ? 2 : 3;
      const translations = calls.filter(c => c[0] === 'translate');
      assert.deepEqual(translations[0], ['translate', b.x, b.y - 48 * scale], 'all faces belong to the actual enemy recipient');
      assert.equal(translations.length, count + 1);
      const distances = translations.slice(1).map(c => Math.hypot(Number(c[1]), Number(c[2])));
      assert.ok(distances.every(d => d > radius * 0.25 && d < radius * 0.6));
      if (phase === 0.36) earlierDistance = distances[0];
      else assert.ok(distances[0] < earlierDistance, 'faces converge rather than orbit/spin');
      assert.equal(calls.some(c => ['fill', 'arc', 'ellipse', 'rotate', 'createRadialGradient'].includes(String(c[0]))), false,
        'light-shield delivery keeps transparent faces instead of filled diamonds and orbit ellipses');
      assert.equal(calls.filter(c => c[0] === 'closePath').length, count);
      assert.equal(calls.filter(c => c[0] === 'stroke').length, count * 3, 'each shield retains its two cross strokes on LOW too');
      for (const c of calls.filter(c => ['moveTo', 'lineTo'].includes(String(c[0]))))
        assert.ok(Math.hypot(Number(c[1]), Number(c[2])) <= radius * 0.3, 'small local shield contour');
      assert.equal(calls.filter(c => c[0] === 'save').length, calls.filter(c => c[0] === 'restore').length);
      assert.deepEqual(effect, before);
    }
  }
});

test('actual Hendrik active release carries an outlined shield toward the real recipient instead of a spear', () => {
  const initial = createInitialData(), heroId = 'iron_bastion';
  const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
    seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
  const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
  sim.consumeEvents(); let entries: CombatEvent[] = [];
  for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
    sim.step(50); entries = sim.consumeEvents();
    if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
  }
  const cast = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
  assert.ok(cast);
  const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills.active.targetType);
  assert.notEqual(target.team, source.team);
  assert.ok(entries.some(event => event.sourceId === source.instanceId && event.castId === cast.castId &&
    event.targetId === target.instanceId && event.type === 'damage' && event.value! > 0));
  const effect = createSpriteEffect(cast, source, target)!;
  for (const phase of [0.36, 0.42]) for (const low of [false, true]) {
    effect.age = effect.duration * phase;
    const before = structuredClone(effect), calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 390, 530, false, low);
    const scale = Math.min(390 / 480, 530 / 680), radius = 43 * scale;
    const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
    const travel = (phase - 0.18) / 0.32;
    assert.deepEqual(calls.filter(c => c[0] === 'translate'), [['translate', a.x + (b.x - a.x) * travel,
      a.y - 53 * scale + (b.y - 48 * scale - (a.y - 53 * scale)) * travel]], 'shield follows the actual release path');
    const rotations = calls.filter(c => c[0] === 'rotate');
    assert.equal(rotations.length, 1);
    assert.ok(Math.abs(Number(rotations[0][1]) - Math.atan2(b.y - a.y + 5 * scale, b.x - a.x)) < 1e-10);
    assert.equal(calls.some(c => ['fill', 'arc', 'ellipse', 'createRadialGradient'].includes(String(c[0]))), false,
      'shield bash is transparent, not the generic filled spearhead');
    assert.equal(calls.filter(c => c[0] === 'closePath').length, 1, 'one shield contour');
    assert.equal(calls.filter(c => c[0] === 'stroke').length, 3, 'shield edge and two bastion brace strokes');
    for (const c of calls.filter(c => ['moveTo', 'lineTo'].includes(String(c[0]))))
      assert.ok(Math.hypot(Number(c[1]), Number(c[2])) < radius * 0.55, 'compact travelling shield');
    assert.equal(calls.filter(c => c[0] === 'save').length, calls.filter(c => c[0] === 'restore').length);
    assert.deepEqual(effect, before);
  }
});

test('ground accents belong only to cast anticipation, never every heal ward or control outcome', () => {
  const source = fixture(), target = { ...source, instanceId: 'ground-recipient', team: 'enemy' as const, x: 740, y: 300 };
  const cast = createSpriteEffect({ id: 1190, timestampMs: 0, type: 'active_skill', sourceId: source.instanceId, sourceName: source.name }, source, target)!;
  const trace = (effect: typeof cast, reduced = false) => {
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
    drawSpriteEffects(ctx, [effect], 390, 530, reduced, 'ground');
    return calls;
  };
  for (const reduced of [false, true]) {
    const charge = trace({ ...cast, age: cast.duration * 0.2 }, reduced);
    assert.equal(charge.filter(call => call[0] === 'arc').length, 1, 'active anticipation has one quiet foot accent');
    assert.equal(charge.some(call => call[0] === 'set' && call[1] === 'shadowBlur' && Number(call[2]) > 0), false, 'ground accents never glow over bodies');
    assert.equal(charge.filter(call => call[0] === 'save').length, charge.filter(call => call[0] === 'restore').length);
    assert.equal(trace({ ...cast, age: cast.duration * 0.6 }, reduced).length, 0, 'ground charge disappears during delivery/recovery');
    for (const kind of ['heal', 'shield', 'control', 'death', 'impact'] as const) {
      assert.equal(trace({ ...cast, kind, age: cast.duration * 0.2 }, reduced).length, 0, `${kind}: recipient front art is enough`);
    }
  }
});

test('blade deliveries sweep toward the recipient instead of using a spear or generic spell ribbon', () => {
  for (const heroId of ['astral_blademaster', 'cecilia', 'hero_134_thane']) for (const reverse of [false, true]) for (const low of [false, true]) {
    const source = { ...fixture(), heroId, x: reverse ? 740 : 180, y: 210 };
    const target = { ...source, instanceId: 'blade-recipient', team: 'enemy' as const, x: reverse ? 180 : 740, y: 300 };
    const effect = createSpriteEffect({ id: 1170, timestampMs: 0, type: 'active_skill', sourceId: source.instanceId, sourceName: source.name }, source, target)!;
    effect.age = effect.duration * 0.42;
    const before = structuredClone(effect), calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: () => true }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 390, 530, false, low);
    assert.ok(calls.filter(call => call[0] === 'quadraticCurveTo').length >= 3, `${heroId}: tapered crescent and luminous inner edge`);
    assert.ok(calls.some(call => call[0] === 'fill'), 'blade has a visible tapered surface');
    const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
    const bearing = Math.atan2(b.y - a.y + 5 * Math.min(390 / 480, 530 / 680), b.x - a.x);
    assert.ok(calls.some(call => call[0] === 'rotate' && Math.abs((call[1] as number) - bearing) < 1e-10), 'sweep follows the actual recipient in either direction');
    assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
    for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    assert.deepEqual(effect, before);
  }
});

test('Oscar delivers a handled dagger rather than the generic thrust spearhead', () => {
  for (const ultimate of [false, true]) {
    const source = { ...fixture(), heroId: 'oscar', x: 180, y: 210 };
    const target = { ...source, instanceId: 'dagger-recipient', team: 'enemy' as const, x: 740, y: 300 };
    const effect = createSpriteEffect({ id: 1180, timestampMs: 0, type: ultimate ? 'ultimate_cast' : 'active_skill', sourceId: source.instanceId, sourceName: source.name }, source, target)!;
    effect.age = effect.duration * 0.42;
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: () => true }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 390, 530, false, false);
    assert.ok(calls.some(call => call[0] === 'lineTo' && Math.abs(call[1] as number) < 1e-10 && (call[2] as number) > 0), 'dagger has an explicit perpendicular crossguard');
    assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
  }
});

test('ranged arrow and bullet deliveries use oriented weapon glyphs instead of vertical magic diamonds', () => {
  for (const heroId of ['gwyneth', 'walker', 'raine']) for (const ultimate of [false, true]) {
    const source = { ...fixture(), heroId, x: 180, y: 210 };
    const target = { ...source, instanceId: 'ranged-recipient', team: 'enemy' as const, x: 740, y: 300 };
    const effect = createSpriteEffect({ id: 1150, timestampMs: 0, type: ultimate ? 'ultimate_cast' : 'active_skill', sourceId: source.instanceId, sourceName: source.name }, source, target)!;
    effect.age = effect.duration * 0.42;
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: () => true }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 390, 530, false, false);
    const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
    const bearing = Math.atan2(b.y - a.y + 5 * Math.min(390 / 480, 530 / 680), b.x - a.x);
    assert.ok(calls.some(call => call[0] === 'rotate' && Math.abs((call[1] as number) - bearing) < 1e-10), `${heroId}: projectile glyph aligns with trajectory`);
    if (heroId === 'gwyneth') assert.ok(calls.filter(call => call[0] === 'lineTo').length >= 7, 'arrow has a head and rear fletching');
    else assert.ok(calls.some(call => call[0] === 'ellipse'), 'bullet has a rounded luminous head, not an arrowhead');
    assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
  }
});

test('Rigby Fire Breath has a directed flame stream rather than a generic curved spell ribbon', () => {
  const source = { ...fixture(), heroId: 'hero_68_rigby', x: 180, y: 210 };
  const target = { ...source, instanceId: 'flame-recipient', team: 'enemy' as const, x: 740, y: 280 };
  const effect = createSpriteEffect({ id: 1130, timestampMs: 0, type: 'active_skill', sourceId: source.instanceId, sourceName: source.name }, source, target)!;
  effect.age = effect.duration * 0.42;
  const before = structuredClone(effect);
  for (const low of [false, true]) {
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: () => true }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 390, 530, false, low);
    assert.ok(calls.filter(call => call[0] === 'fill').length >= 3, 'separate flame tongues remain visible even on LOW');
    const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
    const bearing = Math.atan2(b.y - a.y + 5 * Math.min(390 / 480, 530 / 680), b.x - a.x);
    assert.ok(calls.some(call => call[0] === 'rotate' && Math.abs((call[1] as number) - bearing) < 1e-10));
    assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
    for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    assert.deepEqual(effect, before);
  }
});

test('actual weapon skill damage uses compact directional cuts or punctures without replaying a cast', () => {
  for (const heroId of ['estrilda', 'astral_blademaster', 'gwyneth', 'cecilia', 'oscar', 'walker', 'hero_134_thane']) {
    const initial = createInitialData();
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
      { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
    assert.ok(cast);
    const damage = entries.find(event => event.sourceId === source.instanceId && event.castId === cast.castId && event.type === 'damage')!;
    assert.ok(damage, `${heroId}: actual active damage required`);
    const target = sim.getUnits().find(unit => unit.instanceId === damage.targetId)!;
    const effect = createSpriteEffect(damage, source, target)!;
    assert.equal(effect.kind, 'impact'); assert.equal(effect.basic, false); assert.equal(effect.support, false);
    effect.age = effect.duration * 0.4;
    const before = structuredClone(effect);
    for (const [reduced, low] of [[false, false], [false, true], [true, true]]) {
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { if (name === 'shadowBlur') assert.equal(value, 0, 'small outcomes never glow'); return true; } }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      if (!reduced) {
        assert.equal(calls.some(call => call[0] === 'arc'), false, `${heroId}: not the shared impact ring`);
        const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
        const scale = Math.min(390 / 480, 530 / 680), bearing = Math.atan2(b.y - a.y + 5 * scale, b.x - a.x);
        assert.ok(calls.some(call => call[0] === 'rotate' && Math.abs(Number(call[1]) - bearing) < 1e-10));
        if (getSpriteSkillArt(heroId)!.motif === 'blades') assert.ok(calls.some(call => call[0] === 'quadraticCurveTo'), 'short curved blade cut');
        else assert.ok(calls.filter(call => call[0] === 'lineTo').length >= 3, 'compact puncture and side ticks');
        for (const call of calls.filter(call => call[0] === 'moveTo' || call[0] === 'lineTo')) {
          assert.ok(Math.abs(Number(call[1])) <= 18 * scale && Math.abs(Number(call[2])) <= 18 * scale, 'outcome stays smaller than cast art');
        }
      } else assert.equal(calls.some(call => call[0] === 'rotate'), false, 'reduced motion keeps a static accent');
      assert.ok(calls.some(call => call[0] === 'stroke'));
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual basic damage stays a compact unglowed contact accent rather than a spell ring and particle burst', () => {
  for (const hero of OATHBOUND_HEROES) {
    const initial = createInitialData();
    const formation = [hero.heroId, ...initial.formation.filter(id => id !== hero.heroId)].slice(0, 5) as TeamFormationSlots;
    const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, entry]) => [id,
      { ...entry, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes,
      enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === hero.heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let events: CombatEvent[] = [];
    for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); events = sim.consumeEvents();
      if (events.some(event => event.sourceId === source.instanceId && event.type === 'basic_attack')) break;
    }
    const cast = events.find(event => event.sourceId === source.instanceId && event.type === 'basic_attack')!;
    assert.ok(cast, `${hero.heroId}: natural basic required`);
    const damage = events.find(event => event.sourceId === source.instanceId && event.type === 'damage' && event.castId === cast.castId)!;
    assert.ok(damage, `${hero.heroId}: actual matching damage required`);
    const target = sim.getUnits().find(unit => unit.instanceId === damage.targetId)!;
    const effect = createSpriteEffect(damage, source, target)!;
    assert.equal(effect.basic, true); assert.equal(effect.kind, 'impact');
    effect.age = effect.duration * 0.4;
    const before = structuredClone(effect), scale = Math.min(390 / 480, 530 / 680);
    for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { if (name === 'shadowBlur') assert.equal(value, 0); return true; } }) as CanvasRenderingContext2D;
      drawSpriteEffects(ctx, [effect], 390, 530, reduced, 'ground', low);
      assert.equal(calls.length, 0, 'basic impact has no ground art');
      drawSpriteEffects(ctx, [effect], 390, 530, reduced, 'front', low);
      const b = projectSpritePosition(target.x, target.y, 390, 530);
      assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
      assert.equal(calls.some(call => ['arc', 'ellipse', 'fill', 'createRadialGradient'].includes(String(call[0]))), false, 'no spell ring or particles for basics');
      if (reduced) assert.equal(calls.some(call => call[0] === 'rotate'), false);
      assert.equal(calls.filter(call => call[0] === 'stroke').length, 2, 'two short contact strokes');
      for (const call of calls.filter(call => call[0] === 'moveTo' || call[0] === 'lineTo')) {
        assert.ok(Math.abs(Number(call[1])) <= 10 * scale && Math.abs(Number(call[2])) <= 10 * scale);
      }
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual spell and seal damage leaves small motif-specific recipient accents', () => {
  for (const heroId of ['belinda', 'hero_68_rigby', 'eluard', 'hero_248_eluard', 'scarlet', 'fawkes', 'morrow', 'iron_bastion']) {
    const initial = createInitialData();
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
      { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
    assert.ok(cast);
    const damage = entries.find(event => event.sourceId === source.instanceId && event.castId === cast.castId && event.type === 'damage')!;
    assert.ok(damage, `${heroId}: actual active damage required`);
    const target = sim.getUnits().find(unit => unit.instanceId === damage.targetId)!;
    const effect = createSpriteEffect(damage, source, target)!;
    assert.equal(effect.kind, 'impact'); assert.equal(effect.support, false); assert.equal(effect.basic, false);
    effect.age = effect.duration * 0.4;
    const before = structuredClone(effect), scale = Math.min(390 / 480, 530 / 680);
    for (const [reduced, low] of [[false, false], [false, true], [true, true]]) {
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { if (name === 'shadowBlur') assert.equal(value, 0); return true; } }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      const b = projectSpritePosition(target.x, target.y, 390, 530);
      assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
      assert.equal(calls.some(call => ['rotate', 'createRadialGradient', 'fill', 'ellipse'].includes(String(call[0]))), false, 'small outlined accent, no opaque cast replay');
      if (!reduced) {
        assert.ok(calls.filter(call => call[0] === 'arc').every(call => Number(call[5]) - Number(call[4]) < Math.PI * 2), `${heroId}: not the generic full impact ring`);
        if (heroId.includes('eluard')) assert.equal(calls.filter(call => call[0] === 'closePath').length, 2, 'two small crystal facets on LOW');
        else if (heroId === 'hero_68_rigby') assert.ok(calls.filter(call => call[0] === 'quadraticCurveTo').length >= 2, 'curved flame lick');
        else if (heroId === 'scarlet') assert.equal(calls.filter(call => call[0] === 'arc').length, 2, 'two short vortex coils');
        else if (heroId === 'fawkes') {
          assert.equal(calls.filter(call => call[0] === 'closePath').length, 1, 'one compact coffin seal');
          assert.equal(calls.filter(call => call[0] === 'lineTo').length, 7, 'six seal edges with two cross strokes');
        } else if (heroId === 'morrow') {
          assert.equal(calls.filter(call => call[0] === 'quadraticCurveTo').length, 2, 'two eye lids');
          assert.equal(calls.filter(call => call[0] === 'arc').length, 0, 'no rotating or expanding pupil halo');
          assert.equal(calls.filter(call => call[0] === 'lineTo').length, 1, 'one pupil slit');
        } else if (heroId === 'iron_bastion') {
          assert.equal(calls.filter(call => call[0] === 'closePath').length, 1, 'one shield-shaped contact seal');
          assert.equal(calls.filter(call => call[0] === 'lineTo').length, 7, 'five shield edges and two brace strokes');
        } else assert.equal(calls.filter(call => call[0] === 'lineTo').length, 4, 'four short light rays');
        for (const call of calls.filter(call => call[0] === 'moveTo' || call[0] === 'lineTo')) {
          assert.ok(Math.abs(Number(call[1])) <= 18 * scale && Math.abs(Number(call[2])) <= 18 * scale);
        }
      }
      assert.ok(calls.some(call => call[0] === 'stroke'));
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual arrow and dagger active arrivals keep compact weapon silhouettes instead of oversized spear lines', () => {
  for (const heroId of ['gwyneth', 'oscar']) {
    const initial = createInitialData();
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
      { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
    assert.ok(cast);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills.active.targetType);
    assert.notEqual(source.team, target.team);
    const effect = createSpriteEffect(cast, source, target)!;
    effect.age = effect.duration * 0.72;
    const before = structuredClone(effect);
    for (const [reduced, low] of [[false, false], [false, true], [true, true]]) {
      const calls: unknown[][] = [], weaponPaths: unknown[][] = [];
      let depth = 0;
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        if (name === 'save') depth++;
        if ((name === 'moveTo' || name === 'lineTo') && depth >= 3) weaponPaths.push([String(name), ...args]);
        if (name === 'restore') depth--;
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: () => true }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      if (!reduced) {
        const scale = Math.min(390 / 480, 530 / 680), radius = 43 * scale;
        // Inspect the nested weapon-local paths, not the independent outer spark decoration.
        assert.ok(weaponPaths.length > 0);
        for (const call of weaponPaths) {
          assert.ok(Math.abs(Number(call[1])) <= radius * 0.65 && Math.abs(Number(call[2])) <= radius * 0.65,
            `${heroId}: local weapon paths do not span the entire recipient body`);
        }
        const vertices = weaponPaths.filter(call => call[0] === 'lineTo').length;
        assert.ok(vertices >= (heroId === 'gwyneth' ? 14 : 12), 'arrow retains fletching; dagger retains crossguard and handle');
      }
      assert.ok(calls.some(call => call[0] === 'stroke'));
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual Estrilda active and ultimate arrivals retain short directed lance tips instead of body-spanning shafts', () => {
  const initial = createInitialData();
  const heroId = 'estrilda';
  const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
    seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
  const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
  sim.consumeEvents();
  let entries: CombatEvent[] = [];
  for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
    sim.step(50); entries = sim.consumeEvents();
    if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
  }
  const active = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
  assert.ok(active, 'natural active must occur');
  const activeEntries = entries;
  assert.equal(sim.triggerUltimate(source.instanceId, true), true);
  const ultimateEntries = sim.consumeEvents();
  const ultimate = ultimateEntries.find(event => event.sourceId === source.instanceId && event.type === 'ultimate_cast')!;
  assert.ok(ultimate, 'actual ultimate must occur');
  for (const [cast, outcomes, spec] of [[active, activeEntries, getHeroById(heroId).skills.active],
    [ultimate, ultimateEntries, getHeroById(heroId).skills.ultimate]] as const) {
    const target = resolveSpriteEffectTarget(cast, outcomes, sim.getUnits(), source, spec.targetType);
    assert.notEqual(target.team, source.team);
    assert.ok(outcomes.some(event => event.castId === cast.castId && event.type === 'damage' &&
      event.targetId === target.instanceId && event.value! > 0), 'visible lance arrival needs an actual damaged recipient');
    const effect = createSpriteEffect(cast, source, target)!;
    for (const phase of [0.72, 0.92]) for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      effect.age = effect.duration * phase;
      const before = structuredClone(effect), calls: unknown[][] = [], localPaths: unknown[][] = [];
      let depth = 0;
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        if (name === 'save') depth++;
        if (depth >= 3 && (name === 'moveTo' || name === 'lineTo')) localPaths.push([String(name), ...args]);
        if (name === 'restore') depth--;
        calls.push([String(name), ...args]);
        return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: () => true }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      const scale = Math.min(390 / 480, 530 / 680), radius = (effect.ultimate ? 62 : 43) * scale;
      const b = projectSpritePosition(target.x, target.y, 390, 530);
      if (!reduced) {
        assert.ok(localPaths.length > 0, 'directed local lance geometry remains');
        for (const call of localPaths) assert.ok(Math.abs(Number(call[1])) <= radius * 0.8 &&
          Math.abs(Number(call[2])) <= radius * 0.8, 'arrival shafts must not span the recipient body');
        assert.equal(calls.filter(call => call[0] === 'fill').length, effect.ultimate ? 5 : 3, 'one compact solid tip per lance');
        assert.equal(calls.some(call => ['ellipse', 'createRadialGradient'].includes(String(call[0]))), false,
          'lance tips do not add a generic halo or magic glyph');
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
      } else assert.equal(calls.some(call => call[0] === 'rotate'), false, 'reduced motion stays static');
      assert.ok(calls.some(call => call[0] === 'stroke'));
      assert.equal(depth, 0);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual Estrilda ultimate release flies short oriented lance tips rather than generic spell diamonds', () => {
  const initial = createInitialData();
  const sim = new BattleSimulation({ allyFormation: initial.formation, ownedHeroes: initial.ownedHeroes,
    enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false });
  const source = sim.getUnits().find(unit => unit.heroId === 'estrilda' && unit.team === 'ally')!;
  assert.ok(source);
  sim.consumeEvents();
  assert.equal(sim.triggerUltimate(source.instanceId, true), true);
  const entries = sim.consumeEvents(), cast = entries.find(event => event.type === 'ultimate_cast' && event.sourceId === source.instanceId)!;
  assert.ok(cast);
  const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById('estrilda').skills.ultimate.targetType);
  assert.notEqual(target.team, source.team);
  assert.ok(entries.some(event => event.type === 'damage' && event.castId === cast.castId &&
    event.targetId === target.instanceId && event.value! > 0));
  const effect = createSpriteEffect(cast, source, target)!;
  for (const phase of [0.38, 0.44]) for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
    effect.age = effect.duration * phase;
    const before = structuredClone(effect), calls: unknown[][] = [], tips: unknown[][][] = [];
    let depth = 0, current: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      if (name === 'save') depth++;
      if (name === 'beginPath') current = [];
      if (name === 'moveTo' || name === 'lineTo') current.push([String(name), ...args]);
      if (name === 'fill' && depth >= 2) tips.push(current);
      if (name === 'restore') depth--;
      calls.push([String(name), ...args]);
      return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: () => true }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
    if (!reduced) {
      const count = low ? 3 : 5;
      assert.equal(calls.filter(call => call[0] === 'rotate').length, count, 'each projectile follows the real cast bearing');
      assert.equal(tips.length, count, 'one local spearhead per projectile, not an unrotated spell diamond');
      const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
      const scale = Math.min(390 / 480, 530 / 680), bearing = Math.atan2(b.y - 48 * scale - (a.y - 53 * scale), b.x - a.x);
      for (const call of calls.filter(call => call[0] === 'rotate')) assert.equal(call[1], bearing);
      for (const tip of tips) {
        assert.equal(tip.length, 4, 'pointed lance head keeps two barbs and central notch');
        const xs = tip.map(call => Number(call[1])), ys = tip.map(call => Number(call[2]));
        assert.ok(Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys), 'head points along travel, not vertically');
        for (const value of [...xs, ...ys]) assert.ok(Math.abs(value) <= 62 * scale * 0.35, 'projectile head remains compact');
      }
      assert.equal(calls.some(call => ['ellipse', 'createRadialGradient'].includes(String(call[0]))), false);
    } else assert.equal(calls.some(call => call[0] === 'rotate'), false);
    assert.ok(calls.some(call => call[0] === 'stroke'));
    assert.equal(depth, 0);
    for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    assert.deepEqual(effect, before);
  }
});

test('actual crowd control applications retain distinct compact recipient marks without replaying magic bursts', () => {
  const signatures = new Set<string>();
  for (const ccType of ['stun', 'silence', 'slow', 'knockback', 'petrify'] as const) {
    const initial = createInitialData();
    const sim = new BattleSimulation({ allyFormation: initial.formation, ownedHeroes: initial.ownedHeroes,
      enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false });
    const source = sim.getUnits().find(unit => unit.team === 'ally')!;
    const target = sim.getUnits().find(unit => unit.team === 'enemy')!;
    sim.consumeEvents();
    sim.applyCrowdControl(source, target, ccType, 1200);
    const event = sim.consumeEvents().find(entry => entry.type === 'crowd_control')!;
    assert.ok(event);
    assert.equal(event.ccType, ccType);
    assert.ok(target.statusEffects.some(status => status.type === ccType && status.remainingMs === 1200));
    const effect = createSpriteEffect(event, source, target)!;
    assert.equal(effect.kind, 'control');
    assert.equal((effect as { ccType?: string }).ccType, ccType, 'presentation retains the actual applied control type');
    for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      effect.age = effect.duration * 0.4;
      const before = structuredClone(effect), calls: unknown[][] = [], writes: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]);
        return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { writes.push([String(name), value]); return true; } }) as CanvasRenderingContext2D;
      drawSpriteEffects(ctx, [effect], 390, 530, reduced, 'front', low);
      const scale = Math.min(390 / 480, 530 / 680), point = projectSpritePosition(target.x, target.y, 390, 530);
      assert.ok(calls.some(call => call[0] === 'translate' && call[1] === point.x && call[2] === point.y - 48 * scale));
      assert.equal(calls.some(call => ['fill', 'ellipse', 'rotate', 'createRadialGradient'].includes(String(call[0]))), false);
      assert.ok(writes.filter(write => write[0] === 'shadowBlur').length > 0);
      assert.ok(writes.filter(write => write[0] === 'shadowBlur').every(write => write[1] === 0));
      for (const call of calls.filter(call => ['moveTo', 'lineTo'].includes(String(call[0]))))
        assert.ok(Math.abs(Number(call[1])) <= 14 * scale && Math.abs(Number(call[2])) <= 14 * scale, 'control mark stays recipient-local and small');
      for (const call of calls.filter(call => call[0] === 'arc')) assert.ok(Number(call[3]) <= 14 * scale);
      assert.ok(calls.some(call => call[0] === 'stroke'), 'all quality/motion combinations retain feedback');
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      if (!reduced && !low) signatures.add(JSON.stringify(calls.filter(call => ['moveTo', 'lineTo', 'arc'].includes(String(call[0])))));
      assert.deepEqual(effect, before);
      calls.length = 0;
      drawSpriteEffects(ctx, [effect], 390, 530, reduced, 'ground', low);
      assert.equal(calls.length, 0, 'a control outcome does not replay a floor charge');
    }
  }
  assert.equal(signatures.size, 5, 'each actual control kind has its own static-safe shape');
});

test('imported control skills route their real cast outcomes to matching recipient marks and pause-safe timelines', () => {
  const observedTypes = new Set<string>();
  let casts = 0, outcomes = 0;
  for (const hero of OATHBOUND_HEROES) for (const slot of ['active', 'ultimate'] as const) {
    const skill = getHeroById(hero.heroId).skills[slot];
    if (!skill.ccType) continue;
    const initial = createInitialData();
    const formation = [hero.heroId, ...initial.formation.filter(id => id !== hero.heroId)].slice(0, 5) as TeamFormationSlots;
    const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, owned]) => [id,
      { ...owned, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === hero.heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    if (slot === 'ultimate') {
      assert.equal(sim.triggerUltimate(source.instanceId, true), true);
      entries = sim.consumeEvents();
    } else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId &&
      event.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'));
    assert.ok(cast, `${hero.name}/${slot}: real cast required`);
    const controls = entries.filter(event => event.sourceId === source.instanceId && event.castId === cast.castId && event.type === 'crowd_control');
    assert.ok(controls.length > 0, `${hero.name}/${slot}: real applied controls required`);
    casts++;
    for (const event of controls) {
      const target = sim.getUnits().find(unit => unit.instanceId === event.targetId)!;
      assert.ok(target?.isAlive);
      assert.notEqual(target.team, source.team);
      assert.equal(event.ccType, skill.ccType);
      assert.equal(event.skillSlot, slot);
      assert.ok(target.statusEffects.some(status => status.type === event.ccType && status.sourceUnitId === source.instanceId));
      const effect = createSpriteEffect(event, source, target)!;
      assert.equal(effect.ccType, event.ccType);
      assert.equal(effect.skillSlot, slot);
      assert.equal(effect.support, false);
      assert.deepEqual(effect.target, { x: target.x, y: target.y });
      observedTypes.add(effect.ccType!); outcomes++;
      const effects = [effect];
      advanceSpriteEffects(effects, effect.duration * 0.4);
      const before = structuredClone(effects);
      advanceSpriteEffects(effects, advancePresentationClock(0, 0.5, true));
      assert.deepEqual(effects, before, 'paused presentation cannot advance control marks');
      for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
        const trace = () => {
          const calls: unknown[][] = [];
          const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
            calls.push([String(name), ...args]); return undefined;
          }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
          drawSpriteEffects(ctx, effects, 390, 530, reduced, 'front', low);
          return calls;
        };
        const calls = trace(), point = projectSpritePosition(target.x, target.y, 390, 530), scale = Math.min(390 / 480, 530 / 680);
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === point.x && call[2] === point.y - 48 * scale));
        assert.ok(calls.some(call => call[0] === 'stroke'));
        assert.equal(calls.some(call => ['rotate', 'fill', 'createRadialGradient'].includes(String(call[0]))), false);
        assert.deepEqual(trace(), calls, 'paused control drawing remains deterministic');
        assert.deepEqual(effects, before);
      }
      advanceSpriteEffects(effects, effect.duration);
      assert.equal(effects.length, 0, 'application acknowledgement expires independently of persistent status labels');
    }
    for (const event of entries.filter(event => event.type !== 'crowd_control')) {
      const target = sim.getUnits().find(unit => unit.instanceId === event.targetId) || source;
      const effect = createSpriteEffect(event, source, target);
      if (effect) assert.equal(effect.ccType, undefined, 'casts and damage cannot fabricate a control outcome');
    }
  }
  assert.equal(casts, 11, 'all current imported active and ultimate control specifications exercised');
  assert.ok(outcomes >= casts);
  assert.deepEqual([...observedTypes].sort(), ['knockback', 'silence', 'slow', 'stun']);
});

test('real skill draws restore caller Canvas state and preserve composed arrival anchors and opacity', () => {
  type Matrix = [number, number, number, number, number, number];
  const callerMatrix: Matrix = [1.1, 0.15, -0.2, 0.9, 17, 23];
  const transform = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const multiply = (a: Matrix, b: Matrix): Matrix => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const makeContext = () => {
    const initial = { matrix: [...callerMatrix] as Matrix, globalAlpha: 0.4, globalCompositeOperation: 'destination-over',
      strokeStyle: '#123456', fillStyle: '#654321', lineWidth: 3, shadowBlur: 4, shadowColor: '#112233',
      shadowOffsetX: 0, shadowOffsetY: 0, lineCap: 'square', lineJoin: 'bevel', filter: 'none' };
    let state = { ...initial, matrix: [...initial.matrix] as Matrix };
    const stack: typeof state[] = [];
    let points: Array<{ x: number; y: number }> = [];
    const draws: Array<{ points: typeof points; alpha: number; blur: number; width: number; composite: string }> = [];
    const point = (x: number, y: number) => points.push(transform(state.matrix, x, y));
    const methods: Record<string, (...args: number[]) => unknown> = {
      save() { stack.push({ ...state, matrix: [...state.matrix] as Matrix }); },
      restore() { assert.ok(stack.length, 'restore cannot underflow'); state = stack.pop()!; },
      translate(x, y) { state.matrix = multiply(state.matrix, [1, 0, 0, 1, x, y]); },
      rotate(a) { state.matrix = multiply(state.matrix, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
      scale(x, y) { state.matrix = multiply(state.matrix, [x, 0, 0, y, 0, 0]); },
      beginPath() { points = []; }, closePath() {}, moveTo: point, lineTo: point,
      quadraticCurveTo(cx, cy, x, y) { point(cx, cy); point(x, y); },
      bezierCurveTo(a, b, c, d, x, y) { point(a, b); point(c, d); point(x, y); },
      arc(x, y, r, start, end) {
        for (let i = 0; i <= 16; i++) { const a = start + (end - start) * i / 16; point(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      },
      ellipse(x, y, rx, ry, rotation, start, end) {
        for (let i = 0; i <= 16; i++) {
          const a = start + (end - start) * i / 16, dx = Math.cos(a) * rx, dy = Math.sin(a) * ry;
          point(x + dx * Math.cos(rotation) - dy * Math.sin(rotation), y + dx * Math.sin(rotation) + dy * Math.cos(rotation));
        }
      },
      stroke() { draws.push({ points: [...points], alpha: state.globalAlpha, blur: state.shadowBlur, width: state.lineWidth, composite: state.globalCompositeOperation }); },
      fill() { methods.stroke(); },
      createRadialGradient() { return { addColorStop() {} }; },
    };
    const ctx = new Proxy({}, {
      get: (_, key) => key in state ? state[key as keyof typeof state] : methods[String(key)],
      set: (_, key, value) => { Reflect.set(state, key, value); return true; },
    }) as CanvasRenderingContext2D;
    return { ctx, draws, initial, snapshot: () => state, depth: () => stack.length };
  };
  // Positive control: this double composes transforms and restores readable properties, not just call counts.
  const control = makeContext();
  control.ctx.save(); control.ctx.globalAlpha *= 0.5; control.ctx.translate(10, 20); control.ctx.rotate(Math.PI / 2);
  control.ctx.beginPath(); control.ctx.moveTo(2, 3); control.ctx.stroke(); control.ctx.restore();
  const expectedControl = transform(callerMatrix, 7, 22);
  assert.ok(Math.abs(control.draws[0].points[0].x - expectedControl.x) < 1e-10);
  assert.ok(Math.abs(control.draws[0].points[0].y - expectedControl.y) < 1e-10);
  assert.equal(control.draws[0].alpha, 0.2);
  assert.deepEqual(control.snapshot(), control.initial);
  const initial = createInitialData();
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  for (const hero of OATHBOUND_HEROES) for (const slot of ['active', 'ultimate'] as const) {
    const formation = [hero.heroId, ...initial.formation.filter(id => id !== hero.heroId)].slice(0, 5) as TeamFormationSlots;
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === hero.heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    if (slot === 'ultimate') { assert.equal(sim.triggerUltimate(source.instanceId, true), true); entries = sim.consumeEvents(); }
    else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(e => e.sourceId === source.instanceId && e.type === 'active_skill')) break;
    }
    const cast = entries.find(e => e.sourceId === source.instanceId && e.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
    assert.ok(cast);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(hero.heroId).skills[slot].targetType);
    const effect = createSpriteEffect(cast, source, target)!;
    for (const phase of [0.4601, 0.56, 0.6399, 0.64, 0.74, 0.92])
      for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
        effect.age = effect.duration * phase;
        const before = structuredClone(effect), trace = makeContext();
        drawSpriteSkillArt(trace.ctx, effect, 390, 530, reduced, low);
        assert.equal(trace.depth(), 0, `${hero.heroId}/${slot}/${phase}: balanced actual state stack`);
        assert.deepEqual(trace.snapshot(), trace.initial, 'all caller styles, alpha, compositing and matrix restored');
        assert.deepEqual(effect, before);
        assert.ok(trace.draws.length, 'real cast remains visible across release-to-arrival overlap');
        for (const draw of trace.draws) {
          assert.ok(draw.alpha > 0 && draw.alpha <= trace.initial.globalAlpha, 'effective opacity respects the caller');
          for (const p of draw.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
        }
        if (!effect.support && phase >= 0.74) {
          const scale = Math.min(390 / 480, 530 / 680), radius = (slot === 'ultimate' ? 62 : 43) * scale;
          const b = projectSpritePosition(target.x, target.y, 390, 530);
          const [a, c, d, e, tx, ty] = callerMatrix, determinant = a * e - c * d;
          for (const draw of trace.draws) {
            if (['hero_68_rigby', 'walker'].includes(hero.heroId)) assert.equal(draw.blur, 0,
              'final flame and bullet contact stays crisp without a second glow around the recipient');
            if (low || reduced) assert.equal(draw.blur, 0, 'LOW and reduced contacts disable glow');
            for (const p of draw.points) {
              const dx = p.x - tx, dy = p.y - ty;
              const x = (e * dx - d * dy) / determinant - b.x;
              const y = (-c * dx + a * dy) / determinant - (b.y - 48 * scale);
              assert.ok(Math.hypot(x, y) + draw.width / 2 <= radius * 1.05,
                `${hero.heroId}/${slot}: composed path and half-stroke stay compact at the real recipient`);
            }
            // Canvas shadowBlur has no portable finite pixel radius: record it, do not claim a painted-pixel bound.
            assert.ok(draw.blur >= 0 && draw.blur <= 10 * scale);
          }
        }
        if (!effect.support && !reduced) {
          const fade = Math.min(1, phase * 12) * Math.min(1, (1 - phase) * 5);
          const arrivalAlpha = 0.4 * fade * 0.7 * Math.max(0, Math.min(1, (phase - 0.46) / 0.24));
          const deliveryAlpha = 0.4 * fade * 0.7 * 0.65;
          const matches = (actual: number, expected: number) => Math.abs(actual - expected) < 1e-12;
          assert.ok(trace.draws.some(draw => matches(draw.alpha, arrivalAlpha)),
            `${hero.heroId}/${slot}/${phase}: real offensive arrival uses the existing bloom opacity`);
          for (const draw of trace.draws) assert.ok(matches(draw.alpha, arrivalAlpha) ||
            (phase < 0.64 && matches(draw.alpha, deliveryAlpha)),
            'only the in-flight layer may retain delivery opacity during handoff');
        }
        if (hero.heroId === 'belinda' && !reduced) {
          const fade = Math.min(1, phase * 12) * Math.min(1, (1 - phase) * 5);
          const arrival = Math.max(0, Math.min(1, (phase - 0.46) / 0.24));
          const count = low ? slot === 'ultimate' ? 4 : 3 : slot === 'ultimate' ? 6 : 4;
          const arrivalDraws = trace.draws.slice(-count);
          assert.equal(arrivalDraws.length, count);
          for (const draw of arrivalDraws) assert.ok(Math.abs(draw.alpha - 0.4 * fade * 0.7 * arrival) < 1e-12,
            'arrival rays ease into view during delivery overlap rather than appearing fully opaque at onset');
          if (phase < 0.64) {
            const deliveryDraws = trace.draws.slice(0, -count);
            assert.ok(deliveryDraws.length, 'real release geometry remains visible during the handoff');
            assert.ok(deliveryDraws.every(draw => Math.abs(draw.alpha - 0.4 * fade * 0.7 * 0.65) < 1e-12),
              'arrival opacity must not dim the in-flight delivery');
          }
        }
        if (hero.heroId === 'belinda' && phase >= 0.74) {
          const scale = Math.min(390 / 480, 530 / 680), radius = (slot === 'ultimate' ? 62 : 43) * scale;
          const b = projectSpritePosition(target.x, target.y, 390, 530);
          const fade = Math.min(1, phase * 12) * Math.min(1, (1 - phase) * 5);
          for (const draw of trace.draws) {
            assert.ok(Math.abs(draw.alpha - 0.4 * fade * (reduced ? 0.65 : 0.7)) < 1e-12, 'effective fade includes caller opacity');
            assert.equal(draw.blur, 0);
            assert.equal(draw.composite, reduced ? trace.initial.globalCompositeOperation : 'source-over',
              'static reduced marks retain caller composition; normal offensive art explicitly uses source-over');
          }
          if (!reduced) {
            const settle = (phase - 0.66) / 0.34;
            const expected = [radius * 0.24, radius * (0.7 - settle * 0.1)].map(distance => transform(callerMatrix, b.x, b.y - 48 * scale - distance));
            assert.equal(trace.draws[0].points.length, 2);
            trace.draws[0].points.forEach((p, i) => {
              assert.ok(Math.abs(p.x - expected[i].x) < 1e-10 && Math.abs(p.y - expected[i].y) < 1e-10,
                'first light ray is composed at the actual recipient under the caller transform');
            });
          }
        }
      }
  }
});

test('actual Lucius and Hendrik offensive arrivals use compact distinct shield contacts without body wards', () => {
  const initial = createInitialData();
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  const signatures = new Map<string, string>();
  for (const heroId of ['celestial_guardian', 'iron_bastion']) for (const slot of ['active', 'ultimate'] as const) {
    if (heroId === 'celestial_guardian' && slot === 'ultimate') continue; // Actual allied ward is covered by support regressions.
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    if (slot === 'ultimate') {
      assert.equal(sim.triggerUltimate(source.instanceId, true), true);
      entries = sim.consumeEvents();
    } else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId &&
      event.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
    assert.ok(cast, `${heroId}/${slot}: actual cast required`);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills[slot].targetType);
    assert.notEqual(target.team, source.team);
    assert.ok(entries.some(event => event.sourceId === source.instanceId && event.castId === cast.castId &&
      event.targetId === target.instanceId && event.type === 'damage' && event.value! > 0));
    const effect = createSpriteEffect(cast, source, target)!;
    let earlierEnvelope = 0;
    for (const phase of [0.74, 0.92]) for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      effect.age = effect.duration * phase;
      const before = structuredClone(effect), calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      const scale = Math.min(390 / 480, 530 / 680), radius = (slot === 'ultimate' ? 62 : 43) * scale;
      const b = projectSpritePosition(target.x, target.y, 390, 530);
      assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
      assert.equal(calls.some(call => ['fill', 'arc', 'ellipse', 'rotate', 'createRadialGradient'].includes(String(call[0]))), false,
        'offensive shield contacts never become a full ward, particle burst, or generic halo');
      if (!reduced) {
        assert.equal(calls.filter(call => call[0] === 'stroke').length, 3, 'one shield contour plus its two identity marks');
        assert.equal(calls.filter(call => call[0] === 'closePath').length, 1, 'only the transparent shield contour closes');
        const points = calls.filter(call => ['moveTo', 'lineTo'].includes(String(call[0])));
        const envelope = Math.max(...points.map(point => Math.hypot(Number(point[1]), Number(point[2]))));
        assert.ok(envelope > radius * 0.35 && envelope < radius * 0.7, 'small yet nonempty shield contact');
        if (!low && phase === 0.74) earlierEnvelope = envelope;
        if (!low && phase === 0.92) assert.ok(envelope < earlierEnvelope, 'contact contracts during recovery');
        if (!low && phase === 0.74 && slot === 'active') signatures.set(heroId, JSON.stringify(points));
        assert.ok(calls.filter(call => call[0] === 'set' && call[1] === 'lineWidth')
          .every(call => Number(call[2]) <= Math.max(1, 2 * scale)));
      }
      assert.ok(calls.some(call => call[0] === 'stroke'));
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
  assert.equal(signatures.size, 2);
  assert.notEqual(signatures.get('celestial_guardian'), signatures.get('iron_bastion'), 'sun-cross and bastion brace differ in geometry, not only color');
});

test('actual Gwyneth and Oscar arrivals keep directed weapon details without a shared magic halo', () => {
  const initial = createInitialData();
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  for (const heroId of ['gwyneth', 'oscar']) for (const slot of ['active', 'ultimate'] as const) {
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    if (slot === 'ultimate') {
      assert.equal(sim.triggerUltimate(source.instanceId, true), true);
      entries = sim.consumeEvents();
    } else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId &&
      event.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
    assert.ok(cast, `${heroId}/${slot}: actual cast required`);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills[slot].targetType);
    assert.notEqual(target.team, source.team);
    assert.ok(entries.some(event => event.sourceId === source.instanceId && event.castId === cast.castId &&
      event.targetId === target.instanceId && event.type === 'damage' && event.value! > 0));
    const effect = createSpriteEffect(cast, source, target)!;
    for (const phase of [0.74, 0.92]) for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      effect.age = effect.duration * phase;
      const before = structuredClone(effect), calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      const scale = Math.min(390 / 480, 530 / 680), radius = (slot === 'ultimate' ? 62 : 43) * scale;
      const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
      assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
      assert.equal(calls.some(call => ['arc', 'ellipse', 'createRadialGradient'].includes(String(call[0]))), false,
        'arrow and dagger contact never become a generic spell halo');
      if (!reduced) {
        const count = low ? 2 : slot === 'ultimate' ? 4 : 3;
        assert.equal(calls.filter(call => call[0] === 'fill').length, count, 'only the small real weapon heads are filled, no particles');
        assert.equal(calls.filter(call => call[0] === 'stroke').length, count * (heroId === 'gwyneth' ? 2 : 3),
          'arrow fletching and dagger guards remain distinct');
        const rotations = calls.filter(call => call[0] === 'rotate');
        assert.equal(rotations.length, count + 1);
        assert.equal(rotations[0][1], Math.atan2(b.y - 48 * scale - (a.y - 53 * scale), b.x - a.x) + getSpriteSkillArt(heroId)!.angle);
        assert.ok(rotations.slice(1).every(call => Math.abs(Number(call[1])) <= 0.3), 'weapon spread never reapplies the world bearing');
        const offsets = calls.filter(call => call[0] === 'translate').slice(1);
        assert.equal(offsets.length, count);
        for (const point of offsets) assert.ok(Math.hypot(Number(point[1]), Number(point[2])) < radius * 0.5);
        for (const point of calls.filter(call => ['moveTo', 'lineTo'].includes(String(call[0]))))
          assert.ok(Math.hypot(Number(point[1]), Number(point[2])) < radius * 0.55, 'weapon remains a short readable contact');
      }
      assert.ok(calls.some(call => call[0] === 'stroke'));
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual blade heroes settle compact directed cuts at the real victim without thick ellipse blooms', () => {
  const initial = createInitialData();
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  for (const heroId of ['astral_blademaster', 'cecilia', 'hero_134_thane']) for (const slot of ['active', 'ultimate'] as const) {
    const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    if (slot === 'ultimate') {
      assert.equal(sim.triggerUltimate(source.instanceId, true), true);
      entries = sim.consumeEvents();
    } else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId &&
      event.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
    assert.ok(cast, `${heroId}/${slot}: actual cast required`);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills[slot].targetType);
    assert.notEqual(target.team, source.team);
    assert.ok(entries.some(event => event.sourceId === source.instanceId && event.castId === cast.castId &&
      event.targetId === target.instanceId && event.type === 'damage' && event.value! > 0));
    const effect = createSpriteEffect(cast, source, target)!, art = getSpriteSkillArt(heroId)!;
    for (const phase of [0.74, 0.92]) for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      effect.age = effect.duration * phase;
      const before = structuredClone(effect), calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      const scale = Math.min(390 / 480, 530 / 680), radius = (slot === 'ultimate' ? 62 : 43) * scale;
      const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
      assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
      assert.equal(calls.some(call => ['fill', 'arc', 'ellipse', 'createRadialGradient', 'closePath'].includes(String(call[0]))), false,
        `${heroId}/${slot}: open cuts never repeat a thick ellipse, halo, or particle burst`);
      if (!reduced) {
        const count = low ? slot === 'ultimate' ? 3 : 2 : slot === 'ultimate' ? Math.min(4, art.rays) : 2;
        assert.equal(calls.filter(call => call[0] === 'stroke').length, count);
        assert.equal(calls.filter(call => call[0] === 'quadraticCurveTo').length, count);
        assert.deepEqual(calls.filter(call => call[0] === 'rotate'),
          [['rotate', Math.atan2(b.y - 48 * scale - (a.y - 53 * scale), b.x - a.x) + art.angle]],
          'one actual-bearing rotation, never a radial spinning wheel');
        for (const call of calls.filter(call => ['moveTo', 'quadraticCurveTo'].includes(String(call[0])))) {
          for (let i = 1; i < call.length; i += 2)
            assert.ok(Math.hypot(Number(call[i]), Number(call[i + 1])) <= radius * 0.8, 'short bounded cut envelope');
        }
        assert.ok(calls.filter(call => call[0] === 'set' && call[1] === 'lineWidth')
          .every(call => Number(call[2]) <= Math.max(1, 2 * scale)), 'no body-masking thick strokes');
      }
      assert.ok(calls.some(call => call[0] === 'stroke'));
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual Belinda active and ultimate arrivals retain compact open light rays without body-spanning pillars', () => {
  const initial = createInitialData(), heroId = 'belinda';
  const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  for (const slot of ['active', 'ultimate'] as const) {
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    if (slot === 'ultimate') {
      assert.equal(sim.triggerUltimate(source.instanceId, true), true);
      entries = sim.consumeEvents();
    } else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId &&
      event.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
    assert.ok(cast);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills[slot].targetType);
    assert.notEqual(target.team, source.team);
    assert.ok(entries.some(event => event.sourceId === source.instanceId && event.castId === cast.castId &&
      event.targetId === target.instanceId && event.type === 'damage' && event.value! > 0));
    const effect = createSpriteEffect(cast, source, target)!;
    for (const phase of [0.74, 0.92]) for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      effect.age = effect.duration * phase;
      const before = structuredClone(effect), calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      const scale = Math.min(390 / 480, 530 / 680), radius = (slot === 'ultimate' ? 62 : 43) * scale;
      const b = projectSpritePosition(target.x, target.y, 390, 530);
      assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
      assert.equal(calls.some(call => ['fill', 'arc', 'ellipse', 'rotate', 'createRadialGradient', 'closePath'].includes(String(call[0]))), false,
        'light contact remains open without a shared halo, solid core, or particles');
      if (!reduced) {
        const count = low ? slot === 'ultimate' ? 4 : 3 : slot === 'ultimate' ? 6 : 4;
        assert.equal(calls.filter(call => call[0] === 'stroke').length, count);
        const points = calls.filter(call => ['moveTo', 'lineTo'].includes(String(call[0])));
        assert.equal(points.length, count * 2, 'each light ray has a short start and end');
        for (const point of points) {
          const distance = Math.hypot(Number(point[1]), Number(point[2]));
          assert.ok(distance >= radius * 0.2 && distance <= radius * 0.75, 'open center and compact ray envelope');
        }
        assert.equal(calls.some(call => call[0] === 'quadraticCurveTo'), false, 'no oversized wing curves at contact');
        const widths = calls.filter(call => call[0] === 'set' && call[1] === 'lineWidth');
        assert.ok(widths.every(call => Number(call[2]) <= Math.max(1, scale * 2)), 'no thick opaque pillars');
      }
      assert.ok(calls.some(call => call[0] === 'stroke'));
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual Scarlet active and ultimate arrivals retain hollow open vortex arms without a filled core', () => {
  const initial = createInitialData(), heroId = 'scarlet';
  const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  for (const slot of ['active', 'ultimate'] as const) {
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    if (slot === 'ultimate') {
      assert.equal(sim.triggerUltimate(source.instanceId, true), true);
      entries = sim.consumeEvents();
    } else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId &&
      event.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
    assert.ok(cast);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills[slot].targetType);
    assert.notEqual(target.team, source.team);
    assert.ok(entries.some(event => event.sourceId === source.instanceId && event.castId === cast.castId &&
      event.targetId === target.instanceId && event.type === 'damage' && event.value! > 0));
    const effect = createSpriteEffect(cast, source, target)!;
    for (const phase of [0.74, 0.92]) for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      effect.age = effect.duration * phase;
      const before = structuredClone(effect), calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: () => true }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      const scale = Math.min(390 / 480, 530 / 680), radius = (slot === 'ultimate' ? 62 : 43) * scale;
      const b = projectSpritePosition(target.x, target.y, 390, 530);
      assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
      assert.equal(calls.some(call => ['fill', 'ellipse', 'rotate', 'createRadialGradient', 'closePath'].includes(String(call[0]))), false,
        'vortex remains open and transparent without a halo, filled core, or diamond particles');
      if (!reduced) {
        const count = low ? 2 : 3, segments = low ? 12 : 18;
        assert.equal(calls.filter(call => call[0] === 'stroke').length, count, 'distinct open spiral arms survive LOW');
        const points = calls.filter(call => ['moveTo', 'lineTo'].includes(String(call[0])));
        assert.equal(points.length, count * (segments + 1));
        for (const point of points) {
          const distance = Math.hypot(Number(point[1]), Number(point[2]));
          assert.ok(distance >= radius * 0.2 && distance <= radius * 0.75, 'hollow center stays clear with a bounded outer silhouette');
        }
        assert.equal(calls.some(call => call[0] === 'arc'), false, 'no full ring masks the open spiral');
      }
      assert.ok(calls.some(call => call[0] === 'stroke'));
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('actual Fawkes active and ultimate arrivals close compact transparent coffin halves at the real victim', () => {
  const initial = createInitialData(), heroId = 'fawkes';
  const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  for (const slot of ['active', 'ultimate'] as const) {
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    if (slot === 'ultimate') {
      assert.equal(sim.triggerUltimate(source.instanceId, true), true);
      entries = sim.consumeEvents();
    } else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId &&
      event.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
    assert.ok(cast);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills[slot].targetType);
    assert.notEqual(target.team, source.team);
    assert.ok(entries.some(event => event.sourceId === source.instanceId && event.castId === cast.castId &&
      event.targetId === target.instanceId && event.type === 'damage' && event.value! > 0));
    const effect = createSpriteEffect(cast, source, target)!;
    for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      const gaps: number[] = [];
      for (const phase of [0.74, 0.92]) {
        effect.age = effect.duration * phase;
        const before = structuredClone(effect), calls: unknown[][] = [];
        const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
          calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
        }, set: () => true }) as CanvasRenderingContext2D;
        drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
        const scale = Math.min(390 / 480, 530 / 680), radius = (slot === 'ultimate' ? 62 : 43) * scale;
        const b = projectSpritePosition(target.x, target.y, 390, 530);
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
        assert.equal(calls.some(call => ['fill', 'arc', 'ellipse', 'rotate', 'createRadialGradient'].includes(String(call[0]))), false,
          'coffin remains transparent without a shared halo or diamond particles');
        if (!reduced) {
          const halves = calls.filter(call => call[0] === 'translate').slice(1);
          assert.equal(halves.length, 2, 'one local transform per coffin half');
          assert.equal(halves[0][1], -Number(halves[1][1]));
          gaps.push(Math.abs(Number(halves[0][1])));
          assert.equal(calls.filter(call => call[0] === 'closePath').length, 2);
          assert.equal(calls.filter(call => call[0] === 'stroke').length, 4, 'each outlined half retains its seal stroke');
          for (const call of calls.filter(call => ['moveTo', 'lineTo'].includes(String(call[0]))))
            for (const value of call.slice(1)) assert.ok(Math.abs(Number(value)) <= radius * 0.65, 'coffin does not span the body');
        }
        assert.ok(calls.some(call => call[0] === 'stroke'));
        assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
        for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
        assert.deepEqual(effect, before);
      }
      if (!reduced) assert.ok(gaps[1] < gaps[0], 'halves close toward the recipient during recovery');
    }
  }
});

test('actual Morrow active and ultimate arrivals close outlined lids without a filled pupil or magic halo', () => {
  const initial = createInitialData(), heroId = 'morrow';
  const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  for (const slot of ['active', 'ultimate'] as const) {
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    if (slot === 'ultimate') {
      assert.equal(sim.triggerUltimate(source.instanceId, true), true);
      entries = sim.consumeEvents();
    } else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId &&
      event.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
    assert.ok(cast);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills[slot].targetType);
    assert.notEqual(target.team, source.team);
    assert.ok(entries.some(event => event.sourceId === source.instanceId && event.castId === cast.castId &&
      event.targetId === target.instanceId && event.type === 'damage' && event.value! > 0));
    const effect = createSpriteEffect(cast, source, target)!;
    for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      const openings: number[] = [];
      for (const phase of [0.74, 0.92]) {
        effect.age = effect.duration * phase;
        const before = structuredClone(effect), calls: unknown[][] = [];
        const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
          calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
        }, set: () => true }) as CanvasRenderingContext2D;
        drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
        const scale = Math.min(390 / 480, 530 / 680), radius = (slot === 'ultimate' ? 62 : 43) * scale;
        const b = projectSpritePosition(target.x, target.y, 390, 530);
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
        assert.equal(calls.some(call => ['fill', 'arc', 'ellipse', 'rotate', 'createRadialGradient'].includes(String(call[0]))), false,
          'eye stays transparent, without a shared halo, spinning pupil, or filled core');
        const lids = calls.filter(call => call[0] === 'quadraticCurveTo');
        assert.equal(lids.length, 2, 'two recognizable eye lids');
        assert.equal(calls.filter(call => call[0] === 'stroke').length, 2, 'one lid contour and one pupil slit');
        assert.equal(calls.filter(call => call[0] === 'lineTo').length, 1);
        for (const call of calls.filter(call => ['moveTo', 'lineTo', 'quadraticCurveTo'].includes(String(call[0]))))
          for (const value of call.slice(1)) assert.ok(Math.abs(Number(value)) <= radius * 0.75, 'lids stay compact');
        openings.push(Math.abs(Number(lids[0][2])));
        assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
        for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
        assert.deepEqual(effect, before);
      }
      if (reduced) assert.equal(openings[0], openings[1], 'reduced-motion eye remains static');
      else assert.ok(openings[1] < openings[0], 'lids settle closed during recovery instead of replaying an explosion');
    }
  }
});

test('actual Rigby Fire Breath arrival leaves directed open flame tongues instead of radial petals', () => {
  const initial = createInitialData(), heroId = 'hero_68_rigby';
  const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
    seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
  const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
  sim.consumeEvents();
  let entries: CombatEvent[] = [];
  for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
    sim.step(50); entries = sim.consumeEvents();
    if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
  }
  const cast = entries.find(event => event.sourceId === source.instanceId && event.type === 'active_skill')!;
  assert.ok(cast);
  const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills.active.targetType);
  assert.notEqual(target.team, source.team);
  assert.ok(entries.some(event => event.sourceId === source.instanceId && event.castId === cast.castId &&
    event.targetId === target.instanceId && event.type === 'damage' && event.value! > 0));
  const effect = createSpriteEffect(cast, source, target)!;
  for (const phase of [0.74, 0.92]) for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
    effect.age = effect.duration * phase;
    const before = structuredClone(effect), calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: () => true }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
    const scale = Math.min(390 / 480, 530 / 680), radius = 43 * scale;
    const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
    assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
    assert.equal(calls.some(call => ['fill', 'arc', 'ellipse', 'createRadialGradient'].includes(String(call[0]))), false,
      'flame contact must not replay a filled radial magic burst');
    if (!reduced) {
      const rotations = calls.filter(call => call[0] === 'rotate');
      assert.deepEqual(rotations, [['rotate', Math.atan2(b.y - 48 * scale - (a.y - 53 * scale), b.x - a.x)]]);
      const count = low ? 2 : 3;
      assert.equal(calls.filter(call => call[0] === 'quadraticCurveTo').length, count * 2, 'each open tongue has an outer and inner flame edge');
      assert.equal(calls.filter(call => call[0] === 'stroke').length, count * 2);
      assert.equal(calls.some(call => call[0] === 'closePath'), false, 'recipient remains visible through open flame outlines');
      for (const call of calls.filter(call => ['moveTo', 'lineTo', 'quadraticCurveTo'].includes(String(call[0]))))
        for (const value of call.slice(1)) assert.ok(Math.abs(Number(value)) <= radius * 0.8, 'flame contact stays compact');
    } else assert.equal(calls.some(call => call[0] === 'rotate'), false);
    assert.ok(calls.some(call => call[0] === 'stroke'));
    assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
    for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    assert.deepEqual(effect, before);
  }
});

test('actual offensive casts and damage retain static motif identity in reduced motion without shared magic rings', () => {
  const signatures = new Map<string, string>();
  let casts = 0, impacts = 0;
  for (const hero of OATHBOUND_HEROES) for (const slot of ['active', 'ultimate'] as const) {
    const skill = getHeroById(hero.heroId).skills[slot];
    if (['all_allies', 'lowest_hp_ally', 'self'].includes(skill.targetType)) continue;
    const initial = createInitialData();
    const formation = [hero.heroId, ...initial.formation.filter(id => id !== hero.heroId)].slice(0, 5) as TeamFormationSlots;
    const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, owned]) => [id,
      { ...owned, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === hero.heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    if (slot === 'ultimate') {
      assert.equal(sim.triggerUltimate(source.instanceId, true), true);
      entries = sim.consumeEvents();
    } else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId &&
      event.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
    assert.ok(cast);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, skill.targetType);
    const damage = entries.find(event => event.sourceId === source.instanceId && event.castId === cast.castId &&
      event.targetId === target.instanceId && event.type === 'damage' && event.value! > 0)!;
    assert.ok(damage, `${hero.name}/${slot}: actual damage recipient required`);
    casts++; impacts++;
    for (const event of [cast, damage]) {
      const effect = createSpriteEffect(event, source, target)!;
      const scale = Math.min(390 / 480, 530 / 680);
      const radius = (effect.kind === 'impact' ? 18 : slot === 'ultimate' ? 62 : 43) * scale;
      const motif = getSpriteSkillArt(hero.heroId)!.motif;
      let stableGeometry: unknown[][] | undefined;
      for (const low of [false, true]) for (const phase of [0.42, 0.74, 0.92]) {
        effect.age = effect.duration * phase;
        const before = structuredClone(effect), calls: unknown[][] = [];
        const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
          calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
        }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
        drawSpriteSkillArt(ctx, effect, 390, 530, true, low);
        assert.equal(calls.some(call => ['rotate', 'scale', 'fill', 'ellipse', 'createRadialGradient'].includes(String(call[0]))), false);
        assert.equal(calls.some(call => call[0] === 'arc' && Math.abs(Number(call[5]) - Number(call[4])) >= Math.PI * 2), false,
          `${hero.name}: no shared full magic ring replaces weapon identity`);
        assert.equal(calls.some(call => call[0] === 'set' && call[1] === 'shadowBlur' && Number(call[2]) > 0), false);
        const b = projectSpritePosition(target.x, target.y, 390, 530);
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
        const geometry = calls.filter(call => ['moveTo', 'lineTo', 'quadraticCurveTo', 'arc', 'closePath', 'stroke'].includes(String(call[0])));
        assert.ok(geometry.some(call => call[0] === 'stroke'));
        for (const call of geometry.filter(call => ['moveTo', 'lineTo', 'quadraticCurveTo'].includes(String(call[0]))))
          for (const value of call.slice(1)) assert.ok(Math.abs(Number(value)) <= radius * 0.75, 'static marks stay compact');
        if (stableGeometry) assert.deepEqual(geometry, stableGeometry, 'geometry cannot pulse, travel, or rotate between phases or quality levels');
        else stableGeometry = geometry;
        if (slot === 'active' && effect.kind === 'cast') signatures.set(motif, JSON.stringify(geometry));
        assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
        for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
        assert.deepEqual(effect, before);
      }
    }
  }
  assert.equal(casts, 30, 'all sixteen offensive actives and fourteen offensive ultimates exercised');
  assert.equal(impacts, casts);
  assert.deepEqual([...signatures.keys()].sort(), ['aegis', 'arrows', 'bastion', 'blades', 'coffin', 'crossfire', 'daggers',
    'embers', 'eye', 'lance', 'prism', 'seraph', 'vortex'], 'all offensive motif families covered by actual active casts');
  assert.equal(new Set(signatures.values()).size, signatures.size, 'motifs remain distinguishable by geometry, not only color');
});

test('actual Walker active and ultimate arrivals use directed bullet streaks instead of radial magic bursts', () => {
  const initial = createInitialData();
  const heroId = 'walker';
  const formation = [heroId, ...initial.formation.filter(id => id !== heroId)].slice(0, 5) as TeamFormationSlots;
  const ownedHeroes = Object.fromEntries(Object.entries(initial.ownedHeroes).map(([id, hero]) => [id,
    { ...hero, level: 12, stars: 2, equipment: { weapon: 1, armor: 1, relic: 1 } }]));
  for (const slot of ['active', 'ultimate'] as const) {
    const sim = new BattleSimulation({ allyFormation: formation, ownedHeroes, enemies: getCampaignStage(1).enemies,
      seed: 2201, autoUltimate: false, maxDurationMs: 90000 });
    const source = sim.getUnits().find(unit => unit.heroId === heroId && unit.team === 'ally')!;
    sim.consumeEvents();
    let entries: CombatEvent[] = [];
    if (slot === 'ultimate') {
      assert.equal(sim.triggerUltimate(source.instanceId, true), true);
      entries = sim.consumeEvents();
    } else for (let step = 0; step < 400 && sim.getStatus() === 'running'; step++) {
      sim.step(50); entries = sim.consumeEvents();
      if (entries.some(event => event.sourceId === source.instanceId && event.type === 'active_skill')) break;
    }
    const cast = entries.find(event => event.sourceId === source.instanceId &&
      event.type === (slot === 'active' ? 'active_skill' : 'ultimate_cast'))!;
    assert.ok(cast);
    const target = resolveSpriteEffectTarget(cast, entries, sim.getUnits(), source, getHeroById(heroId).skills[slot].targetType);
    assert.notEqual(target.team, source.team);
    assert.ok(entries.some(event => event.castId === cast.castId && event.targetId === target.instanceId &&
      event.type === 'damage' && event.value! > 0));
    const effect = createSpriteEffect(cast, source, target)!;
    for (const phase of [0.74, 0.92]) for (const [reduced, low] of [[false, false], [false, true], [true, false], [true, true]]) {
      effect.age = effect.duration * phase;
      const before = structuredClone(effect), calls: unknown[][] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: () => true }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, reduced, low);
      const scale = Math.min(390 / 480, 530 / 680), radius = (slot === 'ultimate' ? 62 : 43) * scale;
      const a = projectSpritePosition(source.x, source.y, 390, 530), b = projectSpritePosition(target.x, target.y, 390, 530);
      if (!reduced) {
        assert.equal(calls.some(call => ['fill', 'arc', 'ellipse', 'createRadialGradient'].includes(String(call[0]))), false,
          'bullet arrivals remain transparent without a magic ring, glow bloom, or diamond particles');
        const rotations = calls.filter(call => call[0] === 'rotate');
        assert.equal(rotations.length, 1, 'one actual firing bearing, no radial/spinning bullets');
        assert.equal(rotations[0][1], Math.atan2(b.y - 48 * scale - (a.y - 53 * scale), b.x - a.x));
        const count = low ? slot === 'ultimate' ? 3 : 2 : slot === 'ultimate' ? 5 : 3;
        assert.equal(calls.filter(call => call[0] === 'stroke').length, count * 3, 'each short bullet streak retains two contact ticks');
        for (const call of calls.filter(call => ['moveTo', 'lineTo'].includes(String(call[0]))))
          assert.ok(Math.abs(Number(call[1])) <= radius * 0.8 && Math.abs(Number(call[2])) <= radius * 0.8, 'bullet marks stay compact');
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === b.x && call[2] === b.y - 48 * scale));
      } else assert.equal(calls.some(call => call[0] === 'rotate'), false);
      assert.ok(calls.some(call => call[0] === 'stroke'));
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      assert.deepEqual(effect, before);
    }
  }
});

test('weapon blooms follow actual caster-to-recipient bearings for both battlefield sides', () => {
  for (const hero of OATHBOUND_HEROES) {
    const art = getSpriteSkillArt(hero.heroId)!;
    if (!['lance', 'arrows', 'daggers', 'blades'].includes(art.motif)) continue;
    for (const reverse of [false, true]) {
      const source = { ...fixture(), heroId: hero.heroId, x: reverse ? 780 : 180, y: 190 };
      const target = { ...source, instanceId: 'weapon-recipient', team: 'enemy' as const, x: reverse ? 180 : 780, y: 310 };
      const effect = createSpriteEffect({ id: 920, timestampMs: 0, type: 'ultimate_cast', sourceId: source.instanceId, sourceName: source.name }, source, target)!;
      effect.age = effect.duration * 0.72;
      const rotations: number[] = [];
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        if (name === 'rotate') rotations.push(args[0] as number);
        return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: () => true }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, false, false);
      const a = projectSpritePosition(source.x, source.y, 390, 530);
      const b = projectSpritePosition(target.x, target.y, 390, 530);
      const scale = Math.min(390 / 480, 530 / 680);
      const bearing = Math.atan2(b.y - a.y + 5 * scale, b.x - a.x);
      assert.ok(Math.abs(rotations[0] - (art.angle + bearing)) < 1e-10, `${hero.name}/${reverse}: weapon points along the actual hit direction`);
    }
  }
});

test('support cast signatures distinguish active blessings from ultimates without attacking allies', () => {
  for (const hero of OATHBOUND_HEROES) {
    const source = { ...fixture(), heroId: hero.heroId };
    const ally = { ...source, instanceId: 'ally-recipient', x: 200, y: 260 };
    const trace = (ultimate: boolean) => {
      const effect = createSpriteEffect({ id: 95, timestampMs: 0, type: ultimate ? 'ultimate_cast' : 'active_skill',
        sourceId: source.instanceId, sourceName: source.name }, source, ally)!;
      effect.age = effect.duration * 0.42;
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, {
        get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
          calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
        }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; },
      }) as CanvasRenderingContext2D;
      drawSpriteSkillArt(ctx, effect, 390, 530, false, false);
      assert.equal(calls.some(c => c[0] === 'rotate' || c[0] === 'quadraticCurveTo'), false);
      return calls;
    };
    const active = trace(false), ultimate = trace(true);
    assert.ok(ultimate.filter(c => c[0] === 'beginPath').length > active.filter(c => c[0] === 'beginPath').length,
      `${hero.name}: ultimate support has its own choreography, not just enlarged active geometry`);
  }
});

test('all imported heroes have distinct deterministic skill art with scoped canvas state and reduced-motion feedback', () => {
  const signatures = new Set<string>();
  for (const hero of OATHBOUND_HEROES) {
    const art = getSpriteSkillArt(hero.heroId)!;
    assert.ok(art, hero.name);
    signatures.add(JSON.stringify(art));
    const source = { ...fixture(), heroId: hero.heroId };
    const event: CombatEvent = { id: 83, timestampMs: 0, type: 'ultimate_cast', sourceId: source.instanceId, sourceName: source.name };
    const effect = createSpriteEffect(event, source, { ...source, team: 'enemy', x: 780, y: 240 })!;
    const before = structuredClone(effect);
    const trace = (reduced: boolean, age: number) => {
      const calls: unknown[][] = [];
      const gradient = { addColorStop(...args: unknown[]) { calls.push(['colorStop', ...args]); } };
      const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([name, ...args]);
        return String(name).startsWith('create') ? gradient : undefined;
      }, set: (_, name, value) => { calls.push(['set', name, typeof value === 'object' && value !== null ? 'gradient' : value]); return true; } }) as CanvasRenderingContext2D;
      assert.equal(drawSpriteSkillArt(ctx, { ...effect, age }, 390, 530, reduced, false), true);
      assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
      for (const call of calls) for (const value of call.slice(1)) {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), `${hero.name}/${String(call[0])}`);
      }
      assert.ok(calls.some(call => call[0] === 'stroke' || call[0] === 'fill'), hero.name);
      if (reduced) assert.equal(calls.some(call => call[0] === 'rotate'), false);
      return calls;
    };
    assert.deepEqual(trace(false, 0.7), trace(false, 0.7), 'paused draw must be deterministic');
    assert.notDeepEqual(trace(false, 0.2), trace(false, 0.7), 'wind-up must differ from impact');
    trace(true, 0.7);
    assert.deepEqual(effect, before, 'drawing must not change event state');
  }
  assert.equal(signatures.size, OATHBOUND_HEROES.length, 'no hero silently shares the same authored profile');
  assert.equal(getSpriteSkillArt('unmapped-fixture'), undefined);
});

test('skill attribution keeps basic impacts restrained and distinguishes ultimate outcomes and passive wards', () => {
  const source = fixture();
  const enemy = { ...source, instanceId: 'enemy', team: 'enemy' as const };
  const event: CombatEvent = { id: 301, timestampMs: 0, type: 'damage', sourceId: source.instanceId,
    sourceName: source.name, skillSlot: 'basic', castId: 300 };
  assert.equal(createSpriteEffect(event, source, enemy)!.basic, true);
  assert.equal(createSpriteEffect({ ...event, skillSlot: 'ultimate' }, source, enemy)!.ultimate, true);
  const ward = createSpriteEffect({ ...event, type: 'shield', skillSlot: 'passive' }, source, source)!;
  assert.equal(ward.skillSlot, 'passive');
  assert.equal(ward.support, true);
  assert.equal(createSpriteEffect({ ...event, type: 'active_skill' }, source, source)!.support, true);
  assert.equal(createSpriteEffect(event, source, enemy)!.support, false);
});

test('cast IDs correlate actual recipients despite interleaved casts and misleading legacy names', () => {
  const source = fixture();
  const enemyA = { ...source, instanceId: 'enemy-a', team: 'enemy' as const };
  const enemyB = { ...enemyA, instanceId: 'enemy-b' };
  const cast: CombatEvent = { id: 400, castId: 400, timestampMs: 0, type: 'active_skill',
    sourceId: source.instanceId, sourceName: source.name, skillName: 'Same skill' };
  const second: CombatEvent = { ...cast, id: 401, castId: 401 };
  const wrong: CombatEvent = { ...cast, id: 402, type: 'damage', castId: 401, targetId: enemyB.instanceId };
  const actual: CombatEvent = { ...cast, id: 403, type: 'damage', skillName: 'Explicit outcome name', targetId: enemyA.instanceId };
  const events = [cast, second, wrong, actual];
  const before = structuredClone(events);
  assert.equal(resolveSpriteEffectTarget(cast, events, [source, enemyA, enemyB], source, 'all_enemies'), enemyA);
  assert.deepEqual(events, before);
});

test('actual self lifesteal renders a compact recovery accent instead of a full support spell', () => {
  const source = fixture();
  const event: CombatEvent = { id: 1040, timestampMs: 0, type: 'heal', sourceId: source.instanceId,
    sourceName: source.name, targetId: source.instanceId, skillName: 'Lifesteal', skillSlot: 'basic', value: 20 };
  const recovery = createSpriteEffect(event, source, source)!;
  const blessing = createSpriteEffect({ ...event, id: 1041, skillName: 'Actual healing spell', skillSlot: 'active' }, source, source)!;
  assert.equal(recovery.recovery, 'lifesteal');
  assert.equal(blessing.recovery, undefined);
  assert.ok(recovery.duration < blessing.duration);
  assert.equal(createSpriteEffect({ ...event, value: 0 }, source, source)!.recovery, undefined);
  assert.equal(createSpriteEffect(event, source, { ...source, instanceId: 'other-ally' })!.recovery, undefined);
  recovery.age = recovery.duration * 0.42;
  const before = structuredClone(recovery);
  for (const [reduced, low] of [[false, false], [true, false], [false, true]]) {
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
      calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
    }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; } }) as CanvasRenderingContext2D;
    drawSpriteEffects(ctx, [recovery], 390, 530, reduced, 'ground', low);
    assert.equal(calls.length, 0, 'lifesteal does not create another floor sigil');
    drawSpriteEffects(ctx, [recovery], 390, 530, reduced, 'front', low);
    assert.ok(calls.some(call => call[0] === 'stroke'));
    assert.equal(calls.some(call => ['rotate', 'createRadialGradient', 'quadraticCurveTo'].includes(String(call[0]))), false);
    const radii = calls.filter(call => call[0] === 'arc').map(call => call[3] as number);
    assert.ok(radii.length > 0 && Math.max(...radii) < 12, 'recovery stays below a full body-sized halo');
    assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
    assert.deepEqual(recovery, before);
  }
});

test('all hero support art stays recipient-local without offensive travel or weapon rotation', () => {
  for (const hero of OATHBOUND_HEROES) {
    const source = { ...fixture(), heroId: hero.heroId, x: 120, y: 180 };
    const ally = { ...source, instanceId: 'recipient', x: 320, y: 280 };
    for (const type of ['active_skill', 'heal', 'shield'] as const) {
      const effect = createSpriteEffect({ id: 500, timestampMs: 0, type, skillSlot: 'active',
        sourceId: source.instanceId, sourceName: source.name }, source, ally)!;
      effect.age = effect.duration * 0.55;
      const before = structuredClone(effect);
      const calls: unknown[][] = [];
      const ctx = new Proxy({}, {
        get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
          calls.push([String(name), ...args]);
          return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
        },
        set: (_, name, value) => { calls.push(['set', String(name), value]); return true; },
      }) as CanvasRenderingContext2D;
      for (const [reducedMotion, lowQuality] of [[false, false], [true, false], [false, true]]) {
        calls.length = 0;
        assert.equal(drawSpriteSkillArt(ctx, effect, 390, 530, reducedMotion, lowQuality), true);
        assert.equal(calls.some(call => call[0] === 'quadraticCurveTo'), false, `${hero.name}/${type}: no attack ribbon`);
        assert.equal(calls.some(call => call[0] === 'rotate'), false, `${hero.name}/${type}: no weapon motif`);
        const target = projectSpritePosition(ally.x, ally.y, 390, 530);
        assert.ok(calls.some(call => call[0] === 'translate' && call[1] === target.x && call[2] === target.y - 48 * Math.min(390 / 480, 530 / 680)));
        assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
        if (reducedMotion || lowQuality) assert.ok(calls.filter(call => call[0] === 'set' && call[1] === 'shadowBlur').every(call => call[2] === 0));
        assert.deepEqual(effect, before);
      }
    }
  }
});

test('ultimate outcomes use compact accents rather than duplicating the full cast signature', () => {
  const source = { ...fixture(), heroId: 'belinda' };
  const target = { ...source, instanceId: 'recipient', team: 'enemy' as const, x: 750 };
  const event: CombatEvent = { id: 600, timestampMs: 0, type: 'ultimate_cast', skillSlot: 'ultimate',
    sourceId: source.instanceId, sourceName: source.name };
  const trace = (type: CombatEvent['type']) => {
    const effect = createSpriteEffect({ ...event, type }, source, target)!;
    effect.age = effect.duration * 0.74;
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, {
      get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([String(name), ...args]);
        return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      }, set: (_, name, value) => { calls.push(['set', String(name), value]); return true; },
    }) as CanvasRenderingContext2D;
    drawSpriteSkillArt(ctx, effect, 480, 680, false, false);
    return calls;
  };
  const cast = trace('ultimate_cast'), impact = trace('damage'), shield = trace('shield');
  const footprint = (calls: unknown[][]) => Math.max(0, ...calls.flatMap(call => {
    if (call[0] === 'arc') return [Math.hypot(Number(call[1]), Number(call[2])) + Number(call[3])];
    if (!['moveTo', 'lineTo', 'quadraticCurveTo'].includes(String(call[0]))) return [];
    const distances: number[] = [];
    for (let i = 1; i < call.length; i += 2) distances.push(Math.hypot(Number(call[i]), Number(call[i + 1])));
    return distances;
  }));
  assert.ok(footprint(cast) > 30, 'positive control: the actual light-ray envelope is measured without requiring a circle');
  assert.ok(footprint(impact) < footprint(cast) * 0.4, 'a hit cannot repeat the full ultimate bloom');
  assert.ok(footprint(shield) < footprint(cast) * 0.5, 'ward opacity and scale must not inherit the ultimate explosion');
  assert.equal(impact.some(c => c[0] === 'quadraticCurveTo'), false, 'no repeated seraph wings on damage events');
  assert.equal(shield.some(c => c[0] === 'createRadialGradient'), false, 'ward interior stays transparent');
});

test('all real multi-target outcomes retain their exact recipient and source identity for individual impact choreography', () => {
  const source = fixture();
  const enemyA = { ...source, instanceId: 'opponent-a', team: 'enemy' as const, x: 740, y: 200 };
  const enemyB = { ...enemyA, instanceId: 'opponent-b', x: 860, y: 270 };
  const ally = { ...source, instanceId: 'support-recipient', x: 250, y: 260 };
  const cast: CombatEvent = { id: 200, timestampMs: 0, type: 'ultimate_cast', sourceId: source.instanceId, sourceName: source.name, skillName: 'Mixed actual outcomes' };
  const events: CombatEvent[] = [cast,
    { ...cast, id: 201, type: 'shield', targetId: ally.instanceId, value: 100 },
    { ...cast, id: 202, type: 'damage', targetId: enemyA.instanceId, value: 100 },
    { ...cast, id: 203, type: 'damage', targetId: enemyB.instanceId, value: 100 }];
  const units = [source, enemyA, enemyB, ally];
  const before = structuredClone({ events, units });
  for (const event of events.slice(1)) {
    const target = resolveSpriteEffectTarget(event, events, units, source, 'all_enemies');
    assert.equal(target.instanceId, event.targetId);
    const effect = createSpriteEffect(event, source, target)!;
    assert.deepEqual(effect.target, { x: target.x, y: target.y });
    assert.equal(effect.sourceHeroId, source.heroId);
  }
  assert.deepEqual({ events, units }, before);
});

test('pause modal retains both actions and declares an accessible focusable modal root', () => {
  const html = renderToStaticMarkup(React.createElement(BattlePauseModal, {
    chapter: 'Test chapter', stageName: 'Test stage', onResume: () => {}, onRetry: () => {},
  }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /aria-label="Tạm dừng trận đấu"/);
  assert.match(html, /data-testid="resume-battle-btn"/);
  assert.match(html, /Try Again · Đánh Lại Từ Đầu/);
  assert.match(html, /Test chapter — Test stage/);
});

test('explicit 2D arena palettes override every stage theme and AUTO restores theme selection', () => {
  const themes = ['sanctuary', 'catacombs', 'sylvan', 'obsidian', 'unknown'];
  for (const theme of themes) {
    assert.equal(resolveSpriteArena(theme, 'celestial_temple'), 'temple');
    assert.equal(resolveSpriteArena(theme, 'enchanted_forest'), 'forest');
    assert.equal(resolveSpriteArena(theme, 'shadow_realm'), 'shadow');
  }
  assert.equal(resolveSpriteArena('sylvan', 'auto'), 'forest');
  assert.equal(resolveSpriteArena('catacombs', 'auto'), 'shadow');
  assert.equal(resolveSpriteArena('obsidian'), 'shadow');
  assert.equal(resolveSpriteArena('sanctuary', 'auto'), 'temple');
  assert.equal(resolveSpriteArena('unknown', 'auto'), 'temple');
});

test('settings controls expose distinct accessible names and selected states for both toggle values', () => {
  for (const enabled of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(ClassicSettingsModal, {
      isMuted: !enabled, cameraShakeEnabled: enabled, ultimateCameraEnabled: enabled,
      reducedMotion: enabled, showPerfOverlay: enabled, graphicsPreset: 'LOW', arenaOverride: 'shadow_realm',
      onToggleMute: () => {}, onClose: () => {},
    }));
    const buttons = html.match(/<button\b[^>]*>/g)!;
    for (const id of ['toggle-audio-btn', 'toggle-ultimate-dim-btn', 'toggle-camera-shake-btn', 'toggle-reduced-motion-btn', 'toggle-perf-hud-btn']) {
      const button = buttons.find(tag => tag.includes(`data-testid="${id}"`))!;
      assert.ok(button, id);
      assert.match(button, /aria-label="[^\"]{8,}"/);
      assert.ok(button.includes(`aria-pressed="${enabled}"`), id);
    }
    for (const [id, selected] of [['preset-btn-low', true], ['preset-btn-auto', false], ['arena-btn-shadow_realm', true], ['arena-btn-auto', false]] as const) {
      assert.ok(buttons.find(tag => tag.includes(`data-testid="${id}"`))?.includes(`aria-pressed="${selected}"`), id);
    }
  }
});

test('shared popup focus containment is opt-in so unrelated dialogs keep their current behavior', () => {
  for (const containFocus of [undefined, false, true]) {
    const html = renderToStaticMarkup(React.createElement(PopupModal, {
      title: 'Fixture dialog', onClose: () => {}, containFocus, children: 'Fixture content',
    }));
    assert.equal(html.includes('aria-modal="true"'), containFocus === true);
    assert.equal(html.includes('tabindex="-1"'), containFocus === true);
  }
});

test('settings describe the active Canvas2D renderer and available presentation controls truthfully', () => {
  const html = renderToStaticMarkup(React.createElement(ClassicSettingsModal, {
    isMuted: true, onToggleMute: () => {}, onClose: () => {},
  }));
  assert.match(html, /data-testid="classic-settings-modal"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /Sprite 2D · Canvas2D/);
  assert.match(html, /Giảm mật độ hiệu ứng/);
  assert.match(html, /Làm tối nền khi tung tuyệt kỹ/);
  assert.match(html, /Nhãn renderer 2D/);
  assert.doesNotMatch(html, /3D Active|Three\.js 3D Engine|Đồ Họa 3D|Chiến Trường 3D|FPS \/ Draw Calls \/ Triangles/);
});

test('dialog focus contains Tab and scrolling keys, restores connected opener and removes listeners', () => {
  const rootEvents = new Map<string, (event: any) => void>();
  const documentEvents = new Map<string, (event: any) => void>();
  const owner = { activeElement: null as any,
    addEventListener: (name: string, fn: any) => documentEvents.set(name, fn),
    removeEventListener: (name: string) => documentEvents.delete(name) };
  const element = () => { const e = { isConnected: true, focus: () => { owner.activeElement = e; } }; return e; };
  const opener = element(), first = element(), last = element();
  opener.focus();
  const root = { ...element(), ownerDocument: owner,
    contains: (node: unknown) => node === root || node === first || node === last,
    querySelectorAll: () => [first, last],
    addEventListener: (name: string, fn: any) => rootEvents.set(name, fn),
    removeEventListener: (name: string) => rootEvents.delete(name) };
  root.focus = () => { owner.activeElement = root; };
  const release = containDialogFocus(root as unknown as HTMLElement);
  assert.equal(owner.activeElement, root);
  const send = (key: string, shiftKey = false) => {
    let prevented = false, stopped = false;
    rootEvents.get('keydown')!({ key, shiftKey, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
    return { prevented, stopped };
  };
  assert.deepEqual(send('Tab', true), { prevented: true, stopped: true });
  assert.equal(owner.activeElement, last);
  send('Tab'); assert.equal(owner.activeElement, first);
  first.focus(); send('Tab', true); assert.equal(owner.activeElement, last);
  assert.deepEqual(send(' '), { prevented: false, stopped: true }, 'native scrolling stays enabled without triggering game shortcut');
  assert.deepEqual(send('Enter'), { prevented: false, stopped: true }, 'native button activation stays enabled');
  opener.focus(); documentEvents.get('focusin')!(undefined); assert.equal(owner.activeElement, root);
  release(); assert.equal(owner.activeElement, opener);
  assert.equal(rootEvents.size, 0); assert.equal(documentEvents.size, 0);
});

test('optional dialog dismissal keeps native input typing and stops battle shortcuts', () => {
  let listener: (event: any) => void = () => {};
  let dismissed = 0;
  const owner = { activeElement: null as any, addEventListener: () => {}, removeEventListener: () => {} };
  const root = { ownerDocument: owner, contains: (node: unknown) => node === root,
    querySelectorAll: () => [], focus: () => { owner.activeElement = root; },
    addEventListener: (name: string, fn: any) => { if (name === 'keydown') listener = fn; }, removeEventListener: () => {} };
  const release = containDialogFocus(root as unknown as HTMLElement, () => { dismissed++; });
  const send = (key: string, code: string, editable = false) => {
    let prevented = false, stopped = false;
    listener({ key, code, target: { closest: () => editable ? {} : null },
      preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
    return { prevented, stopped };
  };
  assert.deepEqual(send('p', 'KeyP', true), { prevented: false, stopped: true });
  assert.equal(dismissed, 0, 'typing P into an input is not a close shortcut');
  assert.deepEqual(send('Escape', 'Escape'), { prevented: true, stopped: true });
  assert.deepEqual(send('p', 'KeyP'), { prevented: true, stopped: true });
  assert.equal(dismissed, 2);
  assert.deepEqual(send('r', 'KeyR'), { prevented: false, stopped: true });
  assert.equal(dismissed, 2);
  release();
});

test('pause focus explicitly permits showcase shortcuts but contains Tab and native button activation', () => {
  let listener: (event: any) => void = () => {};
  let dismissed = 0;
  const owner = { activeElement: null as any, addEventListener: () => {}, removeEventListener: () => {} };
  const root = { ownerDocument: owner, contains: (node: unknown) => node === root,
    querySelectorAll: () => [], focus: () => { owner.activeElement = root; },
    addEventListener: (name: string, fn: any) => { if (name === 'keydown') listener = fn; }, removeEventListener: () => {} };
  const release = containDialogFocus(root as unknown as HTMLElement, () => { dismissed++; },
    ['KeyC', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyR']);
  const send = (key: string, code: string, editable = false) => {
    let prevented = false, stopped = false;
    listener({ key, code, target: { closest: () => editable ? {} : null },
      preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
    return { prevented, stopped };
  };
  for (const code of ['KeyC', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyR']) {
    assert.deepEqual(send(code, code), { prevented: false, stopped: false });
    assert.deepEqual(send(code, code, true), { prevented: false, stopped: true });
  }
  assert.deepEqual(send('Tab', 'Tab'), { prevented: true, stopped: true });
  assert.deepEqual(send(' ', 'Space'), { prevented: false, stopped: true });
  assert.deepEqual(send('Enter', 'Enter'), { prevented: false, stopped: true });
  assert.deepEqual(send('p', 'KeyP'), { prevented: true, stopped: true });
  assert.deepEqual(send('Escape', 'Escape'), { prevented: true, stopped: true });
  assert.equal(dismissed, 2);
  release();
});

test('empty dialog keeps Tab on its root and never restores a disconnected opener', () => {
  const listeners = new Map<string, (event: any) => void>();
  const opener = { isConnected: false, focus: () => assert.fail('disconnected opener must not be focused') };
  const owner = { activeElement: opener as any, addEventListener: () => {}, removeEventListener: () => {} };
  const root = { ownerDocument: owner, contains: (node: unknown) => node === root,
    querySelectorAll: () => [], focus: () => { owner.activeElement = root; },
    addEventListener: (name: string, fn: any) => listeners.set(name, fn), removeEventListener: () => {} };
  const release = containDialogFocus(root as unknown as HTMLElement);
  for (const shiftKey of [false, true]) {
    let prevented = false;
    listeners.get('keydown')!({ key: 'Tab', shiftKey, preventDefault: () => { prevented = true; }, stopPropagation: () => {} });
    assert.equal(prevented, true);
    assert.equal(owner.activeElement, root);
  }
  release();
  assert.equal(owner.activeElement, root);
});

test('dialog teardown does not steal focus already moved to a new screen', () => {
  const listeners = new Map();
  const owner = { activeElement: null as any, addEventListener: (name: string, fn: any) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  const opener = { isConnected: false, focus: () => { throw Error('disconnected opener must not receive focus'); } };
  owner.activeElement = opener;
  const root = { ownerDocument: owner, contains: (node: unknown) => node === root, querySelectorAll: () => [],
    focus: () => { owner.activeElement = root; }, addEventListener: () => {}, removeEventListener: () => {} };
  const release = containDialogFocus(root as unknown as HTMLElement);
  const newScreen = {}; owner.activeElement = newScreen;
  release(); assert.equal(owner.activeElement, newScreen);
});

test('persistent real shields use a compact static bar badge instead of a body-sized oval', () => {
  const unit = { ...fixture(), shield: 75 };
  for (const scale of [0.6, 1, 1.4]) {
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => (...args: unknown[]) => calls.push([String(name), ...args]), set: () => true }) as CanvasRenderingContext2D;
    const before = structuredClone(unit);
    assert.equal(drawSpriteShieldStatus(ctx, unit, 200, 120, scale), true);
    assert.equal(calls.some(call => ['ellipse', 'arc', 'rotate', 'createRadialGradient'].includes(String(call[0]))), false, 'no full-body envelope or animation');
    assert.ok(calls.some(call => call[0] === 'fill') && calls.some(call => call[0] === 'stroke'), 'badge has a contrasting solid backing and outline');
    for (const call of calls.filter(call => call[0] === 'moveTo' || call[0] === 'lineTo')) {
      assert.ok(Math.abs(Number(call[1]) - 200) <= 6 * scale && Math.abs(Number(call[2]) - 120) <= 6 * scale, 'badge remains inside its local bar-side footprint');
    }
    assert.equal(calls.filter(call => call[0] === 'save').length, calls.filter(call => call[0] === 'restore').length);
    assert.deepEqual(unit, before);
    const again: unknown[][] = [];
    drawSpriteShieldStatus(new Proxy({}, { get: (_, name) => (...args: unknown[]) => again.push([String(name), ...args]), set: () => true }) as CanvasRenderingContext2D, unit, 200, 120, scale);
    assert.deepEqual(again, calls, 'badge does not advance a clock');
  }
  for (const state of [{ shield: 0 }, { shield: -1 }, { shield: NaN }, { shield: Infinity }, { isAlive: false }]) {
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, { get: (_, name) => (...args: unknown[]) => calls.push([String(name), ...args]), set: () => true }) as CanvasRenderingContext2D;
    assert.equal(drawSpriteShieldStatus(ctx, { ...unit, ...state }, 200, 120, 1), false);
    assert.equal(calls.length, 0, 'no invented shielding for dead or unshielded units');
  }
});

test('actual overlay avoidance reserves the shield badge so nearby readiness cannot cover it', () => {
  const unit = { ...fixture(), heroId: 'gwyneth', energy: 0, shield: 75, statusEffects: [] };
  // Inverse projection creates the exact two-actor overlap reported by independent review.
  const at = (x: number, y: number) => ({ x: (x / 480 - 0.1) / 0.8 * 1000, y: (y / 680 - 0.37) / 0.32 * 300 + 140 });
  const shielded = { ...unit, instanceId: 'shielded', ...at(200, 400) };
  const ready = { ...unit, instanceId: 'ready', shield: 0, energy: 100, ...at(278, 444) };
  const units = [shielded, ready], scale = getSpriteBattleScale(480, 680);
  const badge = { x: 200 + 31 * scale - 6 * scale, y: 400 - 100 * scale + 3 - 6 * scale,
    width: 12 * scale, height: 12 * scale };
  const bounds = units.map(unit => getSpriteUnitOverlayBounds(unit, 480, 680));
  assert.ok(bounds[0].x + bounds[0].width >= badge.x + badge.width, 'actual badge right edge is reserved');
  assert.ok(bounds[0].y + bounds[0].height >= badge.y + badge.height, 'actual badge bottom edge is reserved');
  const labels = layoutSpriteUnitStatuses(units, 480, 680, 'running', bounds);
  assert.ok(labels.length > 0, 'readiness is moved rather than unconditionally hidden');
  assert.ok(!labels.some(label => label.x < badge.x + badge.width && label.x + label.width > badge.x &&
    label.y < badge.y + badge.height && label.y + label.height > badge.y), 'ready label cannot paint over the real shield');
  const bare = getSpriteUnitOverlayBounds({ ...shielded, shield: 0 }, 480, 680);
  assert.ok(bare.width < bounds[0].width, 'only real shielding reserves the badge width');
});

test('crowded battlefield status layout avoids other labels, bars and ultimate panel deterministically', () => {
  const unit = fixture();
  const controlled = { ...unit, energy: 100, statusEffects: [{ id: 'control', type: 'stun' as const, durationMs: 1000,
    remainingMs: 1000, magnitude: 1, sourceUnitId: unit.instanceId }] };
  const units = Array.from({ length: 10 }, (_, i) => ({ ...controlled, instanceId: `status-${i}`, x: 500 + i * 2, y: 280 + i * 2 }));
  for (const width of [320, 390, 480]) {
    const obstacles = [{ x: 12, y: 8, width: width - 24, height: 96 }, { x: width / 2 - 35, y: 160, width: 70, height: 10 }];
    const labels = layoutSpriteUnitStatuses(units, width, 530, 'running', obstacles);
    assert.ok(labels.length > 0);
    assert.deepEqual(labels, layoutSpriteUnitStatuses(units, width, 530, 'running', obstacles));
    const intersects = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    for (const [i, label] of labels.entries()) {
      assert.ok(label.x >= 0 && label.x + label.width <= width && label.y >= 0 && label.y + label.height <= 530);
      assert.ok(!obstacles.some(obstacle => intersects(label, obstacle)));
      assert.ok(!labels.slice(i + 1).some(other => intersects(label, other)));
      assert.ok(Math.abs(label.y - getSpriteUnitStatus(units.find(u => u.instanceId === label.unitId)!, width, 530, 'running')!.y) <= 50,
        'do not detach a hint far from its actor just to fit every label');
    }
    assert.equal(layoutSpriteUnitStatuses(units, width, 530, 'running', [{ x: 0, y: 0, width, height: 530 }]).length, 0);
  }
});

test('battlefield status labels show silence, hide dead/enemy readiness and remain inside narrow viewports', () => {
  const unit = { ...fixture(), energy: 100 };
  for (const width of [320, 390, 480]) {
    const ready = getSpriteUnitStatus(unit, width, 530, 'running')!;
    assert.equal(ready.text, '★ ULT');
    assert.ok(ready.x >= 0 && ready.x + ready.width <= width);
    assert.ok(ready.y >= 0 && ready.y + ready.height <= 530);
    assert.equal(getSpriteUnitStatus({ ...unit, team: 'enemy' }, width, 530, 'running'), undefined);
    assert.equal(getSpriteUnitStatus({ ...unit, isAlive: false }, width, 530, 'running'), undefined);
    assert.equal(getSpriteUnitStatus(unit, width, 530, 'victory'), undefined);
    for (const type of ['silence', 'stun', 'petrify'] as const) {
      const controlled = { ...unit, statusEffects: [{ id: 'control', type, durationMs: 1000, remainingMs: 1000,
        magnitude: 1, sourceUnitId: unit.instanceId }] };
      const label = getSpriteUnitStatus(controlled, width, 530, 'running')!;
      assert.equal(label.kind, 'blocked');
      assert.equal(label.text, type === 'silence' ? 'CÂM LẶNG' : type === 'stun' ? 'CHOÁNG' : 'HÓA ĐÁ');
      const calls: string[] = [];
      const ctx = new Proxy({}, { get: (_, name) => (..._args: unknown[]) => calls.push(String(name)), set: () => true }) as CanvasRenderingContext2D;
      drawSpriteUnitStatus(ctx, label);
      assert.ok(calls.includes('fillText'));
      assert.equal(calls.filter(call => call === 'save').length, calls.filter(call => call === 'restore').length);
    }
  }
});

test('ultimate readiness mirrors real cast eligibility without treating forced showcase casts as charged', () => {
  const unit = fixture();
  assert.equal(getUltimateReadiness(undefined).state, 'waiting');
  assert.equal(getUltimateReadiness({ ...unit, energy: 99.9 }).state, 'charging');
  assert.equal(getUltimateReadiness({ ...unit, energy: 100 }).state, 'ready');
  assert.equal(getUltimateReadiness({ ...unit, energy: NaN }).energy, 0);
  assert.equal(getUltimateReadiness({ ...unit, energy: -10 }).energy, 0);
  assert.equal(getUltimateReadiness({ ...unit, energy: 200 }).energy, 100);
  for (const type of ['stun', 'petrify', 'silence'] as const) {
    const blocked = { ...unit, energy: 100, statusEffects: [{ id: 'control', type, durationMs: 1000,
      remainingMs: 1000, magnitude: 1, sourceUnitId: unit.instanceId }] };
    assert.equal(getUltimateReadiness(blocked).state, 'blocked');
    assert.equal(getUltimateReadiness(blocked).canShowcase, false);
    assert.equal(getUltimateReadiness({ ...blocked, isAlive: false }).state, 'dead');
  }
  assert.equal(getUltimateReadiness({ ...unit, energy: 0 }).canShowcase, true);
  assert.equal(getUltimateReadiness({ ...unit, energy: 100 }, 'victory').state, 'finished');
  assert.equal(getUltimateReadiness({ ...unit, energy: 100 }, 'defeat').canShowcase, false);
});

test('readiness agrees with actual engine normal and forced casts for energy and control states', () => {
  for (const energy of [0, 99.9, 100]) for (const control of [undefined, 'stun', 'petrify', 'silence'] as const) {
    for (const force of [false, true]) {
      const initial = createInitialData();
      const sim = new BattleSimulation({ allyFormation: initial.formation, ownedHeroes: initial.ownedHeroes,
        enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false });
      const unit = sim.getUnits()[0]; unit.energy = energy;
      if (control) unit.statusEffects.push({ id: 'control', type: control, durationMs: 1000, remainingMs: 1000,
        magnitude: 1, sourceUnitId: unit.instanceId });
      const readiness = getUltimateReadiness(unit, sim.getStatus());
      assert.equal(sim.triggerUltimate(unit.instanceId, force), force ? readiness.canShowcase : readiness.state === 'ready',
        `energy=${energy},control=${control},force=${force}`);
    }
  }
});

test('actual ultimate bar renders readiness and keeps the identity of blocked, charged and defeated heroes', () => {
  const initial = createInitialData();
  const sim = new BattleSimulation({ allyFormation: initial.formation, ownedHeroes: initial.ownedHeroes,
    enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false });
  const units = sim.getUnits().filter(unit => unit.team === 'ally');
  units[0].energy = 100;
  units[1].energy = 100;
  units[1].statusEffects.push({ id: 'fixture-control', type: 'silence', durationMs: 1000, remainingMs: 1000, magnitude: 1, sourceUnitId: units[0].instanceId });
  units[2].isAlive = false; units[2].hp = 0;
  units[3].energy = 45;
  const markup = renderToStaticMarkup(React.createElement(HeroUltimateBar, { formation: initial.formation,
    ownedHeroes: initial.ownedHeroes, liveSnapshot: sim.getSnapshot(), idleMinutes: 1,
    onTriggerComboUlt() {}, onClaimIdle() {}, onAutoUpgrade() {}, onTriggerHeroUlt() {}, onOpenFormation() {} }));
  for (const state of ['ready', 'blocked', 'dead', 'charging']) assert.ok(markup.includes(`data-ultimate-state="${state}"`));
  assert.ok(markup.includes('Câm lặng')); assert.ok(markup.includes('Sẵn sàng')); assert.ok(markup.includes('Nạp 45%'));
  assert.ok(markup.includes('Estrilda')); assert.ok(markup.includes('Lucius')); assert.ok(markup.includes('bỏ qua yêu cầu năng lượng'));
});

test('ultimate announcements retain simultaneous casters, bound overflow and count only distinct same-team combo casts', () => {
  const unit = fixture(), entries: UltimateAnnouncement[] = [];
  const cast: CombatEvent = { id: 1, timestampMs: 1000, type: 'ultimate_cast', sourceId: unit.instanceId, sourceName: unit.name, skillName: 'Fixture ultimate' };
  for (let i = 0; i < 5; i++) addUltimateAnnouncement(entries, { ...cast, id: i + 1, sourceId: `ally-${i}` }, { ...unit, instanceId: `ally-${i}`, name: `Hero ${i}` });
  addUltimateAnnouncement(entries, { ...cast, id: 6, sourceId: 'enemy' }, { ...unit, instanceId: 'enemy', team: 'enemy' });
  addUltimateAnnouncement(entries, { ...cast, id: 6, sourceId: 'enemy' }, { ...unit, instanceId: 'enemy', team: 'enemy' });
  const view = getUltimateAnnouncementView(entries);
  assert.equal(entries.length, 6); assert.equal(view.rows.length, presentation.ultimate.maxVisible);
  assert.equal(view.hidden.length + view.rows.length, 6);
  assert.equal(view.allyCombo, 5); assert.equal(view.enemyCombo, 1);
  assert.equal(view.rows[0].team, 'enemy'); assert.equal(view.rows[0].skill, cast.skillName);
  addUltimateAnnouncement(entries, { ...cast, id: 7, timestampMs: 1000 + presentation.ultimate.comboWindowMs + 1 }, unit);
  assert.equal(getUltimateAnnouncementView(entries).allyCombo, 1, 'unrelated later casts must not extend an earlier combo');
  for (let i = 10; i < 50; i++) addUltimateAnnouncement(entries, { ...cast, id: i }, unit);
  assert.equal(entries.length, presentation.ultimate.maxAnnouncements);
  assert.equal(getUltimateAnnouncementView(entries).allyCombo, 1, 'repeated casts by one actor are not a team combo');
});

test('ultimate announcement lifetime freezes on pause, rejects invalid time and expires without refreshing older casts', () => {
  const unit = fixture(), entries: UltimateAnnouncement[] = [];
  const cast: CombatEvent = { id: 1, timestampMs: 0, type: 'ultimate_cast', sourceId: unit.instanceId, sourceName: unit.name };
  assert.equal(addUltimateAnnouncement(entries, { ...cast, type: 'damage' }, unit), false);
  addUltimateAnnouncement(entries, cast, unit);
  advanceUltimateAnnouncements(entries, 0); advanceUltimateAnnouncements(entries, NaN); advanceUltimateAnnouncements(entries, -1);
  assert.equal(entries[0].remaining, presentation.ultimate.bannerSeconds);
  advanceUltimateAnnouncements(entries, presentation.ultimate.bannerSeconds / 2);
  addUltimateAnnouncement(entries, { ...cast, id: 2 }, unit);
  advanceUltimateAnnouncements(entries, presentation.ultimate.bannerSeconds / 2);
  assert.deepEqual(entries.map(entry => entry.id), [2]);
  advanceUltimateAnnouncements(entries, 10); assert.equal(entries.length, 0);
  assert.equal(getUltimateAnnouncementView(entries).rows.length, 0);
});

test('combat numbers combine same-target bursts without merging criticals or support and freeze on pause', () => {
  const unit = fixture();
  const texts: import('./spriteCombatText').CombatText[] = [];
  const event: CombatEvent = { id: 1, timestampMs: 0, type: 'damage', sourceId: unit.instanceId,
    sourceName: unit.name, targetId: unit.instanceId, value: 120 };
  addCombatText(texts, event, unit);
  addCombatText(texts, { ...event, id: 2, value: 80 }, unit);
  assert.equal(texts.length, 1); assert.equal(texts[0].value, 200); assert.equal(texts[0].count, 2);
  addCombatText(texts, { ...event, id: 3, isCrit: true }, unit);
  addCombatText(texts, { ...event, id: 4, type: 'heal' }, unit);
  assert.equal(texts.length, 3);
  advanceCombatTexts(texts, 0); advanceCombatTexts(texts, Number.NaN);
  assert.equal(texts[0].age, 0);
  advanceCombatTexts(texts, 0.3);
  addCombatText(texts, { ...event, id: 5 }, unit);
  assert.equal(texts.length, 4, 'later hits must not keep the original number alive');
  advanceCombatTexts(texts, 10); assert.equal(texts.length, 0);
});

test('crowded combat number layout stays inside phone/desktop and avoids each other and health bars', () => {
  for (const width of [320, 390, 480]) {
    const unit = fixture();
    const texts: import('./spriteCombatText').CombatText[] = [];
    for (let i = 0; i < 32; i++) addCombatText(texts, { id: i, timestampMs: 0, type: 'damage',
      sourceId: unit.instanceId, sourceName: unit.name, value: 999999, isCrit: i % 2 === 0 },
      { ...unit, instanceId: `target-${i}`, x: i % 2 ? 10 : 990, y: 290 });
    const obstacles = [{ x: 0, y: 120, width, height: 15 }];
    const result = layoutCombatTexts(texts, width, 530, false, (text, size) => text.length * size * 0.6, obstacles);
    assert.ok(result.length > 0 && result.length <= 16);
    const intersects = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    for (let i = 0; i < result.length; i++) {
      const label = result[i];
      assert.ok(label.x >= 0 && label.x + label.width <= width);
      assert.ok(label.y >= 0 && label.y + label.height <= 530);
      assert.ok(!intersects(label, obstacles[0]));
      for (const other of result.slice(i + 1)) assert.ok(!intersects(label, other));
    }
  }
});

test('cast targeting distinguishes healing recipients from incidental self shields and pause freezes cinematic time', () => {
  const caster = fixture();
  const ally = { ...caster, instanceId: 'fixture-ally' };
  const enemy = { ...caster, instanceId: 'fixture-enemy', team: 'enemy' as const };
  const cast: CombatEvent = { id: 1, timestampMs: 0, type: 'active_skill', sourceId: caster.instanceId,
    sourceName: caster.name, targetId: enemy.instanceId, skillName: 'fixture-skill' };
  const heal: CombatEvent = { ...cast, id: 2, type: 'heal', targetId: ally.instanceId };
  const shield: CombatEvent = { ...cast, id: 2, type: 'shield', targetId: caster.instanceId };
  const damage: CombatEvent = { ...cast, id: 3, type: 'damage', targetId: enemy.instanceId };
  const units = [caster, ally, enemy];
  assert.equal(resolveSpriteEffectTarget(cast, [cast, heal], units, caster, 'lowest_hp_ally'), ally);
  cast.type = 'ultimate_cast'; delete cast.targetId;
  assert.equal(resolveSpriteEffectTarget(cast, [cast, shield, damage], units, caster, 'all_enemies'), enemy);
  assert.equal(resolveSpriteEffectTarget(cast, [cast, shield, damage], units, caster, 'all_allies'), caster);
  const clock = advancePresentationClock(0.25, 0, true);
  assert.equal(clock, 0.25);
  assert.equal(advancePresentationClock(clock, 0.05, false), 0.3);
});

test('skill body choreography separates anticipation, release and recovery without moving combat coordinates', () => {
  const unit = fixture(), spec = getOathboundSprite(4)!;
  const signatures = new Set<string>();
  for (const style of ['thrust', 'volley', 'arc', 'pillar', 'orbit', 'rift', 'blessing'] as const) {
    const actor = createSpriteActor(unit);
    startSpriteAction(actor, 'skill', spec, 'slash', style);
    const poses = [0.12, 0.42, 0.72].map(phase => {
      actor.age = actor.actionDuration * phase;
      actor.actionRemaining = actor.actionDuration - actor.age;
      const before = structuredClone(actor);
      const pose = getSpriteActionPose(actor, 1, false);
      const reverse = getSpriteActionPose(actor, -1, false);
      Object.values(pose).forEach(value => assert.ok(Number.isFinite(value)));
      assert.equal(reverse.x, -pose.x); assert.equal(reverse.rotation, -pose.rotation);
      assert.equal(reverse.y, pose.y); assert.equal(reverse.scale, pose.scale);
      if (style === 'blessing') assert.equal(pose.x, 0, 'support caster never lunges at an ally');
      assert.deepEqual(getSpriteActionPose(actor, 1, true), { x: 0, y: 0, rotation: 0, scale: 1 });
      assert.deepEqual(actor, before);
      return pose;
    });
    assert.notDeepEqual(poses[0], poses[1], `${style}: anticipation differs from release`);
    assert.notDeepEqual(poses[1], poses[2], `${style}: release differs from recovery`);
    signatures.add(JSON.stringify(poses));
    actor.actionRemaining = 0;
    assert.deepEqual(getSpriteActionPose(actor, 1, false), { x: 0, y: 0, rotation: 0, scale: 1 });
  }
  assert.equal(signatures.size, 7, 'each delivery gets a distinct body gesture, not the same universal lunge');
  assert.equal(unit.x, fixture().x); assert.equal(unit.y, fixture().y);
});

test('skill clips cannot be interrupted by basics and ultimate poses animate without moving simulation feet', () => {
  const unit = fixture(), spec = getOathboundSprite(4)!;
  const actor = createSpriteActor(unit);
  assert.equal(startSpriteAction(actor, 'skill', spec, 'nova'), true);
  advanceSpriteActor(actor, unit, 0.18);
  const clip = actor.clip, age = actor.age;
  assert.equal(startSpriteAction(actor, 'basic', spec, 'slash'), false);
  assert.equal(actor.age, age);
  assert.equal(actor.clip, clip);
  assert.equal(startSpriteAction(actor, 'ultimate', spec, 'slash'), true);
  advanceSpriteActor(actor, unit, 0.2);
  const pose = getSpriteActionPose(actor, unit.facing, false);
  assert.ok(pose.scale > 1);
  assert.notEqual(pose.x, 0);
  assert.deepEqual(getSpriteActionPose(actor, unit.facing, true), { x: 0, y: 0, rotation: 0, scale: 1 });
  assert.equal(unit.x, fixture().x);
});

test('skill effects preserve identity/shape, freeze on pause and expire with bounded lifetime', () => {
  const unit = fixture();
  const event: CombatEvent = { id: 3, timestampMs: 0, type: 'ultimate_cast', sourceId: unit.instanceId,
    sourceName: unit.name, skillName: 'Fixture ultimate', vfxShape: 'lightning', vfxColor: '#aaccff' };
  const effect = createSpriteEffect(event, unit, unit)!;
  assert.equal(effect.shape, 'lightning'); assert.equal(effect.kind, 'cast');
  assert.equal(effect.ultimate, true);
  const effects = [effect];
  advanceSpriteEffects(effects, 0); assert.equal(effect.age, 0);
  advanceSpriteEffects(effects, Number.NaN); assert.equal(effect.age, 0);
  advanceSpriteEffects(effects, 0.5); assert.equal(effect.age, 0.5);
  const calls: string[] = [];
  const ctx = new Proxy({}, { get: (_, name) => (..._args: unknown[]) => { calls.push(String(name)); return { addColorStop() {} }; }, set: () => true }) as CanvasRenderingContext2D;
  for (const shape of ['slash', 'beam', 'meteor', 'lightning', 'serpent', 'nova', 'arrow', 'shadow'] as const) {
    effect.shape = shape;
    for (const age of [0.05, 0.5, 1.1]) {
      effect.age = age;
      drawSpriteEffects(ctx, effects, 390, 530, false, 'ground');
      drawSpriteEffects(ctx, effects, 390, 530, false, 'front');
    }
  }
  assert.ok(calls.includes('stroke') && calls.includes('fill'));
  assert.equal(calls.filter(n => n === 'save').length, calls.filter(n => n === 'restore').length);
  advanceSpriteEffects(effects, 10); assert.equal(effects.length, 0);
});

test('reduced motion removes procedural pose, spinning trails, particles and glow without suppressing cast feedback', () => {
  const unit = fixture();
  const actor = createSpriteActor(unit);
  startSpriteAction(actor, 'ultimate', getOathboundSprite(4));
  advanceSpriteActor(actor, unit, 0.2);
  assert.deepEqual(getSpriteActionPose(actor, unit.facing, true), { x: 0, y: 0, rotation: 0, scale: 1 });
  assert.notDeepEqual(getSpriteActionPose(actor, unit.facing, false), { x: 0, y: 0, rotation: 0, scale: 1 });
  for (const type of ['ultimate_cast', 'damage', 'heal', 'shield', 'death'] as const) {
    for (const shape of ['slash', 'beam', 'meteor', 'lightning', 'serpent', 'nova', 'arrow', 'shadow'] as const) {
      const event: CombatEvent = { id: 3, timestampMs: 0, type, sourceId: unit.instanceId,
        sourceName: unit.name, skillName: 'Fixture reduced motion', vfxShape: shape, vfxColor: '#aaccff' };
      const effect = createSpriteEffect(event, unit, unit)!;
      effect.age = Math.min(0.2, effect.duration / 2);
      const trace = (reduced: boolean) => {
        const calls: Array<[string, ...unknown[]]> = [];
        const ctx = new Proxy({}, {
          get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
            calls.push([String(name), ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
          },
          set: (_, name, value) => { calls.push(['set', String(name), value]); return true; },
        }) as CanvasRenderingContext2D;
        for (const layer of ['ground', 'front'] as const) drawSpriteEffects(ctx, [effect], 390, 530, reduced, layer);
        return calls;
      };
      const reduced = trace(true), normal = trace(false);
      assert.ok(reduced.some(call => call[0] === 'stroke'), `${type}/${shape} retains visible feedback`);
      assert.equal(reduced.some(call => call[0] === 'rotate'), false, `${type}/${shape} must not spin`);
      assert.ok(reduced.filter(call => call[0] === 'set' && call[1] === 'shadowBlur').every(call => call[2] === 0));
      assert.equal(reduced.filter(call => call[0] === 'save').length, reduced.filter(call => call[0] === 'restore').length);
      if (effect.support || effect.kind === 'impact') {
        assert.ok(normal.filter(call => call[0] === 'set' && call[1] === 'shadowBlur').every(call => call[2] === 0), 'support and compact impacts stay unglowed even at normal quality');
      } else {
        assert.ok(normal.some(call => call[0] === 'set' && call[1] === 'shadowBlur' && Number(call[2]) > 0), 'negative control: casts/fallback rendering keeps authored glow');
      }
      assert.notDeepEqual(reduced, normal);
    }
  }
});

test('paused in-flight spell drawing stays deterministic across viewport changes without mutating its timeline', () => {
  const unit = fixture();
  const event: CombatEvent = { id: 3, timestampMs: 0, type: 'ultimate_cast', sourceId: unit.instanceId,
    sourceName: unit.name, skillName: 'Fixture ultimate', vfxShape: 'nova', vfxColor: '#aaccff' };
  const effects = [createSpriteEffect(event, unit, unit)!];
  advanceSpriteEffects(effects, 0.2);
  const actor = createSpriteActor(unit);
  startSpriteAction(actor, 'ultimate', getOathboundSprite(4));
  advanceSpriteActor(actor, unit, 0.2);
  const before = structuredClone({ actor, effects, unit });
  const trace = (width: number, height: number) => {
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, {
      get: (_, name) => name === 'globalAlpha' ? 1 : (...args: unknown[]) => {
        calls.push([name, ...args]); return String(name).startsWith('create') ? { addColorStop() {} } : undefined;
      },
      set: (_, name, value) => { calls.push(['set', name, typeof value === 'object' && value !== null ? 'gradient' : value]); return true; },
    }) as CanvasRenderingContext2D;
    drawSpriteEffects(ctx, effects, width, height, false, 'ground');
    calls.push(['pose', getSpriteActionPose(actor, unit.facing, false)]);
    drawSpriteEffects(ctx, effects, width, height, false, 'front');
    return calls;
  };
  for (const [width, height] of [[384, 528.75], [454, 196.625], [454, 684.75]]) {
    const first = trace(width, height);
    advanceSpriteEffects(effects, 0);
    advanceSpriteActor(actor, unit, 0);
    assert.deepEqual(trace(width, height), first);
    assert.deepEqual({ actor, effects, unit }, before);
    advanceSpriteEffects(effects, 0.05);
    assert.notDeepEqual(trace(width, height), first, 'negative control: advancing a spell must change its draw commands');
    effects[0].age = before.effects[0].age;
  }
});

function fixture() {
  const initial = createInitialData();
  return new BattleSimulation({ allyFormation: initial.formation, ownedHeroes: initial.ownedHeroes,
    enemies: getCampaignStage(1).enemies, seed: 2201, autoUltimate: false }).getUnits()[0];
}

test('Canvas2D sprite drawing crops a single atlas frame, anchors feet and mirrors locally', () => {
  const unit = fixture();
  const spec = getOathboundSprite(4)!;
  const actor = createSpriteActor(unit);
  actor.clip = 'attack'; actor.age = 0.2;
  const calls: Array<[string, ...unknown[]]> = [];
  const context = new Proxy({}, { get: (_, name) => (...args: unknown[]) => calls.push([String(name), ...args]), set: () => true }) as CanvasRenderingContext2D;
  const image = { width: spec.width, height: spec.height } as HTMLImageElement;
  drawSpriteActor(context, actor, unit, spec, image, 200, 400, 1);
  const draw = calls.find(call => call[0] === 'drawImage')!;
  assert.equal(draw[1], image);
  assert.equal(draw[2], spec.cellWidth * 2);
  assert.equal(draw[3], spec.clips.attack.y);
  assert.equal(draw[4], spec.cellWidth);
  assert.equal(draw[5], spec.clips.attack.height);
  assert.deepEqual(calls.find(call => call[0] === 'translate'), ['translate', 200, 400]);
  assert.equal(Number(draw[7]) + Number(draw[9]) * spec.clips.attack.groundY / spec.clips.attack.height, 0);
  assert.equal(calls.at(-1)![0], 'restore');
  calls.length = 0; unit.facing = -1;
  drawSpriteActor(context, actor, unit, spec, image, 200, 400, 1);
  assert.deepEqual(calls.find(call => call[0] === 'scale'), ['scale', -1, 1]);
});

test('static-reference defeated heroes are muted without inventing death frames or changing living/authored sprites', () => {
  const unit = fixture();
  const before = structuredClone(unit);
  for (const unitId of [66, 105, 4]) {
    const spec = getOathboundSprite(unitId)!;
    for (const alive of [true, false]) {
      const subject = { ...unit, isAlive: alive, hp: alive ? unit.hp : 0 };
      const actor = createSpriteActor(subject); actor.clip = alive ? 'idle' : 'death';
      const state = { globalAlpha: 0.8, filter: 'none' };
      const stack: Array<typeof state> = [];
      const observed: Array<typeof state> = [];
      const ctx = { ...state,
        save(this: typeof state) { stack.push({ globalAlpha: this.globalAlpha, filter: this.filter }); },
        restore(this: typeof state) { Object.assign(this, stack.pop()); }, translate() {}, scale() {},
        drawImage(this: typeof state) { observed.push({ globalAlpha: this.globalAlpha, filter: this.filter }); },
      } as unknown as CanvasRenderingContext2D;
      drawSpriteActor(ctx, actor, subject, spec, {} as HTMLImageElement, 200, 400, 1);
      const staticDefeat = !alive && spec.clips.death.count === 1;
      assert.equal(observed[0].globalAlpha, staticDefeat ? 0.8 * presentation.action.staticDefeatOpacity : 0.8);
      assert.equal(observed[0].filter, staticDefeat ? 'grayscale(1)' : 'none');
      assert.equal(ctx.globalAlpha, state.globalAlpha, 'sprite draw must restore caller alpha');
      assert.equal(ctx.filter, state.filter, 'sprite draw must restore caller filter');
    }
  }
  assert.deepEqual(unit, before);
});

test('battle characters are 40 percent larger with foot-anchored crops inside desktop and phone opening lanes', () => {
  const unit = fixture();
  for (const [width, height] of [[456, 687], [390, 530]]) {
    const scale = getSpriteBattleScale(width, height);
    assert.equal(scale, 1.4 * Math.min(width / 480, height / 680));
    for (const unitId of [4, 44, 34, 20, 37]) {
      const spec = getOathboundSprite(unitId)!;
      for (const clip of Object.keys(spec.clips)) for (const facing of [-1, 1] as const) {
        const actor = createSpriteActor(unit); actor.clip = clip;
        unit.facing = facing;
        for (const x of [135, 865]) for (const y of [165, 415]) {
          const point = projectSpritePosition(x, y, width, height);
          let bounds: number[] = [];
          const ctx = { save() {}, restore() {}, translate() {}, scale() {}, drawImage(...args: unknown[]) {
            bounds = args.slice(5).map(Number);
          } } as unknown as CanvasRenderingContext2D;
          drawSpriteActor(ctx, actor, unit, spec, {} as HTMLImageElement, point.x, point.y, scale);
          const [left, top, w, h] = bounds;
          const mirrored = (spec.facing === 'left') !== (facing < 0);
          const screenLeft = point.x + (mirrored ? -left - w : left);
          assert.ok(screenLeft >= 0 && screenLeft + w <= width, `${spec.sourceId}/${clip} horizontal bounds`);
          assert.ok(point.y + top >= 0 && point.y + top + h <= height, `${spec.sourceId}/${clip} vertical bounds`);
        }
      }
    }
  }
});

test('sprite actor clock pauses, freezes crowd control and still finishes death', () => {
  const unit = fixture();
  const actor = createSpriteActor(unit);
  advanceSpriteActor(actor, unit, 0.2);
  const age = actor.age;
  advanceSpriteActor(actor, unit, 0);
  assert.equal(actor.age, age);
  unit.statusEffects = [{ id: 'fixture-stun', type: 'stun', remainingMs: 1000, durationMs: 1000, magnitude: 0, sourceUnitId: unit.instanceId }];
  advanceSpriteActor(actor, unit, 0.2);
  assert.equal(actor.age, age);
  unit.isAlive = false; unit.hp = 0;
  advanceSpriteActor(actor, unit, 0.2);
  assert.equal(actor.clip, 'death');
  assert.equal(actor.age, 0);
  advanceSpriteActor(actor, unit, 0.2);
  assert.equal(actor.age, 0.2);
  advanceSpriteActor(actor, unit, Number.NaN);
  assert.equal(actor.age, 0.2);
});

test('sprite actors are independent, repeated attacks restart, and layout stays on portrait field', () => {
  const unit = fixture();
  const first = createSpriteActor(unit), second = createSpriteActor(unit);
  first.action = 'attack'; first.actionRemaining = 0.5;
  advanceSpriteActor(first, unit, 0.2);
  advanceSpriteActor(first, unit, 0.2);
  assert.equal(second.age, 0);
  assert.equal(first.clip, 'attack');
  first.age = 0; first.actionRemaining = 0.5;
  advanceSpriteActor(first, unit, 0);
  assert.equal(first.age, 0);
  for (const width of [390, 480]) for (const x of [135, 295, 705, 865]) for (const y of [165, 290, 415]) {
    const point = projectSpritePosition(x, y, width, 680);
    assert.ok(point.x > 0 && point.x < width);
    assert.ok(point.y > 0 && point.y < 680);
  }
});
