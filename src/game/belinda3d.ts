// PROTOTYPE - NOT FOR PRODUCTION
import type { BattleUnitRuntime } from './types';
import type { SpriteActor } from './spriteBattleRenderer';
import type { SpriteEffect } from './spriteBattleEffects';
import type { BelindaSpellFrame } from './belindaSpell3d';
import { loadHeroBackend } from './hero3d';

export type BelindaClip = 'idle' | 'run' | 'basic' | 'active' | 'ultimate' | 'hit' | 'death';
export interface BelindaPose { clip: BelindaClip; seconds: number }

/** Pure presentation selection. The engine remains the sole owner of combat outcomes. */
export function getBelindaPose(unit: BattleUnitRuntime, actor: SpriteActor, elapsedMs: number,
  reducedMotion: boolean, previous?: BelindaPose): BelindaPose {
  if (!unit.isAlive || unit.hp <= 0) return { clip: 'death', seconds: actor.clip === 'death' ? actor.age : 0 };
  if (unit.statusEffects.some(status => status.remainingMs > 0 && ['stun', 'petrify', 'isolation'].includes(status.type))) {
    return previous || { clip: 'idle', seconds: 0 };
  }
  if (unit.currentCast) {
    const cast = unit.currentCast;
    return { clip: cast.skillSlot, seconds: Math.max(0, Math.min(cast.timeline.durationMs, elapsedMs - cast.startedAtMs)) / 1000 };
  }
  if (actor.actionKind === 'hit' && actor.actionRemaining > 0) return { clip: 'hit', seconds: actor.age };
  return { clip: unit.lastActionType === 'move' ? 'run' : 'idle', seconds: reducedMotion ? 0 : Math.max(0, actor.age) };
}

export interface BelindaRenderBackend {
  /** Returns false on unavailable rendering; caller draws the original sprite instead. */
  draw(ctx: CanvasRenderingContext2D, unit: BattleUnitRuntime, actor: SpriteActor, elapsedMs: number,
    reducedMotion: boolean, x: number, y: number, scale: number): boolean;
  /** Successful IDs alone may replace their Canvas2D counterparts; failures keep fallback intact. */
  drawSpells?(ctx: CanvasRenderingContext2D, effects: readonly SpriteEffect[], layer: 'ground' | 'front',
    frame: Omit<BelindaSpellFrame, 'staffAnchors'>): Set<number>;
  /** Releases per-battle instances, retaining the shared model and renderer. */
  reset(): void;
  /** Releases GPU resources and all instances. Must not mutate combat state. */
  dispose(): void;
}

/** Lazy, failure-contained lifetime wrapper; injectable backend keeps unit tests GPU-independent. */
export function createBelinda3D(load: () => Promise<BelindaRenderBackend> = loadBelindaBackend) {
  let state: 'idle' | 'loading' | 'ready' | 'failed' | 'disposed' = 'idle';
  let backend: BelindaRenderBackend | undefined;
  const release = () => { const old = backend; backend = undefined; try { old?.dispose(); } catch { /* fallback must remain available */ } };
  return {
    status: () => state,
    draw(...args: Parameters<BelindaRenderBackend['draw']>): boolean {
      if (args[1].heroId !== 'belinda' || state === 'disposed' || state === 'failed') return false;
      if (state === 'idle') {
        state = 'loading';
        // A promise boundary also contains synchronous WebGL initialization exceptions.
        Promise.resolve().then(load).then(loaded => {
          if (state === 'disposed') { loaded.dispose(); return; }
          backend = loaded; state = 'ready';
        }).catch(() => { if (state !== 'disposed') { state = 'failed'; release(); } });
      }
      if (!backend) return false;
      try { return backend.draw(...args); }
      catch { state = 'failed'; release(); return false; }
    },
    drawSpells(ctx: CanvasRenderingContext2D, effects: readonly SpriteEffect[], layer: 'ground' | 'front',
      frame: Omit<BelindaSpellFrame, 'staffAnchors'>): Set<number> {
      if (state !== 'ready' || !backend?.drawSpells) return new Set();
      try { return backend.drawSpells(ctx, effects, layer, frame); }
      catch { state = 'failed'; release(); return new Set(); }
    },
    reset() { try { backend?.reset(); } catch { state = 'failed'; release(); } },
    dispose() { if (state === 'disposed') return; state = 'disposed'; release(); },
  };
}

async function loadBelindaBackend(): Promise<BelindaRenderBackend> {
  return loadHeroBackend();
}
