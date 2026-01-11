import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gift, Handshake, Heart } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { appId, db } from '../firebase';

const PremiumParks = ({ user, premiumParksCount = 0, isDark = false, iconStyle }) => {
  const { t } = useTranslation('common');
  const [showPremiumParksInfo, setShowPremiumParksInfo] = useState(false);
  const [closingPremiumParksInfo, setClosingPremiumParksInfo] = useState(false);
  const [buyingPremiumParks, setBuyingPremiumParks] = useState(false);
  const [premiumParksPurchaseMsg, setPremiumParksPurchaseMsg] = useState('');
  const [premiumParksPurchaseError, setPremiumParksPurchaseError] = useState('');

  useEffect(() => {
    if (showPremiumParksInfo) setClosingPremiumParksInfo(false);
  }, [showPremiumParksInfo]);

  const closeWithAnim = (setClosing, setShow) => {
    setClosing(true);
    setTimeout(() => {
      setShow(false);
      setClosing(false);
    }, 260);
  };

  const openPremiumParksModal = () => {
    setPremiumParksPurchaseMsg('');
    setPremiumParksPurchaseError('');
    setShowPremiumParksInfo(true);
  };

  const handleBuyPremiumParks = async () => {
    if (!user?.uid) return;
    if (buyingPremiumParks) return;

    setPremiumParksPurchaseMsg('');
    setPremiumParksPurchaseError('');

    if (premiumParksCount >= 5) {
      setPremiumParksPurchaseMsg(t('premiumParksAlreadyFull', { defaultValue: 'You already have 5 hearts.' }));
      return;
    }

    setBuyingPremiumParks(true);
    try {
      const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);
      await setDoc(
        userRef,
        {
          premiumParks: 5,
          premiumParksInitialized: true,
          premiumParksPurchasedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setPremiumParksPurchaseMsg(t('premiumParksRecharged', { defaultValue: 'Recharged to 5 hearts.' }));
    } catch (err) {
      console.error('Error topping up Premium Parks:', err);
      setPremiumParksPurchaseError(t('premiumParksPurchaseError', { defaultValue: 'Purchase unavailable right now.' }));
    } finally {
      setBuyingPremiumParks(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openPremiumParksModal}
        className={`w-full p-4 flex items-center justify-between text-left transition ${
          isDark ? 'text-slate-100 [@media(hover:hover)]:hover:bg-slate-800' : 'text-gray-900 [@media(hover:hover)]:hover:bg-gray-50'
        }`}
      >
        <div className="flex items-center space-x-3">
          <div className="bg-white p-2 rounded-lg border border-gray-100">
            <Heart size={20} style={iconStyle ? iconStyle('premiumParks') : undefined} />
          </div>
          <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
            {t('premiumParks', 'Premium Parks')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, idx) => {
              const filled = idx < premiumParksCount;
              return (
                <Heart
                  key={idx}
                  size={18}
                  strokeWidth={2.25}
                  className={
                    filled
                      ? isDark
                        ? 'text-rose-400'
                        : 'text-rose-500'
                      : isDark
                        ? 'text-slate-700'
                        : 'text-gray-300'
                  }
                  fill={filled ? 'currentColor' : 'none'}
                />
              );
            })}
          </div>
        </div>
      </button>

      {showPremiumParksInfo && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingPremiumParksInfo ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={() => closeWithAnim(setClosingPremiumParksInfo, setShowPremiumParksInfo)}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative ${
              closingPremiumParksInfo ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="bg-white p-2 rounded-lg border border-gray-100">
                  <Heart size={20} style={iconStyle ? iconStyle('premiumParks') : undefined} />
                </div>
                <div>
                  <div className="font-semibold text-lg leading-tight">{t('premiumParks', 'Premium Parks')}</div>
                  <div className={`text-xs ${isDark ? 'text-slate-300' : 'text-gray-500'}`}>
                    {t('premiumParksInfoSubtitle', { defaultValue: 'Hearts for free spots' })}
                  </div>
                </div>
              </div>
              <div className={`text-sm font-bold ${isDark ? 'text-rose-300' : 'text-rose-500'}`}>
                {premiumParksCount}/5
              </div>
            </div>

            <div
              className={`rounded-2xl border overflow-hidden divide-y ${
                isDark ? 'border-white/10 divide-white/10 bg-white/5' : 'border-gray-100 divide-gray-100 bg-gray-50'
              }`}
            >
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${isDark ? 'bg-white/10' : 'bg-white'}`}>
                    <Gift size={16} className={isDark ? 'text-emerald-300' : 'text-emerald-600'} />
                  </div>
                  <div className={`text-sm ${isDark ? 'text-slate-100' : 'text-gray-800'}`}>
                    {t('premiumParksInfoGain', { defaultValue: 'Gain +1 when someone accepts a free spot you proposed.' })}
                  </div>
                </div>
                <div className="text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-full">
                  +1
                </div>
              </div>
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${isDark ? 'bg-white/10' : 'bg-white'}`}>
                    <Handshake size={16} className={isDark ? 'text-rose-300' : 'text-rose-500'} />
                  </div>
                  <div className={`text-sm ${isDark ? 'text-slate-100' : 'text-gray-800'}`}>
                    {t('premiumParksInfoLose', { defaultValue: 'Lose -1 when you accept a free spot.' })}
                  </div>
                </div>
                <div className="text-xs font-bold text-rose-500 bg-rose-500/10 px-2 py-1 rounded-full">
                  -1
                </div>
              </div>
              <div className="px-4 py-3 text-xs text-gray-500">
                {t('premiumParksInfoRule', { defaultValue: "You can't accept a free spot with 0 hearts." })}
              </div>
            </div>

            {premiumParksPurchaseError ? (
              <div className="mt-4 text-sm text-rose-500 font-semibold">{premiumParksPurchaseError}</div>
            ) : null}
            {premiumParksPurchaseMsg ? (
              <div className="mt-4 text-sm text-emerald-600 font-semibold">{premiumParksPurchaseMsg}</div>
            ) : null}

            <button
              type="button"
              onClick={handleBuyPremiumParks}
              disabled={buyingPremiumParks}
              className={`mt-4 w-full h-12 rounded-2xl font-bold shadow-md transition ${
                buyingPremiumParks
                  ? 'bg-gray-200 text-gray-400'
                  : isDark
                    ? 'bg-orange-600 text-white hover:bg-orange-700'
                    : 'bg-gray-900 text-white hover:bg-gray-800'
              }`}
            >
              {buyingPremiumParks
                ? t('premiumParksBuying', { defaultValue: 'Processing...' })
                : t('premiumParksBuyCta', { defaultValue: 'Refill to 5 hearts • 10€' })}
            </button>
            <div className="mt-2 text-[11px] text-gray-400 text-center">
              {t('premiumParksBuyNote', { defaultValue: 'Refills your hearts back to 5.' })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PremiumParks;
