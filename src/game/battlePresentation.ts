// PROTOTYPE - NOT FOR PRODUCTION
import type { BattleSimulation } from './battleEngine';
import type { BattleSnapshot, CombatEvent } from './types';

/** Plays at most one impact per drained batch, preserving critical feedback without voice flooding. */
export function playBattleImpact(events: readonly CombatEvent[], audio: { playHit: (critical: boolean) => void }): void {
  const hits = events.filter(event => event.type === 'damage' && Number.isFinite(event.value) && (event.value ?? 0) > 0);
  if (hits.length) audio.playHit(hits.some(event => !!event.isCrit));
}

/** Drains presentation events and reports terminal state once per simulation lifetime. */
export function createBattlePresentationObserver() {
  const reported = new WeakSet<BattleSimulation>();
  return (
    sim: BattleSimulation,
    onEvents: (events: CombatEvent[]) => void,
    onFinished: (snapshot: BattleSnapshot) => void,
  ): void => {
    const events = sim.consumeEvents();
    if (events.length) onEvents(events);
    const status = sim.getStatus();
    if ((status === 'victory' || status === 'defeat') && !reported.has(sim)) {
      reported.add(sim);
      onFinished(sim.getSnapshot());
    }
  };
}
