import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Laptop, Smartphone, Trophy } from 'lucide-react';

const Leaderboard = ({
  leaderboard = [],
  rankTiers = [],
  user,
  isDark = false,
  iconStyle,
  rankIcon,
  rankLabel,
}) => {
  const { t } = useTranslation('common');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [closingLeaderboard, setClosingLeaderboard] = useState(false);
  const [leaderboardCountdown, setLeaderboardCountdown] = useState({
    days: '00',
    hours: '00',
    minutes: '00',
    seconds: '00',
  });

  useEffect(() => {
    if (showLeaderboard) setClosingLeaderboard(false);
  }, [showLeaderboard]);

  useEffect(() => {
    if (!showLeaderboard) return;
    const updateCountdown = () => {
      const now = new Date();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0);
      const diff = Math.max(0, endOfMonth - now);
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);
      setLeaderboardCountdown({
        days: String(days).padStart(2, '0'),
        hours: String(hours).padStart(2, '0'),
        minutes: String(minutes).padStart(2, '0'),
        seconds: String(seconds).padStart(2, '0'),
      });
    };
    updateCountdown();
    const id = setInterval(updateCountdown, 1000);
    return () => clearInterval(id);
  }, [showLeaderboard]);

  const closeWithAnim = (setClosing, setShow) => {
    setClosing(true);
    setTimeout(() => {
      setShow(false);
      setClosing(false);
    }, 260);
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setShowLeaderboard(true);
        }}
        className={`relative z-10 flex items-center justify-center w-14 h-14 rounded-2xl shadow-sm transition pointer-events-auto overflow-visible ${
          isDark
            ? 'bg-slate-900/85 text-amber-200 border border-white/10 hover:bg-slate-800'
            : 'bg-white text-orange-600 border border-white/60 hover:bg-orange-50'
        }`}
      >
        <div
          className={`pointer-events-none absolute inset-0 rounded-xl blur-md scale-140 opacity-70 -z-10 ${
            isDark
              ? 'bg-white/8 shadow-[0_16px_40px_-24px_rgba(0,0,0,0.8)]'
              : 'bg-white/60 shadow-[0_14px_34px_-26px_rgba(0,0,0,0.25)]'
          }`}
          aria-hidden="true"
        />
        <Trophy size={22} style={iconStyle ? iconStyle('leaderboard') : undefined} />
      </button>

      {showLeaderboard && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingLeaderboard ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={() => closeWithAnim(setClosingLeaderboard, setShowLeaderboard)}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative ${
              closingLeaderboard ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center space-x-2 mb-4">
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                <Trophy size={20} style={iconStyle ? iconStyle('leaderboard') : undefined} />
              </div>
              <h3 className="text-xl font-bold text-gray-900">{t('leaderboard', 'Leaderboard')}</h3>
            </div>
            <div className="mb-4 bg-orange-50/70 rounded-xl px-3 py-2 text-sm text-orange-700 font-semibold flex items-center justify-between shadow-sm shadow-orange-100/80">
              <span>{t('resetsIn', 'Resets in')}</span>
              <div className="flex space-x-2 font-mono">
                <span>{leaderboardCountdown.days}d</span>
                <span>{leaderboardCountdown.hours}h</span>
                <span>{leaderboardCountdown.minutes}m</span>
                <span>{leaderboardCountdown.seconds}s</span>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto no-scrollbar rounded-2xl overflow-hidden bg-white shadow-sm shadow-gray-200/60 divide-y divide-gray-100/40">
              {leaderboard.length === 0 && (
                <p className="text-sm text-gray-400 px-4 py-6">{t('noLeaderboard', 'No leaderboard data yet.')}</p>
              )}
              {leaderboard.map((u, idx) => {
                const txnCount = Number(u.transactions ?? u.transactionCount ?? u.historyCount ?? 0);
                const isMe = u.id === user?.uid;
                return (
                  <div
                    key={u.id || idx}
                    className={`flex items-center justify-between px-4 py-3 transition-colors active:bg-gray-50 ${
                      isMe ? 'bg-orange-50/60' : 'bg-white'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="relative w-8 h-8 rounded-full bg-orange-50 text-orange-700 font-bold flex items-center justify-center">
                        {idx === 0 ? (
                          <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-amber-500 crown-bounce">
                            👑
                          </span>
                        ) : null}
                        {idx + 1}
                      </div>
                      <div className="flex items-center space-x-2">
                        <img
                          src={rankIcon ? rankIcon(txnCount) : ''}
                          alt="Rank"
                          className="w-8 h-8 rounded-full object-contain bg-white p-1"
                        />
                        <div className="truncate max-w-[180px]">
                          <p className="font-semibold text-gray-900 truncate">{u.displayName || t('unknown', 'Unknown')}</p>
                          <p className="text-[11px] font-semibold text-orange-600 truncate">
                            {rankLabel ? rankLabel(txnCount) : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold text-gray-900">{txnCount}</p>
                      <div className="mt-1 flex justify-end">
                        {idx === 0 && <Car size={16} style={iconStyle ? iconStyle('tierCar') : undefined} />}
                        {idx > 0 && idx < 5 && <Laptop size={16} style={iconStyle ? iconStyle('tierLaptop') : undefined} />}
                        {idx >= 5 && idx < 10 && <Smartphone size={16} style={iconStyle ? iconStyle('tierPhone') : undefined} />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2 text-[11px] text-gray-600">
              {rankTiers.map((tier) => (
                <button
                  key={tier.label}
                  type="button"
                  className="flex flex-col items-center bg-orange-50 rounded-lg px-2 py-2 hover:bg-orange-100 transition shadow-sm shadow-orange-100/70"
                >
                  <img src={tier.img} alt={tier.label} className="w-10 h-10 object-contain" />
                  <span className="font-semibold text-orange-700">{tier.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Leaderboard;
