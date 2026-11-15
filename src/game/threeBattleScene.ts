// PROTOTYPE - NOT FOR PRODUCTION
import * as THREE from 'three';
import { createBattlePortrait } from './battlePortrait';
import { getOathboundSprite } from './oathboundSprites';
import { createOathboundThreeSprite, type OathboundThreeSprite } from './oathboundThreeSprite';
import {
  BattleUnitRuntime,
  CampaignStageDefinition,
  FactionId,
  HeroClass,
} from './types';
import { HERO_ROSTER } from './heroes';

export type GraphicsPreset = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA' | 'AUTO';
export type ResolvedGraphicsQuality = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';
export type CameraBehaviorMode = 'standard' | 'focus' | 'ultimate' | 'victory';
export type ArenaEnvironmentId = 'enchanted_forest' | 'celestial_temple' | 'shadow_realm';
export type StageTheme = CampaignStageDefinition['theme'];

export type HeroAnimState10 =
  | 'Idle'
  | 'Move'
  | 'BasicAttack'
  | 'Skill'
  | 'Ultimate'
  | 'Hit'
  | 'Stun'
  | 'Knockback'
  | 'Victory'
  | 'Defeat';

export interface GraphicsPresetConfig {
  quality: ResolvedGraphicsQuality;
  maxDpr: number;
  shadowsEnabled: boolean;
  shadowMapSize: number;
  propDensity: number;
  maxParticles: number;
  dynamicLights: boolean;
  ambientParticles: number;
}

export const GRAPHICS_PRESET_CONFIGS: Record<ResolvedGraphicsQuality, GraphicsPresetConfig> = {
  LOW: {
    quality: 'LOW',
    maxDpr: 1.0,
    shadowsEnabled: false,
    shadowMapSize: 0,
    propDensity: 0.45,
    maxParticles: 36,
    dynamicLights: false,
    ambientParticles: 16,
  },
  MEDIUM: {
    quality: 'MEDIUM',
    maxDpr: 1.25,
    shadowsEnabled: true,
    shadowMapSize: 512,
    propDensity: 0.75,
    maxParticles: 72,
    dynamicLights: false,
    ambientParticles: 32,
  },
  HIGH: {
    quality: 'HIGH',
    maxDpr: 1.65,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    propDensity: 1.0,
    maxParticles: 128,
    dynamicLights: true,
    ambientParticles: 56,
  },
  ULTRA: {
    quality: 'ULTRA',
    maxDpr: 2.0,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    propDensity: 1.25,
    maxParticles: 180,
    dynamicLights: true,
    ambientParticles: 84,
  },
};

export interface BattlePerformanceMetrics {
  avgFps: number;
  low1PctFps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  activeRigs: number;
  activeVfx: number;
  activePreset: ResolvedGraphicsQuality;
  isSoftwareGl: boolean;
  arenaId: ArenaEnvironmentId;
  cameraMode: CameraBehaviorMode;
}

export function resolveArenaEnvironment(
  theme: StageTheme,
  override?: 'auto' | ArenaEnvironmentId
): ArenaEnvironmentId {
  if (override && override !== 'auto') return override;
  switch (theme) {
    case 'sylvan':
      return 'enchanted_forest';
    case 'sanctuary':
    case 'tempest':
      return 'celestial_temple';
    case 'catacombs':
    case 'obsidian':
    default:
      return 'shadow_realm';
  }
}

/**
 * Converts BattleSimulation 2.5D coordinates (x: 0..1000, y: 0..540)
 * into 3D Portrait Arena world coordinates (x: -4.2..+4.2, z: -2.8..+2.8).
 * Allies on left (-X) and lower/closer (+Z slight offset), Enemies on right (+X)
 * so all 10 heroes are clearly separated inside the 9:16 portrait frame.
 */
export function simToWorldPosition(simX: number, simY: number): { x: number; z: number } {
  const normX = (simX - 500) / 380; // approx -1.05 to +1.05
  const normY = (simY - 290) / 150; // approx -1.0 to +1.0
  return {
    x: normX * 3.15,
    z: normY * 2.25 - normX * 0.45,
  };
}

export interface HeroVisualArchetype {
  heroId: string;
  primaryHex: number;
  secondaryHex: number;
  trimHex: number;
  glowHex: number;
  skinHex: number;
  scale: number;
  shoulderScale: number;
  headgear:
    | 'solar_crown'
    | 'horned_helm'
    | 'void_crown'
    | 'vampire_collar'
    | 'hood'
    | 'halo'
    | 'flame_crown'
    | 'antlers'
    | 'serpent_crown'
    | 'ice_crown'
    | 'knight_helm';
  weaponStyle:
    | 'sword_shield'
    | 'hammer_shield'
    | 'axe_shield'
    | 'greatsword'
    | 'twin_daggers'
    | 'bow'
    | 'storm_scepter'
    | 'pyre_staff'
    | 'sun_staff'
    | 'nature_staff'
    | 'serpent_staff'
    | 'frost_blade';
  hasCape: boolean;
  hasWings: boolean;
  wingStyle?: 'feathered' | 'void' | 'valkyrie';
}

export const CORE_HERO_ARCHETYPES: Record<string, HeroVisualArchetype> = {
  celestial_guardian: {
    heroId: 'celestial_guardian',
    primaryHex: 0xf59e0b,
    secondaryHex: 0x1e3a8a,
    trimHex: 0xfef08a,
    glowHex: 0x38bdf8,
    skinHex: 0xfde68a,
    scale: 1.08,
    shoulderScale: 1.25,
    headgear: 'solar_crown',
    weaponStyle: 'sword_shield',
    hasCape: true,
    hasWings: true,
    wingStyle: 'feathered',
  },
  iron_bastion: {
    heroId: 'iron_bastion',
    primaryHex: 0xea580c,
    secondaryHex: 0x3f2e21,
    trimHex: 0xfdba74,
    glowHex: 0xf97316,
    skinHex: 0xd97706,
    scale: 1.14,
    shoulderScale: 1.38,
    headgear: 'horned_helm',
    weaponStyle: 'hammer_shield',
    hasCape: false,
    hasWings: false,
  },
  abyssal_warden: {
    heroId: 'abyssal_warden',
    primaryHex: 0x4f46e5,
    secondaryHex: 0x1e1b4b,
    trimHex: 0xa5b4fc,
    glowHex: 0x818cf8,
    skinHex: 0xc7d2fe,
    scale: 1.12,
    shoulderScale: 1.32,
    headgear: 'void_crown',
    weaponStyle: 'axe_shield',
    hasCape: true,
    hasWings: false,
  },
  crimson_revenant: {
    heroId: 'crimson_revenant',
    primaryHex: 0xdc2626,
    secondaryHex: 0x270909,
    trimHex: 0xfca5a5,
    glowHex: 0xef4444,
    skinHex: 0xfecdd3,
    scale: 1.04,
    shoulderScale: 1.15,
    headgear: 'vampire_collar',
    weaponStyle: 'greatsword',
    hasCape: true,
    hasWings: true,
    wingStyle: 'void',
  },
  shadow_sovereign: {
    heroId: 'shadow_sovereign',
    primaryHex: 0x9333ea,
    secondaryHex: 0x0f172a,
    trimHex: 0xd8b4fe,
    glowHex: 0xc084fc,
    skinHex: 0xe2e8f0,
    scale: 0.96,
    shoulderScale: 0.95,
    headgear: 'hood',
    weaponStyle: 'twin_daggers',
    hasCape: true,
    hasWings: false,
  },
  emerald_valkyrie: {
    heroId: 'emerald_valkyrie',
    primaryHex: 0x10b981,
    secondaryHex: 0x064e3b,
    trimHex: 0xa7f3d0,
    glowHex: 0x34d399,
    skinHex: 0xfde68a,
    scale: 0.98,
    shoulderScale: 0.96,
    headgear: 'hood',
    weaponStyle: 'bow',
    hasCape: true,
    hasWings: true,
    wingStyle: 'valkyrie',
  },
  storm_empress: {
    heroId: 'storm_empress',
    primaryHex: 0x0284c7,
    secondaryHex: 0x1e293b,
    trimHex: 0xfde047,
    glowHex: 0x38bdf8,
    skinHex: 0xfef3c7,
    scale: 1.0,
    shoulderScale: 1.02,
    headgear: 'halo',
    weaponStyle: 'storm_scepter',
    hasCape: true,
    hasWings: false,
  },
  pyre_archon: {
    heroId: 'pyre_archon',
    primaryHex: 0xf97316,
    secondaryHex: 0x451a03,
    trimHex: 0xfde047,
    glowHex: 0xfb923c,
    skinHex: 0xfed7aa,
    scale: 1.02,
    shoulderScale: 1.08,
    headgear: 'flame_crown',
    weaponStyle: 'pyre_staff',
    hasCape: true,
    hasWings: false,
  },
  dawn_oracle: {
    heroId: 'dawn_oracle',
    primaryHex: 0xfacc15,
    secondaryHex: 0x1e3a8a,
    trimHex: 0xffffff,
    glowHex: 0xfef08a,
    skinHex: 0xfef3c7,
    scale: 1.0,
    shoulderScale: 0.98,
    headgear: 'halo',
    weaponStyle: 'sun_staff',
    hasCape: true,
    hasWings: true,
    wingStyle: 'feathered',
  },
  grove_mystic: {
    heroId: 'grove_mystic',
    primaryHex: 0x22c55e,
    secondaryHex: 0x14532d,
    trimHex: 0xbef264,
    glowHex: 0x4ade80,
    skinHex: 0xd9f99d,
    scale: 0.98,
    shoulderScale: 0.96,
    headgear: 'antlers',
    weaponStyle: 'nature_staff',
    hasCape: true,
    hasWings: false,
  },
  arcane_serpent: {
    heroId: 'arcane_serpent',
    primaryHex: 0xdb2777,
    secondaryHex: 0x3b0764,
    trimHex: 0xfbcfe8,
    glowHex: 0xf472b6,
    skinHex: 0xf5d0fe,
    scale: 1.03,
    shoulderScale: 1.05,
    headgear: 'serpent_crown',
    weaponStyle: 'serpent_staff',
    hasCape: true,
    hasWings: false,
  },
  frost_arbiter: {
    heroId: 'frost_arbiter',
    primaryHex: 0x06b6d4,
    secondaryHex: 0x0f172a,
    trimHex: 0xcffafe,
    glowHex: 0x22d3ee,
    skinHex: 0xe0f2fe,
    scale: 1.06,
    shoulderScale: 1.18,
    headgear: 'ice_crown',
    weaponStyle: 'frost_blade',
    hasCape: true,
    hasWings: false,
  },
};

function parseHexColor(cssHex: string | undefined, fallback: number): number {
  if (!cssHex) return fallback;
  const cleaned = cssHex.replace('#', '').trim();
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function getHeroVisualArchetype(
  heroId: string,
  heroClass: HeroClass,
  faction: FactionId,
  isRanged: boolean,
  isBoss?: boolean
): HeroVisualArchetype {
  const baseHeroId = heroId.replace(/^(ally|enemy)_\d+_/, '');
  if (CORE_HERO_ARCHETYPES[baseHeroId]) {
    const core = CORE_HERO_ARCHETYPES[baseHeroId];
    return isBoss ? { ...core, scale: core.scale * 1.22 } : core;
  }

  const rosterEntry = HERO_ROSTER.find((h) => h.id === baseHeroId);
  const primaryHex = parseHexColor(rosterEntry?.visual.primaryColor, 0x3b82f6);
  const secondaryHex = parseHexColor(rosterEntry?.visual.secondaryColor, 0x1e293b);
  const glowHex = parseHexColor(rosterEntry?.visual.accentColor, 0x60a5fa);

  const headgear: HeroVisualArchetype['headgear'] =
    faction === 'Solar Order'
      ? 'solar_crown'
      : faction === 'Shadow Court'
      ? 'void_crown'
      : heroClass === 'Tank'
      ? 'horned_helm'
      : heroClass === 'Support'
      ? 'halo'
      : isRanged
      ? 'hood'
      : heroClass === 'Mage'
      ? 'flame_crown'
      : 'knight_helm';

  const weaponStyle: HeroVisualArchetype['weaponStyle'] =
    heroClass === 'Tank'
      ? 'sword_shield'
      : heroClass === 'Support'
      ? 'sun_staff'
      : heroClass === 'Mage'
      ? 'storm_scepter'
      : heroClass === 'Crowd Controller'
      ? 'serpent_staff'
      : isRanged
      ? 'bow'
      : 'greatsword';

  const baseScale = heroClass === 'Tank' ? 1.1 : 1.0;

  return {
    heroId: baseHeroId,
    primaryHex,
    secondaryHex,
    trimHex: 0xfde047,
    glowHex,
    skinHex: 0xfde68a,
    scale: isBoss ? baseScale * 1.22 : baseScale,
    shoulderScale: heroClass === 'Tank' ? 1.28 : 1.04,
    headgear,
    weaponStyle,
    hasCape: true,
    hasWings: rosterEntry?.visual.capeStyle === 'wings',
    wingStyle: faction === 'Shadow Court' ? 'void' : 'feathered',
  };
}

export interface ThreeHeroRig {
  unitId: string;
  heroId: string;
  archetype: HeroVisualArchetype;
  root: THREE.Group;
  plinthRing: THREE.Mesh;
  telegraphRing: THREE.Mesh;
  shieldDome: THREE.Mesh;
  stunRing: THREE.Group;
  animState: HeroAnimState10;
  animTimer: number;
  hitFlashTimer: number;
  knockbackOffset: number;
  prevSimX: number;
  prevSimY: number;
  oathboundSprite?: OathboundThreeSprite;
  portrait?: ReturnType<typeof createBattlePortrait>;
}

export function buildThreeHeroRig(
  unit: BattleUnitRuntime,
  shadowsEnabled: boolean
): ThreeHeroRig {
  const archetype = getHeroVisualArchetype(
    unit.heroId,
    unit.heroClass,
    unit.faction,
    unit.isRanged,
    unit.isBoss
  );
  const isEnemy = unit.team === 'enemy';

  const root = new THREE.Group();
  root.name = `hero_rig_${unit.instanceId}`;

  // 1. Ground Contact Shadow + Octagonal Faction Plinth
  const shadowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.62 * archetype.scale, 20),
    new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    })
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.01;
  root.add(shadowDisc);

  const teamColor = isEnemy ? 0xef4444 : 0xfbbf24;
  const plinthRing = new THREE.Mesh(
    new THREE.RingGeometry(0.48 * archetype.scale, 0.62 * archetype.scale, 8),
    new THREE.MeshBasicMaterial({
      color: teamColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    })
  );
  plinthRing.rotation.x = -Math.PI / 2;
  plinthRing.position.y = 0.025;
  root.add(plinthRing);

  // 2. Skill Anticipation / Telegraph Ring
  const telegraphRing = new THREE.Mesh(
    new THREE.RingGeometry(0.64 * archetype.scale, 0.86 * archetype.scale, 24),
    new THREE.MeshBasicMaterial({
      color: isEnemy ? 0xf43f5e : 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  telegraphRing.rotation.x = -Math.PI / 2;
  telegraphRing.position.y = 0.035;
  root.add(telegraphRing);

  // 8. Sleek Runic Shield Barrier Ring & Crowd Control Stun Ring
  const shieldDome = new THREE.Mesh(
    new THREE.TorusGeometry(0.58 * archetype.scale, 0.04, 8, 24),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  shieldDome.rotation.x = Math.PI / 2;
  shieldDome.position.y = 0.62 * archetype.scale;
  shieldDome.visible = false;
  root.add(shieldDome);

  const stunRing = new THREE.Group();
  stunRing.position.y = 1.78 * archetype.scale;
  stunRing.visible = false;
  for (let i = 0; i < 3; i++) {
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.075, 0),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 })
    );
    const angle = (i / 3) * Math.PI * 2;
    star.position.set(Math.cos(angle) * 0.3, 0, Math.sin(angle) * 0.3);
    stunRing.add(star);
  }
  root.add(stunRing);

  root.traverse((obj) => {
    if (
      obj instanceof THREE.Mesh &&
      obj !== shadowDisc &&
      obj !== plinthRing &&
      obj !== telegraphRing &&
      obj !== shieldDome
    ) {
      obj.castShadow = shadowsEnabled;
      obj.receiveShadow = shadowsEnabled;
    }
  });

  root.rotation.y = isEnemy ? Math.PI : 0;

  const worldPos = simToWorldPosition(unit.x, unit.y);
  root.position.set(worldPos.x, 0, worldPos.z);
  const hero = HERO_ROSTER.find(h => h.id === unit.heroId)!;
  const spriteSpec = getOathboundSprite(hero.unitId);
  // Both the authored atlas and its loading/error fallback are flat sprites.
  const portrait = createBattlePortrait(hero);
  root.add(portrait.object);
  const oathboundSprite = spriteSpec ? createOathboundThreeSprite(spriteSpec, portrait.object) : undefined;
  if (oathboundSprite) root.add(oathboundSprite.object);

  return {
    portrait,
    oathboundSprite,
    unitId: unit.instanceId,
    heroId: unit.heroId,
    archetype,
    root,
    plinthRing,
    telegraphRing,
    shieldDome,
    stunRing,
    animState: 'Idle',
    animTimer: 0,
    hitFlashTimer: 0,
    knockbackOffset: 0,
    prevSimX: unit.x,
    prevSimY: unit.y,
  };
}

/** Releases per-rig textures, geometry and materials when a battle is replaced. */
export function disposeThreeHeroRig(rig: ThreeHeroRig): void {
  rig.oathboundSprite?.dispose();
  rig.portrait?.dispose();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  rig.root.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      geometries.add(obj.geometry);
      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(mat);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  rig.root.removeFromParent();
}

/** Updates flat character animation, movement and battle-status effects. */
export function updateThreeHeroAnimation(
  rig: ThreeHeroRig,
  unit: BattleUnitRuntime,
  dt: number,
  elapsedSec: number,
  battleOutcome: 'running' | 'victory' | 'defeat'
): void {
  const worldPos = simToWorldPosition(unit.x, unit.y);
  const dx = unit.x - rig.prevSimX;
  const dy = unit.y - rig.prevSimY;
  const moveDist = Math.hypot(dx, dy);
  rig.prevSimX = unit.x;
  rig.prevSimY = unit.y;

  // Orient facing dynamically
  rig.root.rotation.y = unit.facing === -1 ? Math.PI : 0;

  // Decay knockback impulse
  rig.knockbackOffset = THREE.MathUtils.lerp(rig.knockbackOffset, 0, Math.min(1, dt * 10));

  rig.root.position.x = THREE.MathUtils.lerp(
    rig.root.position.x,
    worldPos.x + rig.knockbackOffset,
    Math.min(1, dt * 16)
  );
  rig.root.position.z = THREE.MathUtils.lerp(
    rig.root.position.z,
    worldPos.z,
    Math.min(1, dt * 16)
  );

  const hasStun = unit.statusEffects.some((s) => s.type === 'stun');
  const hasPetrify = unit.statusEffects.some((s) => s.type === 'petrify');
  const hasCc = hasStun || hasPetrify;

  if (!unit.isAlive || unit.hp <= 0) {
    rig.animState = 'Defeat';
  } else if (battleOutcome === 'victory' || battleOutcome === 'defeat') {
    const unitWon =
      (battleOutcome === 'victory' && unit.team === 'ally') ||
      (battleOutcome === 'defeat' && unit.team === 'enemy');
    rig.animState = unitWon ? 'Victory' : 'Defeat';
  } else if (Math.abs(rig.knockbackOffset) > 0.12) {
    rig.animState = 'Knockback';
  } else if (hasCc) {
    rig.animState = 'Stun';
  } else if (rig.animTimer > 0) {
    rig.animTimer = Math.max(0, rig.animTimer - dt);
  } else if (moveDist > 0.25 || unit.lastActionType === 'move') {
    rig.animState = 'Move';
  } else {
    rig.animState = 'Idle';
  }

  // Hit flash timing also drives the flat portrait and atlas tint.
  rig.hitFlashTimer = Math.max(0, rig.hitFlashTimer - dt);

  // Shield Barrier Ring visibility
  const shieldRatio = unit.shield > 0 ? Math.min(1, unit.shield / (unit.maxHp * 0.25)) : 0;
  rig.shieldDome.visible = shieldRatio > 0 && unit.isAlive;
  if (rig.shieldDome.visible) {
    const domeMat = rig.shieldDome.material as THREE.MeshBasicMaterial;
    domeMat.opacity = 0.55 + Math.sin(elapsedSec * 6) * 0.15;
    rig.shieldDome.position.y = (0.58 + Math.sin(elapsedSec * 4) * 0.08) * rig.archetype.scale;
  }

  // Stun stars overhead
  rig.stunRing.visible = Boolean(hasCc && unit.isAlive);
  if (rig.stunRing.visible) {
    rig.stunRing.rotation.y = elapsedSec * 4.5;
  }

  // Telegraph ring pulse when energy >= 95 or casting skill/ultimate
  const teleMat = rig.telegraphRing.material as THREE.MeshBasicMaterial;
  if (
    unit.isAlive &&
    (rig.animState === 'Skill' || rig.animState === 'Ultimate' || unit.energy >= 95)
  ) {
    teleMat.opacity = 0.45 + Math.sin(elapsedSec * 9) * 0.2;
    rig.telegraphRing.scale.setScalar(1 + Math.sin(elapsedSec * 7) * 0.08);
  } else {
    teleMat.opacity = 0;
  }

  // Flat characters have no skeleton; only the defeat ground marker changes here.
  if (rig.animState === 'Defeat') rig.plinthRing.visible = false;

  if (rig.portrait) {
    const material = rig.portrait.object.material as THREE.SpriteMaterial;
    material.color.setHex(hasPetrify ? 0x94a3b8 : rig.hitFlashTimer > 0 ? 0xffb2ad : 0xffffff);
    rig.portrait.object.scale.x = unit.facing < 0 ? -1.5 : 1.5;
    if (!rig.oathboundSprite) {
      material.opacity = unit.isAlive ? 1 : 0.3;
    }
  }

  rig.oathboundSprite?.update(
    rig.animState === 'Defeat' ? 'death' :
    rig.animState === 'Move' ? 'run' :
    rig.animState === 'BasicAttack' ? 'attack' :
    rig.animState === 'Skill' || rig.animState === 'Ultimate' ? 'skill' :
    rig.animState === 'Hit' || rig.animState === 'Knockback' ? 'hit' : 'idle',
    hasCc && unit.isAlive ? 0 : dt, unit.facing, rig.hitFlashTimer > 0, hasPetrify,
  );

}

// ============================================================================
// 3 ORIGINAL 3D BATTLE ENVIRONMENTS
// ============================================================================

export interface ArenaEnvironmentBundle {
  id: ArenaEnvironmentId;
  group: THREE.Group;
  fogColor: number;
  ambientColor: number;
  keyLightColor: number;
  rimLightColor: number;
  ambientParticles: THREE.Points;
  update: (elapsedSec: number) => void;
  dispose: () => void;
}

function createProceduralGroundTexture(
  baseHex: string,
  veinHex: string,
  sigilHex: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = veinHex;
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const pos = i * 32;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, 256);
      ctx.moveTo(0, pos);
      ctx.lineTo(256, pos);
      ctx.stroke();
    }

    ctx.strokeStyle = sigilHex;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(128, 128, 86, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(128, 128, 54, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

export function buildArenaEnvironment(
  arenaId: ArenaEnvironmentId,
  preset: GraphicsPresetConfig
): ArenaEnvironmentBundle {
  const group = new THREE.Group();
  group.name = `arena_${arenaId}`;

  const disposables: Array<{ dispose: () => void }> = [];
  const animatedNodes: Array<{ mesh: THREE.Object3D; speed: number; baseY: number }> = [];

  const palette =
    arenaId === 'enchanted_forest'
      ? {
          fogColor: 0x0c1f17,
          ambientColor: 0x86efac,
          keyLightColor: 0xfef08a,
          rimLightColor: 0x34d399,
          floorBase: '#132a1e',
          floorVein: '#1e3f2d',
          floorSigil: '#34d399',
          borderHex: 0x14532d,
          pillarHex: 0x334155,
          crystalHex: 0x4ade80,
        }
      : arenaId === 'celestial_temple'
      ? {
          fogColor: 0x0f172a,
          ambientColor: 0xbae6fd,
          keyLightColor: 0xfef9c3,
          rimLightColor: 0x38bdf8,
          floorBase: '#1e293b',
          floorVein: '#334155',
          floorSigil: '#fbbf24',
          borderHex: 0xb45309,
          pillarHex: 0xe2e8f0,
          crystalHex: 0x38bdf8,
        }
      : {
          fogColor: 0x11071f,
          ambientColor: 0xc084fc,
          keyLightColor: 0xf472b6,
          rimLightColor: 0x818cf8,
          floorBase: '#160b24',
          floorVein: '#2e1065',
          floorSigil: '#c084fc',
          borderHex: 0x4c1d95,
          pillarHex: 0x1e1b4b,
          crystalHex: 0xe879f9,
        };

  const groundTex = createProceduralGroundTexture(
    palette.floorBase,
    palette.floorVein,
    palette.floorSigil
  );
  disposables.push(groundTex);

  const floorGeo = new THREE.CylinderGeometry(8.2, 9.0, 0.6, 32);
  const floorMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    roughness: 0.72,
    metalness: 0.18,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.y = -0.3;
  floorMesh.receiveShadow = preset.shadowsEnabled;
  group.add(floorMesh);
  disposables.push(floorGeo, floorMat);

  const rimGeo = new THREE.TorusGeometry(8.15, 0.22, 10, 48);
  const rimMat = new THREE.MeshStandardMaterial({
    color: palette.borderHex,
    roughness: 0.35,
    metalness: 0.72,
  });
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.rotation.x = Math.PI / 2;
  rimMesh.position.y = 0.02;
  group.add(rimMesh);
  disposables.push(rimGeo, rimMat);

  const centerRingGeo = new THREE.RingGeometry(1.3, 1.52, 32);
  const centerRingMat = new THREE.MeshBasicMaterial({
    color: palette.crystalHex,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  });
  const centerRing = new THREE.Mesh(centerRingGeo, centerRingMat);
  centerRing.rotation.x = -Math.PI / 2;
  centerRing.position.y = 0.015;
  group.add(centerRing);
  disposables.push(centerRingGeo, centerRingMat);

  const propCount = Math.max(4, Math.round(10 * preset.propDensity));
  const pillarGeo =
    arenaId === 'enchanted_forest'
      ? new THREE.ConeGeometry(0.62, 3.1, 7)
      : arenaId === 'celestial_temple'
      ? new THREE.CylinderGeometry(0.36, 0.44, 3.3, 12)
      : new THREE.OctahedronGeometry(0.8, 0);
  const pillarMat = new THREE.MeshStandardMaterial({
    color: palette.pillarHex,
    roughness: 0.55,
    metalness: 0.35,
  });
  const instancedPillars = new THREE.InstancedMesh(pillarGeo, pillarMat, propCount);
  instancedPillars.castShadow = preset.shadowsEnabled;
  instancedPillars.receiveShadow = preset.shadowsEnabled;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < propCount; i++) {
    const angle = Math.PI * 1.08 + (i / Math.max(1, propCount - 1)) * Math.PI * 0.84;
    const radius = 7.1 + (i % 2) * 0.85;
    dummy.position.set(
      Math.cos(angle) * radius,
      arenaId === 'shadow_realm' ? 1.05 : 1.45,
      Math.sin(angle) * radius - 0.8
    );
    dummy.rotation.y = -angle;
    const s = 0.85 + (i % 3) * 0.16;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    instancedPillars.setMatrixAt(i, dummy.matrix);
  }
  instancedPillars.instanceMatrix.needsUpdate = true;
  group.add(instancedPillars);
  disposables.push(pillarGeo, pillarMat);

  const crystalGeo = new THREE.OctahedronGeometry(0.4, 0);
  const crystalMat = new THREE.MeshStandardMaterial({
    color: palette.crystalHex,
    emissive: palette.crystalHex,
    emissiveIntensity: 1.8,
    roughness: 0.15,
  });
  disposables.push(crystalGeo, crystalMat);

  for (let i = -2; i <= 2; i++) {
    const crystal = new THREE.Mesh(crystalGeo, crystalMat);
    const baseY = 2.3 + Math.abs(i) * 0.25;
    crystal.position.set(i * 2.25, baseY, -5.5 - Math.abs(i) * 0.35);
    group.add(crystal);
    animatedNodes.push({ mesh: crystal, speed: 1.8 + i * 0.2, baseY });
  }

  const pCount = preset.ambientParticles;
  const pPositions = new Float32Array(pCount * 3);
  for (let i = 0; i < pCount; i++) {
    pPositions[i * 3] = (Math.random() - 0.5) * 12;
    pPositions[i * 3 + 1] = 0.3 + Math.random() * 4.0;
    pPositions[i * 3 + 2] = (Math.random() - 0.5) * 8.5;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
  const pMat = new THREE.PointsMaterial({
    color: palette.crystalHex,
    size: 0.12,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ambientParticles = new THREE.Points(pGeo, pMat);
  group.add(ambientParticles);
  disposables.push(pGeo, pMat);

  return {
    id: arenaId,
    group,
    fogColor: palette.fogColor,
    ambientColor: palette.ambientColor,
    keyLightColor: palette.keyLightColor,
    rimLightColor: palette.rimLightColor,
    ambientParticles,
    update: (elapsedSec: number) => {
      for (const node of animatedNodes) {
        node.mesh.position.y = node.baseY + Math.sin(elapsedSec * node.speed) * 0.22;
        node.mesh.rotation.y = elapsedSec * 0.9;
      }
      ambientParticles.rotation.y = elapsedSec * 0.05;
    },
    dispose: () => {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}

// ============================================================================
// 5-PHASE POOLED 3D VFX SYSTEM (ANTICIPATION, CAST, TRAVEL, IMPACT, AFTERMATH)
// ============================================================================

export type VfxPhaseType =
  | 'anticipation'
  | 'cast'
  | 'travel_projectile'
  | 'impact_ring'
  | 'slash_arc'
  | 'aftermath_zone';

interface PooledVfxItem {
  active: boolean;
  phase: VfxPhaseType;
  mesh: THREE.Mesh;
  age: number;
  duration: number;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  baseScale: number;
}

export class ThreeVfxPool {
  public readonly group = new THREE.Group();
  private readonly pool: PooledVfxItem[] = [];
  private readonly sharedGeos: THREE.BufferGeometry[] = [];
  private maxBudget: number;

  constructor(maxBudget: number = 96) {
    this.maxBudget = maxBudget;
    const ringGeo = new THREE.RingGeometry(0.35, 0.52, 24);
    const sphereGeo = new THREE.OctahedronGeometry(0.18, 1);
    const slashGeo = new THREE.TorusGeometry(0.62, 0.055, 6, 16, Math.PI * 0.85);
    const zoneGeo = new THREE.CircleGeometry(0.92, 24);
    this.sharedGeos.push(ringGeo, sphereGeo, slashGeo, zoneGeo);

    for (let i = 0; i < 64; i++) {
      const phase: VfxPhaseType =
        i < 12
          ? 'anticipation'
          : i < 24
          ? 'cast'
          : i < 40
          ? 'travel_projectile'
          : i < 52
          ? 'impact_ring'
          : i < 58
          ? 'slash_arc'
          : 'aftermath_zone';

      const geo =
        phase === 'travel_projectile'
          ? sphereGeo
          : phase === 'slash_arc'
          ? slashGeo
          : phase === 'aftermath_zone'
          ? zoneGeo
          : ringGeo;

      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.group.add(mesh);

      this.pool.push({
        active: false,
        phase,
        mesh,
        age: 0,
        duration: 0.4,
        startPos: new THREE.Vector3(),
        endPos: new THREE.Vector3(),
        baseScale: 1,
      });
    }
  }

  public setBudget(maxBudget: number): void {
    this.maxBudget = maxBudget;
  }

  /** Clears battle-local particles without disposing the reusable pool. */
  public clear(): void {
    for (const item of this.pool) {
      item.active = false;
      item.age = 0;
      item.mesh.visible = false;
      (item.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }
  }

  public getActiveCount(): number {
    let count = 0;
    for (const item of this.pool) {
      if (item.active) count++;
    }
    return count;
  }

  private acquire(phase: VfxPhaseType): PooledVfxItem | null {
    if (this.getActiveCount() >= this.maxBudget) return null;
    for (const item of this.pool) {
      if (!item.active && item.phase === phase) {
        item.active = true;
        item.age = 0;
        item.mesh.visible = true;
        return item;
      }
    }
    return null;
  }

  public spawnCastBurst(
    pos: { x: number; z: number },
    colorHex: number,
    scale: number = 1.2
  ): void {
    const ant = this.acquire('anticipation');
    if (ant) {
      ant.duration = 0.32;
      ant.baseScale = scale;
      ant.mesh.position.set(pos.x, 0.05, pos.z);
      ant.mesh.rotation.set(-Math.PI / 2, 0, 0);
      (ant.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    }

    const cast = this.acquire('cast');
    if (cast) {
      cast.duration = 0.45;
      cast.baseScale = scale * 1.35;
      cast.mesh.position.set(pos.x, 0.08, pos.z);
      cast.mesh.rotation.set(-Math.PI / 2, 0, 0);
      (cast.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    }
  }

  public spawnProjectile(
    from: { x: number; z: number },
    to: { x: number; z: number },
    colorHex: number,
    duration: number = 0.26
  ): void {
    const item = this.acquire('travel_projectile');
    if (!item) return;
    item.duration = duration;
    item.baseScale = 1.0;
    item.startPos.set(from.x, 0.9, from.z);
    item.endPos.set(to.x, 0.9, to.z);
    item.mesh.position.copy(item.startPos);
    (item.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
  }

  public spawnSlashArc(
    pos: { x: number; z: number },
    colorHex: number,
    isEnemy: boolean
  ): void {
    const item = this.acquire('slash_arc');
    if (!item) return;
    item.duration = 0.24;
    item.baseScale = 1.08;
    item.mesh.position.set(pos.x + (isEnemy ? -0.4 : 0.4), 0.9, pos.z);
    item.mesh.rotation.set(0.35, isEnemy ? Math.PI : 0, 0.25);
    (item.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
  }

  public spawnImpact(
    pos: { x: number; z: number },
    colorHex: number,
    scale: number = 1.1,
    withAftermath: boolean = false
  ): void {
    const imp = this.acquire('impact_ring');
    if (imp) {
      imp.duration = 0.36;
      imp.baseScale = scale;
      imp.mesh.position.set(pos.x, 0.12, pos.z);
      imp.mesh.rotation.set(-Math.PI / 2, 0, 0);
      (imp.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    }

    if (withAftermath) {
      const zone = this.acquire('aftermath_zone');
      if (zone) {
        zone.duration = 1.15;
        zone.baseScale = scale * 1.25;
        zone.mesh.position.set(pos.x, 0.02, pos.z);
        zone.mesh.rotation.set(-Math.PI / 2, 0, 0);
        (zone.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
      }
    }
  }

  public update(dt: number): void {
    for (const item of this.pool) {
      if (!item.active) continue;
      item.age += dt;
      const p = Math.min(1, item.age / item.duration);
      const mat = item.mesh.material as THREE.MeshBasicMaterial;

      if (p >= 1) {
        item.active = false;
        item.mesh.visible = false;
        mat.opacity = 0;
        continue;
      }

      switch (item.phase) {
        case 'anticipation': {
          const s = item.baseScale * (1.3 - p * 0.4);
          item.mesh.scale.setScalar(s);
          mat.opacity = Math.sin(p * Math.PI) * 0.75;
          break;
        }
        case 'cast':
        case 'impact_ring': {
          const s = item.baseScale * (0.4 + p * 1.8);
          item.mesh.scale.setScalar(s);
          mat.opacity = (1 - p) * 0.85;
          break;
        }
        case 'travel_projectile': {
          item.mesh.position.lerpVectors(item.startPos, item.endPos, p);
          item.mesh.position.y += Math.sin(p * Math.PI) * 0.42;
          item.mesh.rotation.y += dt * 12;
          item.mesh.scale.setScalar(item.baseScale * (1.1 - p * 0.25));
          mat.opacity = 0.95;
          break;
        }
        case 'slash_arc': {
          item.mesh.rotation.z += dt * 14;
          item.mesh.scale.setScalar(item.baseScale * (0.75 + p * 0.65));
          mat.opacity = (1 - p) * 0.9;
          break;
        }
        case 'aftermath_zone': {
          item.mesh.scale.setScalar(item.baseScale);
          mat.opacity = (1 - p) * 0.28;
          break;
        }
      }
    }
  }

  public dispose(): void {
    for (const geo of this.sharedGeos) {
      geo.dispose();
    }
    for (const item of this.pool) {
      (item.mesh.material as THREE.Material).dispose();
    }
  }
}
