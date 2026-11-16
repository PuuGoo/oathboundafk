// PROTOTYPE - NOT FOR PRODUCTION
import profiles from './spriteSkillArt.json';
import type { SpriteEffect } from './spriteBattleEffects';
import { projectSpritePosition } from './spriteBattleRenderer';

/** Individual cosmetic direction; this never defines a hero's damage or skill rules. */
export interface SpriteSkillArt {
  motif: string; primary: string; accent: string; rays: number; angle: number;
  activeClip: string;
  ultimateClip: string;
  activeDelivery: 'thrust' | 'volley' | 'arc' | 'pillar' | 'orbit' | 'rift';
  ultimateDelivery: SpriteSkillArt['activeDelivery'];
  supportEmblem: 'crest' | 'sun' | 'coin' | 'petal' | 'crystal' | 'scripture' | 'flame' | 'eye';
}

/** Stable roster identity lookup; unknown heroes keep the existing generic renderer. */
export function getSpriteSkillArt(heroId: string): Readonly<SpriteSkillArt> | undefined {
  return (profiles as Record<string, SpriteSkillArt>)[heroId];
}

/** Draws a layered hero signature using real event endpoints, without advancing any clocks. */
export function drawSpriteSkillArt(ctx: CanvasRenderingContext2D, effect: SpriteEffect, width: number, height: number,
  reducedMotion: boolean, lowQuality: boolean): boolean {
  const art = getSpriteSkillArt(effect.sourceHeroId);
  if (!art || effect.basic || effect.kind === 'death' || effect.kind === 'control') return false;
  const scale = Math.min(width / 480, height / 680);
  const p = Math.max(0, Math.min(1, effect.age / effect.duration));
  const source = projectSpritePosition(effect.source.x, effect.source.y, width, height);
  const target = projectSpritePosition(effect.target.x, effect.target.y, width, height);
  const ax = source.x, ay = source.y - 53 * scale, bx = target.x, by = target.y - 48 * scale;
  const radius = (effect.kind === 'cast' ? effect.ultimate ? 62 : 43 : effect.kind === 'impact' ? 18 : 28) * scale;
  const fade = Math.min(1, p * 12) * Math.min(1, (1 - p) * 5);
  const travel = Math.max(0, Math.min(1, (p - 0.18) / 0.32));
  const bloom = Math.max(0, Math.min(1, (p - 0.46) / 0.24));
  const ring = (x: number, y: number, r: number) => {
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); ctx.stroke();
  };
  const path = (points: number[][], close = false, fill = false) => {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (close) ctx.closePath();
    if (fill) ctx.fill(); else ctx.stroke();
  };
  const diamond = (x: number, y: number, size: number) => path([[x, y - size], [x + size * 0.35, y], [x, y + size], [x - size * 0.35, y]], true, true);
  const weapon = (x: number, y: number, size: number, angle = Math.atan2(by - ay, bx - ax)) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.strokeStyle = art.primary; ctx.fillStyle = art.accent;
    path([[-size, 0], [size * 0.5, 0]]);
    if (art.motif === 'lance') {
      path([[size, 0], [size * 0.18, -size * 0.24], [size * 0.35, 0], [size * 0.18, size * 0.24]], true, true);
    } else if (art.motif === 'arrows') {
      path([[size, 0], [size * 0.25, -size * 0.28], [size * 0.42, 0], [size * 0.25, size * 0.28]], true, true);
      path([[-size * 0.7, 0], [-size, -size * 0.24], [-size * 0.45, 0], [-size, size * 0.24]]);
    } else if (art.motif === 'daggers') {
      path([[size, 0], [size * 0.12, -size * 0.2], [0, 0], [size * 0.12, size * 0.2]], true, true);
      path([[0, -size * 0.32], [0, size * 0.32]]);
      path([[-size * 0.55, 0], [0, 0]]);
    } else {
      ctx.beginPath(); ctx.ellipse(size * 0.45, 0, size * 0.42, size * 0.18, 0, 0, Math.PI * 2); ctx.fill();
      path([[-size * 1.35, 0], [-size * 0.85, 0]]);
    }
    ctx.restore();
  };
  const blade = (x: number, y: number, size: number) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(by - ay, bx - ax));
    ctx.fillStyle = art.primary;
    ctx.beginPath(); ctx.moveTo(-size * 0.45, -size * 0.85);
    ctx.quadraticCurveTo(size * 1.35, -size * 0.15, -size * 0.45, size * 0.85);
    ctx.quadraticCurveTo(size * 0.35, 0, -size * 0.45, -size * 0.85);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = art.accent; ctx.lineWidth = Math.max(1, scale * 1.5);
    ctx.beginPath(); ctx.moveTo(-size * 0.35, -size * 0.73);
    ctx.quadraticCurveTo(size * 1.05, 0, -size * 0.35, size * 0.73); ctx.stroke();
    ctx.restore();
  };
  const halo = (x: number, y: number, size: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.1, size));
    gradient.addColorStop(0, art.accent + '99'); gradient.addColorStop(0.35, art.primary + '40'); gradient.addColorStop(1, art.primary + '00');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, size), 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = art.primary;
  };
  const emblem = (x: number, y: number, r: number) => {
    ctx.save(); ctx.translate(x, y);
    switch (art.supportEmblem) {
      case 'crest':
        path([[-r * 0.6, -r * 0.6], [0, -r], [r * 0.6, -r * 0.6], [r * 0.5, r * 0.25], [0, r], [-r * 0.5, r * 0.25]], true); break;
      case 'sun':
        ring(0, 0, r * 0.4);
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          path([[Math.cos(a) * r * 0.65, Math.sin(a) * r * 0.65], [Math.cos(a) * r, Math.sin(a) * r]]);
        }
        break;
      case 'coin':
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.72, r, 0, 0, Math.PI * 2); ctx.stroke();
        path([[0, -r * 0.55], [0, r * 0.55]]); break;
      case 'petal':
        for (let i = 0; i < 5; i++) {
          const a = i * Math.PI * 2 / 5;
          ctx.beginPath(); ctx.ellipse(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.5, r * 0.2, a, 0, Math.PI * 2); ctx.stroke();
        }
        break;
      case 'crystal':
        path([[0, -r], [r * 0.65, 0], [0, r], [-r * 0.65, 0]], true);
        path([[0, -r], [0, r]]); break;
      case 'scripture':
        path([[0, -r * 0.5], [-r, -r * 0.8], [-r, r * 0.6], [0, r], [r, r * 0.6], [r, -r * 0.8], [0, -r * 0.5]], true);
        path([[0, -r * 0.5], [0, r]]); break;
      case 'flame':
        path([[0, -r], [r * 0.65, r * 0.1], [r * 0.3, r * 0.8], [-r * 0.3, r * 0.8], [-r * 0.65, r * 0.1], [-r * 0.2, -r * 0.2]], true); break;
      case 'eye':
        path([[-r, 0], [0, -r * 0.6], [r, 0], [0, r * 0.6]], true); ring(0, 0, r * 0.25); break;
    }
    ctx.restore();
  };
  ctx.save();
  ctx.globalAlpha *= fade;
  ctx.strokeStyle = art.primary; ctx.fillStyle = art.primary;
  ctx.lineWidth = Math.max(1, 2 * scale); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = art.primary; ctx.shadowBlur = reducedMotion || lowQuality || effect.support || effect.kind === 'impact' ? 0 : 10 * scale;
  const support = effect.support;
  if (support) {
    if (effect.supportBuff && effect.supportBuff !== 'shield') {
      // Stat gains use small upward marks; only real shields receive a protective outline.
      const r = radius * 0.3, lift = reducedMotion ? 0 : p * r * 0.6;
      ctx.save(); ctx.translate(bx, by); ctx.globalAlpha *= 0.65;
      for (let i = 0; i < (lowQuality ? 1 : 2); i++) {
        const y = -lift - i * r * 0.55;
        ctx.strokeStyle = i ? art.accent : art.primary;
        path([[-r * 0.5, y], [0, y - r * 0.45], [r * 0.5, y]]);
      }
      ctx.restore(); ctx.restore(); return true;
    }
    // Heal outcomes acknowledge the event without replaying a body-sized blessing for every ally.
    if (effect.kind === 'heal') {
      const r = radius * 0.34;
      const lift = reducedMotion ? 0 : p * r * 0.65;
      ctx.save(); ctx.translate(bx, by);
      ctx.globalAlpha *= 0.65; ctx.strokeStyle = effect.color;
      ring(0, -lift, r * 0.72);
      path([[-r * 0.35, -lift], [r * 0.35, -lift]]);
      path([[0, -r * 0.35 - lift], [0, r * 0.35 - lift]]);
      if (!reducedMotion) for (let i = 0; i < (lowQuality ? 2 : 4); i++) {
        const angle = i * Math.PI / 2 + art.angle;
        const near = r * 0.95, far = r * 1.25;
        ctx.strokeStyle = i % 2 ? art.accent : art.primary;
        path([[Math.cos(angle) * near, Math.sin(angle) * near - lift],
          [Math.cos(angle) * far, Math.sin(angle) * far - lift]]);
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (effect.kind === 'shield') {
      // The health-bar badge owns persistent shield HP; this only acknowledges the real application.
      const passive = effect.skillSlot === 'passive';
      const size = radius * (passive ? 0.33 : 0.4);
      const opening = reducedMotion ? 1 : 0.88 + Math.sin(p * Math.PI) * 0.12;
      ctx.save(); ctx.translate(bx, by); ctx.globalAlpha *= passive ? 0.55 : 0.65;
      ctx.strokeStyle = effect.color;
      path([[-size * 0.62 * opening, -size * 0.55], [0, -size * 0.8],
        [size * 0.62 * opening, -size * 0.55], [size * 0.5 * opening, size * 0.25],
        [0, size * 0.85], [-size * 0.5 * opening, size * 0.25]], true);
      ctx.strokeStyle = art.accent;
      if (passive && art.motif === 'aegis') {
        // Lucius: a small cross of light inside the actual protective ward.
        path([[0, -size * 0.4], [0, size * 0.4]]);
        path([[-size * 0.28, -size * 0.08], [size * 0.28, -size * 0.08]]);
      } else if (passive && art.motif === 'blades') {
        // Thane: paired open blade edges, never an extra passive attack.
        path([[-size * 0.3, size * 0.28], [size * 0.18, -size * 0.4], [size * 0.12, -size * 0.08]]);
        path([[size * 0.3, size * 0.28], [-size * 0.18, -size * 0.4], [-size * 0.12, -size * 0.08]]);
      } else if (passive && art.motif === 'bastion') {
        path([[-size * 0.32, 0], [0, -size * 0.32], [size * 0.32, 0]]);
        path([[0, -size * 0.32], [0, size * 0.4]]);
      } else if (passive && art.motif === 'embers') {
        path([[-size * 0.3, size * 0.3], [-size * 0.32, -size * 0.02], [0, -size * 0.42],
          [size * 0.06, -size * 0.12], [size * 0.28, size * 0.06], [size * 0.2, size * 0.3]]);
        path([[0, size * 0.3], [size * 0.02, size * 0.02]]);
      } else if (passive && art.motif === 'scripture') {
        path([[-size * 0.32, -size * 0.3], [0, -size * 0.12], [size * 0.32, -size * 0.3]]);
        path([[-size * 0.32, size * 0.2], [0, size * 0.38], [size * 0.32, size * 0.2]]);
        path([[0, -size * 0.12], [0, size * 0.38]]);
      } else {
        path([[0, -size * 0.35], [0, size * 0.35]]);
        if (!passive) path([[-size * 0.22, 0], [size * 0.22, 0]]);
      }
      ctx.restore(); ctx.restore(); return true;
    }
    // Blessings are local to the real recipient: never send a weapon or attack ribbon at an ally.
    const passive = effect.skillSlot === 'passive';
    const r = radius * (passive ? 0.78 : 1) * (reducedMotion ? 0.9 : 0.82 + Math.sin(p * Math.PI) * 0.18);
    ctx.save(); ctx.translate(bx, by);
    ctx.globalAlpha *= effect.kind === 'cast' ? 0.55 : 0.42;
    ctx.shadowBlur = 0;
    // Small brackets frame the hero's prop; no repeated floor ring or body-sized crown bands.
    ctx.strokeStyle = art.accent;
    for (const side of [-1, 1]) {
      path([[side * r * 0.38, -r * 0.64], [side * r * 0.48, -r * 0.64],
        [side * r * 0.48, -r * 0.46]]);
    }
    if (effect.kind === 'cast' && effect.ultimate) {
      path([[-r * 0.16, -r * 0.9], [0, -r], [r * 0.16, -r * 0.9]]);
    }
    if (art.motif === 'rose' && effect.kind === 'cast') {
      // Sonja's real cast is a blessing: a small rose opens above the recipient, never in flight.
      const opening = reducedMotion ? 1 : 0.45 + Math.sin(p * Math.PI) * 0.55;
      const flower = (x: number, y: number, size: number) => {
        for (let i = 0; i < 5; i++) {
          const angle = i * Math.PI * 2 / 5 - Math.PI / 2;
          ctx.fillStyle = effect.ultimate ? effect.color : art.primary; ctx.strokeStyle = art.accent;
          ctx.beginPath(); ctx.ellipse(x + Math.cos(angle) * size * 0.42 * opening,
            y + Math.sin(angle) * size * 0.42 * opening, size * 0.5, size * 0.28, angle, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = art.accent;
        ctx.beginPath(); ctx.arc(x, y, size * 0.16, 0, Math.PI * 2); ctx.fill();
      };
      flower(0, -r * 0.55, r * (effect.ultimate ? 0.36 : 0.29));
      if (effect.ultimate && !lowQuality && !reducedMotion) {
        flower(-r * 0.52, -r * 0.3, r * 0.2);
        flower(r * 0.52, -r * 0.3, r * 0.2);
      }
    } else if (effect.kind === 'cast' && art.motif === 'coins') {
      const size = r * 0.3, y = -r * 0.45;
      // A recipient-local potion, not an airborne weapon; keep the silhouette on LOW.
      const bottle = [[-size * 0.22, y - size], [size * 0.22, y - size],
        [size * 0.22, y - size * 0.45], [size * 0.65, y - size * 0.08],
        [size * 0.65, y + size * 0.65], [-size * 0.65, y + size * 0.65],
        [-size * 0.65, y - size * 0.08], [-size * 0.22, y - size * 0.45]];
      ctx.fillStyle = art.accent; ctx.strokeStyle = art.primary;
      path(bottle, true, true); path(bottle, true);
      ctx.strokeStyle = art.accent;
      path([[-size * 0.35, y - size], [size * 0.35, y - size]]);
      ctx.fillStyle = art.primary;
      path([[-size * 0.42, y + size * 0.15], [size * 0.42, y + size * 0.15],
        [size * 0.42, y + size * 0.46], [-size * 0.42, y + size * 0.46]], true, true);
      if (effect.ultimate) for (const side of [-1, 1]) {
        const rise = reducedMotion ? 0 : Math.sin(p * Math.PI) * r * 0.15;
        ctx.beginPath(); ctx.ellipse(side * r * 0.48, y - rise, r * 0.1, r * 0.15, 0, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (effect.kind === 'cast' && art.motif === 'petals') {
      const size = r * 0.32, y = -r * 0.48;
      // Rosaline offers tea at the actual recipient; the cup stays upright and locally anchored.
      const cup = [[-size * 0.72, y - size * 0.3], [size * 0.72, y - size * 0.3],
        [size * 0.5, y + size * 0.5], [-size * 0.5, y + size * 0.5]];
      ctx.fillStyle = art.accent; ctx.strokeStyle = art.primary;
      path(cup, true, true); path(cup, true);
      ctx.beginPath(); ctx.arc(size * 0.72, y, size * 0.3, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, y + size * 0.65, size, size * 0.16, 0, 0, Math.PI * 2); ctx.stroke();
      if (!reducedMotion) for (const side of [-1, 1]) {
        const lift = Math.sin(p * Math.PI) * size * 0.25;
        path([[side * size * 0.25, y - size * 0.55], [side * size * 0.3, y - size * 0.85 - lift]]);
      }
      if (effect.ultimate) {
        ctx.strokeStyle = art.accent;
        emblem(0, y - size * 1.45, size * 0.25);
      }
    } else if (effect.kind === 'cast' && effect.sourceHeroId === 'hero_107_peggy') {
      const size = r * 0.32, y = -r * 0.48;
      const open = effect.ultimate ? (reducedMotion ? 0.45 : Math.sin(p * Math.PI) * 0.45) : 0;
      const box = [[-size * 0.65, y - size * 0.25], [size * 0.65, y - size * 0.25],
        [size * 0.65, y + size * 0.65], [-size * 0.65, y + size * 0.65]];
      const lid = [[-size * 0.78, y - size * (0.5 + open)], [size * 0.78, y - size * (0.5 + open)],
        [size * 0.78, y - size * (0.2 + open)], [-size * 0.78, y - size * (0.2 + open)]];
      ctx.fillStyle = art.primary; ctx.strokeStyle = art.accent;
      path(box, true, true); path(box, true);
      ctx.fillStyle = art.accent; path(lid, true, true); path(lid, true);
      ctx.strokeStyle = art.accent; path([[0, y - size * 0.25], [0, y + size * 0.65]]);
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(side * size * 0.22, y - size * (0.66 + open),
          size * 0.25, size * 0.14, side * 0.35, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (effect.kind === 'cast' && art.motif === 'aegis') {
      const size = r * 0.32, y = -r * 0.48;
      const shield = [[0, y - size], [size * 0.7, y - size * 0.55],
        [size * 0.55, y + size * 0.35], [0, y + size * 0.9],
        [-size * 0.55, y + size * 0.35], [-size * 0.7, y - size * 0.55]];
      ctx.fillStyle = art.primary; ctx.strokeStyle = art.accent;
      path(shield, true, true); path(shield, true);
      path([[0, y - size * 0.6], [0, y + size * 0.45]]);
      path([[-size * 0.35, y - size * 0.15], [size * 0.35, y - size * 0.15]]);
      if (effect.ultimate) for (const side of [-1, 1]) {
        path([[side * size * 0.85, y - size * 0.25], [side * size * 1.2, y - size * 0.55],
          [side * size * 1.05, y + size * 0.2]]);
      }
    } else if (effect.kind === 'cast' && effect.sourceHeroId === 'raine') {
      // Raine's target-game skills support allies: a rally badge replaces offensive bullet travel.
      const size = r * 0.3, y = -r * 0.48;
      ctx.fillStyle = art.primary; ctx.strokeStyle = art.accent;
      path([[0, y - size], [size * 0.75, y], [0, y + size], [-size * 0.75, y]], true, true);
      path([[-size * 0.4, y + size * 0.2], [0, y - size * 0.3], [size * 0.4, y + size * 0.2]]);
      if (effect.ultimate) for (const side of [-1, 1]) {
        path([[side * size * 0.8, y + size * 0.15], [side * size * 1.1, y + size * 0.65],
          [side * size * 0.7, y + size * 0.55]]);
      }
    } else if (effect.kind === 'cast' && art.motif === 'embers') {
      // The target-game ultimate grants protection, so its barrel is a local emblem, not a bomb.
      const size = r * 0.32, y = -r * 0.48;
      const barrel = [[-size * 0.5, y - size * 0.7], [size * 0.5, y - size * 0.7],
        [size * 0.7, y - size * 0.2], [size * 0.7, y + size * 0.2],
        [size * 0.5, y + size * 0.7], [-size * 0.5, y + size * 0.7],
        [-size * 0.7, y + size * 0.2], [-size * 0.7, y - size * 0.2]];
      ctx.fillStyle = art.primary; ctx.strokeStyle = art.accent;
      path(barrel, true, true); path(barrel, true);
      for (const side of [-1, 1]) {
        path([[-size * 0.6, y + side * size * 0.4], [size * 0.6, y + side * size * 0.4]]);
        path([[side * size * 0.22, y - size * 0.6], [side * size * 0.22, y + size * 0.6]]);
      }
      ctx.beginPath(); ctx.ellipse(0, y - size * 0.7, size * 0.5, size * 0.14, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (effect.kind === 'cast' && art.motif === 'scripture') {
      const size = r * 0.34, y = -r * 0.5;
      const opening = reducedMotion ? 1 : 0.6 + Math.sin(p * Math.PI) * 0.4;
      for (const side of [-1, 1]) {
        const edge = side * size * opening;
        const page = [[0, y - size * 0.45], [edge, y - size * 0.8],
          [edge, y + size * 0.45], [0, y + size * 0.7]];
        ctx.fillStyle = art.accent; ctx.strokeStyle = art.primary;
        path(page, true, true); path(page, true);
        for (let row = 0; row < 2; row++) {
          const baseline = y + (row * 0.35 - 0.2) * size;
          path([[edge * 0.25, baseline], [edge * 0.8, baseline - size * 0.16]]);
        }
      }
      if (effect.ultimate) {
        ctx.strokeStyle = art.accent;
        for (let i = 0; i < (lowQuality || reducedMotion ? 3 : 5); i++) {
          const x = (i - (lowQuality || reducedMotion ? 1 : 2)) * size * 0.34;
          const lift = reducedMotion ? 0 : Math.sin(p * Math.PI) * size * 0.3;
          path([[x, y - size * 0.95], [x, y - size * 1.35 - lift]]);
        }
      }
    } else {
      // A translucent ward with a non-weapon central sigil; passive wards stay more restrained.
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.62, r * 0.95, 0, -Math.PI * 0.95, Math.PI * 0.95); ctx.stroke();
      ctx.strokeStyle = art.primary;
      emblem(0, -r * 0.1, r * (passive ? 0.18 : 0.28));
      if (!reducedMotion && !lowQuality) for (let i = 0; i < art.rays; i++) {
        const angle = i / art.rays * Math.PI * 2 + art.angle;
        diamond(Math.cos(angle) * r * 0.82, Math.sin(angle) * r * 0.82, r * 0.045);
      }
    }
    ctx.restore(); ctx.restore(); return true;
  }
  if (reducedMotion) {
    // Keep identity without motion: only opacity fades; the recipient-local geometry is fixed.
    const r = radius * 0.55;
    ctx.save(); ctx.translate(bx, by); ctx.globalAlpha *= 0.65;
    switch (art.motif) {
      case 'lance':
        path([[-r, 0], [r * 0.65, 0]]);
        path([[r * 0.25, -r * 0.25], [r, 0], [r * 0.25, r * 0.25]]); break;
      case 'arrows':
        path([[-r * 0.85, 0], [r * 0.8, 0]]);
        path([[r * 0.35, -r * 0.3], [r * 0.8, 0], [r * 0.35, r * 0.3]]);
        path([[-r * 0.8, -r * 0.28], [-r * 0.45, 0], [-r * 0.8, r * 0.28]]); break;
      case 'daggers':
        path([[-r * 0.2, -r * 0.7], [r * 0.9, 0], [-r * 0.2, r * 0.7], [0, 0]], true);
        path([[-r * 0.35, -r * 0.4], [-r * 0.35, r * 0.4]]);
        path([[-r * 0.8, 0], [-r * 0.35, 0]]); break;
      case 'blades':
        ctx.beginPath(); ctx.moveTo(-r * 0.5, -r);
        ctx.quadraticCurveTo(r, 0, -r * 0.5, r); ctx.stroke();
        ctx.strokeStyle = art.accent;
        ctx.beginPath(); ctx.moveTo(-r * 0.2, -r * 0.7);
        ctx.quadraticCurveTo(r * 0.7, 0, -r * 0.2, r * 0.7); ctx.stroke(); break;
      case 'crossfire':
        for (const side of [-1, 1]) {
          const y = side * r * 0.24;
          path([[-r * 0.85, y], [r * 0.6, y]]);
          path([[r * 0.3, y - r * 0.14], [r * 0.75, y], [r * 0.3, y + r * 0.14]]);
        }
        break;
      case 'coffin':
        path([[-r * 0.35, -r], [r * 0.35, -r], [r * 0.65, -r * 0.5],
          [r * 0.4, r], [-r * 0.4, r], [-r * 0.65, -r * 0.5]], true);
        path([[0, -r * 0.5], [0, r * 0.5]]);
        path([[-r * 0.25, -r * 0.15], [r * 0.25, -r * 0.15]]); break;
      case 'eye':
        ctx.beginPath(); ctx.moveTo(-r, 0);
        ctx.quadraticCurveTo(0, -r, r, 0); ctx.quadraticCurveTo(0, r, -r, 0); ctx.stroke();
        path([[0, -r * 0.3], [0, r * 0.3]]); break;
      case 'prism':
        path([[0, -r], [r * 0.65, 0], [0, r], [-r * 0.65, 0]], true);
        path([[0, -r], [0, r]]);
        path([[-r * 0.65, 0], [r * 0.65, 0]]); break;
      case 'aegis':
      case 'bastion':
        path([[-r * 0.65, -r * 0.65], [0, -r], [r * 0.65, -r * 0.65],
          [r * 0.5, r * 0.35], [0, r], [-r * 0.5, r * 0.35]], true);
        if (art.motif === 'aegis') {
          path([[-r * 0.3, -r * 0.1], [r * 0.3, -r * 0.1]]);
          path([[0, -r * 0.45], [0, r * 0.45]]);
        } else path([[-r * 0.3, -r * 0.25], [0, r * 0.3], [r * 0.3, -r * 0.25]]);
        break;
      case 'seraph':
        for (const side of [-1, 1]) path([[side * r * 0.15, r * 0.4], [side * r, -r * 0.45],
          [side * r * 0.7, r * 0.2], [side * r * 0.15, r * 0.65]]);
        path([[0, -r * 0.9], [0, r * 0.1]]); break;
      case 'embers':
        path([[0, -r], [r * 0.65, r * 0.15], [r * 0.3, r * 0.8], [-r * 0.3, r * 0.8],
          [-r * 0.65, r * 0.15], [-r * 0.2, -r * 0.2]], true);
        path([[0, -r * 0.1], [r * 0.2, r * 0.45], [-r * 0.2, r * 0.45]], true); break;
      case 'vortex':
        for (let i = 0; i < 2; i++) {
          const angle = i * Math.PI;
          ctx.beginPath(); ctx.arc(0, 0, r * (0.55 + i * 0.3), angle, angle + Math.PI * 0.85); ctx.stroke();
        }
        break;
      default:
        path([[-r * 0.6, 0], [0, -r * 0.6], [r * 0.6, 0]]);
    }
    ctx.restore(); ctx.restore(); return true;
  }
  if (effect.kind === 'impact') {
    // Damage feedback is a short accent, not a second complete spell for every victim.
    ctx.globalAlpha *= 0.6;
    ctx.shadowBlur = 0;
    ctx.save(); ctx.translate(bx, by);
    const weaponImpact = ['lance', 'arrows', 'daggers', 'crossfire', 'blades'].includes(art.motif);
    if (weaponImpact && !reducedMotion) {
      const size = radius * (0.65 + (1 - p) * 0.2);
      ctx.rotate(Math.atan2(by - ay, bx - ax));
      if (art.motif === 'blades') {
        ctx.beginPath(); ctx.moveTo(-size * 0.35, -size * 0.7);
        ctx.quadraticCurveTo(size * 0.8, 0, -size * 0.35, size * 0.7); ctx.stroke();
        ctx.strokeStyle = art.accent;
        ctx.beginPath(); ctx.moveTo(-size * 0.25, -size * 0.5);
        ctx.quadraticCurveTo(size * 0.6, 0, -size * 0.25, size * 0.5); ctx.stroke();
      } else {
        path([[-size, 0], [size * 0.35, 0]]);
        ctx.strokeStyle = art.accent;
        for (const side of [-1, 1]) path([[size * 0.05, side * size * 0.22], [size * 0.4, side * size * 0.55]]);
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (!reducedMotion && ['coffin', 'eye', 'bastion'].includes(art.motif)) {
      const size = radius * (0.65 + (1 - p) * 0.2);
      if (art.motif === 'coffin') {
        path([[-size * 0.3, -size * 0.8], [size * 0.3, -size * 0.8], [size * 0.5, -size * 0.4],
          [size * 0.35, size * 0.8], [-size * 0.35, size * 0.8], [-size * 0.5, -size * 0.4]], true);
        ctx.strokeStyle = art.accent;
        path([[0, -size * 0.4], [0, size * 0.4]]);
        path([[-size * 0.2, -size * 0.15], [size * 0.2, -size * 0.15]]);
      } else if (art.motif === 'eye') {
        ctx.beginPath(); ctx.moveTo(-size * 0.85, 0);
        ctx.quadraticCurveTo(0, -size * 0.8, size * 0.85, 0);
        ctx.quadraticCurveTo(0, size * 0.8, -size * 0.85, 0); ctx.stroke();
        ctx.strokeStyle = art.accent;
        path([[0, -size * 0.25], [0, size * 0.25]]);
      } else {
        // A small shield-contact notch indicates real damage, not a new shield application.
        path([[-size * 0.55, -size * 0.6], [0, -size * 0.8], [size * 0.55, -size * 0.6],
          [size * 0.45, size * 0.3], [0, size * 0.8], [-size * 0.45, size * 0.3]], true);
        ctx.strokeStyle = art.accent;
        path([[-size * 0.25, -size * 0.2], [0, size * 0.2], [size * 0.25, -size * 0.2]]);
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (!reducedMotion && ['seraph', 'embers', 'prism', 'vortex'].includes(art.motif)) {
      const size = radius * (0.65 + (1 - p) * 0.2);
      if (art.motif === 'seraph') {
        for (let i = 0; i < 4; i++) {
          const angle = Math.PI / 4 + i * Math.PI / 2;
          path([[Math.cos(angle) * size * 0.25, Math.sin(angle) * size * 0.25],
            [Math.cos(angle) * size, Math.sin(angle) * size]]);
        }
      } else if (art.motif === 'embers') {
        ctx.beginPath(); ctx.moveTo(-size * 0.45, size * 0.55);
        ctx.quadraticCurveTo(-size * 0.7, -size * 0.15, 0, -size);
        ctx.quadraticCurveTo(-size * 0.08, -size * 0.1, size * 0.45, size * 0.4); ctx.stroke();
        ctx.strokeStyle = art.accent;
        ctx.beginPath(); ctx.moveTo(-size * 0.12, size * 0.5);
        ctx.quadraticCurveTo(size * 0.3, size * 0.1, size * 0.12, -size * 0.3); ctx.stroke();
      } else if (art.motif === 'prism') {
        for (const side of [-1, 1]) {
          const x = side * size * (0.22 + p * 0.18);
          path([[x, -size * 0.65], [x + side * size * 0.35, 0], [x, size * 0.65]], true);
          ctx.strokeStyle = art.accent;
        }
      } else {
        for (let i = 0; i < 2; i++) {
          const angle = art.angle + p * 0.65 + i * Math.PI;
          ctx.beginPath(); ctx.arc(0, 0, size * (0.5 + i * 0.3), angle, angle + Math.PI * 0.85); ctx.stroke();
          ctx.strokeStyle = art.accent;
        }
      }
      ctx.restore(); ctx.restore(); return true;
    }
    ring(0, 0, radius * (0.45 + p * 0.45));
    ctx.strokeStyle = art.accent;
    if (!reducedMotion) for (let i = 0; i < (lowQuality ? 3 : 5); i++) {
      const angle = art.angle + i * Math.PI * 2 / 5;
      const near = radius * (0.35 + p * 0.3), far = near + radius * (1 - p) * 0.4;
      path([[Math.cos(angle) * near, Math.sin(angle) * near], [Math.cos(angle) * far, Math.sin(angle) * far]]);
    }
    ctx.restore(); ctx.restore(); return true;
  }
  ctx.globalAlpha *= 0.7;
  ctx.globalCompositeOperation = 'source-over';
  if (effect.kind === 'cast') {
    // Anticipation stays on the caster; a fine energy ribbon connects to the actual recipient.
    if (p < 0.36) {
      const charge = p / 0.36;
      if (!['lance', 'blades', 'arrows', 'crossfire', 'daggers', 'prism', 'aegis', 'coffin', 'eye', 'embers', 'bastion', 'seraph', 'vortex'].includes(art.motif)) {
        halo(ax, ay, radius * (0.3 + charge * 0.45));
      }
      ctx.save(); ctx.translate(ax, ay);
      if (art.motif === 'seraph') {
        const r = radius * (0.25 + charge * 0.25);
        ring(0, 0, r * 0.5);
        ctx.strokeStyle = art.accent;
        for (let i = 0; i < (lowQuality ? 4 : 8); i++) {
          const angle = i * Math.PI * 2 / (lowQuality ? 4 : 8);
          path([[Math.cos(angle) * r * 0.7, Math.sin(angle) * r * 0.7],
            [Math.cos(angle) * r, Math.sin(angle) * r]]);
        }
        if (effect.sourceHeroId === 'belinda' && effect.ultimate) {
          const width = radius * (0.22 + charge * 0.2), feathers = lowQuality ? 2 : 3;
          for (const side of [-1, 1]) {
            ctx.strokeStyle = art.primary;
            ctx.beginPath(); ctx.moveTo(side * radius * 0.08, 0);
            ctx.quadraticCurveTo(side * width * 0.5, -radius * 0.28, side * width, -radius * 0.24);
            ctx.quadraticCurveTo(side * width * 0.85, radius * 0.02, side * radius * 0.12, radius * 0.12); ctx.stroke();
            ctx.strokeStyle = art.accent;
            for (let i = 0; i < feathers; i++) {
              const t = (i + 1) / (feathers + 1);
              path([[side * width * (0.4 + t * 0.4), -radius * (0.15 - t * 0.06)],
                [side * width * (0.22 + t * 0.4), radius * (0.04 + t * 0.05)]]);
            }
          }
        }
      } else if (art.motif === 'vortex') {
        if (effect.sourceHeroId === 'scarlet' && effect.ultimate) {
          const count = lowQuality ? 2 : 3, reach = radius * (0.44 - charge * 0.12);
          for (let i = 0; i < count; i++) {
            ctx.save(); ctx.rotate(i * Math.PI * 2 / count - charge * 0.5);
            ctx.strokeStyle = art.primary;
            ctx.beginPath(); ctx.moveTo(-reach, -reach * 0.25);
            ctx.quadraticCurveTo(-reach * 0.35, -reach * 0.9, reach * 0.22, -reach * 0.25);
            ctx.quadraticCurveTo(reach * 0.52, reach * 0.35, 0, reach * 0.12); ctx.stroke();
            ctx.strokeStyle = art.accent;
            ctx.beginPath(); ctx.moveTo(-reach * 0.65, -reach * 0.2);
            ctx.quadraticCurveTo(-reach * 0.1, -reach * 0.5, reach * 0.1, -reach * 0.1); ctx.stroke();
            ctx.restore();
          }
        } else {
          for (let i = 0; i < (lowQuality ? 2 : 3); i++) {
            const angle = -charge * Math.PI + i * Math.PI * 2 / 3;
            ctx.strokeStyle = i % 2 ? art.accent : art.primary;
            ctx.beginPath(); ctx.arc(0, 0, radius * (0.2 + i * 0.1), angle, angle + Math.PI * 1.25); ctx.stroke();
          }
        }
      } else if (art.motif === 'aegis') {
        const size = radius * (0.24 + charge * 0.24);
        // This open charge emblem prepares the attack; it never grants or reapplies a shield.
        ctx.strokeStyle = art.primary;
        ctx.beginPath(); ctx.moveTo(-size * 0.65, -size * 0.6);
        ctx.lineTo(0, -size * 0.85); ctx.lineTo(size * 0.65, -size * 0.6);
        ctx.quadraticCurveTo(size * 0.7, size * 0.45, 0, size);
        ctx.quadraticCurveTo(-size * 0.7, size * 0.45, -size * 0.65, -size * 0.6);
        ctx.closePath(); ctx.stroke();
        ctx.strokeStyle = art.accent;
        path([[0, -size * 0.5], [0, size * 0.5]]);
        path([[-size * 0.3, -size * 0.2], [0, 0], [size * 0.3, -size * 0.2]]);
      } else if (['coffin', 'eye', 'embers', 'bastion'].includes(art.motif)) {
        const size = radius * (0.24 + charge * 0.24);
        ctx.strokeStyle = art.primary;
        if (art.motif === 'coffin') {
          if (effect.sourceHeroId === 'fawkes' && effect.ultimate) {
            const gap = radius * (0.06 + charge * 0.12);
            for (const side of [-1, 1]) {
              ctx.save(); ctx.translate(side * gap, 0); ctx.strokeStyle = art.primary;
              path([[0, -size], [side * size * 0.3, -size], [side * size * 0.58, -size * 0.55],
                [side * size * 0.42, size], [0, size]], true);
              ctx.strokeStyle = art.accent;
              path([[side * size * 0.12, -size * 0.5], [side * size * 0.12, size * 0.5]]);
              path([[side * size * 0.04, -size * 0.15], [side * size * 0.28, -size * 0.15]]);
              ctx.restore();
            }
          } else {
            // A small upright seal prepares the later doors at the victim; it never covers their body.
            path([[-size * 0.32, -size], [size * 0.32, -size], [size * 0.58, -size * 0.55],
              [size * 0.42, size], [-size * 0.42, size], [-size * 0.58, -size * 0.55]], true);
            ctx.strokeStyle = art.accent;
            path([[0, -size * 0.5], [0, size * 0.5]]);
            path([[-size * 0.2, -size * 0.15], [size * 0.2, -size * 0.15]]);
          }
        } else if (art.motif === 'eye') {
          const opening = size * (0.15 + charge * 0.35);
          ctx.beginPath(); ctx.moveTo(-size, 0);
          ctx.quadraticCurveTo(0, -opening * 2, size, 0);
          ctx.quadraticCurveTo(0, opening * 2, -size, 0); ctx.stroke();
          ctx.strokeStyle = art.accent;
          if (effect.sourceHeroId === 'morrow' && effect.ultimate) {
            path([[0, -opening * 0.65], [0, opening * 0.65]]);
            for (const side of [-1, 1]) {
              ctx.beginPath(); ctx.moveTo(-size * 0.75, side * opening * 0.75);
              ctx.quadraticCurveTo(0, side * opening * 2.6, size * 0.75, side * opening * 0.75); ctx.stroke();
            }
          } else ring(0, 0, opening * 0.48);
        } else if (art.motif === 'embers') {
          ctx.beginPath(); ctx.moveTo(0, size * 0.8);
          ctx.quadraticCurveTo(-size * 0.9, size * 0.3, -size * 0.35, -size * 0.45);
          ctx.quadraticCurveTo(-size * 0.12, 0, size * 0.12, -size);
          ctx.quadraticCurveTo(size * 0.9, -size * 0.1, size * 0.45, size * 0.5);
          ctx.quadraticCurveTo(size * 0.25, size * 0.8, 0, size * 0.8); ctx.stroke();
          ctx.strokeStyle = art.accent;
          path([[0, size * 0.45], [size * 0.1, -size * 0.1]]);
        } else {
          path([[-size * 0.7, -size * 0.6], [0, -size * 0.85], [size * 0.7, -size * 0.6],
            [size * 0.55, size * 0.45], [0, size], [-size * 0.55, size * 0.45]], true);
          ctx.strokeStyle = art.accent;
          path([[-size * 0.35, 0], [0, -size * 0.28], [size * 0.35, 0]]);
          path([[0, -size * 0.28], [0, size * 0.55]]);
        }
      } else if (['lance', 'blades', 'arrows', 'crossfire', 'daggers'].includes(art.motif)) {
        const size = radius * (0.22 + charge * 0.22);
        if (art.motif === 'blades') {
          if (effect.sourceHeroId === 'hero_134_thane' && effect.ultimate) {
            const bearing = Math.atan2(by - ay, bx - ax), gap = radius * (0.2 - charge * 0.1);
            const windSize = size * 0.65;
            for (const side of [-1, 1]) {
              ctx.save(); ctx.translate(-Math.sin(bearing) * gap * side, Math.cos(bearing) * gap * side);
              ctx.rotate(bearing); ctx.strokeStyle = art.primary;
              ctx.beginPath(); ctx.moveTo(-windSize * 0.65, -windSize * 0.6);
              ctx.quadraticCurveTo(windSize * 0.35, -windSize * 0.65, windSize * 0.8, 0);
              ctx.quadraticCurveTo(windSize * 0.1, windSize * 0.15, -windSize * 0.65, windSize * 0.6); ctx.stroke();
              ctx.strokeStyle = art.accent;
              ctx.beginPath(); ctx.moveTo(-windSize * 0.55, -windSize * 0.25);
              ctx.quadraticCurveTo(windSize * 0.1, -windSize * 0.35, windSize * 0.48, 0); ctx.stroke();
              ctx.restore();
            }
          } else if (effect.sourceHeroId === 'cecilia' && !effect.ultimate) {
            const bearing = Math.atan2(by - ay, bx - ax), gap = radius * (0.2 - charge * 0.1);
            for (const side of [-1, 1]) {
              blade(-Math.sin(bearing) * gap * side, Math.cos(bearing) * gap * side, size * 0.6);
            }
          } else blade(0, 0, size);
        } else if (art.motif === 'lance') {
          ctx.save(); ctx.rotate(Math.atan2(by - ay, bx - ax));
          ctx.strokeStyle = art.primary;
          path([[-size, 0], [size * 0.5, 0]]);
          ctx.fillStyle = art.accent;
          path([[size, 0], [size * 0.35, -size * 0.2], [size * 0.5, 0], [size * 0.35, size * 0.2]], true, true);
          ctx.restore();
        } else if (art.motif === 'crossfire' && effect.sourceHeroId === 'walker' && effect.ultimate) {
          const bearing = Math.atan2(by - ay, bx - ax), size = radius * (0.85 + charge * 0.15);
          ctx.rotate(bearing); ctx.strokeStyle = art.primary;
          // Walker readies one shotgun: long barrel, pump and broad shoulder stock.
          path([[-size * 0.34, -size * 0.02], [-size * 0.12, -size * 0.02],
            [-size * 0.08, -size * 0.07], [size * 0.38, -size * 0.07],
            [size * 0.38, size * 0.02], [size * 0.05, size * 0.02],
            [-size * 0.04, size * 0.07], [-size * 0.12, size * 0.05],
            [-size * 0.2, size * 0.15], [-size * 0.34, size * 0.15]], true);
          ctx.strokeStyle = art.accent;
          path([[0, -size * 0.025], [size * 0.32, -size * 0.025]]);
          path([[size * 0.08, size * 0.045], [size * 0.22, size * 0.045]]);
        } else if (art.motif === 'arrows' && effect.sourceHeroId === 'gwyneth' && effect.ultimate) {
          const bearing = Math.atan2(by - ay, bx - ax), count = lowQuality ? 3 : 5;
          // A transparent drawn bow frames the coming volley without masking the sprite.
          ctx.save(); ctx.rotate(bearing); ctx.strokeStyle = art.primary;
          ctx.beginPath(); ctx.moveTo(0, -radius * 0.3);
          ctx.quadraticCurveTo(radius * 0.28, 0, 0, radius * 0.3); ctx.stroke();
          ctx.strokeStyle = art.accent;
          path([[0, -radius * 0.3], [-radius * (0.08 + charge * 0.14), 0], [0, radius * 0.3]]);
          ctx.restore();
          for (let i = 0; i < count; i++) {
            const spread = (i - (count - 1) / 2) * radius * (0.09 + charge * 0.03);
            weapon(-Math.sin(bearing) * spread, Math.cos(bearing) * spread, radius * (0.12 + charge * 0.06));
          }
        } else if (art.motif === 'daggers' && effect.sourceHeroId === 'oscar' && effect.ultimate) {
          const bearing = Math.atan2(by - ay, bx - ax), count = lowQuality ? 2 : 4;
          for (let i = 0; i < count; i++) {
            const spread = (i - (count - 1) / 2) * radius * (0.12 + charge * 0.04);
            weapon(-Math.sin(bearing) * spread, Math.cos(bearing) * spread, radius * (0.12 + charge * 0.06));
          }
        } else weapon(0, 0, size);
      } else if (art.motif === 'prism') {
        const size = radius * (0.22 + charge * 0.3);
        const spread = size * (effect.sourceHeroId === 'hero_248_eluard' ? 0.9 : 0.6);
        if (effect.sourceHeroId === 'hero_248_eluard' && effect.ultimate) {
          const count = lowQuality ? 2 : 4, distance = radius * (0.16 + charge * 0.12);
          const h = size * 0.65, w = size * 0.22;
          for (let i = 0; i < count; i++) {
            const angle = -Math.PI / 2 + i * Math.PI * 2 / count;
            ctx.save(); ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
            ctx.strokeStyle = i % 2 ? art.accent : art.primary;
            path([[0, -h], [w, 0], [0, h], [-w, 0]], true);
            ctx.strokeStyle = art.accent;
            path([[0, -h], [0, h]]);
            path([[-w, 0], [w, 0]]);
            ctx.restore();
          }
        } else {
          // Three transparent facets unfold at the caster; no spinning wheel or opaque body cover.
          for (let i = -1; i <= 1; i++) {
            const x = i * spread, y = Math.abs(i) * size * 0.18;
            ctx.strokeStyle = i === 0 ? art.accent : art.primary;
            path([[x, y - size], [x + size * 0.35, y], [x, y + size * 0.75], [x - size * 0.35, y]], true);
            path([[x, y - size], [x, y + size * 0.75]]);
          }
        }
      } else {
        ctx.rotate(art.angle + p * 2);
        for (let i = 0; i < art.rays; i++) {
          const angle = i / art.rays * Math.PI * 2;
          diamond(Math.cos(angle) * radius * 0.55, Math.sin(angle) * radius * 0.55, 6 * scale * charge);
        }
      }
      ctx.restore();
    }
    if (p > 0.16 && p < 0.64) {
      const delivery = effect.ultimate ? art.ultimateDelivery : art.activeDelivery;
      const tx = ax + (bx - ax) * travel, ty = ay + (by - ay) * travel;
      ctx.globalAlpha *= 0.65;
      if (art.motif === 'blades' && delivery === 'orbit') {
        // Wind blades converge inward, leaving the victim visible between open curved edges.
        const count = lowQuality ? 2 : 4;
        const distance = radius * (0.9 - travel * 0.55), size = radius * 0.32;
        const bearing = Math.atan2(by - ay, bx - ax);
        ctx.save(); ctx.translate(bx, by);
        for (let i = 0; i < count; i++) {
          const angle = bearing + art.angle + i * Math.PI * 2 / count;
          ctx.save(); ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
          ctx.rotate(angle + Math.PI);
          ctx.strokeStyle = art.primary;
          ctx.beginPath(); ctx.moveTo(-size * 0.65, -size * 0.6);
          ctx.quadraticCurveTo(size * 0.35, -size * 0.65, size * 0.8, 0);
          ctx.quadraticCurveTo(size * 0.1, size * 0.15, -size * 0.65, size * 0.6); ctx.stroke();
          ctx.strokeStyle = art.accent;
          ctx.beginPath(); ctx.moveTo(-size * 0.55, -size * 0.25);
          ctx.quadraticCurveTo(size * 0.1, -size * 0.35, size * 0.48, 0); ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      } else if ((art.motif === 'aegis' || art.motif === 'coffin') && delivery === 'orbit') {
        // Transparent shield faces or coffin seals converge at the real opponent without orbit ribbons.
        const count = lowQuality ? 2 : 3, h = radius * 0.28, w = h * 0.65;
        const distance = radius * (0.65 - travel * 0.35);
        ctx.save(); ctx.translate(bx, by);
        for (let i = 0; i < count; i++) {
          const angle = -Math.PI / 2 + i * Math.PI * 2 / count;
          ctx.save(); ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
          ctx.strokeStyle = art.primary;
          if (art.motif === 'coffin') {
            path([[-w * 0.55, -h], [w * 0.55, -h], [w, -h * 0.45],
              [w * 0.75, h], [-w * 0.75, h], [-w, -h * 0.45]], true);
          } else {
            path([[-w, -h * 0.6], [0, -h], [w, -h * 0.6], [w * 0.75, h * 0.35],
              [0, h], [-w * 0.75, h * 0.35]], true);
          }
          ctx.strokeStyle = art.accent;
          path([[0, -h * 0.55], [0, h * 0.5]]);
          path([[-w * 0.5, -h * 0.15], [w * 0.5, -h * 0.15]]);
          ctx.restore();
        }
        ctx.restore();
      } else if (art.motif === 'prism' && (delivery === 'orbit' || delivery === 'rift')) {
        ctx.save(); ctx.translate(bx, by);
        const size = radius * 0.42;
        if (delivery === 'orbit' && effect.sourceHeroId === 'hero_248_eluard' && effect.ultimate) {
          // Four sanctuary faces close on the real opponent; LOW keeps an opposing pair.
          const count = lowQuality ? 2 : 4, h = radius * 0.3;
          const w = radius * (0.1 + travel * 0.1), distance = radius * (0.72 - travel * 0.44);
          for (let i = 0; i < count; i++) {
            const angle = -Math.PI / 2 + i * Math.PI * 2 / count;
            ctx.save(); ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
            ctx.strokeStyle = i % 2 ? art.accent : art.primary;
            path([[0, -h], [w, 0], [0, h], [-w, 0]], true);
            ctx.strokeStyle = art.accent;
            path([[0, -h], [0, h]]);
            path([[-w, 0], [w, 0]]);
            ctx.restore();
          }
        } else if (delivery === 'orbit') {
          // Transparent facets converge around the actual recipient; no filled orbiting diamonds.
          const distance = radius * (0.65 - travel * 0.35);
          for (let i = 0; i < 3; i++) {
            const angle = -Math.PI / 2 + i * Math.PI * 2 / 3;
            const x = Math.cos(angle) * distance, y = Math.sin(angle) * distance;
            ctx.strokeStyle = i === 1 ? art.accent : art.primary;
            path([[x, y - size * 0.65], [x + size * 0.32, y], [x, y + size * 0.65], [x - size * 0.32, y]], true);
            path([[x, y - size * 0.65], [x, y + size * 0.65]]);
          }
        } else {
          // Awakened delivery opens two angular portal facets, leaving the victim visible between them.
          const gap = radius * (0.12 + travel * 0.22);
          for (const side of [-1, 1]) {
            const x = side * gap;
            ctx.strokeStyle = side < 0 ? art.primary : art.accent;
            path([[x, -size], [x + side * size * 0.45, -size * 0.45],
              [x + side * size * 0.45, size * 0.45], [x, size], [x - side * size * 0.12, 0]], true);
            path([[x, -size * 0.7], [x + side * size * 0.2, 0], [x, size * 0.7]]);
          }
        }
        ctx.restore();
      } else switch (delivery) {
        case 'thrust': {
          if (art.motif === 'bastion') {
            // A shield bash carries a transparent face along the real strike, not a spear shaft.
            const h = radius * 0.48, w = h * 0.65;
            ctx.save(); ctx.translate(tx, ty); ctx.rotate(Math.atan2(by - ay, bx - ax));
            path([[-w, -h * 0.6], [0, -h], [w, -h * 0.6], [w * 0.75, h * 0.35],
              [0, h], [-w * 0.75, h * 0.35]], true);
            ctx.strokeStyle = art.accent;
            path([[-w * 0.55, 0], [0, -h * 0.35], [w * 0.55, 0]]);
            path([[0, -h * 0.35], [0, h * 0.55]]);
            ctx.restore(); break;
          }
          if (art.motif === 'blades') {
            blade(tx, ty, radius * 0.72);
            break;
          }
          if (art.motif === 'arrows' || art.motif === 'crossfire' || art.motif === 'daggers') {
            weapon(tx, ty, radius * 0.36);
            break;
          }
          const angle = Math.atan2(by - ay, bx - ax);
          ctx.save(); ctx.translate(tx, ty); ctx.rotate(angle);
          ctx.lineWidth = 3 * scale;
          path([[-radius * 0.72, 0], [radius * 0.22, 0]]);
          ctx.fillStyle = art.accent;
          path([[radius * 0.3, 0], [0, -radius * 0.1], [radius * 0.05, 0], [0, radius * 0.1]], true, true);
          ctx.restore(); break;
        }
        case 'volley': {
          if (['daggers', 'arrows', 'crossfire', 'lance'].includes(art.motif)) {
            // Short weapons fan across the bearing and close on the real victim.
            const daggers = art.motif === 'daggers', arrows = art.motif === 'arrows', bullets = art.motif === 'crossfire';
            const count = daggers ? lowQuality ? 2 : 4 : lowQuality ? 3 : 5;
            const spreadScale = arrows ? 0.22 : bullets ? 0.12 : daggers ? 0.18 : 0.16;
            const size = radius * (bullets ? 0.14 : daggers ? 0.16 : 0.18);
            const bearing = Math.atan2(by - ay, bx - ax);
            for (let i = 0; i < count; i++) {
              const t = Math.max(0, Math.min(1, travel * 1.3 - i * 0.075));
              const spread = (i - (count - 1) / 2) * radius * spreadScale * Math.sin(t * Math.PI);
              weapon(ax + (bx - ax) * t - Math.sin(bearing) * spread,
                ay + (by - ay) * t + Math.cos(bearing) * spread, size);
            }
            break;
          }
          const count = lowQuality ? 3 : Math.min(5, art.rays);
          for (let i = 0; i < count; i++) {
            const t = Math.max(0, Math.min(1, travel * 1.3 - i * 0.075));
            const spread = (i - (count - 1) / 2) * radius * 0.2 * Math.sin(t * Math.PI);
            const x = ax + (bx - ax) * t, y = ay + (by - ay) * t + spread;
            ctx.strokeStyle = i % 2 ? art.accent : art.primary;
            path([[x - (bx - ax) * 0.06, y - (by - ay) * 0.06], [x, y]]);
            if (['lance', 'arrows', 'crossfire', 'daggers'].includes(art.motif)) weapon(x, y, 9 * scale);
            else diamond(x, y, 4 * scale);
          }
          break;
        }
        case 'arc':
          if (art.motif === 'blades') {
            if (effect.sourceHeroId === 'cecilia') {
              // Twin smaller cuts flank the actual flight path and tighten toward the victim.
              const bearing = Math.atan2(by - ay, bx - ax);
              const gap = radius * (0.22 - travel * 0.12);
              for (const side of [-1, 1]) {
                blade(tx - Math.sin(bearing) * gap * side, ty + Math.cos(bearing) * gap * side, radius * 0.42);
              }
            } else blade(tx, ty, radius * 0.78);
          } else if (art.motif === 'seraph' || art.motif === 'vortex') {
            // A compact signature follows an arcing path; no full-length ribbon masks the bodies.
            const lift = radius * 0.45;
            const y = ty - Math.sin(travel * Math.PI) * lift;
            const tangent = Math.atan2(by - ay - lift * Math.PI * Math.cos(travel * Math.PI), bx - ax);
            const size = radius * 0.3;
            ctx.save(); ctx.translate(tx, y); ctx.rotate(tangent);
            ctx.fillStyle = art.accent; ctx.strokeStyle = art.primary;
            if (art.motif === 'seraph') {
              path([[size, 0], [0, -size * 0.35], [-size * 0.7, 0], [0, size * 0.35]], true, true);
              for (const side of [-1, 1]) {
                ctx.beginPath(); ctx.moveTo(size * 0.15, 0);
                ctx.bezierCurveTo(-size * 0.1, side * size, -size * 0.9, side * size * 1.1, -size * 1.5, side * size * 0.35);
                ctx.stroke();
              }
            } else {
              ctx.beginPath(); ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2); ctx.fill();
              for (let i = 0; i < (lowQuality ? 2 : 3); i++) {
                const angle = p * Math.PI * 4 + i * Math.PI * 2 / 3;
                ctx.strokeStyle = i % 2 ? art.accent : art.primary;
                ctx.beginPath(); ctx.arc(0, 0, size * (0.6 + i * 0.22), angle, angle + Math.PI * 1.25); ctx.stroke();
              }
            }
            ctx.restore();
          } else if (art.motif === 'embers') {
            // Fire Breath is a narrow directional stream, not the generic spell ribbon.
            const dx = bx - ax, dy = by - ay;
            const length = Math.hypot(dx, dy) * travel;
            const count = lowQuality ? 3 : 5;
            ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.atan2(dy, dx));
            for (let i = 0; i < count; i++) {
              const end = length * (1 - i * 0.06);
              const spread = (i - (count - 1) / 2) * radius * 0.095;
              const flutter = Math.sin(p * Math.PI * 6 + i * 1.7) * radius * 0.035;
              ctx.fillStyle = i % 2 ? art.accent : art.primary;
              path([[radius * 0.12, 0], [end * 0.55, spread + flutter], [end, spread * 1.5],
                [end * 0.78, spread * 0.6 - radius * 0.055], [end * 0.38, -radius * 0.04]], true, true);
            }
            ctx.restore();
          } else {
            ctx.beginPath(); ctx.moveTo(ax, ay);
            ctx.quadraticCurveTo((ax + tx) / 2, (ay + ty) / 2 - radius * 0.55, tx, ty); ctx.stroke();
            ctx.strokeStyle = art.accent;
            ctx.beginPath(); ctx.ellipse(tx, ty, radius * 0.34, radius * 0.12, art.angle + travel * Math.PI, -2.4, 0.5); ctx.stroke();
          }
          break;
        case 'pillar': {
          if (art.motif === 'seraph') {
            // Separated, open light rays descend into the real victim; no shared pillar ring or opaque beam.
            const count = lowQuality ? 2 : 3;
            ctx.save(); ctx.translate(bx, by);
            for (let i = 0; i < count; i++) {
              const offset = i - (count - 1) / 2;
              const x = offset * radius * 0.38 * (1 - travel * 0.35);
              const y = -radius * (2 * (1 - travel) + Math.abs(offset) * 0.08);
              ctx.strokeStyle = i % 2 ? art.accent : art.primary;
              path([[x + offset * radius * 0.08, y - radius * 0.42], [x, y]]);
              ctx.strokeStyle = art.accent;
              for (const side of [-1, 1]) {
                path([[x + side * radius * 0.13, y - radius * 0.23], [x, y - radius * 0.06]]);
              }
            }
            ctx.restore(); break;
          }
          if (art.motif === 'eye') {
            // Morrow's hollow eyes open while descending; no opaque pupil or shared pillar ring.
            const count = lowQuality ? 2 : 3;
            const w = radius * 0.3, h = radius * (0.08 + travel * 0.16);
            ctx.save(); ctx.translate(bx, by);
            for (let i = 0; i < count; i++) {
              const offset = i - (count - 1) / 2;
              ctx.save(); ctx.translate(offset * radius * 0.48 * (1 - travel * 0.3),
                -radius * (1.9 * (1 - travel) + Math.abs(offset) * 0.14));
              ctx.strokeStyle = i % 2 ? art.accent : art.primary;
              ctx.beginPath(); ctx.moveTo(-w, 0);
              ctx.quadraticCurveTo(0, -h * 2, w, 0);
              ctx.quadraticCurveTo(0, h * 2, -w, 0); ctx.stroke();
              ctx.strokeStyle = art.accent;
              path([[0, -h * 0.5], [0, h * 0.5]]);
              ctx.restore();
            }
            ctx.restore(); break;
          }
          if (art.motif === 'bastion') {
            // Hendrik's attack descends on the opponent; his real self ward is a separate outcome.
            const count = lowQuality ? 2 : 3, size = radius * 0.32;
            ctx.save(); ctx.translate(bx, by);
            for (let i = 0; i < count; i++) {
              const offset = i - (count - 1) / 2;
              ctx.save(); ctx.translate(offset * radius * 0.42 * (1 - travel * 0.25),
                -radius * (1.9 * (1 - travel) + Math.abs(offset) * 0.12));
              ctx.strokeStyle = i % 2 ? art.accent : art.primary;
              path([[-size * 0.65, -size * 0.65], [0, -size], [size * 0.65, -size * 0.65],
                [size * 0.5, size * 0.45], [0, size], [-size * 0.5, size * 0.45]], true);
              ctx.strokeStyle = art.accent;
              path([[-size * 0.35, 0], [0, -size * 0.3], [size * 0.35, 0]]);
              path([[0, -size * 0.3], [0, size * 0.55]]);
              ctx.restore();
            }
            ctx.restore(); break;
          }
          if (art.motif === 'prism') {
            // Eluard's open facets descend without replaying an opaque column over the victim.
            const count = lowQuality ? 2 : 3, h = radius * 0.34;
            const w = radius * (0.2 - travel * 0.07);
            ctx.save(); ctx.translate(bx, by);
            for (let i = 0; i < count; i++) {
              const offset = i - (count - 1) / 2;
              ctx.save(); ctx.translate(offset * radius * 0.42 * (1 - travel * 0.3),
                -radius * (1.9 * (1 - travel) + Math.abs(offset) * 0.12));
              ctx.strokeStyle = i % 2 ? art.accent : art.primary;
              path([[0, -h], [w, 0], [0, h], [-w, 0]], true);
              ctx.strokeStyle = art.accent;
              path([[0, -h], [0, h]]);
              path([[-w, 0], [w, 0]]);
              ctx.restore();
            }
            ctx.restore(); break;
          }
          const y = by - radius * 2.3 * (1 - travel);
          ctx.lineWidth = (effect.ultimate ? 4 : 2) * scale;
          path([[bx, y - radius * 0.5], [bx, y]]);
          ctx.strokeStyle = art.accent;
          ctx.beginPath(); ctx.ellipse(bx, y, radius * 0.3, radius * 0.08, 0, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'orbit':
          ctx.save(); ctx.translate(bx, by);
          for (let i = 0; i < (lowQuality ? 2 : 3); i++) {
            const angle = travel * Math.PI * 1.5 + i * Math.PI * 2 / 3;
            const distance = radius * (1.1 - travel * 0.65);
            ctx.strokeStyle = i % 2 ? art.accent : art.primary;
            ctx.beginPath(); ctx.ellipse(0, 0, distance, distance * 0.55, art.angle, angle - 0.55, angle); ctx.stroke();
            diamond(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.55, 5 * scale);
          }
          ctx.restore(); break;
        case 'rift':
          if (art.motif === 'blades') {
            // Cecilia's paired blade edges close toward the victim, not a generic magical gate.
            const count = lowQuality ? 2 : 4, size = radius * 0.34;
            const distance = radius * (0.78 - travel * 0.55);
            const bearing = Math.atan2(by - ay, bx - ax);
            ctx.save(); ctx.translate(bx, by);
            for (let i = 0; i < count; i++) {
              const angle = bearing + art.angle + Math.PI / 4 + i * Math.PI * 2 / count;
              ctx.save(); ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
              ctx.rotate(angle + Math.PI); ctx.strokeStyle = art.primary;
              path([[-size * 0.65, -size * 0.38], [size * 0.85, 0], [-size * 0.65, size * 0.38]]);
              ctx.strokeStyle = art.accent;
              path([[-size * 0.4, -size * 0.18], [size * 0.48, 0], [-size * 0.4, size * 0.18]]);
              ctx.restore();
            }
            ctx.restore(); break;
          }
          if (art.motif === 'vortex') {
            // Hollow curls descend into the real recipient instead of the shared slit and ellipse gates.
            const count = lowQuality ? 2 : 3;
            const curl = radius * (0.38 - travel * 0.16);
            ctx.save(); ctx.translate(bx, by);
            for (let i = 0; i < count; i++) {
              const offset = i - (count - 1) / 2;
              const y = -radius * (1.8 * (1 - travel) + Math.abs(offset) * 0.12);
              ctx.save(); ctx.translate(offset * radius * 0.4 * (1 - travel * 0.3), y);
              ctx.strokeStyle = i % 2 ? art.accent : art.primary;
              ctx.beginPath(); ctx.moveTo(-curl * 0.65, -curl * 0.9);
              ctx.quadraticCurveTo(curl, -curl * 0.55, curl * 0.45, curl * 0.4);
              ctx.quadraticCurveTo(-curl * 0.25, curl * 0.75, -curl * 0.5, 0); ctx.stroke();
              ctx.strokeStyle = art.accent;
              ctx.beginPath(); ctx.moveTo(-curl * 0.28, -curl * 0.48);
              ctx.quadraticCurveTo(curl * 0.5, -curl * 0.2, curl * 0.12, curl * 0.3); ctx.stroke();
              ctx.restore();
            }
            ctx.restore(); break;
          }
          ctx.save(); ctx.translate(bx, by); ctx.rotate(art.angle);
          if (art.motif === 'coffin') {
            // Outlined halves open around the real victim without painting over their body.
            const h = radius * 0.85, w = radius * 0.3, gap = radius * travel * 0.3;
            for (const side of [-1, 1]) {
              ctx.save(); ctx.translate(side * gap, 0);
              ctx.strokeStyle = art.primary;
              path([[0, -h], [side * w * 0.65, -h], [side * w, -h * 0.45],
                [side * w * 0.8, h], [0, h]], true);
              ctx.strokeStyle = art.accent;
              path([[side * w * 0.35, -h * 0.5], [side * w * 0.35, h * 0.3]]);
              ctx.restore();
            }
          } else if (art.motif === 'eye') {
            const w = radius * 0.85, h = radius * travel * 0.45;
            ctx.strokeStyle = art.primary;
            ctx.beginPath(); ctx.moveTo(-w, 0);
            ctx.quadraticCurveTo(0, -h * 2, w, 0);
            ctx.quadraticCurveTo(0, h * 2, -w, 0); ctx.stroke();
            ctx.strokeStyle = art.accent;
            ring(0, 0, radius * 0.16 * travel);
            path([[0, -h * 0.45], [0, h * 0.45]]);
          } else {
            ctx.strokeStyle = art.accent;
            path([[-radius * 0.12, -radius * travel], [radius * 0.12, 0], [-radius * 0.12, radius * travel]]);
            ctx.strokeStyle = art.primary;
            for (const side of [-1, 1]) {
              ctx.beginPath(); ctx.ellipse(side * radius * (1 - travel) * 0.4, 0, radius * 0.2, radius * travel, 0, -1.3, 1.3); ctx.stroke();
            }
          }
          ctx.restore(); break;
      }
      ctx.strokeStyle = art.primary;
      ctx.globalAlpha /= 0.65;
    }
  }
  const arrival = effect.kind === 'cast' ? bloom : Math.sin(p * Math.PI);
  if (arrival > 0) {
    // Ease only the arrival layer through its existing bloom window; delivery and simulation timing stay intact.
    ctx.globalAlpha *= arrival;
    const r = radius * (0.65 + arrival * 0.35);
    if (art.motif === 'prism') {
      // Facets open outward and settle; keep the recipient visible through the entire bloom.
      ctx.save(); ctx.translate(bx, by);
      const count = effect.sourceHeroId === 'hero_248_eluard' ? 4 : 3;
      const size = r * 0.3, distance = r * (0.32 + arrival * 0.18);
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + i * Math.PI * 2 / count;
        const x = Math.cos(angle) * distance, y = Math.sin(angle) * distance;
        ctx.strokeStyle = i % 2 ? art.accent : art.primary;
        path([[x, y - size], [x + size * 0.4, y], [x, y + size * 0.75], [x - size * 0.4, y]], true);
        path([[x, y - size], [x, y + size * 0.75]]);
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (art.motif === 'seraph') {
      // Short separated rays acknowledge Divine Light without a second body-sized pillar bloom.
      const count = lowQuality ? effect.ultimate ? 4 : 3 : effect.ultimate ? 6 : 4;
      const settle = Math.max(0, Math.min(1, (p - 0.66) / 0.34));
      ctx.save(); ctx.translate(bx, by); ctx.shadowBlur = 0;
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + i * Math.PI * 2 / count;
        const near = radius * 0.24, far = radius * (0.7 - settle * 0.1);
        ctx.strokeStyle = i % 2 ? art.accent : art.primary;
        path([[Math.cos(angle) * near, Math.sin(angle) * near], [Math.cos(angle) * far, Math.sin(angle) * far]]);
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (art.motif === 'vortex') {
      // Hollow spiral arms leave the victim readable; no filled core or shared arrival halo.
      const count = lowQuality ? 2 : 3, segments = lowQuality ? 12 : 18;
      const settle = Math.max(0, Math.min(1, (p - 0.66) / 0.34));
      ctx.save(); ctx.translate(bx, by); ctx.shadowBlur = 0;
      for (let arm = 0; arm < count; arm++) {
        ctx.strokeStyle = arm % 2 ? art.accent : art.primary;
        ctx.beginPath();
        for (let j = 0; j <= segments; j++) {
          const t = j / segments;
          const angle = t * Math.PI * 1.3 + arm * Math.PI * 2 / count - settle * 0.45;
          const distance = radius * (0.24 + t * 0.46) * (1 - settle * 0.08);
          const x = Math.cos(angle) * distance, y = Math.sin(angle) * distance;
          if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (art.motif === 'coffin') {
      // Two light outline halves close on the actual victim without an opaque seal or radial burst.
      const settle = Math.max(0, Math.min(1, (p - 0.66) / 0.34));
      const h = radius * 0.58, w = radius * 0.24;
      const gap = radius * (0.05 + (1 - settle) * 0.18);
      ctx.save(); ctx.translate(bx, by); ctx.shadowBlur = 0;
      for (const side of [-1, 1]) {
        ctx.save(); ctx.translate(side * gap, 0);
        ctx.strokeStyle = art.primary;
        path([[0, -h], [side * w * 0.65, -h], [side * w, -h * 0.45],
          [side * w * 0.8, h], [0, h]], true);
        ctx.strokeStyle = art.accent;
        path([[side * w * 0.35, -h * 0.5], [side * w * 0.35, h * 0.3]]);
        ctx.restore();
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (art.motif === 'eye') {
      // The eye settles over the actual recipient; open contours never paint over the body.
      const settle = Math.max(0, Math.min(1, (p - 0.66) / 0.34));
      const w = radius * 0.62, h = radius * 0.42 * (1 - settle * 0.65);
      ctx.save(); ctx.translate(bx, by); ctx.shadowBlur = 0;
      ctx.strokeStyle = art.primary;
      ctx.beginPath(); ctx.moveTo(-w, 0);
      ctx.quadraticCurveTo(0, -h, w, 0);
      ctx.quadraticCurveTo(0, h, -w, 0); ctx.stroke();
      ctx.strokeStyle = art.accent;
      path([[0, -h * 0.35], [0, h * 0.35]]);
      ctx.restore(); ctx.restore(); return true;
    }
    if (art.motif === 'embers') {
      // Fire Breath ends in short open tongues along the actual breath bearing, not flower petals.
      const count = lowQuality ? 2 : 3;
      const size = r * 0.42;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.atan2(by - ay, bx - ax)); ctx.shadowBlur = 0;
      for (let i = 0; i < count; i++) {
        const y = (i - (count - 1) / 2) * r * 0.28;
        const tip = size * (i % 2 ? 0.8 : 1);
        ctx.strokeStyle = art.primary;
        ctx.beginPath(); ctx.moveTo(-size * 0.8, y - size * 0.2);
        ctx.quadraticCurveTo(size * 0.05, y - size * 0.55, tip, y); ctx.stroke();
        ctx.strokeStyle = art.accent;
        ctx.beginPath(); ctx.moveTo(-size * 0.55, y + size * 0.25);
        ctx.quadraticCurveTo(size * 0.15, y + size * 0.4, tip * 0.75, y); ctx.stroke();
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (art.motif === 'crossfire') {
      // Gunfire arrives along the actual shot bearing, never as a radial magic explosion.
      const count = lowQuality ? effect.ultimate ? 3 : 2 : effect.ultimate ? 5 : 3;
      const size = r * 0.35;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.atan2(by - ay, bx - ax)); ctx.shadowBlur = 0;
      for (let i = 0; i < count; i++) {
        const y = (i - (count - 1) / 2) * r * 0.18;
        const x = r * (i % 2 ? 0.04 : 0.18) * arrival;
        ctx.strokeStyle = i % 2 ? art.accent : art.primary;
        path([[x - size, y], [x + size * 0.35, y]]);
        ctx.strokeStyle = art.accent;
        for (const side of [-1, 1]) path([[x + size * 0.1, y + side * size * 0.14],
          [x + size * 0.42, y + side * size * 0.36]]);
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (art.motif === 'lance') {
      // Short staggered tips carry the charge direction without laying full shafts across the victim.
      const bearing = Math.atan2(by - ay, bx - ax);
      const count = effect.ultimate ? art.rays : Math.min(3, art.rays);
      const size = r * 0.38;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(art.angle + bearing);
      for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * r * 0.2;
        const advance = r * ((i % 2 ? 0.04 : 0.16) + arrival * 0.08);
        ctx.save(); ctx.translate(advance, offset); ctx.rotate(-0.26);
        ctx.strokeStyle = art.primary;
        path([[-size, 0], [size * 0.45, 0]]);
        ctx.fillStyle = art.accent;
        path([[size * 0.8, 0], [size * 0.12, -size * 0.22], [size * 0.28, 0],
          [size * 0.12, size * 0.22]], true, true);
        ctx.restore();
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (art.motif === 'blades') {
      // Short open cuts follow the real strike bearing, then contract instead of spinning over the body.
      const count = lowQuality ? effect.ultimate ? 3 : 2 : effect.ultimate ? Math.min(4, art.rays) : 2;
      const settle = Math.max(0, Math.min(1, (p - 0.66) / 0.34));
      const size = radius * (0.52 - settle * 0.1);
      ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.atan2(by - ay, bx - ax) + art.angle);
      ctx.shadowBlur = 0;
      for (let i = 0; i < count; i++) {
        const y = (i - (count - 1) / 2) * radius * 0.2;
        const bend = (i % 2 ? -1 : 1) * size * 0.42;
        ctx.strokeStyle = i % 2 ? art.accent : art.primary;
        ctx.beginPath(); ctx.moveTo(-size, y - bend * 0.35);
        ctx.quadraticCurveTo(size * 0.12, y + bend, size, y - bend * 0.35); ctx.stroke();
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (art.motif === 'arrows' || art.motif === 'daggers') {
      // Preserve each weapon's head and fletching/guard without a shared magical contact bloom.
      const count = lowQuality ? 2 : effect.ultimate ? 4 : 3;
      const settle = Math.max(0, Math.min(1, (p - 0.66) / 0.34));
      const size = radius * (0.4 - settle * 0.06);
      ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.atan2(by - ay, bx - ax) + art.angle); ctx.shadowBlur = 0;
      for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * radius * 0.2;
        const spread = art.motif === 'daggers' ? (i - (count - 1) / 2) * 0.18 : -0.12;
        weapon(radius * 0.12 * (1 - settle * 0.5), offset, size, spread);
      }
      ctx.restore(); ctx.restore(); return true;
    }
    if (art.motif === 'aegis' || art.motif === 'bastion') {
      // Offensive shield contact is a small settling crest, never an allied body-sized ward.
      const settle = Math.max(0, Math.min(1, (p - 0.66) / 0.34));
      const h = radius * (0.6 - settle * 0.1), w = h * 0.68;
      ctx.save(); ctx.translate(bx, by); ctx.shadowBlur = 0;
      ctx.strokeStyle = art.primary;
      path([[-w, -h * 0.6], [0, -h], [w, -h * 0.6], [w * 0.75, h * 0.35],
        [0, h], [-w * 0.75, h * 0.35]], true);
      ctx.strokeStyle = art.accent;
      if (art.motif === 'aegis') {
        path([[0, -h * 0.55], [0, h * 0.5]]);
        path([[-w * 0.5, -h * 0.15], [w * 0.5, -h * 0.15]]);
      } else {
        path([[-w * 0.55, 0], [0, -h * 0.35], [w * 0.55, 0]]);
        path([[0, -h * 0.35], [0, h * 0.55]]);
      }
      ctx.restore(); ctx.restore(); return true;
    }
    halo(bx, by, r * 1.35);
    ctx.save(); ctx.translate(bx, by); ctx.rotate(art.angle);
    ctx.lineWidth = Math.max(1, 2.5 * scale);
    switch (art.motif) {
      case 'scripture': {
        path([[0, -r * 0.3], [-r * 0.6, -r * 0.5], [-r * 0.6, r * 0.25], [0, r * 0.45], [r * 0.6, r * 0.25], [r * 0.6, -r * 0.5], [0, -r * 0.3]], true);
        path([[0, -r * 0.3], [0, r * 0.45]]);
        ctx.strokeStyle = art.accent;
        for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
          ctx.beginPath(); ctx.moveTo(side * r * 0.25, 0);
          ctx.quadraticCurveTo(side * r * 0.75, -r * (0.9 - i * 0.12), side * r * (1.5 - i * 0.16), -r * (0.3 - i * 0.18)); ctx.stroke();
        }
        break;
      }
      case 'coins':
      case 'petals':
      case 'rose': {
        for (let i = 0; i < art.rays; i++) {
          const angle = i / art.rays * Math.PI * 2 + p * 0.65;
          const distance = r * (art.motif === 'rose' ? 0.3 : 0.3 + arrival * 0.65);
          ctx.save(); ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance); ctx.rotate(angle);
          ctx.beginPath(); ctx.ellipse(0, 0, r * 0.16, r * (art.motif === 'coins' ? 0.16 : 0.34), 0, 0, Math.PI * 2);
          ctx.fillStyle = i % 2 ? art.accent : art.primary; ctx.fill(); ctx.restore();
        }
        if (art.motif === 'rose') {
          ctx.strokeStyle = art.accent;
          path([[0, r * 0.2], [-r * 0.1, r * 1.2], [r * 0.2, r * 0.9], [-r * 0.1, r * 0.72], [-r * 0.35, r * 0.85]]);
        }
        break;
      }
    }
    if (!lowQuality) for (let i = 0; i < art.rays; i++) {
      const angle = i * Math.PI * 2 / art.rays + effect.id;
      const distance = r * (0.7 + p * 0.7);
      ctx.fillStyle = i % 2 ? art.accent : art.primary;
      diamond(Math.cos(angle) * distance, Math.sin(angle) * distance, (1 - p) * 4 * scale);
    }
    ctx.restore();
  }
  ctx.restore();
  return true;
}
