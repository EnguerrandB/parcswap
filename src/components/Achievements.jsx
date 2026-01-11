import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  Camera,
  Car,
  Check,
  Compass,
  Flame,
  Gem,
  Gift,
  Handshake,
  ArrowRight,
  MapPin,
  Search,
  Sunrise,
  Trophy,
} from 'lucide-react';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return null;
};

const dayKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDayKeyUtc = (key) => {
  const [y, m, d] = String(key || '').split('-').map((v) => Number(v));
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
};

const getTxAmount = (tx) => {
  const raw = tx?.amount ?? tx?.price ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

const Achievements = ({ transactions = [], vehicles = [], isDark = false, iconStyle, onCollapse }) => {
  const { t } = useTranslation('common');
  const [showAchievementsModal, setShowAchievementsModal] = useState(false);
  const [selectedAchievementId, setSelectedAchievementId] = useState(null);

  const achievementStats = useMemo(() => {
    const txs = Array.isArray(transactions) ? transactions : [];
    const v = Array.isArray(vehicles) ? vehicles : [];

    const hostTxs = txs.filter((tx) => tx?.role === 'host');
    const bookerTxs = txs.filter((tx) => tx?.role === 'booker');
    const concludedTxs = txs.filter((tx) => tx?.status === 'concluded');
    const concludedHostTxs = concludedTxs.filter((tx) => tx?.role === 'host');
    const concludedBookerTxs = concludedTxs.filter((tx) => tx?.role === 'booker');

    const freeHostConcludedCount = concludedHostTxs.filter((tx) => getTxAmount(tx) <= 0).length;
    const highValueConcludedCount = concludedTxs.filter((tx) => getTxAmount(tx) >= 10).length;

    const hostEarlyCount = hostTxs.filter((tx) => {
      const date = toDate(tx?.createdAt) || toDate(tx?.updatedAt);
      if (!date) return false;
      return date.getHours() < 9;
    }).length;

    const weekendConcludedCount = concludedTxs.filter((tx) => {
      const date = toDate(tx?.createdAt) || toDate(tx?.updatedAt);
      if (!date) return false;
      const dow = date.getDay();
      return dow === 0 || dow === 6;
    }).length;

    const activityDays = new Set();
    txs.forEach((tx) => {
      const created = toDate(tx?.createdAt);
      const updated = toDate(tx?.updatedAt);
      if (created) activityDays.add(dayKey(created));
      if (updated) activityDays.add(dayKey(updated));
    });
    const sortedDays = Array.from(activityDays).sort();
    let bestStreak = 0;
    let currentStreak = 0;
    let prevDayUtc = null;
    sortedDays.forEach((key) => {
      const dayUtc = parseDayKeyUtc(key);
      if (dayUtc == null) return;
      if (prevDayUtc != null && dayUtc - prevDayUtc === 86_400_000) {
        currentStreak += 1;
      } else {
        currentStreak = 1;
      }
      bestStreak = Math.max(bestStreak, currentStreak);
      prevDayUtc = dayUtc;
    });

    return {
      vehiclesCount: v.length,
      vehiclePhotoCount: v.filter((veh) => !!veh?.photo).length,
      hostCount: hostTxs.length,
      bookerCount: bookerTxs.length,
      concludedCount: concludedTxs.length,
      concludedHostCount: concludedHostTxs.length,
      concludedBookerCount: concludedBookerTxs.length,
      freeHostConcludedCount,
      highValueConcludedCount,
      hostEarlyCount,
      weekendConcludedCount,
      bestStreak,
    };
  }, [transactions, vehicles]);

  const achievementDefs = [
    {
      id: 'achv-vehicle',
      labelKey: 'achievementFirstVehicle',
      labelDefault: 'First Wheels',
      Icon: Car,
      badgeClass: 'bg-gradient-to-br from-orange-500 to-amber-400',
      challenges: [
        {
          key: 'achievementFirstVehicleChallenge1',
          fallback: 'Add your first vehicle',
          getProgress: (s) => ({ current: clamp(s.vehiclesCount, 0, 1), target: 1 }),
        },
      ],
    },
    {
      id: 'achv-photo',
      labelKey: 'achievementPhotoReady',
      labelDefault: 'Photo Ready',
      Icon: Camera,
      badgeClass: 'bg-gradient-to-br from-sky-500 to-indigo-500',
      challenges: [
        {
          key: 'achievementPhotoReadyChallenge1',
          fallback: 'Add a photo to a vehicle',
          getProgress: (s) => ({ current: clamp(s.vehiclePhotoCount, 0, 1), target: 1 }),
        },
      ],
    },
    {
      id: 'achv-offer-1',
      labelKey: 'achievementFirstOffer',
      labelDefault: 'First Offer',
      Icon: MapPin,
      badgeClass: 'bg-gradient-to-br from-emerald-500 to-teal-500',
      challenges: [
        {
          key: 'achievementFirstOfferChallenge1',
          fallback: 'Publish your first spot',
          getProgress: (s) => ({ current: clamp(s.hostCount, 0, 1), target: 1 }),
        },
      ],
    },
    {
      id: 'achv-book-1',
      labelKey: 'achievementFirstBooking',
      labelDefault: 'First Booking',
      Icon: Search,
      badgeClass: 'bg-gradient-to-br from-violet-500 to-fuchsia-500',
      challenges: [
        {
          key: 'achievementFirstBookingChallenge1',
          fallback: 'Book your first spot',
          getProgress: (s) => ({ current: clamp(s.bookerCount, 0, 1), target: 1 }),
        },
      ],
    },
    {
      id: 'achv-swap-1',
      labelKey: 'achievementPioneer',
      labelDefault: 'Pioneer',
      Icon: Handshake,
      badgeClass: 'bg-gradient-to-br from-slate-800 to-slate-950',
      challenges: [
        {
          key: 'achievementPioneerChallenge1',
          fallback: 'Complete your first swap',
          getProgress: (s) => ({ current: clamp(s.concludedCount, 0, 1), target: 1 }),
        },
      ],
    },
    {
      id: 'achv-swap-5',
      labelKey: 'achievementTrusty',
      labelDefault: 'Trusty Trader',
      Icon: Trophy,
      badgeClass: 'bg-gradient-to-br from-amber-500 to-orange-500',
      challenges: [
        {
          key: 'achievementTrustyChallenge1',
          fallback: 'Complete 5 swaps',
          getProgress: (s) => ({ current: clamp(s.concludedCount, 0, 5), target: 5 }),
        },
      ],
    },
    {
      id: 'achv-free',
      labelKey: 'achievementGoodSamaritan',
      labelDefault: 'Good Samaritan',
      Icon: Gift,
      badgeClass: 'bg-gradient-to-br from-yellow-500 to-amber-400',
      challenges: [
        {
          key: 'achievementGoodSamaritanChallenge1',
          fallback: 'Complete a free swap as host',
          getProgress: (s) => ({ current: clamp(s.freeHostConcludedCount, 0, 1), target: 1 }),
        },
      ],
    },
    {
      id: 'achv-high-roller',
      labelKey: 'achievementHighRoller',
      labelDefault: 'High Roller',
      Icon: Gem,
      badgeClass: 'bg-gradient-to-br from-rose-500 to-pink-500',
      challenges: [
        {
          key: 'achievementHighRollerChallenge1',
          fallback: 'Complete a swap above €10',
          getProgress: (s) => ({ current: clamp(s.highValueConcludedCount, 0, 1), target: 1 }),
        },
      ],
    },
    {
      id: 'achv-early',
      labelKey: 'achievementEarlyBird',
      labelDefault: 'Early Bird',
      Icon: Sunrise,
      badgeClass: 'bg-gradient-to-br from-orange-500 to-rose-500',
      challenges: [
        {
          key: 'achievementEarlyBirdChallenge1',
          fallback: 'Publish a spot before 9am',
          getProgress: (s) => ({ current: clamp(s.hostEarlyCount, 0, 1), target: 1 }),
        },
      ],
    },
    {
      id: 'achv-weekend',
      labelKey: 'achievementWeekendWarrior',
      labelDefault: 'Weekend Warrior',
      Icon: Calendar,
      badgeClass: 'bg-gradient-to-br from-blue-500 to-sky-500',
      challenges: [
        {
          key: 'achievementWeekendWarriorChallenge1',
          fallback: 'Complete 3 swaps on a weekend',
          getProgress: (s) => ({ current: clamp(s.weekendConcludedCount, 0, 3), target: 3 }),
        },
      ],
    },
    {
      id: 'achv-dual',
      labelKey: 'achievementDualRole',
      labelDefault: 'Two‑Way Driver',
      Icon: Compass,
      badgeClass: 'bg-gradient-to-br from-teal-500 to-cyan-500',
      challenges: [
        {
          key: 'achievementDualRoleChallenge1',
          fallback: 'Complete swaps as host and as booker',
          getProgress: (s) => ({
            current: Number(s.concludedHostCount > 0) + Number(s.concludedBookerCount > 0),
            target: 2,
          }),
        },
      ],
    },
    {
      id: 'achv-streak',
      labelKey: 'achievementStreak3',
      labelDefault: 'Streak x3',
      Icon: Flame,
      badgeClass: 'bg-gradient-to-br from-red-500 to-orange-500',
      challenges: [
        {
          key: 'achievementStreak3Challenge1',
          fallback: 'Keep a 3-day activity streak',
          getProgress: (s) => ({ current: clamp(s.bestStreak, 0, 3), target: 3 }),
        },
      ],
    },
  ];

  const achievements = useMemo(
    () =>
      achievementDefs.map((def) => {
        const challenges = (def.challenges || []).map((c) => {
          const { current = 0, target = 1 } = c.getProgress?.(achievementStats) || {};
          const done = Number(current) >= Number(target);
          return {
            text: t(c.key, c.fallback),
            current: Number.isFinite(Number(current)) ? Number(current) : 0,
            target: Number.isFinite(Number(target)) ? Number(target) : 1,
            done,
          };
        });
        const enabled = challenges.length ? challenges.every((c) => c.done) : false;
        return {
          id: def.id,
          Icon: def.Icon,
          badgeClass: def.badgeClass,
          enabled,
          label: t(def.labelKey, def.labelDefault),
          challenges,
        };
      }),
    [t, achievementDefs, achievementStats],
  );

  const selectedAchievement = useMemo(() => {
    if (!achievements.length) return null;
    return achievements.find((a) => a.id === selectedAchievementId) || achievements[0];
  }, [achievements, selectedAchievementId]);

  const openAchievementsModal = () => {
    onCollapse?.();
    if (!selectedAchievementId && achievements.length > 0) setSelectedAchievementId(achievements[0].id);
    setShowAchievementsModal(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openAchievementsModal}
        className={`w-full p-4 flex items-center justify-between text-left transition ${
          isDark ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100' : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
        }`}
      >
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 flex items-center justify-center bg-white p-2 rounded-lg border border-gray-100">
            🏅
          </div>
          <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
            {t('achievements', { defaultValue: 'Défis' })}
          </span>
        </div>
        <ArrowRight size={16} className={isDark ? 'text-slate-500' : 'text-gray-300'} />
      </button>

      {showAchievementsModal && selectedAchievement && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 animate-[overlayFade_0.2s_ease]"
          onClick={() => setShowAchievementsModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative animate-[modalIn_0.28s_ease]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center space-x-2 mb-4">
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                <Trophy size={20} style={iconStyle ? iconStyle('leaderboard') : undefined} />
              </div>
              <h3 className="text-xl font-bold text-gray-900">{t('achievements', 'Achievements')}</h3>
            </div>
            <div className="grid grid-cols-5 gap-3 mb-4">
              {achievements.map((achv) => (
                <button
                  key={achv.id}
                  type="button"
                  onClick={() => setSelectedAchievementId(achv.id)}
                  className={`w-14 h-14 rounded-xl border transition flex items-center justify-center ${
                    achv.id === selectedAchievement.id
                      ? 'border-orange-400 bg-orange-50'
                      : 'border-gray-200 bg-white hover:border-orange-200'
                  }`}
                >
                  {(() => {
                    const Icon = achv.Icon || Trophy;
                    return (
                      <div
                        className={`relative w-11 h-11 rounded-xl flex items-center justify-center shadow-inner ${
                          achv.badgeClass || 'bg-gradient-to-br from-slate-700 to-slate-950'
                        } ${achv.enabled ? 'opacity-100' : 'opacity-60 grayscale'}`}
                      >
                        <Icon size={22} strokeWidth={2.5} className="text-white" />
                        {achv.enabled ? (
                          <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white shadow flex items-center justify-center">
                            <Check size={14} strokeWidth={3} className="text-emerald-600" />
                          </span>
                        ) : null}
                      </div>
                    );
                  })()}
                </button>
              ))}
            </div>
            <div className="flex items-center space-x-3 mb-3">
              {(() => {
                const Icon = selectedAchievement.Icon || Trophy;
                return (
                  <div
                    className={`w-12 h-12 rounded-full border border-white/40 shadow-inner flex items-center justify-center ${
                      selectedAchievement.badgeClass || 'bg-gradient-to-br from-slate-700 to-slate-950'
                    }`}
                  >
                    <Icon size={22} strokeWidth={2.5} className="text-white" />
                  </div>
                );
              })()}
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">
                  {t('challenge', 'Challenge')}
                </p>
                <p className="text-xl font-bold text-gray-900">{selectedAchievement.label}</p>
              </div>
            </div>
            <div className="space-y-2">
              {(selectedAchievement.challenges || []).map((c, idx) => (
                <div key={idx} className="flex items-start justify-between gap-3">
                  <div className="flex items-start space-x-2">
                    {c.done ? (
                      <Check size={16} strokeWidth={3} className="text-emerald-600 mt-[2px]" />
                    ) : (
                      <span className="text-orange-500 leading-[1.4]">•</span>
                    )}
                    <p className="text-sm text-gray-700 leading-[1.4]">{c.text}</p>
                  </div>
                  <span className="text-[11px] font-semibold text-gray-400 tabular-nums">
                    {Math.min(c.current, c.target)}/{c.target}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Achievements;
