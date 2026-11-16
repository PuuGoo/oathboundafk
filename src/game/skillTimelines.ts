// PROTOTYPE - NOT FOR PRODUCTION
import type { CombatTimeline } from './types';

type Slot = 'basic' | 'active' | 'ultimate';
const FIRST_SQUAD = new Set(['estrilda', 'celestial_guardian', 'raine', 'belinda', 'fawkes']);

/** Initial project timing, not claimed source-sheet contact markers or official AFK data. */
export function getCombatTimeline(heroId: string, slot: Slot): CombatTimeline | undefined {
  if (!FIRST_SQUAD.has(heroId)) return undefined;
  const timing = slot === 'basic' ? { prepareMs: 100, releaseMs: 100, impactMs: 200, durationMs: 400 } :
    slot === 'active' ? { prepareMs: 300, releaseMs: 300, impactMs: 600, durationMs: 1150 } :
      { prepareMs: 450, releaseMs: 450, impactMs: 850, durationMs: 1650 };
  const hits = heroId === 'belinda' && slot === 'ultimate'
    ? [650, 850, 1050, 1250].map(atMs => ({ atMs, damageShare: 0.25 }))
    : [{ atMs: timing.impactMs, damageShare: 1 }];
  return { skillId: `oathbound.${heroId}.${slot}`, prepareMs: timing.prepareMs,
    releaseMs: timing.releaseMs, hits, durationMs: timing.durationMs,
    targetPolicy: 'lock-at-cast', cancelPolicy: 'death-or-hard-control' };
}

/** Maps shared simulation release/contact markers to the existing art's authored procedural phases. */
export function getTimelineVisualPhase(timeline: CombatTimeline, ageSeconds: number): number {
  const time = Math.max(0, ageSeconds * 1000);
  const release = timeline.releaseMs, contact = timeline.hits[0].atMs;
  if (time <= release) return release > 0 ? time / release * 0.18 : 0.18;
  if (time <= contact) return 0.18 + (time - release) / (contact - release) * 0.32;
  return Math.min(1, 0.5 + (time - contact) / (timeline.durationMs - contact) * 0.5);
}
