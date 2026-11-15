// PROTOTYPE - NOT FOR PRODUCTION
import { useLayoutEffect, useRef } from 'react';
import { containDialogFocus } from './dialogFocus';

/** Pause controls own their focus lifecycle so teardown runs before their DOM is removed. */
export function BattlePauseModal({ chapter, stageName, onResume, onRetry }: {
  chapter: string;
  stageName: string;
  onResume: () => void;
  onRetry: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!dialogRef.current) return;
    return containDialogFocus(dialogRef.current, onResume,
      ['KeyC', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyR']);
  }, [onResume]);

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}
      aria-label="Tạm dừng trận đấu" data-testid="pause-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 pointer-events-auto">
      <div className="w-full max-w-sm bg-[#f2e2c4] border-4 border-[#8c6430] rounded-2xl p-5 text-center shadow-2xl space-y-3 text-[#3b2512]">
        <h2 className="text-xl font-extrabold text-[#5c3818] uppercase" style={{ fontFamily: '"Cinzel", serif' }}>
          Paused · Tạm Dừng
        </h2>
        <p className="text-xs text-[#6b4826] truncate">{chapter} — {stageName}</p>
        <div className="flex flex-col gap-2 pt-1">
          <button type="button" data-testid="resume-battle-btn" onClick={onResume}
            className="w-full py-2.5 rounded-xl bg-gradient-to-b from-[#67e8f9] to-[#0284c7] text-[#041019] font-extrabold text-xs uppercase tracking-wider cursor-pointer shadow">
            Continue · Tiếp Tục Chiến Đấu
          </button>
          <button type="button" onClick={onRetry}
            className="w-full py-2.5 rounded-xl bg-[#8c6239] hover:bg-[#734f2c] text-amber-100 font-bold text-xs uppercase tracking-wider cursor-pointer">
            Try Again · Đánh Lại Từ Đầu
          </button>
        </div>
      </div>
    </div>
  );
}
