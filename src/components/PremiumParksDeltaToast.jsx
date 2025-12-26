import React, { useEffect, useMemo, useState } from 'react';
import { Heart } from 'lucide-react';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const PremiumParksDeltaToast = ({
  fromCount = 0,
  toCount = 0,
  max = 5,
  title = 'Premium Parks',
  durationMs = 2600,
  onDone,
}) => {
  const from = useMemo(() => clamp(Number(fromCount) || 0, 0, max), [fromCount, max]);
  const to = useMemo(() => clamp(Number(toCount) || 0, 0, max), [toCount, max]);
  const delta = to - from;

  const changedIndex = useMemo(() => {
    if (delta > 0) return clamp(from, 0, max - 1);
    if (delta < 0) return clamp(to, 0, max - 1);
    return null;
  }, [delta, from, to, max]);

  const [phase, setPhase] = useState('enter');

  useEffect(() => {
    const exitAt = Math.max(0, durationMs - 380);
    const exitTimer = window.setTimeout(() => setPhase('exit'), exitAt);
    const doneTimer = window.setTimeout(() => onDone?.(), durationMs);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [durationMs, onDone]);

  if (delta === 0) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center pointer-events-none">
      <div className={`pp-toast ${phase === 'exit' ? 'pp-toast-exit' : 'pp-toast-enter'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-white/90 text-sm font-semibold tracking-tight">{title}</div>
          <div
            className={`text-[11px] font-bold px-2 py-1 rounded-full ${
              delta > 0 ? 'bg-emerald-400/20 text-emerald-200' : 'bg-rose-400/20 text-rose-200'
            }`}
          >
            {delta > 0 ? `+${delta}` : `${delta}`}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-center gap-1">
          {Array.from({ length: max }).map((_, idx) => {
            const filled = idx < to;
            const shouldOverlay = changedIndex === idx;
            return (
              <div key={idx} className="relative w-[22px] h-[22px]">
                <Heart
                  size={22}
                  strokeWidth={2.25}
                  className={filled ? 'text-rose-300' : 'text-white/25'}
                  fill={filled ? 'currentColor' : 'none'}
                />
                {shouldOverlay ? (
                  <Heart
                    size={22}
                    strokeWidth={2.25}
                    className={`absolute inset-0 text-rose-300 ${
                      delta > 0 ? 'pp-heart-gain' : 'pp-heart-loss'
                    }`}
                    fill="currentColor"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PremiumParksDeltaToast;
