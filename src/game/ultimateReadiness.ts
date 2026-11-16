// PROTOTYPE - NOT FOR PRODUCTION
import type { BattleSnapshot, BattleUnitRuntime } from './types';

/** Describe ultimate eligibility: full energy, a living actor and no blocking control. */
export function getUltimateReadiness(unit: BattleUnitRuntime | undefined, battleStatus: BattleSnapshot['status'] = 'running') {
  const energy = unit && Number.isFinite(unit.energy) ? Math.max(0, Math.min(100, unit.energy)) : 0;
  if (!unit) return { state: 'waiting', label: 'Đang chờ', energy, canCast: false } as const;
  if (!unit.isAlive) return { state: 'dead', label: 'Đã gục', energy, canCast: false } as const;
  if (battleStatus !== 'running') return { state: 'finished', label: 'Kết thúc', energy, canCast: false } as const;
  if (unit.statusEffects.some(effect => effect.type === 'isolation' && effect.remainingMs > 0))
    return { state: 'blocked', label: 'Cô lập', energy, canCast: false } as const;
  // Match BattleSimulation.triggerUltimate: energy never bypasses these controls.
  const control = unit.statusEffects.find(effect => ['stun', 'petrify', 'silence'].includes(effect.type));
  if (control) return { state: 'blocked', label: control.type === 'stun' ? 'Choáng' : control.type === 'petrify' ? 'Hóa đá' : 'Câm lặng', energy, canCast: false } as const;
  if (unit.currentCast) return { state: 'casting', label: 'Đang thi triển', energy, canCast: false } as const;
  if (energy >= 100) return { state: 'ready', label: 'Sẵn sàng', energy, canCast: true } as const;
  return { state: 'charging', label: `Nạp ${Math.floor(energy)}%`, energy, canCast: false } as const;
}
