// PROTOTYPE - NOT FOR PRODUCTION
import type { BattleSnapshot, BattleUnitRuntime } from './types';

/** Describe normal energy readiness separately from the existing instant-cast showcase action. */
export function getUltimateReadiness(unit: BattleUnitRuntime | undefined, battleStatus: BattleSnapshot['status'] = 'running') {
  const energy = unit && Number.isFinite(unit.energy) ? Math.max(0, Math.min(100, unit.energy)) : 0;
  if (!unit) return { state: 'waiting', label: 'Đang chờ', energy, canShowcase: false } as const;
  if (!unit.isAlive) return { state: 'dead', label: 'Đã gục', energy, canShowcase: false } as const;
  if (battleStatus !== 'running') return { state: 'finished', label: 'Kết thúc', energy, canShowcase: false } as const;
  // Match BattleSimulation.triggerUltimate: these controls block even forced casts.
  const control = unit.statusEffects.find(effect => ['stun', 'petrify', 'silence'].includes(effect.type));
  if (control) return { state: 'blocked', label: control.type === 'stun' ? 'Choáng' : control.type === 'petrify' ? 'Hóa đá' : 'Câm lặng', energy, canShowcase: false } as const;
  if (energy >= 100) return { state: 'ready', label: 'Sẵn sàng', energy, canShowcase: true } as const;
  return { state: 'charging', label: `Nạp ${Math.floor(energy)}%`, energy, canShowcase: true } as const;
}
