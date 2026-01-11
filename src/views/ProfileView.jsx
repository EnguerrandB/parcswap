// src/views/ProfileView.jsx
import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  LogOut,
  ArrowRight,
  Sun,
  Moon,
  Globe,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Achievements from '../components/Achievements';
import MyVehicules from '../components/MyVehicules';
import MyHistory from '../components/MyHistory';
import Leaderboard from '../components/Leaderboard';
import LegalContact from '../components/LegalContact';
import PremiumParks from '../components/PremiumParks';
import MyProfile from '../components/MyProfile';

const ProfileView = ({
  user,
  vehicles = [],
  onAddVehicle,
  onDeleteVehicle,
  onSelectVehicle,
  onUpdateProfile,
  leaderboard = [],
  transactions = [],
  onLogout,
  theme = 'light',
  onChangeTheme,
  onInvite,
  inviteMessage,
  openAddVehicleRequestId = 0,
  highlightVehiclesRequestId = 0,
}) => {
  const { t, i18n } = useTranslation('common');
  const isDark = theme === 'dark';
	  const iconColors = {
	    rank: '#f97316',
	    profile: '#ec4899',
	    vehicle: '#8b5cf6',
	    stripe: '#0ea5e9',
	    invite: '#22c55e',
	    premiumParks: '#f43f5e',
	    appearance: '#f59e0b',
	    history: '#6366f1',
	    legal: '#ef4444',
	    leaderboard: '#06b6d4',
	    tierCar: '#f97316',
    tierLaptop: '#10b981',
    tierPhone: '#22c55e',
    logout: '#f97316',
  };
  const iconStyle = (key) => ({ color: iconColors[key] || '#f97316' });
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const rankLabel = (count = 0) => {
    const n = Number(count) || 0;
    if (n >= 20) return 'Loulou Ultimate';
    if (n >= 15) return 'Loulou Platinum';
    if (n >= 10) return 'Loulou Gold';
    if (n >= 5) return 'Loulou Silver';
    return 'Loulou Explorer';
  };
  const rankIcon = (count = 0) => {
    const n = Number(count) || 0;
    if (n >= 20) return '/ranks/rank5.png';
    if (n >= 15) return '/ranks/rank4.png';
    if (n >= 10) return '/ranks/rank3.png';
    if (n >= 5) return '/ranks/rank2.png';
    return '/ranks/rank1.png';
  };
  const rankTiers = [
    { img: '/ranks/rank1.png', label: 'Explorer', minTransactions: 0 },
    { img: '/ranks/rank2.png', label: 'Silver', minTransactions: 5 },
    { img: '/ranks/rank3.png', label: 'Gold', minTransactions: 10 },
    { img: '/ranks/rank4.png', label: 'Platinum', minTransactions: 15 },
    { img: '/ranks/rank5.png', label: 'Ultimate', minTransactions: 20 },
  ];
  const [showRankInfo, setShowRankInfo] = useState(null);
  const [closingRank, setClosingRank] = useState(false);
  const [language, setLanguage] = useState(user?.language || 'en');

  useEffect(() => {
    if (showRankInfo) setClosingRank(false);
  }, [showRankInfo]);

  useEffect(() => {
    setLanguage(user?.language || 'en');
  }, [user?.language]);
  const selfLeaderboardEntry = leaderboard.find((u) => u.id === user?.uid);
	  const userTransactionCount = Number(
	    selfLeaderboardEntry?.transactions ??
	      user?.transactions ??
	      (Array.isArray(transactions) ? transactions.length : 0),
	  );
	  const userRank = selfLeaderboardEntry?.rank ?? null;
	  const premiumParksCountRaw = Number(user?.premiumParks);
	  const premiumParksCount = clamp(Number.isFinite(premiumParksCountRaw) ? premiumParksCountRaw : 0, 0, 5);
	  const toggleTheme = () => onChangeTheme?.(theme === 'dark' ? 'light' : 'dark');
	  const closeWithAnim = (setClosing, setShow) => {
	    setClosing(true);
	    setTimeout(() => {
      setShow(false);
      setClosing(false);
    }, 260);
  };

  useEffect(() => {
    if (user?.language) {
      i18n.changeLanguage(user.language);
    }
  }, [user?.language, i18n]);

  const getLanguageFlag = (lng) => {
    const normalized = String(lng || '').split('-')[0].toLowerCase();
    if (normalized === 'fr') return '🇫🇷';
    if (normalized === 'en') return '🇬🇧';
    return '';
  };

  const handleChangeLanguage = async (lng) => {
    if (!lng) return;
    setLanguage(lng);
    i18n.changeLanguage(lng);
    if (!user?.uid) return;
    await onUpdateProfile?.({
      displayName: user?.displayName || '',
      email: user?.email || '',
      phone: user?.phone || '',
      language: lng,
      phoneVerified: user?.phoneVerified,
    });
  };

  return (
    <div
      className="relative h-full bg-gray-50 overflow-y-auto no-scrollbar"
      style={{ WebkitTapHighlightColor: 'transparent' }}
      data-role="account-sheet-scroll"
    >
      <div className="p-6 pb-6">
        <div className="flex items-center justify-between mb-8 mt-4">
        <div className="flex items-center space-x-3">
          <img
            src={rankIcon(userTransactionCount)}
            alt="Rang"
            className="w-10 h-10 rounded-full border border-orange-100 object-contain bg-white p-1"
          />
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{user?.displayName || t('unknown', 'Unknown')}</h2>
            <p className="text-xs font-semibold text-orange-600 mt-1">{rankLabel(userTransactionCount)}</p>
          </div>
        </div>
        <Leaderboard
          leaderboard={leaderboard}
          rankTiers={rankTiers}
          user={user}
          isDark={isDark}
          iconStyle={iconStyle}
          rankIcon={rankIcon}
          rankLabel={rankLabel}
        />
      </div>

      <div className="mt-3 mb-4">
        <h3 className={`text-sm font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-slate-400' : 'text-gray-400'}`}>
          {t('myInfo', { defaultValue: 'Mes infos' })}
        </h3>
        <div
          className={`rounded-2xl shadow-sm border overflow-hidden divide-y ${
            isDark
              ? 'bg-slate-900 border-slate-800 divide-slate-800'
              : 'bg-white border-gray-100 divide-gray-100'
          }`}
        >
          <MyProfile user={user} onUpdateProfile={onUpdateProfile} isDark={isDark} iconStyle={iconStyle} />

          <MyVehicules
            vehicles={vehicles}
            isDark={isDark}
            iconStyle={iconStyle}
            onAddVehicle={onAddVehicle}
            onDeleteVehicle={onDeleteVehicle}
            onSelectVehicle={onSelectVehicle}
            openAddVehicleRequestId={openAddVehicleRequestId}
            highlightVehiclesRequestId={highlightVehiclesRequestId}
          />

	          <div className={`w-full p-4 flex items-center justify-between ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
	            <div className="flex items-center space-x-3">
	              <div className="bg-white p-2 rounded-lg border border-gray-100">
	                <CreditCard size={20} style={iconStyle('stripe')} />
	              </div>
	              <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
	                {t('stripeConnection', 'Stripe Connection')}
	              </span>
	            </div>
	            <span className="text-xs text-green-500 font-bold bg-green-100 px-2 py-1 rounded">
	              {t('stripeActive', 'Active')}
	            </span>
	          </div>

          <PremiumParks
            user={user}
            premiumParksCount={premiumParksCount}
            isDark={isDark}
            iconStyle={iconStyle}
          />
	        </div>
	      </div>

      <div className="mt-8">
        <h3 className={`text-sm font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-slate-400' : 'text-gray-400'}`}>
          {t('social', { defaultValue: 'Social' })}
        </h3>
        <div
          className={`rounded-2xl shadow-sm border overflow-hidden mb-3 divide-y ${
            isDark
              ? 'bg-slate-900 border-slate-800 divide-slate-800'
              : 'bg-white border-gray-100 divide-gray-100'
          }`}
        >
          <button
            type="button"
            onClick={() => onInvite?.()}
            className={`w-full p-4 flex items-center justify-between text-left transition ${
              isDark
                ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100'
                : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                <ArrowRight size={20} style={iconStyle('invite')} />
              </div>
              <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
                {t('inviteFriends', { defaultValue: 'Inviter des amis' })}
              </span>
            </div>
            <ArrowRight size={16} className={isDark ? 'text-slate-500' : 'text-gray-300'} />
          </button>

          <Achievements
            transactions={transactions}
            vehicles={vehicles}
            isDark={isDark}
            iconStyle={iconStyle}
          />

          <MyHistory
            transactions={transactions}
            user={user}
            isDark={isDark}
            iconStyle={iconStyle}
          />
        </div>
      </div>

      <div className="mt-8">
        <h3
          className={`text-sm font-bold uppercase tracking-wider mb-3 ${
            isDark ? 'text-slate-400' : 'text-gray-400'
          }`}
        >
          {t('settings', 'Settings')}
        </h3>
        <div
          className={`rounded-2xl shadow-sm border overflow-hidden mb-3 divide-y ${
            isDark
              ? 'bg-slate-900 border-slate-800 divide-slate-800'
              : 'bg-white border-gray-100 divide-gray-100'
          }`}
        >
          <button
            type="button"
            onClick={toggleTheme}
            className={`w-full p-4 flex items-center justify-between text-left transition ${
              isDark
                ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100'
                : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                {theme === 'dark' ? <Moon size={20} style={iconStyle('appearance')} /> : <Sun size={20} style={iconStyle('appearance')} />}
              </div>
              <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
                {t('appearance', 'Appearance')}
              </span>
            </div>
            <span
              role="switch"
              aria-checked={theme === 'dark'}
              className={`inline-flex h-7 w-12 items-center rounded-full px-1 transition-colors ${
                isDark ? 'bg-slate-700' : 'bg-gray-200'
              }`}
            >
              <span
                className={`h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-in-out ${
                  isDark ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </span>
          </button>

	          <div
	            className={`w-full p-4 flex items-center justify-between text-left ${
	              isDark ? 'text-slate-100' : 'text-gray-900'
	            }`}
	          >
	            <div className="flex items-center space-x-3">
	              <div className="bg-white p-2 rounded-lg border border-gray-100">
	                {getLanguageFlag(language) ? (
	                  <span className="text-lg leading-none">{getLanguageFlag(language)}</span>
	                ) : (
	                  <Globe size={20} style={iconStyle('appearance')} />
	                )}
	              </div>
	              <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
	                {t('languageLabel', 'Language')}
	              </span>
	            </div>
            <select
              className={`border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 ${
                isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-gray-200 text-gray-900'
              }`}
              value={language}
              onChange={(e) => handleChangeLanguage(e.target.value)}
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
          </div>

          <LegalContact isDark={isDark} iconStyle={iconStyle} />
	        </div>

      </div>

        <div className="mt-8 text-center text-gray-400 text-xs">
          <p>{t('versionLabel', 'Park Swap v1.0.2')}</p>
        </div>
      </div>

      <div className="px-6">
        <button
          type="button"
          onClick={() => onLogout?.()}
          className={`w-full px-6 py-5 shadow-sm flex items-center space-x-3 border-t transition rounded-t-2xl rounded-b-none ${
            isDark
              ? 'bg-slate-950/95 border-white/10 text-slate-100 [@media(hover:hover)]:hover:bg-slate-950'
              : 'bg-white/95 border-gray-200 text-gray-900 [@media(hover:hover)]:hover:bg-gray-50'
          }`}
          style={{ backdropFilter: 'blur(14px) saturate(180%)', WebkitBackdropFilter: 'blur(14px) saturate(180%)' }}
        >
          <LogOut size={20} style={iconStyle('logout')} />
          <span className="font-medium">{t('logout', 'Log Out')}</span>
        </button>
      </div>

      {/* Premium Parks info */}
      {showRankInfo && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingRank ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={() => closeWithAnim(setClosingRank, setShowRankInfo)}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-xs p-5 relative ${
              closingRank ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            }`}
            onClick={(e) => e.stopPropagation()}
	          >
			            <div className="text-center space-y-2">
			              <div className="mx-auto w-16 h-16 rounded-2xl bg-orange-50 shadow-sm shadow-orange-200/60 flex items-center justify-center">
			                <img
		                  src={showRankInfo.img}
		                  alt={showRankInfo.label}
		                  className="w-10 h-10 object-contain"
		                />
		              </div>
		              <p className="text-xl font-bold text-gray-900">{showRankInfo.label}</p>
		              <div className="inline-flex items-center bg-gray-50 rounded-full px-3 py-1 text-sm text-gray-800 font-semibold shadow-sm shadow-gray-200/60">
		                <span className="tabular-nums">
		                  + {showRankInfo.minTransactions} {t('transactionsLabel', 'Transactions').toLowerCase()}
		                </span>
		              </div>
		            </div>
		          </div>
		        </div>
		      )}

    </div>
  );
};

export default ProfileView;
