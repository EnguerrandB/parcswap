// src/views/GotSelectedView.jsx
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, X } from 'lucide-react';
import { collection, doc, getCountFromServer, onSnapshot, query, where } from 'firebase/firestore';
import { appId, db } from '../firebase';

const rankIcon = (count = 0) => {
  const n = Number(count) || 0;
  if (n >= 20) return '/ranks/rank5.png';
  if (n >= 15) return '/ranks/rank4.png';
  if (n >= 10) return '/ranks/rank3.png';
  if (n >= 5) return '/ranks/rank2.png';
  return '/ranks/rank1.png';
};

const GotSelectedView = ({ spot, onCancel }) => {
  const { t } = useTranslation('common');
  const fallbackName = spot?.bookerName || t('seeker', 'Seeker');
  const [bookerInfo, setBookerInfo] = useState({
    name: fallbackName,
    transactions: spot?.bookerTransactions ?? spot?.bookerTx ?? null,
    rank: spot?.bookerRank ?? null,
  });

  // Détection du thème (inchangée pour compatibilité)
  const isDark =
    (typeof document !== 'undefined' && document.body?.dataset?.theme === 'dark') ||
    (typeof window !== 'undefined' && window.localStorage?.getItem('theme') === 'dark');

  useEffect(() => {
    if (!spot?.bookerId) return undefined;

    let cancelled = false;
    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'users');
    const userRef = doc(usersRef, spot.bookerId);

    const fetchRank = async (txCount) => {
      try {
        const rankQuery = query(usersRef, where('transactions', '>', txCount));
        const countSnap = await getCountFromServer(rankQuery);
        if (!cancelled) {
          setBookerInfo((prev) => ({ ...prev, rank: (countSnap.data().count || 0) + 1 }));
        }
      } catch (err) {
        console.error('Error computing booker rank:', err);
      }
    };

    const unsub = onSnapshot(
      userRef,
      (snap) => {
        const data = snap.data?.() || snap.data() || {};
        const txCountRaw = data.transactions ?? spot.bookerTransactions ?? spot.bookerTx ?? 0;
        const txCount = Number.isFinite(Number(txCountRaw)) ? Number(txCountRaw) : 0;
        const displayName = data.displayName || spot.bookerName || fallbackName;

        setBookerInfo((prev) => ({
          ...prev,
          name: displayName,
          transactions: txCount,
        }));

        fetchRank(txCount);
      },
      (err) => console.error('Error subscribing to booker profile:', err),
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [spot?.bookerId, spot?.bookerName, fallbackName]);

  const rank = bookerInfo.rank ?? '—';
  const transactions = bookerInfo.transactions ?? 0;
  const name = bookerInfo.name || fallbackName;
  const formattedPrice = (() => {
    const n = Number(spot?.price ?? 0);
    if (!Number.isFinite(n)) return '0';
    const rounded = Math.round(n * 100) / 100;
    return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2)).replace(/\.00$/, '');
  })();

  const handleCancelClick = () => {
    if (!onCancel || !spot?.id) return;
    const message = t('cancelLossConfirm', 'Tu vas perdre {{amount}} € en annulant, tu confirmes ?', {
      amount: formattedPrice,
      defaultValue: 'Tu vas perdre {{amount}} € en annulant, tu confirmes ?',
    });
    const shouldCancel = typeof window !== 'undefined' ? window.confirm(message) : true;
    if (shouldCancel) {
      onCancel(spot.id);
    }
  };

  // Configuration des styles dynamiques
  const themeStyles = {
    bg: isDark ? 'bg-[#0b1220]' : 'bg-[#F2F2F7]', // Apple System Gray background
    card: isDark 
      ? 'bg-slate-900/60 border-white/10 text-white shadow-black/40' 
      : 'bg-white/70 border-white/40 text-gray-900 shadow-xl shadow-orange-500/10',
    accentGradient: isDark 
      ? 'from-orange-400 to-pink-600' 
      : 'from-orange-400 to-orange-600',
    subText: isDark ? 'text-slate-400' : 'text-gray-500',
  };

  return (
    <div className={`fixed inset-0 overflow-hidden flex flex-col items-center justify-center p-6 ${themeStyles.bg}`}>
      
      {/* Background Ambience (Orbs) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className={`absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[100px] opacity-20 bg-orange-500/40`} />
        <div className={`absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full blur-[120px] opacity-20 bg-blue-500/40`} />
      </div>

      {/* Main Glass Card */}
      <div className={`relative w-full max-w-sm backdrop-blur-2xl rounded-[2.5rem] border p-8 flex flex-col items-center text-center transition-all duration-500 ${themeStyles.card}`}>
        
        {/* Avatar Section with Waze-like Badge */}
        <div className="relative mb-6 group">
          <div className={`w-24 h-24 rounded-[2rem] flex items-center justify-center shadow-lg bg-gradient-to-br ${themeStyles.accentGradient}`}>
            <img
              src={rankIcon(transactions)}
              alt="Rang"
              className="w-16 h-16 object-contain drop-shadow-md"
            />
          </div>
          
          {/* Rank Badge (Floating) */}
          <div className={`absolute -bottom-3 -right-3 px-3 py-1.5 rounded-full text-xs font-bold shadow-lg flex items-center gap-1.5 border border-white/10 ${isDark ? 'bg-slate-800 text-orange-400' : 'bg-white text-orange-600'}`}>
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{rank}</span>
          </div>
        </div>

        {/* User Info */}
        <h2 className="text-3xl font-bold tracking-tight mb-1">{name}</h2>
        <div className="flex items-center gap-2 mb-8">
            <span className={`text-xs font-medium px-2.5 py-1 rounded-lg bg-opacity-10 ${isDark ? 'bg-white text-slate-300' : 'bg-black text-gray-600'}`}>
              {t('transactions', { defaultValue: 'transactions' })}: {transactions}
            </span>
        </div>

        {/* Status Indicator (Pulse) */}
        <div className={`w-full rounded-2xl p-4 flex items-center gap-4 mb-2 text-left border ${isDark ? 'bg-slate-800/50 border-white/5' : 'bg-white/60 border-white/60'}`}>
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </div>
            <div>
                <p className="text-sm font-semibold leading-none mb-1">
                    {t('requestAccepted', 'Demande acceptée')}
                </p>
                <p className={`text-xs ${themeStyles.subText}`}>
                    {t('awaitingNavConfirm', 'En attente de confirmation...')}
                </p>
            </div>
        </div>

      </div>

      {/* Action Button (Separated for better ergonomics) */}
      {onCancel && (
        <button
          onClick={handleCancelClick}
          className={`mt-8 group relative px-8 py-4 rounded-full font-semibold transition-all duration-300 active:scale-95 flex items-center gap-2 
            ${isDark 
              ? 'bg-slate-800 text-red-400 hover:bg-slate-700 hover:text-red-300' 
              : 'bg-white text-red-500 shadow-lg shadow-gray-200 hover:shadow-xl hover:text-red-600'
            }`}
        >
            <X className="w-4 h-4" />
            <span>{t('cancelReturn', 'Annuler et retour')}</span>
        </button>
      )}
    </div>
  );
};

export default GotSelectedView;
