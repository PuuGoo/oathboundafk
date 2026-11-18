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
import { createHero3D } from '../game/hero3d';
import { spellEffectsForFallback } from '../game/belindaSpell3d';
import { getHeroVfx, heroVfxTint } from '../game/heroVfx';
import { arenaLighting, arenaPulseOpacity, resolveArenaScene, ARENA_CLIP_SECONDS } from '../game/arena3d';
import { groundShadow } from '../game/spriteGroundShadow';
import { impactShock, IMPACT_SHOCK_SECONDS } from '../game/spriteImpactShock';
import { castTelegraph } from '../game/spriteCastTelegraph';
import { vignetteFor, vignetteStops } from '../game/spriteVignette';
import { hitFlashFilter } from '../game/spriteHitFlash';
import { dustPuff, MOVE_DUST_INTERVAL } from '../game/spriteMoveDust';
import { readyAura } from '../game/spriteReadyAura';
import { getUltimateReadiness } from '../game/ultimateReadiness';
import { deathTide, DEATH_TIDE_SECONDS } from '../game/spriteDeathTide';

/** Shared live hero models with source-sprite fallback; only Belinda spells use the 3D pass. */
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
    const heroes3d = createHero3D();
    let drawn3D: string[] = [];
    let active: BattleSimulation | null = null;
    let frame = 0, previous = 0, accumulator = 0, hudAge = 0;
    let width = 480, height = 680, pixelRatio = 0;
    let hitAreas: Array<{ id: string; x: number; y: number; radius: number }> = [];
    const texts: CombatText[] = [];
    const effects: SpriteEffect[] = [];
    /** Vòng xung kích đang chạy tại điểm chạm, tính bằng đồng hồ trình diễn. */
    const shocks: Array<{ id: number; at: number; strength: number; x: number; y: number; tint: string }> = [];
    /** Bụi cuốn dưới chân khi chạy; `seed` cố định để hạt bay cùng hướng mỗi lần. */
    let dustSeed = 0;
    const dust: Array<{ at: number; seed: number; x: number; y: number; facing: number }> = [];
    /** Mốc đồng hồ của hạt bụi gần nhất theo từng instance, để không xả mỗi khung. */
    const lastDustAt = new Map<string, number>();
    /** Tướng đã gục + mốc trình diễn lúc gục, cho chuỗi cột sáng và vệt sàn. */
    const deaths: Array<{ at: number; x: number; y: number; ultimate: boolean }> = [];
    const feed: UltimateAnnouncement[] = [];
    const publishAnnouncements = () => setAnnouncements(feed.map(entry => ({ ...entry })));
    let impactShake = 0, visualClock = 0;
    /** Tuyệt kỹ gần nhất: mốc thời gian cho vòng pulse và màu của tướng đã tung. */
    let lastUltimate: { atMs: number; tint?: number } | undefined;
    /** Sân 3D đang hiện + mốc trình diễn lúc nó vẽ được lần đầu, cho nhịp fade-in. */
    let arenaRevealId: string | undefined, arenaRevealAt = 0;
    /** Sân đang đấu, để bóng nhân vật ngả theo đúng màu sàn của theme. */
    const arenaScene = () => {
      const theme = getCampaignStage(live.current.stageId).theme;
      const arena = resolveSpriteArena(theme, live.current.arenaOverride);
      return { theme, arena, definition: resolveArenaScene(theme, arena, live.current.arenaOverride) };
    };
    /** Màu sàn của theme đang đấu; mặc định xám đêm nếu stage không có sân. */
    const arenaGroundHex = (): number => {
      const { definition } = arenaScene();
      return definition ? arenaLighting(definition.id).ground : 0x17141c;
    };
    /** 0..1 của nhịp pulse để bóng nhân vật nhạt đi cùng lúc cả sân bừng sáng. */
    const currentPulseFlash = (): number => {
      if (lastUltimate === undefined) return 0;
      const since = (simulation.current?.getElapsedMs() ?? 0) + accumulator - lastUltimate.atMs;
      if (!(since >= 0) || since >= ARENA_CLIP_SECONDS.pulse * 1000) return 0;
      return arenaPulseOpacity(since / 1000 / ARENA_CLIP_SECONDS.pulse);
    };
    /**
     * Gradient bóng dựng tại gốc toạ độ rồi dịch bằng context, nên chỉ tạo một lần cho mỗi
     * (màu sàn, bán kính) thay vì cấp phát mới cho từng tướng ở mỗi khung.
     */
    const shadowGradients = new Map<string, CanvasGradient>();
    const shadowFill = (shadow: ReturnType<typeof groundShadow>): CanvasGradient => {
      const key = `${shadow.core}|${Math.round(shadow.radiusX)}`;
      const cached = shadowGradients.get(key);
      if (cached) return cached;
      if (shadowGradients.size > 48) shadowGradients.clear();
      const gradient = ctx.createRadialGradient(0, 0, 1, 0, 0, shadow.radiusX);
      gradient.addColorStop(0, shadow.core);
      gradient.addColorStop(.55, shadow.core);
      gradient.addColorStop(1, shadow.edge);
      shadowGradients.set(key, gradient);
      return gradient;
    };
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
      // Buffer 3D theo độ phân giải thật của canvas; LOW giữ 1× để máy yếu không tô lại ở 2×.
      heroes3d.resize(width, height, live.current.graphicsPreset === 'LOW' ? 1 : dpr);
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
            lastUltimate = { atMs: event.timestampMs, tint: heroVfxTint(source.heroId) };
            soundEngine.playUltimateCast();
          } else soundEngine.playSkillCast('arcane');
        }
        if (source && target) {
          const effect = createSpriteEffect(event, source, target);
          if (effect) effects.push(Object.assign(effect, { sourceId: source.instanceId, hitIndex: event.hitIndex,
            outcomeAtMs: event.timestampMs }));
          // Chuỗi gục: mốc trình diễn riêng để cột sáng chạy đúng nhịp pause/×2.
          if (effect?.kind === 'death' && deaths.length < 10) {
            deaths.push({ at: visualClock, x: target.x, y: target.y,
              ultimate: event.skillSlot === 'ultimate' });
          }
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
            // Vòng xung kích ở chân người trúng: mạnh theo bậc chiêu, nhuộm màu bên đánh.
            const power = event.skillSlot === 'ultimate' ? 1.6 : event.skillSlot === 'active' ? 1 : .45;
            if (shocks.length < 12) {
              shocks.push({ id: event.id, at: visualClock, strength: power,
                x: target.x, y: target.y,
                tint: source.team === 'ally' ? '#ffe6a8' : '#ffb0a8' });
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
      const { theme, arena, definition: scene } = arenaScene();
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
      /** Vignette màu sàn: hạ sáng bốn góc để mắt bám vào hai hàng tướng; giữa khung không đổi pixel. */
      const drawVignette = () => {
        const vignette = vignetteFor(width, height, arenaGroundHex(), currentPulseFlash());
        const radius = Math.hypot(width, height) * .5;
        const shade = ctx.createRadialGradient(width * vignette.centerX, height * vignette.centerY,
          radius * vignette.inner, width * vignette.centerX, height * vignette.centerY, radius * vignette.outer);
        for (const stop of vignetteStops(vignette)) shade.addColorStop(stop.at, stop.color);
        ctx.save();
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      };
      // Lớp sân Blender vẽ đè lên ellipse nền; asset tải xong mới hiện, lỗi thì giữ nền phẳng.
      if (scene) {
        // Vòng sáng sân chỉ chạy trong 1,65 s kể từ lần tung tuyệt kỹ gần nhất.
        const sinceUltimate = lastUltimate === undefined ? undefined
          : (simulation.current?.getElapsedMs() ?? 0) + accumulator - lastUltimate.atMs;
        const pulseAge = sinceUltimate !== undefined && sinceUltimate >= 0 && sinceUltimate < 1650
          ? sinceUltimate / 1000 : undefined;
        const reveal = arenaRevealId === scene.id ? Math.max(0, visualClock - arenaRevealAt) : 0;
        const drawn = heroes3d.drawArena(ctx, scene, { width, height, centerX: width / 2, centerY: height * 0.57,
          radiusX: width * 0.66, radiusY: height * 0.31, reducedMotion: !!reduceMotion(),
          low: live.current.graphicsPreset === 'LOW',
          pulseAge, pulseTint: pulseAge === undefined ? undefined : lastUltimate?.tint,
          reveal, wallClock: visualClock });
        // Nhịp hiện dần chỉ bắt đầu từ khung vẽ được đầu tiên, không tính lúc asset còn đang tải.
        if (drawn && arenaRevealId !== scene.id) { arenaRevealId = scene.id; arenaRevealAt = visualClock; }
        canvas.dataset.arena3d = JSON.stringify({ scene: scene.id, drawn,
          status: heroes3d.arenaStatus(scene.id), pulse: pulseAge !== undefined,
          weather: heroes3d.arenaWeatherCount() });
      } else {
        canvas.dataset.arena3d = JSON.stringify({ scene: null });
      }
      // Đặt sau lớp sân 3D để bóng góc phủ cả nền đá lẫn trời, nhưng vẫn dưới tướng và HUD.
      drawVignette();
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
      // Bụi cuốn: chỉ khi thật sự đang chạy, và cách nhau MOVE_DUST_INTERVAL để không thành vệt đặc.
      if (unit.isAlive && unit.lastActionType === 'move' && !reduceMotion()) {
        const previous = lastDustAt.get(unit.instanceId);
        if (previous === undefined || visualClock - previous >= MOVE_DUST_INTERVAL) {
          lastDustAt.set(unit.instanceId, visualClock);
          if (dust.length < 28) dust.push({ at: visualClock, seed: dustSeed++, x: unit.x, y: unit.y, facing: unit.facing });
        }
      }
      // Vòng niệm dưới chân: đầy tới mốc phóng chiêu thật trong timeline, rồi tan nhanh.
      const cast = unit.currentCast;
      if (cast && unit.isAlive && !reduceMotion()) {
        const ageSeconds = Math.max(0, (simulation.current?.getElapsedMs() ?? 0) + accumulator - cast.startedAtMs) / 1000;
        const telegraph = castTelegraph(ageSeconds, cast.timeline.durationMs / 1000,
          cast.timeline.releaseMs / 1000, scale,
          cast.skillSlot === 'ultimate' ? 1.6 : cast.skillSlot === 'active' ? 1 : .5);
        if (telegraph.alive) {
          ctx.save();
          ctx.globalAlpha = telegraph.opacity;
          ctx.strokeStyle = unit.team === 'ally' ? '#ffe6a8' : '#ffb0a8';
          ctx.lineWidth = telegraph.lineWidth;
          ctx.beginPath();
          ctx.ellipse(point.x, point.y, telegraph.radius, telegraph.radius * .34, 0, 0, Math.PI * 2);
          ctx.stroke();
          // Cung đầy theo tiến độ niệm: đọc được còn bao lâu mới phóng chiêu.
          if (!telegraph.released) {
            ctx.beginPath();
            ctx.ellipse(point.x, point.y, telegraph.radius, telegraph.radius * .34,
              0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * telegraph.charge);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
      // Hào quang "tuyệt kỹ sẵn sàng": chỉ đọc trạng thái thật của simulation.
      if (unit.isAlive && !reduceMotion()) {
        const readiness = getUltimateReadiness(unit, simulation.current?.getStatus() || 'running');
        const aura = readyAura(visualClock, readiness.energy / 100, scale, readiness.canCast);
        if (aura.visible) {
          ctx.save();
          ctx.strokeStyle = unit.team === 'ally' ? '#ffe6a8' : '#ffb0a8';
          ctx.globalAlpha = aura.opacity;
          ctx.lineWidth = aura.lineWidth;
          ctx.beginPath();
          ctx.ellipse(point.x, point.y, aura.radius, aura.radius * .34, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          for (const mote of aura.motes) {
            ctx.fillStyle = unit.team === 'ally' ? `rgba(255,236,180,${mote.alpha.toFixed(3)})`
              : `rgba(255,196,186,${mote.alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.ellipse(point.x + mote.x, point.y + mote.y * .34, mote.r, mote.r, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
      // Bóng tiếp đất mềm thay vì một ellipse đặc: ngả theo màu sàn, nhạt đi khi sân bừng sáng.
      const shadow = groundShadow(arenaGroundHex(), scale, currentPulseFlash(), unit.isAlive);
      ctx.save();
      ctx.translate(point.x, point.y + shadow.offsetY);
      ctx.fillStyle = shadowFill(shadow);
      ctx.beginPath(); ctx.ellipse(0, 0, shadow.radiusX, shadow.radiusY, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (unit.isAlive) {
        ctx.strokeStyle = unit.team === 'ally' ? '#f9d77e99' : '#ee837c99'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(point.x, point.y, 28 * scale, 9 * scale, 0, 0, Math.PI * 2); ctx.stroke();
      }
      const image = spec && load(spec.src);
      if (drawSpriteIsolation(ctx, unit, point.x, point.y, scale, !!reduceMotion(), live.current.graphicsPreset === 'LOW')) return;
      /** Sprite của chính tướng: dùng cho fallback và cho nhịp chuyển sang model 3D. */
      const drawSpriteBody = () => {
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
          // Nhân với alpha ngoài để nhịp chuyển model vẫn áp lên cả ảnh chân dung dự phòng.
          ctx.globalAlpha *= unit.isAlive ? 1 : 0.3;
          if (portrait) ctx.drawImage(portrait, -32 * scale, -94 * scale, 64 * scale, 94 * scale);
          else {
            ctx.fillStyle = hero.visual.primaryColor;
            ctx.beginPath(); ctx.arc(0, -64 * scale, 10 * scale, 0, Math.PI * 2); ctx.fill();
            ctx.fillRect(-12 * scale, -52 * scale, 24 * scale, 48 * scale);
          }
          ctx.restore();
        }
        ctx.restore();
      };
      // Model 3D vừa tải xong: sprite mờ dần bên dưới đúng nhịp model hiện ra, không đổi art đột ngột.
      const bodyReady = heroes3d.modelStatus(unit.heroId) === 'ready';
      const reveal = bodyReady ? heroes3d.bodyReveal(unit.instanceId) : 1;
      if (bodyReady && reveal < 1) {
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - reveal); drawSpriteBody(); ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = reveal;
      const drawnNow = heroes3d.draw(ctx, unit, actor, (simulation.current?.getElapsedMs() ?? 0) + accumulator,
        !!reduceMotion(), point.x, point.y, scale);
      ctx.restore();
      if (drawnNow) {
        drawn3D.push(unit.instanceId);
        return; // Model owns body poses; never apply a duplicate sprite lunge/rotation.
      }
      if (!bodyReady || reveal >= 1) drawSpriteBody();
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
        heroes3d.reset();
        lastUltimate = undefined;
        arenaRevealId = undefined; arenaRevealAt = 0;
        active = sim; actors.clear(); texts.length = 0; effects.length = 0; feed.length = 0; shocks.length = 0;
        dust.length = 0; lastDustAt.clear(); dustSeed = 0; deaths.length = 0;
        accumulator = 0; impactShake = 0; visualClock = 0; publishAnnouncements();
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
        if (getHeroVfx(effect.sourceHeroId) && effect.kind === 'cast') {
          const caster = sim.getUnits().find(unit => unit.instanceId === metadata.sourceId);
          if (caster) effect.source = { x: caster.x, y: caster.y };
        }
        if (effect.timeline && effect.startedAtMs !== undefined) {
          effect.age = Math.max(0, sim.getElapsedMs() - effect.startedAtMs + accumulator) / 1000;

        } else if (effect.sourceHeroId === 'belinda' && metadata.outcomeAtMs !== undefined) {
          effect.age = Math.max(0, sim.getElapsedMs() + accumulator - metadata.outcomeAtMs) / 1000;
        }
        if (effect.timeline || getHeroVfx(effect.sourceHeroId)) {
          const recipient = sim.getUnits().find(unit => unit.instanceId === effect.targetId);
          if (recipient) effect.target = { x: recipient.x, y: recipient.y };
        }
      }
      impactShake = Math.max(0, impactShake - playDt);
      drawFloor(); hitAreas = []; drawn3D = []; heroes3d.beginFrame();
      // Vòng xung kích: vẽ ngay trên sàn, trước khi tướng đè lên nên không che mặt anh hùng.
      if (shocks.length) {
        const stageScale = getSpriteBattleScale(width, height);
        for (let index = shocks.length - 1; index >= 0; index--) {
          const shock = shocks[index];
          const age = visualClock - shock.at;
          if (!(age >= 0) || age >= IMPACT_SHOCK_SECONDS) { shocks.splice(index, 1); continue; }
          if (reduceMotion()) { shocks.splice(index, 1); continue; }
          const ring = impactShock(age, shock.strength, stageScale);
          if (!ring.alive) { shocks.splice(index, 1); continue; }
          const at = projectSpritePosition(shock.x, shock.y, width, height);
          ctx.save();
          ctx.globalAlpha = ring.opacity;
          ctx.strokeStyle = shock.tint;
          ctx.lineWidth = ring.lineWidth;
          ctx.beginPath();
          ctx.ellipse(at.x, at.y, ring.radius, ring.radius * ring.flatten, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      // Bụi cuốn dưới chân: vẽ cùng lớp sàn, trước tướng nên không che thân.
      if (dust.length) {
        const stageScale = getSpriteBattleScale(width, height);
        const ground = arenaGroundHex();
        for (let index = dust.length - 1; index >= 0; index--) {
          const puff = dust[index];
          const age = visualClock - puff.at;
          const state = dustPuff(age, puff.seed, stageScale, ground, puff.facing);
          if (!state.alive) { dust.splice(index, 1); continue; }
          const at = projectSpritePosition(puff.x, puff.y, width, height);
          ctx.save();
          ctx.fillStyle = state.color;
          ctx.beginPath();
          ctx.ellipse(at.x + state.dx, at.y + state.dy + 1.5 * stageScale,
            state.radius, state.radius * .5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      // Chuỗi gục: vệt sàn + cột sáng dâng lên rồi tan, vẽ trên lớp sàn trước tướng.
      if (deaths.length) {
        const stageScale = getSpriteBattleScale(width, height);
        for (let index = deaths.length - 1; index >= 0; index--) {
          const death = deaths[index];
          const age = visualClock - death.at;
          const tide = deathTide(age, stageScale, death.ultimate);
          if (!tide.alive) { deaths.splice(index, 1); continue; }
          const at = projectSpritePosition(death.x, death.y, width, height);
          ctx.save();
          // Vệt tối dưới sàn, dẹt theo mặt phẳng nghiêng.
          if (tide.stainOpacity > 0) {
            ctx.globalAlpha = tide.stainOpacity;
            ctx.fillStyle = '#0d0a12';
            ctx.beginPath();
            ctx.ellipse(at.x, at.y + 2 * stageScale, tide.stainRadius, tide.stainRadius * .34, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          // Cột sáng dâng từ chân: gradient dọc để đỉnh tan vào không khí.
          if (tide.columnOpacity > 0) {
            const top = at.y - tide.columnHeight;
            const column = ctx.createLinearGradient(0, top, 0, at.y);
            column.addColorStop(0, 'rgba(255,246,220,0)');
            column.addColorStop(.45, `rgba(255,246,220,${(tide.columnOpacity * .85).toFixed(3)})`);
            column.addColorStop(1, `rgba(255,236,190,${tide.columnOpacity.toFixed(3)})`);
            ctx.globalAlpha = 1;
            ctx.fillStyle = column;
            ctx.beginPath();
            ctx.ellipse(at.x, at.y - tide.columnHeight / 2, tide.columnRadius,
              tide.columnHeight / 2, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          for (const mote of tide.motes) {
            if (mote.alpha <= 0) continue;
            ctx.globalAlpha = mote.alpha;
            ctx.fillStyle = '#fff3d2';
            ctx.beginPath();
            ctx.ellipse(at.x + mote.x, at.y + mote.y, mote.r, mote.r, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
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
          const handled = heroes3d.drawSpells(ctx, batch, layer, { width, height,
            reducedMotion: !!reduceMotion(), low: p.graphicsPreset === 'LOW', clock: visualClock });
          handled.forEach(id => spellDrawn.set(id, layer));
          drawSpriteEffects(ctx, spellEffectsForFallback(batch, handled), width, height,
            !!reduceMotion(), layer, p.graphicsPreset === 'LOW');
        });
      canvas.dataset.belindaSpells = JSON.stringify(effects.filter(effect => effect.sourceHeroId === 'belinda').map(effect => ({
        id: effect.id, castId: effect.castId, kind: effect.kind, slot: effect.skillSlot,
        targetId: effect.targetId, age: effect.age, rendered3d: spellDrawn.has(effect.id),
        hitIndex: (effect as SpriteEffect & { hitIndex?: number }).hitIndex,
      })));
      // Read-only diagnostics for the Blender effect assets; no input can trigger a cast here.
      const vfxDrawn = new Set(heroes3d.vfxDrawnIds());
      canvas.dataset.heroVfx = JSON.stringify({
        models: Object.fromEntries(heroes3d.vfxModelStatuses().map(model => [model.heroId, model.status])),
        effects: effects.filter(effect => getHeroVfx(effect.sourceHeroId)).map(effect => ({
          id: effect.id, heroId: effect.sourceHeroId, kind: effect.kind, slot: effect.skillSlot,
          age: +effect.age.toFixed(3), rendered3d: vfxDrawn.has(effect.id),
        })),
      });
      // Bars remain readable above all bodies and spell layers.
      units.forEach(unit => drawUnit(unit, 0, true));
      ctx.restore();
      canvas.dataset.heroes3d = JSON.stringify({ status: heroes3d.status(), drawn: drawn3D,
        models: Object.fromEntries(heroes3d.modelStatuses().map(model => [model.heroId, model.status])),
        elapsedMs: sim?.getElapsedMs() ?? 0, paused: p.isPaused, speed: p.battleSpeed,
        units: units.map(unit => ({ id: unit.instanceId, heroId: unit.heroId, alive: unit.isAlive,
          x: unit.x, y: unit.y, facing: unit.facing, clip: actors.get(unit.instanceId)?.clip, age: actors.get(unit.instanceId)?.age,
          cast: unit.currentCast && { slot: unit.currentCast.skillSlot, id: unit.currentCast.castId,
            ageMs: (sim?.getElapsedMs() ?? 0) + accumulator - unit.currentCast.startedAtMs },
          controls: unit.statusEffects.filter(status => status.remainingMs > 0).map(status => status.type) })) });
      const belindaIds = new Set(units.filter(unit => unit.heroId === 'belinda').map(unit => unit.instanceId));
      canvas.dataset.belinda3d = JSON.stringify({ status: heroes3d.modelStatus('belinda'), drawn: drawn3D.filter(id => belindaIds.has(id)),
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
    return () => { cancelAnimationFrame(frame); heroes3d.dispose(); ro.disconnect(); canvas.removeEventListener('pointerdown', tap); images.forEach(image => { image.onerror = null; }); };
  }, []);

  return <div className="relative h-full w-full overflow-hidden" data-testid="sprite-battle-view" data-battle-renderer="canvas2d-oathbound">
    <canvas ref={canvasRef} className="block h-full w-full touch-manipulation" aria-label="Chiến đấu Oathbound: anh hùng 3D thời gian thực với sprite dự phòng" />
    {props.showPerfOverlay && <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-[10px] text-amber-200">Oathbound · Anh hùng 3D</div>}
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
