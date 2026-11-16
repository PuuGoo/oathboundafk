// PROTOTYPE - NOT FOR PRODUCTION
import React, { useEffect, useRef, useState } from 'react';
import type { ThreeBattleCanvasProps } from './ThreeBattleCanvas';
import { BattleSimulation } from '../game/battleEngine';
import { getCampaignStage } from '../game/campaign';
import { getHeroById } from '../game/heroes';
import { getOathboundSprite } from '../game/oathboundSprites';
import { getSpriteSkillArt } from '../game/spriteSkillArt';
import { createBattlePresentationObserver, playBattleImpact } from '../game/battlePresentation';
import { advanceSpriteActor, createSpriteActor, drawSpriteActor, projectSpritePosition, getSpriteBattleScale, startSpriteAction, getSpriteActionPose, resolveSpriteArena } from '../game/spriteBattleRenderer';
import { createSpriteEffect, advanceSpriteEffects, drawSpriteEffects, drawSpriteBattleLayers, resolveSpriteEffectTarget, advancePresentationClock, getActiveSkillSources, getActiveImpactSources, type SpriteEffect } from '../game/spriteBattleEffects';
import presentation from '../game/spritePresentation.json';
import { addCombatText, advanceCombatTexts, layoutCombatTexts, drawCombatTexts, type CombatText } from '../game/spriteCombatText';
import { addUltimateAnnouncement, advanceUltimateAnnouncements, getUltimateAnnouncementView, type UltimateAnnouncement } from '../game/spriteUltimateAnnouncements';
import { layoutSpriteUnitStatuses, drawSpriteUnitStatus, drawSpriteShieldStatus, drawSpriteMarkStatus, drawSpriteIsolation, getSpriteUnitOverlayBounds } from '../game/spriteUnitStatus';
import type { SpriteActor } from '../game/spriteBattleRenderer';
import type { BattleUnitRuntime, CombatEvent } from '../game/types';
import { isUnitAvailable } from '../game/types';
import { soundEngine } from '../game/audio';
import { createBelinda3D } from '../game/belinda3d';
import { spellEffectsForFallback } from '../game/belindaSpell3d';

/** Active hybrid battle: Canvas2D sprites with a live WebGL Belinda, falling back to her source sheet. */
export function SpriteBattleCanvas(props: ThreeBattleCanvasProps & { onManualUltimateConsumed?: (seq: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulation = useRef<BattleSimulation | null>(null);
  const live = useRef(props);
  live.current = props;
  const handledRequest = useRef(0);
  const bannerRef = useRef<HTMLDivElement>(null);
  const [announcements, setAnnouncements] = useState<UltimateAnnouncement[]>([]);
  const announcementView = getUltimateAnnouncementView(announcements);

  useEffect(() => {
    const sim = new BattleSimulation({
      allyFormation: props.formation, ownedHeroes: props.ownedHeroes,
      enemies: getCampaignStage(props.stageId).enemies,
      seed: props.stageId * 1009 + props.battleInstanceKey * 97 + 1337,
      autoUltimate: props.autoUltimate, maxDurationMs: 90000,
    });
    simulation.current = sim;
    sim.setPaused(live.current.isPaused);
    props.onSnapshotUpdate(sim.getSnapshot());
  }, [props.stageId, props.battleInstanceKey, props.formation, props.ownedHeroes]);

  useEffect(() => { if (simulation.current) simulation.current.autoUltimate = props.autoUltimate; }, [props.autoUltimate]);
  useEffect(() => { simulation.current?.setPaused(props.isPaused); }, [props.isPaused]);
  useEffect(() => {
    const request = props.manualUltimateRequest, sim = simulation.current;
    if (!request || !sim || request.seq === handledRequest.current) return;
    handledRequest.current = request.seq;
    sim.setPaused(live.current.isPaused);
    if (live.current.isPaused) {
      props.onManualUltimateConsumed?.(request.seq);
      return;
    }
    for (const unit of sim.getUnits()) {
      if (unit.team === 'ally' && isUnitAvailable(unit) &&
        (request.heroId === '__ALL__' || request.heroId === unit.heroId || request.heroId === unit.instanceId)) {
        sim.triggerUltimate(unit.instanceId);
      }
    }
    props.onSnapshotUpdate(sim.getSnapshot());
    props.onManualUltimateConsumed?.(request.seq);
  }, [props.manualUltimateRequest, props.onSnapshotUpdate, props.onManualUltimateConsumed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const images = new Map<string, HTMLImageElement>();
    const failed = new Set<string>();
    const actors = new Map<string, SpriteActor>();
    const belinda3d = createBelinda3D();
    let drawn3D: string[] = [];
    let active: BattleSimulation | null = null;
    let frame = 0, previous = 0, accumulator = 0, hudAge = 0;
    let width = 480, height = 680, pixelRatio = 0;
    let hitAreas: Array<{ id: string; x: number; y: number; radius: number }> = [];
    const texts: CombatText[] = [];
    const effects: SpriteEffect[] = [];
    const feed: UltimateAnnouncement[] = [];
    const publishAnnouncements = () => setAnnouncements(feed.map(entry => ({ ...entry })));
    let impactShake = 0, visualClock = 0;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduceMotion = () => live.current.reducedMotion || motionPreference.matches;
    const observe = createBattlePresentationObserver();
    const load = (url: string) => {
      if (failed.has(url)) return undefined;
      let image = images.get(url);
      if (!image) {
        image = new Image(); images.set(url, image);
        image.onerror = () => failed.add(url);
        image.src = url;
      }
      return image.complete && image.naturalWidth > 0 ? image : undefined;
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      pixelRatio = dpr;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
    const tap = (event: PointerEvent) => {
      if (live.current.isPaused) return;
      simulation.current?.setPaused(false);
      const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      const hit = [...hitAreas].reverse().find(area => Math.abs(area.x - x) < area.radius && y < area.y && y > area.y - area.radius * 2);
      if (hit) simulation.current?.triggerUltimate(hit.id, false);
    };
    canvas.addEventListener('pointerdown', tap);

    const events = (sim: BattleSimulation, entries: CombatEvent[]) => {
      const units = sim.getUnits();
      let feedChanged = false;
      for (const event of entries) {
        const source = units.find(u => u.instanceId === event.sourceId);
        if (!source) continue;
        const definition = getHeroById(source.heroId);
        const skill = event.type === 'ultimate_cast' ? definition.skills.ultimate : event.type === 'active_skill' ? definition.skills.active : definition.skills.basic;
        const target = resolveSpriteEffectTarget(event, entries, units, source, skill.targetType);
        const actor = source && actors.get(source.instanceId);
        if (event.type === 'cast_cancelled') {
          for (let i = effects.length - 1; i >= 0; i--) if (effects[i].kind === 'cast' && effects[i].castId === event.castId) effects.splice(i, 1);
          if (actor) { actor.actionRemaining = 0; actor.actionKind = ''; }
          continue;
        }
        const spec = source && getOathboundSprite(getHeroById(source.heroId).unitId);
        if (actor && ['basic_attack', 'active_skill', 'ultimate_cast'].includes(event.type)) {
          const art = getSpriteSkillArt(source.heroId);
          const style = source.team === target.team ? 'blessing' : event.type === 'ultimate_cast' ? art?.ultimateDelivery : art?.activeDelivery;
          const preferredClip = event.type === 'ultimate_cast' ? art?.ultimateClip : art?.activeClip;
          startSpriteAction(actor, event.type === 'basic_attack' ? 'basic' : event.type === 'ultimate_cast' ? 'ultimate' : 'skill', spec, event.vfxShape, style, preferredClip, event.timeline);
          if (event.type === 'basic_attack') soundEngine.playBasicAttack(source!.isRanged ? 'ranged' : 'melee');
          else if (event.type === 'ultimate_cast') {
            feedChanged = addUltimateAnnouncement(feed, event, source) || feedChanged;
            soundEngine.playUltimateCast();
          } else soundEngine.playSkillCast('arcane');
        }
        if (source && target) {
          const effect = createSpriteEffect(event, source, target);
          if (effect) effects.push(Object.assign(effect, { sourceId: source.instanceId, hitIndex: event.hitIndex,
            outcomeAtMs: event.timestampMs }));
        }
        if (target && ['damage', 'heal', 'shield'].includes(event.type)) {
          addCombatText(texts, event, target);
          if (event.type === 'damage' && (event.value ?? 0) + (event.absorbed ?? 0) > 0) {
            if (event.skillSlot === 'ultimate') impactShake = 0.32;
            const hit = actors.get(target.instanceId);
            if (hit) {
              hit.flash = 0.12;
              startSpriteAction(hit, 'hit', getOathboundSprite(getHeroById(target.heroId).unitId));
            }
          }
        }
      }
      playBattleImpact(entries, soundEngine);
      if (feedChanged) publishAnnouncements();
      const limit = live.current.graphicsPreset === 'LOW' ? presentation.effects.lowMaxCount : presentation.effects.maxCount;
      // Prefer retaining skill/cast choreography over a burst of routine damage sparks.
      while (effects.length > limit) {
        const expendable = effects.findIndex(effect => !effect.ultimate && (effect.kind === 'impact' || effect.basic));
        effects.splice(expendable < 0 ? 0 : expendable, 1);
      }
    };
    const drawFloor = () => {
      const theme = getCampaignStage(live.current.stageId).theme;
      const arena = resolveSpriteArena(theme, live.current.arenaOverride);
      const forest = arena === 'forest', dark = arena === 'shadow';
      canvas.dataset.arenaPalette = arena;
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, forest ? '#102d26' : dark ? '#242139' : '#7b5940');
      bg.addColorStop(0.4, forest ? '#54705a' : dark ? '#59516a' : '#c49c69');
      bg.addColorStop(1, forest ? '#253e31' : dark ? '#383143' : '#8b6744');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
      // Painted 2D arena: no perspective camera, meshes, pillars or WebGL floor.
      ctx.fillStyle = forest ? '#697956' : dark ? '#716679' : '#d6b17c';
      ctx.beginPath(); ctx.ellipse(width / 2, height * 0.57, width * 0.66, height * 0.31, 0, 0, Math.PI * 2); ctx.fill();
      for (const radius of [0.45, 0.65, 0.86, 1]) {
        ctx.strokeStyle = dark ? '#a895b04d' : '#71533666'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(width / 2, height * 0.57, width * 0.59 * radius, height * 0.27 * radius, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.strokeStyle = '#e9d3a333'; ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const angle = i / 12 * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(width / 2 + Math.cos(angle) * width * 0.39, height * 0.57 + Math.sin(angle) * height * 0.18);
        ctx.lineTo(width / 2 + Math.cos(angle) * width * 0.59, height * 0.57 + Math.sin(angle) * height * 0.27); ctx.stroke();
      }
    };
    const drawUnit = (unit: BattleUnitRuntime, dt: number, overlayOnly = false) => {
      const actor = actors.get(unit.instanceId)!;
      if (!overlayOnly) {
        advanceSpriteActor(actor, unit, dt);
        if (unit.currentCast && simulation.current) {
          actor.age = Math.max(0, simulation.current.getElapsedMs() - unit.currentCast.startedAtMs + accumulator) / 1000;
          actor.actionRemaining = Math.max(0, unit.currentCast.timeline.durationMs / 1000 - actor.age);
        }
      }
      const point = projectSpritePosition(unit.x, unit.y, width, height);
      const scale = getSpriteBattleScale(width, height);
      const hero = getHeroById(unit.heroId), spec = getOathboundSprite(hero.unitId);
      if (!overlayOnly) {
      ctx.fillStyle = '#17141c66'; ctx.beginPath(); ctx.ellipse(point.x, point.y, 24 * scale, 7 * scale, 0, 0, Math.PI * 2); ctx.fill();
      if (unit.isAlive) {
        ctx.strokeStyle = unit.team === 'ally' ? '#f9d77e99' : '#ee837c99'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(point.x, point.y, 28 * scale, 9 * scale, 0, 0, Math.PI * 2); ctx.stroke();
      }
      const image = spec && load(spec.src);
      if (drawSpriteIsolation(ctx, unit, point.x, point.y, scale, !!reduceMotion(), live.current.graphicsPreset === 'LOW')) return;
      if (belinda3d.draw(ctx, unit, actor, (simulation.current?.getElapsedMs() ?? 0) + accumulator,
        !!reduceMotion(), point.x, point.y, scale)) {
        drawn3D.push(unit.instanceId);
        return; // Model owns body poses; never apply a duplicate sprite lunge/rotation.
      }
      const pose = getSpriteActionPose(actor, unit.facing, !!reduceMotion() || !unit.isAlive);
      ctx.save(); ctx.translate(point.x, point.y);
      // A physical charge already moves its feet in simulation; do not add a second cosmetic lunge.
      const poseX = unit.currentCast?.chargePath ? 0 : pose.x;
      ctx.translate(poseX * scale, pose.y * scale); ctx.rotate(pose.rotation); ctx.scale(pose.scale, pose.scale);
      ctx.translate(-point.x, -point.y);
      if (spec && image) drawSpriteActor(ctx, actor, unit, spec, image, point.x, point.y, scale);
      else {
        const portrait = load(hero.battleUrl || `/assets/heroes/${hero.id}_battle.webp`);
        ctx.save(); ctx.translate(point.x, point.y); ctx.scale(unit.facing, 1);
        ctx.globalAlpha = unit.isAlive ? 1 : 0.3;
        if (portrait) ctx.drawImage(portrait, -32 * scale, -94 * scale, 64 * scale, 94 * scale);
        else {
          ctx.fillStyle = hero.visual.primaryColor;
          ctx.beginPath(); ctx.arc(0, -64 * scale, 10 * scale, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(-12 * scale, -52 * scale, 24 * scale, 48 * scale);
        }
        ctx.restore();
      }
      ctx.restore();
      return;
      }
      if (!unit.isAlive) return;
      const barWidth = 46 * scale, barY = point.y - (spec?.sourceId === 'lancer' ? 112 : 100) * scale;
      ctx.fillStyle = '#1c1920'; ctx.fillRect(point.x - barWidth / 2 - 1, barY - 1, barWidth + 2, 10);
      ctx.fillStyle = unit.team === 'ally' ? '#86cf61' : '#e66e67';
      ctx.fillRect(point.x - barWidth / 2, barY, barWidth * Math.max(0, unit.hp / unit.maxHp), 4);
      ctx.fillStyle = '#eec469'; ctx.fillRect(point.x - barWidth / 2, barY + 5, barWidth * Math.min(1, unit.energy / 100), 2);
      ctx.font = `${Math.max(9, 10 * scale)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff4d8';
      ctx.fillText(`Lv.${unit.level}`, point.x, point.y + 14 * scale);
      drawSpriteShieldStatus(ctx, unit, point.x + barWidth / 2 + 8 * scale, barY + 3, scale);
      drawSpriteMarkStatus(ctx, unit, simulation.current?.getUnits() || [], point.x, barY + 19 * scale, scale);
      if (unit.team === 'ally' && isUnitAvailable(unit)) hitAreas.push({ id: unit.instanceId, ...point, radius: 45 * scale });
    };
    const tick = (now: number) => {
      // Moving between displays or changing zoom can change DPR without a CSS-box resize.
      if (pixelRatio !== Math.min(window.devicePixelRatio || 1, 2)) resize();
      const dt = previous ? Math.min(0.05, (now - previous) / 1000) : 0; previous = now;
      const sim = simulation.current, p = live.current;
      if (sim !== active) {
        belinda3d.reset();
        active = sim; actors.clear(); texts.length = 0; effects.length = 0; feed.length = 0; accumulator = 0; impactShake = 0; visualClock = 0; publishAnnouncements();
        sim?.getUnits().forEach(unit => actors.set(unit.instanceId, createSpriteActor(unit)));
      }
      const playDt = p.isPaused ? 0 : dt * p.battleSpeed;
      if (sim) {
        sim.autoUltimate = p.autoUltimate;
        if (!p.isPaused && sim.getStatus() === 'running') {
          accumulator += playDt * 1000;
          while (accumulator >= 50 && sim.getStatus() === 'running') { sim.step(50); accumulator -= 50; }
        }
        observe(sim, entries => events(sim, entries), final => {
          p.onSnapshotUpdate(final); p.onBattleFinished(final);
          if (final.status === 'victory') soundEngine.playVictoryFanfare(); else soundEngine.playDefeatSting();
        });
      }
      visualClock = advancePresentationClock(visualClock, playDt, p.isPaused);
      advanceSpriteEffects(effects, playDt);
      for (const effect of effects) if (sim) {
        const metadata = effect as SpriteEffect & { sourceId?: string; outcomeAtMs?: number };
        if (effect.timeline && effect.startedAtMs !== undefined) {
          effect.age = Math.max(0, sim.getElapsedMs() - effect.startedAtMs + accumulator) / 1000;
          const caster = effect.sourceHeroId === 'belinda' && sim.getUnits().find(unit => unit.instanceId === metadata.sourceId);
          if (caster) effect.source = { x: caster.x, y: caster.y };
        } else if (effect.sourceHeroId === 'belinda' && metadata.outcomeAtMs !== undefined) {
          effect.age = Math.max(0, sim.getElapsedMs() + accumulator - metadata.outcomeAtMs) / 1000;
        }
        if (effect.timeline || effect.sourceHeroId === 'belinda') {
          const recipient = sim.getUnits().find(unit => unit.instanceId === effect.targetId);
          if (recipient) effect.target = { x: recipient.x, y: recipient.y };
        }
      }
      impactShake = Math.max(0, impactShake - playDt);
      drawFloor(); hitAreas = []; drawn3D = [];
      const dimAge = Math.max(0, ...feed.map(entry => entry.remaining - presentation.ultimate.bannerSeconds + presentation.effects.ultimateSeconds));
      if (!reduceMotion() && p.ultimateCameraEnabled !== false && dimAge > 0) {
        ctx.save(); ctx.globalAlpha = presentation.ultimate.dimOpacity * Math.min(1, dimAge / 0.3);
        ctx.fillStyle = '#0e0924'; ctx.fillRect(0, 0, width, height); ctx.restore();
      }
      ctx.save();
      if (!reduceMotion() && p.cameraShakeEnabled !== false && impactShake > 0) {
        const strength = presentation.ultimate.shakePixels * impactShake / 0.32;
        ctx.translate(Math.sin(visualClock * 40) * strength, Math.cos(visualClock * 47) * strength * 0.5);
      }
      const units = sim?.getUnits() || [];
      const spellDrawn = new Map<number, string>();
      drawSpriteBattleLayers(units, effects, !!reduceMotion(), unit => drawUnit(unit, playDt),
        (batch, layer) => {
          const handled = belinda3d.drawSpells(ctx, batch, layer, { width, height,
            reducedMotion: !!reduceMotion(), low: p.graphicsPreset === 'LOW' });
          handled.forEach(id => spellDrawn.set(id, layer));
          drawSpriteEffects(ctx, spellEffectsForFallback(batch, handled), width, height,
            !!reduceMotion(), layer, p.graphicsPreset === 'LOW');
        });
      canvas.dataset.belindaSpells = JSON.stringify(effects.filter(effect => effect.sourceHeroId === 'belinda').map(effect => ({
        id: effect.id, castId: effect.castId, kind: effect.kind, slot: effect.skillSlot,
        targetId: effect.targetId, age: effect.age, rendered3d: spellDrawn.has(effect.id),
        hitIndex: (effect as SpriteEffect & { hitIndex?: number }).hitIndex,
      })));
      // Bars remain readable above all bodies and spell layers.
      units.forEach(unit => drawUnit(unit, 0, true));
      ctx.restore();
      canvas.dataset.belinda3d = JSON.stringify({ status: belinda3d.status(), drawn: drawn3D,
        elapsedMs: sim?.getElapsedMs() ?? 0, paused: p.isPaused, speed: p.battleSpeed,
        units: units.filter(unit => unit.heroId === 'belinda').map(unit => ({ id: unit.instanceId, alive: unit.isAlive,
          x: unit.x, y: unit.y, facing: unit.facing, clip: actors.get(unit.instanceId)?.clip, age: actors.get(unit.instanceId)?.age,
          cast: unit.currentCast && { slot: unit.currentCast.skillSlot, id: unit.currentCast.castId,
            ageMs: (sim?.getElapsedMs() ?? 0) + accumulator - unit.currentCast.startedAtMs },
          controls: unit.statusEffects.filter(status => status.remainingMs > 0).map(status => status.type) })) });
      canvas.dataset.activeEffects = String(effects.length);
      // Read-only actual outcome diagnostics; neither test hooks nor the renderer can trigger a proc.
      canvas.dataset.combatOutcomeState = JSON.stringify({ elapsedMs: sim?.getElapsedMs() ?? 0,
        units: units.map(unit => ({ id: unit.instanceId, heroId: unit.heroId, team: unit.team, alive: unit.isAlive, shield: unit.shield })),
        casts: effects.filter(effect => effect.kind === 'cast' && effect.sourceHeroId === 'fawkes' && effect.ultimate).map(effect => ({
          sourceTeam: effect.sourceTeam, castId: effect.castId, age: effect.age,
          releaseMs: effect.timeline?.releaseMs, contactMs: effect.timeline?.hits[0]?.atMs })),
        outcomes: effects.filter(effect => effect.kind === 'purge' || effect.kind === 'resist').map(effect => ({
          kind: effect.kind, sourceHeroId: effect.sourceHeroId, sourceTeam: effect.sourceTeam, targetId: effect.targetId,
          castId: effect.castId, skillSlot: effect.skillSlot, age: effect.age, duration: effect.duration })) });
      // Read-only runtime observation of the same status that drew the coffin; never controls simulation.
      canvas.dataset.isolationState = JSON.stringify({ elapsedMs: sim?.getElapsedMs() ?? 0,
        captives: units.filter(unit => unit.isAlive).flatMap(unit => unit.statusEffects
          .filter(status => status.type === 'isolation' && status.remainingMs > 0)
          .map(status => ({ id: unit.instanceId, name: unit.name, sourceId: status.sourceUnitId, remainingMs: status.remainingMs }))),
        livingIds: units.filter(unit => unit.isAlive).map(unit => unit.instanceId),
        returns: effects.filter(effect => effect.kind === 'isolation-return').map(effect => ({ id: effect.targetId, age: effect.age, duration: effect.duration })) });
      canvas.dataset.activeSkillSources = getActiveSkillSources(effects).join(',');
      canvas.dataset.activeReleaseSources = getActiveSkillSources(effects, [0.36, 0.56]).join(',');
      canvas.dataset.activeAnticipationSources = getActiveSkillSources(effects, [0.06, 0.16]).join(',');
      canvas.dataset.activeImpactSources = getActiveImpactSources(effects).join(',');
      canvas.dataset.activeArrivalSources = getActiveSkillSources(effects, [0.66, 0.82]).join(',');
      canvas.dataset.skillActors = String([...actors.values()].filter(actor => actor.actionRemaining > 0 && ['skill', 'ultimate'].includes(actor.actionKind)).length);
      advanceCombatTexts(texts, playDt);
      const scale = getSpriteBattleScale(width, height);
      const barObstacles = units.filter(unit => unit.isAlive).map(unit => getSpriteUnitOverlayBounds(unit, width, height));
      if (feed.length > 0) {
        const panel = bannerRef.current?.getBoundingClientRect(), rect = canvas.getBoundingClientRect();
        barObstacles.push(panel ? { x: panel.left - rect.left, y: panel.top - rect.top, width: panel.width, height: panel.height }
          : { x: 12, y: 8, width: Math.max(1, width - 24), height: 96 });
      }
      const statusLabels = layoutSpriteUnitStatuses(units, width, height, sim?.getStatus() || 'running', barObstacles);
      statusLabels.forEach(label => drawSpriteUnitStatus(ctx, label));
      barObstacles.push(...statusLabels);
      canvas.dataset.unitStatusLabels = String(statusLabels.length);
      const labels = layoutCombatTexts(texts, width, height, !!reduceMotion(), (text, fontSize) => {
        ctx.font = `bold ${fontSize}px sans-serif`; return ctx.measureText(text).width;
      }, barObstacles);
      drawCombatTexts(ctx, labels);
      canvas.dataset.visibleCombatTexts = String(labels.length);
      if (advanceUltimateAnnouncements(feed, playDt)) publishAnnouncements();
      hudAge += dt;
      if (sim && hudAge >= 0.065) { hudAge = 0; p.onSnapshotUpdate(sim.getSnapshot()); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); belinda3d.dispose(); ro.disconnect(); canvas.removeEventListener('pointerdown', tap); images.forEach(image => { image.onerror = null; }); };
  }, []);

  return <div className="relative h-full w-full overflow-hidden" data-testid="sprite-battle-view" data-battle-renderer="canvas2d-oathbound">
    <canvas ref={canvasRef} className="block h-full w-full touch-manipulation" aria-label="Chiến đấu Oathbound: sprite 2D và Belinda 3D thời gian thực" />
    {props.showPerfOverlay && <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-[10px] text-amber-200">Oathbound · 2D + Belinda 3D</div>}
    {announcements.length > 0 && <div ref={bannerRef} data-testid="sprite-ultimate-banner" data-cast-count={announcements.length} data-cast-ids={announcements.map(entry => entry.id).join(',')}
      className={`pointer-events-none absolute inset-x-3 rounded border border-amber-300/60 bg-stone-950/90 px-2 py-1.5 text-[10px] text-amber-100 ${props.showPerfOverlay ? 'top-8' : 'top-2'}`}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-bold uppercase tracking-wide">
        <span>Tuyệt kỹ</span><span data-testid="sprite-combo-count">{announcementView.allyCombo > 1 ? `Đồng minh · Liên chiêu ×${announcementView.allyCombo}` : ''}{announcementView.allyCombo > 1 && announcementView.enemyCombo > 1 ? ' / ' : ''}{announcementView.enemyCombo > 1 ? `Địch · Liên chiêu ×${announcementView.enemyCombo}` : ''}</span>
      </div>
      {announcementView.rows.map(entry => <div key={entry.id} data-testid="sprite-ultimate-row" data-team={entry.team}
        className="flex min-w-0 items-center gap-1.5 leading-5" title={`${entry.name} — ${entry.skill}`}>
        <span className={`shrink-0 rounded px-1 text-[9px] font-bold ${entry.team === 'ally' ? 'bg-cyan-950 text-cyan-200' : 'bg-rose-950 text-rose-200'}`}>{entry.team === 'ally' ? 'TA' : 'ĐỊCH'}</span>
        <strong className="max-w-[34%] shrink-0 truncate">{entry.name}</strong><span className="min-w-0 truncate text-stone-200">{entry.skill}</span>
      </div>)}
      {announcementView.hidden.length > 0 && <div data-testid="sprite-ultimate-overflow" className="mt-0.5 truncate border-t border-amber-200/20 pt-0.5 text-[9px] text-stone-300"
        title={announcementView.hidden.map(entry => `${entry.team === 'ally' ? 'Ta' : 'Địch'}: ${entry.name} — ${entry.skill}`).join('; ')}>
        +{announcementView.hidden.length} chiêu: {announcementView.hidden.map(entry => entry.name).join(' · ')}
      </div>}
    </div>}
  </div>;
}
