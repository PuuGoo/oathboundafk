// PROTOTYPE - NOT FOR PRODUCTION
import type { BattleUnitRuntime, CombatEvent } from './types';
import presentation from './spritePresentation.json';

/** One real ultimate cast; presentation-only, never a combat multiplier. */
export interface UltimateAnnouncement {
  id: number;
  sourceId: string;
  name: string;
  skill: string;
  team: BattleUnitRuntime['team'];
  timestampMs: number;
  remaining: number;
}

/** Retain independent cast lifetimes with a bounded recent feed. */
export function addUltimateAnnouncement(entries: UltimateAnnouncement[], event: CombatEvent, source: BattleUnitRuntime): boolean {
  if (event.type !== 'ultimate_cast' || entries.some(entry => entry.id === event.id)) return false;
  entries.push({ id: event.id, sourceId: source.instanceId, name: source.name,
    skill: event.skillName || 'Tuyệt kỹ', team: source.team, timestampMs: event.timestampMs,
    remaining: presentation.ultimate.bannerSeconds });
  if (entries.length > presentation.ultimate.maxAnnouncements) entries.splice(0, entries.length - presentation.ultimate.maxAnnouncements);
  return true;
}

/** Consume simulation time; zero dt freezes the complete announcement feed. */
export function advanceUltimateAnnouncements(entries: UltimateAnnouncement[], seconds: number): boolean {
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  let changed = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    entries[i].remaining = Math.max(0, entries[i].remaining - seconds);
    if (entries[i].remaining === 0) { entries.splice(i, 1); changed = true; }
  }
  return changed;
}

/** Newest first; combo counts distinct casters near the newest cast of EACH team. */
export function getUltimateAnnouncementView(entries: readonly UltimateAnnouncement[]) {
  const recent = [...entries].reverse();
  const count = (team: BattleUnitRuntime['team']) => {
    const latest = recent.find(entry => entry.team === team);
    if (!latest) return 0;
    return new Set(recent.filter(entry => entry.team === team && entry.timestampMs <= latest.timestampMs &&
      latest.timestampMs - entry.timestampMs <= presentation.ultimate.comboWindowMs).map(entry => entry.sourceId)).size;
  };
  return { rows: recent.slice(0, presentation.ultimate.maxVisible), hidden: recent.slice(presentation.ultimate.maxVisible),
    allyCombo: count('ally'), enemyCombo: count('enemy') };
}
