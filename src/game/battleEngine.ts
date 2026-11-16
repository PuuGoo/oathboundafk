// PROTOTYPE - NOT FOR PRODUCTION
import {
  BattleUnitRuntime,
  BattleSnapshot,
  CombatEvent,
  HeroSkillSpec,
  OwnedHeroState,
  TeamFormationSlots,
  CampaignEnemySlot,
  CrowdControlType,
  BuffType,
} from './types';
import { isUnitAvailable, isUnitIsolated } from './types';
import { getCombatTimeline } from './skillTimelines';
import type { CombatCastState } from './types';
import {
  getHeroById,
  computeHeroStats,
  computeFactionAura,
  getHeroRepoFaction,
  getFactionDamageMultiplier,
} from './heroes';

/**
 * Deterministic Mulberry32 Seeded PRNG (returns 0..1)
 */
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Virtual 2.5D Battlefield Coordinates (1000 x 540 arena)
 * Frontline: Position 1 (Top Front), Position 2 (Bottom Front)
 * Backline: Position 3 (Top Back), Position 4 (Mid Back), Position 5 (Bottom Back)
 */
export const ALLY_SLOT_COORDS: Record<1 | 2 | 3 | 4 | 5, { x: number; y: number }> = {
  1: { x: 295, y: 215 }, // Frontline 1
  2: { x: 295, y: 365 }, // Frontline 2
  3: { x: 155, y: 165 }, // Backline 3
  4: { x: 135, y: 290 }, // Backline 4
  5: { x: 155, y: 415 }, // Backline 5
};

export const ENEMY_SLOT_COORDS: Record<1 | 2 | 3 | 4 | 5, { x: number; y: number }> = {
  1: { x: 705, y: 215 }, // Frontline 1
  2: { x: 705, y: 365 }, // Frontline 2
  3: { x: 845, y: 165 }, // Backline 3
  4: { x: 865, y: 290 }, // Backline 4
  5: { x: 845, y: 415 }, // Backline 5
};

export interface BattleSimulationConfig {
  allyFormation: TeamFormationSlots;
  ownedHeroes: Record<string, OwnedHeroState>;
  enemies: CampaignEnemySlot[];
  seed?: number;
  autoUltimate?: boolean;
  maxDurationMs?: number;
}

export class BattleSimulation {
  private units: BattleUnitRuntime[] = [];
  private events: CombatEvent[] = [];
  private nextEventId = 1;
  private castPresentation?: { sourceId: string; castId: number; skillSlot: CombatEvent['skillSlot']; skill: HeroSkillSpec;
    skillId?: string; hitIndex?: number; targetIds?: string[]; damageTargetIds?: string[]; damageShare?: number };
  private pendingCasts = new Map<string, { state: CombatCastState; skill: HeroSkillSpec; isUltimate: boolean; released: boolean; nextHit: number }>();
  private focusWindows = new Map<string, { targetId: string; untilMs: number; castId: number;
    rule: NonNullable<HeroSkillSpec['focusReward']>; awards: Map<string, { count: number; nextAtMs: number }> }>();
  private controlResistanceReadyAt = new Map<string, number>();
  private stepRemainderMs = 0;
  private elapsedMs = 0;
  private paused = false;
  private maxDurationMs: number;
  private status: 'running' | 'victory' | 'defeat' = 'running';
  private rng: () => number;
  public autoUltimate: boolean;

  constructor(config: BattleSimulationConfig) {
    this.rng = createSeededRng(config.seed ?? 1337);
    this.autoUltimate = config.autoUltimate ?? true;
    this.maxDurationMs = config.maxDurationMs ?? 90000;
    this.initUnits(config);
    // Report existing passive wards once; do not apply another shield or consume RNG.
    for (const unit of this.units) {
      if (unit.shield <= 0) continue;
      const def = getHeroById(unit.heroId);
      this.pushEvent({ type: 'shield', sourceId: unit.instanceId, sourceName: unit.name,
        targetId: unit.instanceId, targetName: unit.name, value: unit.shield,
        skillName: def.skills.passive.name, skillSlot: 'passive',
        vfxColor: def.visual.accentColor, vfxShape: 'nova' });
    }
  }

  private initUnits(config: BattleSimulationConfig): void {
    const allyAura = computeFactionAura(config.allyFormation);
    const enemyAura = computeFactionAura(config.enemies.map((e) => e.heroId));

    // 1. Spawn Allies from 5-slot formation
    config.allyFormation.forEach((heroId, idx) => {
      if (!heroId) return;
      const pos = (idx + 1) as 1 | 2 | 3 | 4 | 5;
      const def = getHeroById(heroId);
      const owned = config.ownedHeroes[heroId] ?? {
        heroId,
        level: 1,
        stars: 1,
        copies: 0,
        equipment: { weapon: 1, armor: 1, relic: 1 },
      };
      const stats = computeHeroStats(def, owned);
      const coord = ALLY_SLOT_COORDS[pos];
      const maxHp = Math.round(stats.hp * (1 + allyAura.hpBonusPct));
      const baseAttack = Math.round(stats.attack * (1 + allyAura.atkBonusPct));
      const baseDefense = Math.round(stats.defense * (1 + allyAura.defBonusPct));
      const critChance = Math.min(0.85, stats.critChance + allyAura.critBonusPct);
      const openingShield = Math.round(maxHp * def.skills.passive.openingShieldPct);

      this.units.push({
        instanceId: `ally_${pos}_${heroId}`,
        heroId: def.id,
        name: def.name,
        title: def.title,
        team: 'ally',
        position: pos,
        heroClass: def.heroClass,
        faction: def.faction,
        level: owned.level,
        stars: owned.stars,
        isBoss: false,
        isRanged: def.isRanged,
        attackRangePx: def.attackRangePx,
        moveSpeedPxPerSec: def.moveSpeedPxPerSec,
        x: coord.x,
        y: coord.y,
        homeX: coord.x,
        homeY: coord.y,
        facing: 1,
        maxHp,
        hp: maxHp,
        shield: openingShield,
        energy: stats.startingEnergy,
        baseAttack,
        baseDefense,
        baseAttackSpeed: stats.attackSpeed,
        critChance,
        lifestealPct: def.skills.passive.bonusLifestealPct,
        basicAttackCooldownMs: 400 + pos * 90,
        activeSkillCooldownMs: Math.round(def.skills.active.cooldownMs * 0.45),
        activeSkillMaxCooldownMs: def.skills.active.cooldownMs,
        actionAnimTimerMs: 0,
        lastActionType: 'idle',
        targetInstanceId: null,
        statusEffects: [],
        isAlive: true,
        totalDamageDealt: 0,
        totalHealingDone: 0,
        totalDamageTaken: 0,
      });
    });

    // 2. Spawn Enemies
    config.enemies.forEach((slot) => {
      const def = getHeroById(slot.heroId);
      const bossMult = slot.isBoss ? 1.25 : 1.0;
      const stats = computeHeroStats(def, {
        heroId: def.id,
        level: slot.level,
        stars: slot.stars,
        copies: 0,
        equipment: {
          weapon: Math.max(1, Math.floor(slot.level / 3)),
          armor: Math.max(1, Math.floor(slot.level / 3)),
          relic: Math.max(1, Math.floor(slot.level / 4)),
        },
      });
      const coord = ENEMY_SLOT_COORDS[slot.position];
      const maxHp = Math.round(stats.hp * bossMult * (1 + enemyAura.hpBonusPct));
      const openingShield = Math.round(maxHp * def.skills.passive.openingShieldPct);

      this.units.push({
        instanceId: `enemy_${slot.position}_${def.id}`,
        heroId: def.id,
        name: def.name,
        title: def.title,
        team: 'enemy',
        position: slot.position,
        heroClass: def.heroClass,
        faction: def.faction,
        level: slot.level,
        stars: slot.stars,
        isBoss: Boolean(slot.isBoss),
        isRanged: def.isRanged,
        attackRangePx: def.attackRangePx,
        moveSpeedPxPerSec: def.moveSpeedPxPerSec,
        x: coord.x,
        y: coord.y,
        homeX: coord.x,
        homeY: coord.y,
        facing: -1,
        maxHp,
        hp: maxHp,
        shield: openingShield,
        energy: stats.startingEnergy,
        baseAttack: Math.round(
          stats.attack * (slot.isBoss ? 1.15 : 1.0) * (1 + enemyAura.atkBonusPct)
        ),
        baseDefense: Math.round(stats.defense * (1 + enemyAura.defBonusPct)),
        baseAttackSpeed: stats.attackSpeed,
        critChance: Math.min(0.85, stats.critChance + enemyAura.critBonusPct),
        lifestealPct: def.skills.passive.bonusLifestealPct,
        basicAttackCooldownMs: 600 + slot.position * 110,
        activeSkillCooldownMs: Math.round(def.skills.active.cooldownMs * 0.55),
        activeSkillMaxCooldownMs: def.skills.active.cooldownMs,
        actionAnimTimerMs: 0,
        lastActionType: 'idle',
        targetInstanceId: null,
        statusEffects: [],
        isAlive: true,
        totalDamageDealt: 0,
        totalHealingDone: 0,
        totalDamageTaken: 0,
      });
    });
  }

  public getSnapshot(): BattleSnapshot {
    return {
      status: this.status,
      elapsedMs: this.elapsedMs,
      maxDurationMs: this.maxDurationMs,
      units: this.units.map((u) => ({
        ...u,
        ...(u.currentCast ? { currentCast: { ...u.currentCast, targetIds: [...u.currentCast.targetIds],
          ...(u.currentCast.damageTargetIds ? { damageTargetIds: [...u.currentCast.damageTargetIds] } : {}),
          ...(u.currentCast.chargePath ? { chargePath: { ...u.currentCast.chargePath,
            from: { ...u.currentCast.chargePath.from }, to: { ...u.currentCast.chargePath.to } } } : {}),
          timeline: { ...u.currentCast.timeline, hits: u.currentCast.timeline.hits.map(hit => ({ ...hit })) } } } : {}),
        statusEffects: u.statusEffects.map((s) => ({ ...s })),
      })),
      recentEvents: [...this.events],
    };
  }

  public consumeEvents(): CombatEvent[] {
    const out = [...this.events];
    this.events = [];
    return out;
  }

  public getUnits(): BattleUnitRuntime[] {
    return this.units;
  }

  public getStatus(): 'running' | 'victory' | 'defeat' {
    return this.status;
  }

  /** Pause simulation time and all manual/automatic casts without queuing input. */
  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  public getElapsedMs(): number {
    return this.elapsedMs;
  }

  private pushEvent(event: Omit<CombatEvent, 'id' | 'timestampMs'>): number {
    const id = this.nextEventId++;
    const slot = event.type === 'ultimate_cast' ? 'ultimate' : event.type === 'active_skill' ? 'active' :
      event.type === 'basic_attack' ? 'basic' : undefined;
    const context = this.castPresentation;
    const origin = context && context.sourceId === event.sourceId && event.type !== 'death' ? {
      castId: context.castId, skillSlot: context.skillSlot,
      skillId: context.skillId, hitIndex: context.hitIndex,
      skillName: context.skill.name, vfxColor: context.skill.vfxColor, vfxShape: context.skill.vfxShape,
    } : {};
    const caster = slot && this.units.find(unit => unit.instanceId === event.sourceId);
    const timeline = caster && slot ? getCombatTimeline(caster.heroId, slot) : undefined;
    this.events.push({ ...origin, ...event, ...(slot ? { skillSlot: slot, castId: id,
      ...(timeline ? { skillId: timeline.skillId, timeline } : {}) } : {}),
      id, timestampMs: this.elapsedMs });
    return id;
  }

  public isIncapacitated(unit: BattleUnitRuntime): boolean {
    return unit.statusEffects.some(
      (s) => s.type === 'stun' || s.type === 'petrify' || s.type === 'isolation'
    );
  }

  public isSilenced(unit: BattleUnitRuntime): boolean {
    return unit.statusEffects.some((s) => s.type === 'silence');
  }

  private getEffectiveAttack(unit: BattleUnitRuntime): number {
    let mult = 1;
    for (const s of unit.statusEffects) {
      if (s.type === 'atk_up') mult += s.magnitude;
    }
    return Math.round(unit.baseAttack * mult);
  }

  private getEffectiveDefense(unit: BattleUnitRuntime): number {
    let mult = 1;
    for (const s of unit.statusEffects) {
      if (s.type === 'def_up') mult += s.magnitude;
    }
    return Math.max(10, Math.round(unit.baseDefense * mult));
  }

  private getEffectiveSpeedMultiplier(unit: BattleUnitRuntime): number {
    let mult = 1;
    for (const s of unit.statusEffects) {
      if (s.type === 'spd_up') mult += s.magnitude;
      if (s.type === 'slow') mult *= 0.6;
    }
    return Math.max(0.35, mult);
  }

  /**
   * Manually or automatically trigger a hero's Ultimate ability.
   * Always requires full energy. The legacy second argument is ignored;
   * test fixtures must explicitly prepare energy instead of bypassing combat rules.
   */
  public triggerUltimate(unitOrHeroId: string, _legacyForce: boolean = false): boolean {
    if (this.status !== 'running' || this.paused) return false;
    const unit = this.units.find(
      (u) =>
        u.isAlive &&
        (u.instanceId === unitOrHeroId ||
          (u.team === 'ally' && u.heroId === unitOrHeroId))
    );
    if (!unit || unit.currentCast) return false;
    if (!Number.isFinite(unit.energy) || unit.energy < 100) return false;
    if (this.isIncapacitated(unit) || this.isSilenced(unit)) return false;

    const def = getHeroById(unit.heroId);
    unit.energy = 0;
    unit.actionAnimTimerMs = 650;
    unit.lastActionType = 'ultimate';

    const ultimateTargets = this.resolveTargetsForSkill(unit, def.skills.ultimate);
    const castId = this.pushEvent({
      type: 'ultimate_cast',
      targetId: ultimateTargets[0]?.instanceId,
      targetName: ultimateTargets[0]?.name,
      sourceId: unit.instanceId,
      sourceName: unit.name,
      skillName: def.skills.ultimate.name,
      vfxColor: def.skills.ultimate.vfxColor,
      vfxShape: def.skills.ultimate.vfxShape,
    });

    this.executeSkillSpec(unit, def.skills.ultimate, true, castId, 'ultimate');
    this.checkOutcome();
    return true;
  }

  /**
   * Fixed-timestep simulation step (e.g. dtMs = 50ms)
   */
  public step(dtMs: number): void {
    if (this.status !== 'running' || this.paused || !Number.isFinite(dtMs) || dtMs <= 0) return;

    this.stepRemainderMs += dtMs;
    while (this.stepRemainderMs >= 50 && this.status === 'running') {
      this.stepRemainderMs -= 50;
      this.stepFixed(50);
    }
  }

  private stepFixed(clampedDt: number): void {
    this.elapsedMs += clampedDt;

    // 1. Check battle timeout
    if (this.elapsedMs >= this.maxDurationMs) {
      this.status = 'defeat';
      return;
    }

    // Expire marks before contact resolution at this timestamp, regardless of unit iteration order.
    for (const unit of this.units) unit.statusEffects = unit.statusEffects.filter(effect =>
      effect.type !== 'mark' || effect.expiresAtMs === undefined || effect.expiresAtMs > this.elapsedMs);
    this.advanceIsolation();
    this.advanceCasts();
    if (this.status !== 'running') return;

    // 2. Update each living unit
    for (const unit of this.units) {
      if (!unit.isAlive) continue;

      // Tick status effects
      unit.statusEffects = unit.statusEffects
        .map((eff) => eff.type === 'isolation' ? eff : ({ ...eff, remainingMs: eff.type === 'mark' && eff.expiresAtMs !== undefined
          ? Math.max(0, eff.expiresAtMs - this.elapsedMs) : eff.remainingMs - clampedDt }))
        .filter((eff) => eff.remainingMs > 0);

      if (unit.actionAnimTimerMs > 0) {
        unit.actionAnimTimerMs = Math.max(0, unit.actionAnimTimerMs - clampedDt);
      }

      // Captivity advances only its absolute lifetime; other timers and passive energy freeze.
      if (isUnitIsolated(unit)) continue;

      // Passive continuous energy trickle
      unit.energy = Math.min(100, unit.energy + (clampedDt / 1000) * 4.5);

      // If Stunned or Petrified, unit cannot move, attack, or cast skills
      if (this.isIncapacitated(unit)) {
        continue;
      }

      const speedMult = this.getEffectiveSpeedMultiplier(unit);
      unit.basicAttackCooldownMs = Math.max(
        0,
        unit.basicAttackCooldownMs - clampedDt * speedMult
      );
      unit.activeSkillCooldownMs = Math.max(
        0,
        unit.activeSkillCooldownMs - clampedDt * speedMult
      );

      if (unit.currentCast) continue;

      // Auto-Ultimate check (allies if autoUltimate=true, enemies always when energy >= 100)
      if (
        unit.energy >= 100 &&
        !this.isSilenced(unit) &&
        (unit.team === 'enemy' || this.autoUltimate)
      ) {
        this.triggerUltimate(unit.instanceId, false);
        if (this.status !== 'running') return;
        continue;
      }

      // Select target
      const def = getHeroById(unit.heroId);
      const preferredTarget = this.selectTarget(unit, def.skills.basic.targetType);
      if (!preferredTarget) {
        continue;
      }
      unit.targetInstanceId = preferredTarget.instanceId;
      unit.facing = preferredTarget.x >= unit.x ? 1 : -1;

      const dx = preferredTarget.x - unit.x;
      const dy = preferredTarget.y - unit.y;
      const dist = Math.hypot(dx, dy);

      // A ready authored charge can start outside basic melee range; other skills retain range gating.
      const chargeReady = unit.activeSkillCooldownMs <= 0 && !this.isSilenced(unit) && def.skills.active.charge &&
        dist <= def.skills.active.charge.activationRangePx;
      // Move toward target if outside attackRangePx
      if (dist > unit.attackRangePx && !chargeReady) {
        const moveStep =
          unit.moveSpeedPxPerSec * speedMult * (clampedDt / 1000);
        const ratio = Math.min(1, moveStep / dist);
        unit.x = Math.max(70, Math.min(930, unit.x + dx * ratio));
        unit.y = Math.max(120, Math.min(460, unit.y + dy * ratio));
        if (unit.actionAnimTimerMs <= 0) {
          unit.lastActionType = 'move';
        }
        continue;
      }

      // In range: Check Active Skill first (if not silenced)
      if (unit.activeSkillCooldownMs <= 0 && !this.isSilenced(unit)) {
        unit.activeSkillCooldownMs = unit.activeSkillMaxCooldownMs;
        unit.basicAttackCooldownMs = Math.round(900 / unit.baseAttackSpeed);
        unit.actionAnimTimerMs = 480;
        unit.lastActionType = 'skill';
        unit.energy = Math.min(100, unit.energy + 22);

        // Shadow Sovereign teleports behind backline target on Active Skill
        if (unit.heroId === 'shadow_sovereign') {
          const backTarget =
            this.selectTarget(unit, 'backline_enemy') || preferredTarget;
          unit.x = Math.max(
            90,
            Math.min(910, backTarget.x + (unit.team === 'ally' ? -55 : 55))
          );
          unit.y = backTarget.y;
        }

        const castId = this.pushEvent({
          type: 'active_skill',
          sourceId: unit.instanceId,
          sourceName: unit.name,
          targetId: preferredTarget.instanceId,
          targetName: preferredTarget.name,
          skillName: def.skills.active.name,
          vfxColor: def.skills.active.vfxColor,
          vfxShape: def.skills.active.vfxShape,
        });

        this.executeSkillSpec(unit, def.skills.active, false, castId, 'active');
        this.checkOutcome();
        if (this.status !== 'running') return;
        continue;
      }

      // Otherwise execute Basic Attack when ready
      if (unit.basicAttackCooldownMs <= 0) {
        unit.basicAttackCooldownMs = Math.round(1000 / unit.baseAttackSpeed);
        unit.actionAnimTimerMs = 340;
        unit.lastActionType = 'basic';
        unit.energy = Math.min(100, unit.energy + 16);

        const castId = this.pushEvent({
          type: 'basic_attack',
          sourceId: unit.instanceId,
          sourceName: unit.name,
          targetId: preferredTarget.instanceId,
          targetName: preferredTarget.name,
          skillName: def.skills.basic.name,
          vfxColor: def.skills.basic.vfxColor,
          vfxShape: def.skills.basic.vfxShape,
        });

        this.executeSkillSpec(unit, def.skills.basic, false, castId, 'basic');
        this.checkOutcome();
        if (this.status !== 'running') return;
      }
    }

    this.checkOutcome();
  }

  /** Expire captivity before contacts, and release immediately when its living source is gone. */
  private advanceIsolation(): void {
    for (const target of this.units) {
      for (const status of target.statusEffects.filter(effect => effect.type === 'isolation')) {
        const source = this.units.find(unit => unit.instanceId === status.sourceUnitId);
        if (!target.isAlive || !source?.isAlive || (status.expiresAtMs ?? 0) <= this.elapsedMs) {
          target.statusEffects = target.statusEffects.filter(effect => effect !== status);
          if (target.isAlive) {
            target.lastActionType = 'idle';
            this.pushEvent({ type: 'isolation_end', sourceId: status.sourceUnitId,
              sourceName: source?.name ?? '', targetId: target.instanceId, targetName: target.name,
              castId: status.castId, skillSlot: 'active', ccType: 'isolation' });
          }
        } else status.remainingMs = status.expiresAtMs! - this.elapsedMs;
      }
    }
  }

  private selectTarget(
    caster: BattleUnitRuntime,
    targetType: HeroSkillSpec['targetType']
  ): BattleUnitRuntime | null {
    const opponents = this.units.filter(
      (u) => isUnitAvailable(u) && u.team !== caster.team
    );
    const allies = this.units.filter(
      (u) => isUnitAvailable(u) && u.team === caster.team
    );

    if (targetType === 'self') return caster;
    if (targetType === 'lowest_hp_ally') {
      if (allies.length === 0) return null;
      return [...allies].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    }

    if (opponents.length === 0) return null;

    if (targetType === 'current_target') {
      const marked = opponents.find(target => target.statusEffects.some(status => status.type === 'mark' && status.remainingMs > 0 &&
        this.units.some(source => source.instanceId === status.sourceUnitId && source.isAlive && source.team === caster.team)));
      if (marked) return marked;
    }

    if (targetType === 'backline_enemy') {
      const backline = opponents.filter((o) => o.position >= 3);
      const pool = backline.length > 0 ? backline : opponents;
      return [...pool].sort((a, b) => a.hp - b.hp)[0];
    }

    // Default Frontline priority (Positions 1 & 2 first, then nearest)
    const frontline = opponents.filter((o) => o.position <= 2);
    const pool = frontline.length > 0 ? frontline : opponents;

    return [...pool].sort((a, b) => {
      const distA = Math.hypot(a.x - caster.x, a.y - caster.y);
      const distB = Math.hypot(b.x - caster.x, b.y - caster.y);
      return distA - distB;
    })[0];
  }

  private resolveTargetsForSkill(
    caster: BattleUnitRuntime,
    skill: HeroSkillSpec
  ): BattleUnitRuntime[] {
    if (!isUnitAvailable(caster)) return [];
    if (skill.ccType === 'isolation') {
      const eligible = this.units.filter(unit => isUnitAvailable(unit) && unit.team !== caster.team && !unit.isBoss);
      const preferred = this.selectTarget(caster, 'current_target');
      return preferred && eligible.includes(preferred) ? [preferred] : eligible.slice(0, 1);
    }
    const opponents = this.units.filter(
      (u) => isUnitAvailable(u) && u.team !== caster.team
    );
    const allies = this.units.filter(
      (u) => isUnitAvailable(u) && u.team === caster.team
    );

    switch (skill.targetType) {
      case 'self':
        return [caster];
      case 'all_allies':
        return allies;
      case 'lowest_hp_ally': {
        const lowest = this.selectTarget(caster, 'lowest_hp_ally');
        return lowest ? [lowest] : [];
      }
      case 'all_enemies':
        return opponents;
      case 'frontline_enemies': {
        const front = opponents.filter((o) => o.position <= 2);
        return front.length > 0 ? front : opponents;
      }
      case 'backline_enemy': {
        const back = this.selectTarget(caster, 'backline_enemy');
        return back ? [back] : [];
      }
      case 'current_target':
      default: {
        const cur = this.selectTarget(caster, 'current_target');
        return cur ? [cur] : [];
      }
    }
  }

  /** Mixed skills use an independent offensive scope; an empty frontline stays empty. */
  private resolveSupportDamageTargets(caster: BattleUnitRuntime, skill: HeroSkillSpec): BattleUnitRuntime[] {
    const scope = skill.damageTargetType ?? 'all_enemies';
    return scope === 'frontline_enemies'
      ? this.units.filter(unit => isUnitAvailable(unit) && unit.team !== caster.team && unit.position <= 2)
      : this.resolveTargetsForSkill(caster, { ...skill, targetType: scope });
  }

  private executeSkillSpec(
    caster: BattleUnitRuntime, skill: HeroSkillSpec, isUltimate: boolean,
    castId: number, skillSlot: CombatEvent['skillSlot']
  ): void {
    const timeline = skillSlot && skillSlot !== 'passive' ? getCombatTimeline(caster.heroId, skillSlot) : undefined;
    if (timeline && skillSlot && skillSlot !== 'passive') {
      const mixed = skill.damageMultiplier > 0 && ['all_allies', 'lowest_hp_ally', 'self'].includes(skill.targetType);
      const state: CombatCastState = { castId, skillId: timeline.skillId, startedAtMs: this.elapsedMs,
        skillSlot, timeline, targetIds: this.resolveTargetsForSkill(caster, skill).map(unit => unit.instanceId),
        ...(mixed ? { damageTargetIds: this.resolveSupportDamageTargets(caster, skill).map(unit => unit.instanceId) } : {}) };
      if (skill.charge) {
        const target = this.units.find(unit => state.targetIds.includes(unit.instanceId));
        if (target) {
          const dx = target.x - caster.x, dy = target.y - caster.y, distance = Math.hypot(dx, dy);
          const travel = Math.min(skill.charge.maxDistancePx, Math.max(0, distance - skill.charge.stopDistancePx));
          const ratio = distance > 0 ? travel / distance : 0;
          state.chargePath = { from: { x: caster.x, y: caster.y },
            to: { x: Math.max(70, Math.min(930, caster.x + dx * ratio)), y: Math.max(120, Math.min(460, caster.y + dy * ratio)) },
            contactRangePx: skill.charge.contactRangePx };
        }
      }
      caster.currentCast = state;
      caster.actionAnimTimerMs = timeline.durationMs;
      this.pendingCasts.set(caster.instanceId, { state, skill, isUltimate, released: false, nextHit: 0 });
      return;
    }
    this.resolveCastHit(caster, skill, isUltimate, castId, skillSlot);
  }

  private resolveCastHit(caster: BattleUnitRuntime, skill: HeroSkillSpec, isUltimate: boolean,
    castId: number, skillSlot: CombatEvent['skillSlot'], state?: CombatCastState, hitIndex?: number): void {
    const previous = this.castPresentation;
    this.castPresentation = { sourceId: caster.instanceId, castId, skillSlot, skill,
      skillId: state?.skillId, hitIndex, targetIds: state?.chargePath
        ? state.targetIds.filter(id => this.units.some(unit => unit.instanceId === id && isUnitAvailable(unit) &&
          Math.hypot(unit.x - caster.x, unit.y - caster.y) <= state.chargePath!.contactRangePx))
        : state?.targetIds, damageTargetIds: state?.damageTargetIds,
      damageShare: hitIndex === undefined ? undefined : state?.timeline.hits[hitIndex]?.damageShare };
    try {
      this.executeSkillOutcomes(caster, skill, isUltimate);
    } finally {
      // Public CC calls and subsequent casts must never inherit stale presentation metadata.
      this.castPresentation = previous;
    }
  }

  private cancelCast(caster: BattleUnitRuntime, reason: NonNullable<CombatEvent['cancelReason']>): void {
    const pending = this.pendingCasts.get(caster.instanceId);
    if (!pending) return;
    const { state, skill } = pending;
    this.pendingCasts.delete(caster.instanceId);
    delete caster.currentCast;
    caster.actionAnimTimerMs = 0;
    if (caster.isAlive) caster.lastActionType = 'idle';
    this.pushEvent({ type: 'cast_cancelled', sourceId: caster.instanceId, sourceName: caster.name,
      castId: state.castId, skillId: state.skillId, skillSlot: state.skillSlot, skillName: skill.name, cancelReason: reason });
  }

  private advanceCasts(): void {
    for (const [sourceId, pending] of this.pendingCasts) {
      const caster = this.units.find(unit => unit.instanceId === sourceId)!;
      const { state, skill, isUltimate } = pending;
      if (!caster.isAlive) { this.cancelCast(caster, 'death'); continue; }
      if (this.isIncapacitated(caster)) { this.cancelCast(caster, 'control'); continue; }
      const elapsed = this.elapsedMs - state.startedAtMs;
      const surviving = state.targetIds.some(id => this.units.some(unit => unit.instanceId === id && isUnitAvailable(unit)));
      if (!surviving && pending.nextHit < state.timeline.hits.length) { this.cancelCast(caster, 'target-lost'); continue; }
      if (state.chargePath && elapsed >= state.timeline.releaseMs) {
        const path = state.chargePath;
        const fraction = Math.min(1, (elapsed - state.timeline.releaseMs) /
          (state.timeline.hits[0].atMs - state.timeline.releaseMs));
        caster.x = path.from.x + (path.to.x - path.from.x) * fraction;
        caster.y = path.from.y + (path.to.y - path.from.y) * fraction;
      }
      if (!pending.released && elapsed >= state.timeline.releaseMs) {
        pending.released = true;
        this.pushEvent({ type: 'cast_release', sourceId, sourceName: caster.name, castId: state.castId,
          skillId: state.skillId, skillSlot: state.skillSlot, skillName: skill.name });
      }
      while (pending.nextHit < state.timeline.hits.length && elapsed >= state.timeline.hits[pending.nextHit].atMs) {
        const index = pending.nextHit++, marker = state.timeline.hits[index];
        // Split the existing total coefficient across explicit hits; do not multiply the whole skill per marker.
        const hitSkill = { ...skill, damageMultiplier: skill.damageMultiplier * marker.damageShare,
          ...(index > 0 ? { healMultiplier: undefined, shieldMultiplier: undefined, energyGrant: undefined,
            buffType: undefined, ccType: undefined } : {}) };
        this.resolveCastHit(caster, hitSkill, isUltimate, state.castId, state.skillSlot, state, index);
        this.checkOutcome();
        if (this.status !== 'running') return;
      }
      if (elapsed >= state.timeline.durationMs) {
        this.pendingCasts.delete(sourceId); delete caster.currentCast;
        caster.actionAnimTimerMs = 0; caster.lastActionType = 'idle';
        this.pushEvent({ type: 'cast_complete', sourceId, sourceName: caster.name,
          castId: state.castId, skillId: state.skillId, skillSlot: state.skillSlot, skillName: skill.name });
      }
    }
  }

  private executeSkillOutcomes(
    caster: BattleUnitRuntime,
    skill: HeroSkillSpec,
    isUltimate: boolean
  ): void {
    const effectiveAtk = this.getEffectiveAttack(caster);
    const lockedIds = this.castPresentation?.targetIds;
    const targets = lockedIds ? this.units.filter(unit => isUnitAvailable(unit) && lockedIds.includes(unit.instanceId)) :
      this.resolveTargetsForSkill(caster, skill);

    // 1. Handle Allied Support Effects (Heal, Shield, Energy, Buffs) on all_allies / lowest_hp_ally
    if (
      skill.targetType === 'all_allies' ||
      skill.targetType === 'lowest_hp_ally' ||
      skill.targetType === 'self'
    ) {
      for (const ally of targets) {
        if (!ally.isAlive) continue;

        if (skill.healMultiplier && skill.healMultiplier > 0) {
          const healAmount = Math.round(effectiveAtk * skill.healMultiplier);
          this.applyHeal(caster, ally, healAmount, skill.name);
        }

        if (skill.shieldMultiplier && skill.shieldMultiplier > 0) {
          const shieldAmount = Math.round(effectiveAtk * skill.shieldMultiplier);
          this.applyShield(caster, ally, shieldAmount, skill.name);
        }

        if (skill.energyGrant && skill.energyGrant > 0) {
          ally.energy = Math.min(100, ally.energy + skill.energyGrant);
        }

        if (skill.buffType && skill.buffDurationMs && skill.buffMagnitude) {
          this.applyBuff(
            caster,
            ally,
            skill.buffType,
            skill.buffDurationMs,
            skill.buffMagnitude
          );
        }
      }

      // Mixed support/offense uses its own explicit enemy scope, never the allied target list.
      if (skill.damageMultiplier > 0) {
        const lockedDamageIds = this.castPresentation?.damageTargetIds;
        const enemyTargets = lockedDamageIds
          ? this.units.filter(unit => isUnitAvailable(unit) && lockedDamageIds.includes(unit.instanceId))
          : this.resolveSupportDamageTargets(caster, skill);
        for (const enemy of enemyTargets) {
          this.applyDamageAndEffectsToEnemy(
            caster,
            enemy,
            effectiveAtk,
            skill,
            isUltimate
          );
        }
      }
      return;
    }

    // 2. Self-shield or self-buff on offensive skills (e.g., Iron Bastion ultimate, Crimson Revenant active)
    if (skill.shieldMultiplier && skill.shieldMultiplier > 0) {
      const shieldAmt = Math.round(effectiveAtk * skill.shieldMultiplier);
      this.applyShield(caster, caster, shieldAmt, skill.name);
    }
    if (skill.buffType && skill.buffDurationMs && skill.buffMagnitude) {
      this.applyBuff(
        caster,
        caster,
        skill.buffType,
        skill.buffDurationMs,
        skill.buffMagnitude
      );
    }

    // 3. Offensive Execution on Enemy Targets
    for (const target of targets) {
      if (!target.isAlive) continue;
      if (skill.purgePositiveEffects) {
        const positive = new Set(['shield', 'atk_up', 'def_up', 'spd_up', 'regen']);
        const removed = target.statusEffects.filter(status => positive.has(status.type));
        const removedShield = target.shield;
        target.statusEffects = target.statusEffects.filter(status => !positive.has(status.type));
        target.shield = 0;
        if (removed.length > 0 || removedShield > 0) this.pushEvent({ type: 'dispel',
          sourceId: caster.instanceId, sourceName: caster.name, targetId: target.instanceId,
          targetName: target.name, removedBuffCount: removed.length, removedShieldHp: removedShield });
      }
      if (skill.damageMultiplier > 0) this.applyDamageAndEffectsToEnemy(
        caster,
        target,
        effectiveAtk,
        skill,
        isUltimate
      );
      if (skill.ccType === 'isolation' && skill.ccDurationMs) this.applyCrowdControl(caster, target, 'isolation', skill.ccDurationMs);
      if (target.isAlive && skill.markDurationMs && target.team !== caster.team) {
        // One live mark per source: refreshing never grows an unbounded list of focus targets.
        for (const unit of this.units) unit.statusEffects = unit.statusEffects.filter(status =>
          status.type !== 'mark' || status.sourceUnitId !== caster.instanceId);
        target.statusEffects.push({ id: `mark_${this.nextEventId}`, type: 'mark', sourceUnitId: caster.instanceId,
          durationMs: skill.markDurationMs, remainingMs: skill.markDurationMs,
          expiresAtMs: this.elapsedMs + skill.markDurationMs, magnitude: 0 });
        this.pushEvent({ type: 'mark_applied', sourceId: caster.instanceId, sourceName: caster.name,
          targetId: target.instanceId, targetName: target.name, value: skill.markDurationMs });
        // Replacing an active mark ends the previous focus window rather than moving its budget.
        this.focusWindows.delete(caster.instanceId);
        if (skill.focusReward) this.focusWindows.set(caster.instanceId, { targetId: target.instanceId,
          untilMs: this.elapsedMs + skill.focusReward.durationMs, castId: this.castPresentation!.castId,
          rule: { ...skill.focusReward }, awards: new Map() });
      }
    }
  }

  /** Grants only actual bounded energy; support rewards cannot create attacks or cast recursively. */
  private grantMarkedEnergy(source: BattleUnitRuntime, target: BattleUnitRuntime, amount: number,
    skillSlot: 'ultimate' | 'passive', castId?: number): void {
    if (!isUnitAvailable(target)) return;
    const granted = Math.max(0, Math.min(amount, 100 - target.energy));
    target.energy += granted;
    this.pushEvent({ type: 'energy_gain', sourceId: source.instanceId, sourceName: source.name,
      targetId: target.instanceId, targetName: target.name, value: granted, requestedValue: amount,
      skillSlot, castId, skillId: undefined, hitIndex: undefined,
      skillName: getHeroById(source.heroId).skills[skillSlot].name });
  }

  /** One finite reward ledger per source/window; a basic hit must remove enemy HP. */
  private rewardFocusHit(attacker: BattleUnitRuntime, target: BattleUnitRuntime, hpDamage: number): void {
    if (hpDamage <= 0 || this.castPresentation?.skillSlot !== 'basic') return;
    for (const [sourceId, window] of this.focusWindows) {
      const source = this.units.find(unit => unit.instanceId === sourceId);
      const marked = target.statusEffects.some(status => status.type === 'mark' && status.sourceUnitId === sourceId && status.remainingMs > 0);
      if (!source?.isAlive || window.untilMs <= this.elapsedMs) { this.focusWindows.delete(sourceId); continue; }
      if (window.targetId !== target.instanceId || !marked || attacker.team !== source.team || target.team === source.team) continue;
      const ledger = window.awards.get(attacker.instanceId) ?? { count: 0, nextAtMs: 0 };
      if (ledger.count >= window.rule.maxPerAttacker || this.elapsedMs < ledger.nextAtMs) continue;
      window.awards.set(attacker.instanceId, { count: ledger.count + 1, nextAtMs: this.elapsedMs + window.rule.cooldownMs });
      this.grantMarkedEnergy(source, attacker, window.rule.energy, 'ultimate', window.castId);
    }
  }

  /** Death is processed once; only a living opposing marker rewards their living teammates. */
  private rewardMarkedDefeat(target: BattleUnitRuntime): void {
    const sourceIds = new Set(target.statusEffects.filter(status => status.type === 'mark' && status.remainingMs > 0).map(status => status.sourceUnitId));
    for (const sourceId of sourceIds) {
      const source = this.units.find(unit => unit.instanceId === sourceId && unit.isAlive && unit.team !== target.team);
      if (!source) continue;
      const amount = getHeroById(source.heroId).skills.passive.markedDefeatEnergy;
      if (!amount) continue;
      for (const ally of this.units.filter(unit => unit.isAlive && unit.team === source.team)) {
        this.grantMarkedEnergy(source, ally, amount, 'passive');
      }
      this.focusWindows.delete(sourceId);
    }
  }

  private applyDamageAndEffectsToEnemy(
    caster: BattleUnitRuntime,
    target: BattleUnitRuntime,
    effectiveAtk: number,
    skill: HeroSkillSpec,
    isUltimate: boolean
  ): void {
    const targetDef = this.getEffectiveDefense(target);
    const mitigation = 100 / (100 + targetDef);
    const isCrit = this.rng() < caster.critChance;
    const critMult = isCrit ? 1.75 : 1.0;

    // Authentic AFK Arena +25% Faction Advantage Counter Multiplier
    const casterRepoFac = getHeroRepoFaction(getHeroById(caster.heroId));
    const targetRepoFac = getHeroRepoFaction(getHeroById(target.heroId));
    const factionCounterMult = getFactionDamageMultiplier(casterRepoFac, targetRepoFac);

    // Petrified targets take +15% bonus damage
    const isPetrified = target.statusEffects.some((s) => s.type === 'petrify');
    const petrifyMult = isPetrified ? 1.15 : 1.0;

    // Small deterministic variance (0.95..1.05)
    const variance = 0.95 + this.rng() * 0.1;

    const rawDamage =
      effectiveAtk *
      skill.damageMultiplier *
      mitigation *
      critMult *
      factionCounterMult *
      petrifyMult *
      variance;
    // A split hit owns only its share of the existing skill floor, not a new full floor.
    const minimumDamage = Math.round(12 * (this.castPresentation?.damageShare ?? 1));
    const finalDamage = Math.max(minimumDamage, Math.round(rawDamage));

    // Report only effective HP loss as damage; shield loss and overkill remain explicit.
    const absorbed = Math.min(target.shield, finalDamage);
    const remainingDmg = finalDamage - absorbed;
    const hpDamage = Math.min(target.hp, remainingDmg);
    target.shield -= absorbed;
    target.hp -= hpDamage;
    target.totalDamageTaken += hpDamage;
    caster.totalDamageDealt += hpDamage;
    this.rewardFocusHit(caster, target, hpDamage);

    // Target gains energy from taking damage
    if (target.hp > 0) {
      target.energy = Math.min(100, target.energy + 8);
      if (target.actionAnimTimerMs <= 0) {
        target.lastActionType = 'hit';
        target.actionAnimTimerMs = 200;
      }
    }

    this.pushEvent({
      type: 'damage',
      sourceId: caster.instanceId,
      sourceName: caster.name,
      targetId: target.instanceId,
      targetName: target.name,
      skillName: skill.name,
      value: hpDamage,
      requestedValue: finalDamage,
      absorbed,
      overkill: remainingDmg - hpDamage,
      isCrit,
      vfxColor: skill.vfxColor,
      vfxShape: skill.vfxShape,
    });

    // Lifesteal (Passive + Skill Lifesteal)
    const totalLifesteal =
      caster.lifestealPct + (skill.lifestealPct ?? 0);
    // Lifesteal restores a fraction of actual HP removed, never shield loss or overkill.
    if (totalLifesteal > 0 && caster.isAlive && hpDamage > 0) {
      const healVal = Math.max(1, Math.round(hpDamage * totalLifesteal));
      this.applyHeal(caster, caster, healVal, 'Lifesteal');
    }

    // Apply Crowd Control if target survived
    if (target.hp > 0 && skill.ccType && skill.ccDurationMs) {
      this.applyCrowdControl(
        caster,
        target,
        skill.ccType,
        skill.ccDurationMs
      );
    }

    // Death Check
    if (target.hp <= 0 && target.isAlive) {
      target.hp = 0;
      target.shield = 0;
      target.isAlive = false;
      this.cancelCast(target, 'death');
      this.rewardMarkedDefeat(target);
      target.statusEffects = [];
      target.lastActionType = 'dead';
      caster.energy = Math.min(100, caster.energy + (isUltimate ? 20 : 35));

      this.pushEvent({
        type: 'death',
        sourceId: caster.instanceId,
        sourceName: caster.name,
        targetId: target.instanceId,
        targetName: target.name,
      });
      // Release living captives before outcome can finish the battle and stop future ticks.
      this.advanceIsolation();
    }
  }

  private applyHeal(
    source: BattleUnitRuntime,
    target: BattleUnitRuntime,
    amount: number,
    skillName: string
  ): void {
    if (!target.isAlive || amount <= 0) return;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    const actualHeal = target.hp - before;
    source.totalHealingDone += actualHeal;

    this.pushEvent({
      type: 'heal',
      sourceId: source.instanceId,
      sourceName: source.name,
      targetId: target.instanceId,
      targetName: target.name,
      skillName,
      value: actualHeal,
      requestedValue: amount,
      overheal: amount - actualHeal,
    });
  }

  private applyShield(
    source: BattleUnitRuntime,
    target: BattleUnitRuntime,
    amount: number,
    skillName: string
  ): void {
    if (!target.isAlive || amount <= 0) return;
    target.shield += amount;
    this.pushEvent({
      type: 'shield',
      sourceId: source.instanceId,
      sourceName: source.name,
      targetId: target.instanceId,
      targetName: target.name,
      skillName,
      value: amount,
    });
  }

  private applyBuff(
    source: BattleUnitRuntime,
    target: BattleUnitRuntime,
    buffType: BuffType,
    durationMs: number,
    magnitude: number
  ): void {
    if (!target.isAlive) return;
    target.statusEffects = target.statusEffects.filter(
      (s) => s.type !== buffType
    );
    target.statusEffects.push({
      id: `${buffType}_${this.nextEventId}`,
      type: buffType,
      durationMs,
      remainingMs: durationMs,
      magnitude,
      sourceUnitId: source.instanceId,
    });

    this.pushEvent({
      type: 'buff',
      sourceId: source.instanceId,
      sourceName: source.name,
      targetId: target.instanceId,
      targetName: target.name,
      buffType,
      value: Math.round(magnitude * 100),
    });
  }

  public applyCrowdControl(
    source: BattleUnitRuntime,
    target: BattleUnitRuntime,
    ccType: CrowdControlType,
    durationMs: number
  ): void {
    if (!isUnitAvailable(target) || !Number.isFinite(durationMs) || durationMs <= 0) return;
    const passive = getHeroById(target.heroId).skills.passive;
    const resistance = passive.controlResistance;
    if (resistance && source.team !== target.team && ['stun', 'silence', 'slow', 'petrify'].includes(ccType) &&
      this.elapsedMs >= (this.controlResistanceReadyAt.get(target.instanceId) ?? 0)) {
      const requestedDuration = durationMs;
      durationMs = Math.max(1, Math.round(durationMs * (1 - resistance.reductionPct)));
      this.controlResistanceReadyAt.set(target.instanceId, this.elapsedMs + resistance.cooldownMs);
      this.pushEvent({ type: 'control_resisted', sourceId: target.instanceId, sourceName: target.name,
        targetId: target.instanceId, targetName: target.name, skillSlot: 'passive', skillName: passive.name,
        castId: undefined, skillId: undefined, hitIndex: undefined, ccType,
        value: requestedDuration - durationMs, requestedValue: requestedDuration });
    }
    if (ccType === 'isolation') {
      if (target.isBoss || source.team === target.team || !isUnitAvailable(source) || !Number.isFinite(durationMs) || durationMs <= 0) return;
      // One captive per source; no refresh chains or damage fallback on ineligible targets.
      if (this.units.some(unit => unit.statusEffects.some(status => status.type === 'isolation' && status.sourceUnitId === source.instanceId))) return;
      this.cancelCast(target, 'control');
      target.statusEffects.push({ id: `isolation_${this.nextEventId}`, type: 'isolation', sourceUnitId: source.instanceId,
        durationMs, remainingMs: durationMs, expiresAtMs: this.elapsedMs + durationMs,
        castId: this.castPresentation?.sourceId === source.instanceId ? this.castPresentation.castId : undefined, magnitude: 0 });
      target.targetInstanceId = null; target.lastActionType = 'idle'; target.actionAnimTimerMs = 0;
      this.pushEvent({ type: 'crowd_control', sourceId: source.instanceId, sourceName: source.name,
        targetId: target.instanceId, targetName: target.name, ccType, value: durationMs });
      return;
    }
    if (ccType === 'stun' || ccType === 'petrify' || ccType === 'knockback') this.cancelCast(target, 'control');

    if (ccType === 'knockback') {
      const pushDir = target.team === 'enemy' ? 1 : -1;
      target.x = Math.max(80, Math.min(920, target.x + pushDir * 58));
      target.basicAttackCooldownMs += 350;
      this.pushEvent({
        type: 'knockback',
        sourceId: source.instanceId,
        sourceName: source.name,
        targetId: target.instanceId,
        targetName: target.name,
        ccType: 'knockback',
      });
    }

    target.statusEffects = target.statusEffects.filter(
      (s) => s.type !== ccType
    );
    target.statusEffects.push({
      id: `${ccType}_${this.nextEventId}`,
      type: ccType,
      durationMs,
      remainingMs: durationMs,
      magnitude: 1,
      sourceUnitId: source.instanceId,
    });

    this.pushEvent({
      type: 'crowd_control',
      sourceId: source.instanceId,
      sourceName: source.name,
      targetId: target.instanceId,
      targetName: target.name,
      ccType,
      value: durationMs,
    });
  }

  private checkOutcome(): void {
    if (this.status !== 'running') return;
    const alliesAlive = this.units.some(
      (u) => u.team === 'ally' && u.isAlive
    );
    const enemiesAlive = this.units.some(
      (u) => u.team === 'enemy' && u.isAlive
    );

    if (!enemiesAlive) {
      this.status = 'victory';
    } else if (!alliesAlive) {
      this.status = 'defeat';
    }
  }
}
