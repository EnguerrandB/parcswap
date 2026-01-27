// src/views/ProfileView.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  CreditCard,
  Wallet,
  LogOut,
  ArrowRight,
  Sun,
  Moon,
  Globe,
  Volume2,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import Achievements from '../components/Achievements';
import MyVehicules from '../components/MyVehicules';
import MyHistory from '../components/MyHistory';
import Leaderboard from '../components/Leaderboard';
import LegalContact from '../components/LegalContact';
import PremiumParks from '../components/PremiumParks';
import MyProfile from '../components/MyProfile';
import { functions } from '../firebase';
import { getVoicePreference, pickPreferredVoice, scoreVoice, setVoicePreference } from '../utils/voice';

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
  onAddWallet,
  walletPending = false,
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
    voice: '#3b82f6',
    history: '#6366f1',
    legal: '#ef4444',
    leaderboard: '#06b6d4',
    kyc: '#14b8a6',
    tierCar: '#f97316',
    tierLaptop: '#10b981',
    tierPhone: '#22c55e',
    logout: '#f97316',
    wallet: '#22c55e',
  };
  const iconStyle = (key) => ({ color: iconColors[key] || '#f97316' });
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const formatWallet = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0,00€';
    return `${n.toFixed(2).replace('.', ',')}€`;
  };
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
  const [walletInput, setWalletInput] = useState('');
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [closingWalletModal, setClosingWalletModal] = useState(false);
  const [voiceUri, setVoiceUri] = useState(() => getVoicePreference().voiceUri || '');
  const [voices, setVoices] = useState([]);
  const [kycLoading, setKycLoading] = useState(false);

  useEffect(() => {
    if (showRankInfo) setClosingRank(false);
  }, [showRankInfo]);

  useEffect(() => {
    if (showWalletModal) setClosingWalletModal(false);
  }, [showWalletModal]);

  useEffect(() => {
    setLanguage(user?.language || 'en');
  }, [user?.language]);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;
    const synth = window.speechSynthesis;
    const loadVoices = () => {
      try {
        setVoices(synth.getVoices?.() || []);
      } catch (_) {
        setVoices([]);
      }
    };
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
    return () => synth.removeEventListener?.('voiceschanged', loadVoices);
  }, []);
  useEffect(() => {
    if (!voiceUri || !voices.length) return;
    const exists = voices.some((v) => v.voiceURI === voiceUri);
    if (!exists) {
      setVoiceUri('');
      setVoicePreference({ voiceUri: '', voiceName: '', voiceLang: '' });
    }
  }, [voices, voiceUri]);
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
  const handleWalletAdd = () => {
    if (!onAddWallet) return;
    const normalized = String(walletInput || '').replace(',', '.').replace(/[^0-9.]/g, '');
    const amount = Number.parseFloat(normalized);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100) return;
    onAddWallet(amount);
    setWalletInput('');
  };
  const walletValue = Number(user?.wallet);
  const walletDisplay = Number.isFinite(walletValue) ? walletValue : 0;
  const kycBadge = useMemo(() => {
    const statusRaw = String(user?.kycStatus || user?.kyc?.status || 'unverified');
    const status = statusRaw.toLowerCase();
    if (status === 'verified' || status === 'approved') {
      return {
        label: t('kycVerified', { defaultValue: 'Vérifié' }),
        className: isDark
          ? 'text-emerald-200 bg-emerald-500/20 border-emerald-400/30'
          : 'text-emerald-600 bg-emerald-50 border-emerald-200',
      };
    }
    if (status === 'processing' || status === 'pending') {
      return {
        label: t('kycProcessing', { defaultValue: 'En cours' }),
        className: isDark
          ? 'text-amber-200 bg-amber-500/20 border-amber-400/30'
          : 'text-amber-600 bg-amber-50 border-amber-200',
      };
    }
    if (status === 'requires_input' || status === 'requires_action' || status === 'needs_input') {
      return {
        label: t('kycNeedsInput', { defaultValue: 'À vérifier' }),
        className: isDark
          ? 'text-orange-200 bg-orange-500/20 border-orange-400/30'
          : 'text-orange-600 bg-orange-50 border-orange-200',
      };
    }
    if (status === 'canceled' || status === 'failed' || status === 'rejected') {
      return {
        label: t('kycRejected', { defaultValue: 'Refusé' }),
        className: isDark
          ? 'text-rose-200 bg-rose-500/20 border-rose-400/30'
          : 'text-rose-600 bg-rose-50 border-rose-200',
      };
    }
    return {
      label: t('kycNotVerified', { defaultValue: 'Non vérifié' }),
      className: isDark
        ? 'text-slate-200 bg-slate-700/60 border-slate-500/40'
        : 'text-gray-600 bg-gray-100 border-gray-200',
    };
  }, [user?.kycStatus, user?.kyc?.status, isDark, t]);
  const kycBadgeLabel = kycLoading ? t('kycOpening', { defaultValue: 'Ouverture...' }) : kycBadge.label;
  const voiceLang = String(language || i18n.language || 'en').toLowerCase();
  const voiceOptions = useMemo(() => {
    const byLang = voices.filter((v) => String(v.lang || '').toLowerCase().startsWith(voiceLang));
    const list = byLang.length ? byLang : voices.slice();
    return list.sort((a, b) => scoreVoice(b, voiceLang) - scoreVoice(a, voiceLang));
  }, [voices, voiceLang]);
  const autoVoice = useMemo(() => pickPreferredVoice(voiceOptions, voiceLang, {}), [voiceOptions, voiceLang]);
  const playVoicePreview = (nextUri) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const previewText = t('voicePreview', { defaultValue: 'Aperçu de la voix GPS' });
    const trimmed = String(previewText || '').replace(/\s+/g, ' ').trim();
    if (!trimmed) return;
    const selected =
      (nextUri && (voiceOptions.find((v) => v.voiceURI === nextUri) || voices.find((v) => v.voiceURI === nextUri))) ||
      pickPreferredVoice(voiceOptions, voiceLang, {});
    try {
      if (synth.paused) synth.resume();
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(trimmed);
      if (selected?.lang) utterance.lang = selected.lang;
      else if (language || i18n.language) utterance.lang = language || i18n.language;
      if (selected) utterance.voice = selected;
      utterance.volume = 1;
      utterance.rate = 1;
      utterance.pitch = 1;
      window.setTimeout(() => synth.speak(utterance), 0);
    } catch (_) {
      // ignore preview errors
    }
  };

  const handleVoiceChange = (value) => {
    const nextUri = value || '';
    setVoiceUri(nextUri);
    if (!nextUri) {
      setVoicePreference({ voiceUri: '', voiceName: '', voiceLang: '' });
      playVoicePreview('');
      return;
    }
    const selected =
      voiceOptions.find((v) => v.voiceURI === nextUri) || voices.find((v) => v.voiceURI === nextUri);
    setVoicePreference({
      voiceUri: nextUri,
      voiceName: selected?.name || '',
      voiceLang: selected?.lang || '',
    });
    playVoicePreview(nextUri);
  };

  const handleStartKyc = async () => {
    if (!user?.uid || kycLoading) return;
    setKycLoading(true);
    try {
      const callable = httpsCallable(functions, 'createKycSession');
      const returnUrl = typeof window !== 'undefined' ? window.location.href : '';
      const result = await callable({ returnUrl });
      const url = result?.data?.url;
      if (url && typeof window !== 'undefined') {
        window.location.assign(url);
      } else {
        console.error('[KYC] Missing redirect URL from Stripe session.');
      }
    } catch (err) {
      console.error('[KYC] Unable to start verification:', err);
    } finally {
      setKycLoading(false);
    }
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

          <button
            type="button"
            onClick={handleStartKyc}
            disabled={kycLoading}
            className={`w-full p-4 flex items-center justify-between text-left transition ${
              isDark ? 'text-slate-100 [@media(hover:hover)]:hover:bg-slate-800' : 'text-gray-900 [@media(hover:hover)]:hover:bg-gray-50'
            } ${kycLoading ? 'opacity-70 cursor-wait' : ''}`}
          >
            <div className="flex items-center space-x-3">
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                <ShieldCheck size={20} style={iconStyle('kyc')} />
              </div>
              <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
                {t('kycLabel', { defaultValue: 'KYC' })}
              </span>
            </div>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${kycBadge.className}`}>
              {kycBadgeLabel}
            </span>
          </button>

          <PremiumParks
            user={user}
            premiumParksCount={premiumParksCount}
            isDark={isDark}
            iconStyle={iconStyle}
          />

          <button
            type="button"
            onClick={() => setShowWalletModal(true)}
            className={`w-full p-4 flex items-center justify-between text-left transition ${
              isDark ? 'text-slate-100 [@media(hover:hover)]:hover:bg-slate-800' : 'text-gray-900 [@media(hover:hover)]:hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div
                className={`p-2 rounded-lg border ${
                  isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-100'
                }`}
              >
                <Wallet size={20} style={iconStyle('wallet')} />
              </div>
              <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
                {t('wallet', { defaultValue: 'Wallet' })}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={`text-sm font-bold ${isDark ? 'text-slate-100' : 'text-gray-700'}`}>
                {formatWallet(walletDisplay)}
              </span>
              {walletPending ? (
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                    isDark
                      ? 'text-amber-200 bg-amber-500/20 border-amber-400/30'
                      : 'text-amber-700 bg-amber-50 border-amber-200'
                  }`}
                >
                  {t('walletPendingShort', { defaultValue: 'En attente' })}
                </span>
              ) : null}
            </div>
          </button>
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

          <div
            className={`w-full p-4 flex items-center justify-between text-left ${
              isDark ? 'text-slate-100' : 'text-gray-900'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                <Volume2 size={20} style={iconStyle('voice')} />
              </div>
              <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
                {t('gpsVoice', 'GPS voice')}
              </span>
            </div>
            <select
              className={`border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 ${
                isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-gray-200 text-gray-900'
              }`}
              value={voiceUri}
              onChange={(e) => handleVoiceChange(e.target.value)}
              disabled={!voices.length}
            >
              <option value="">
                {autoVoice
                  ? t('voiceAuto', { defaultValue: `Auto (${autoVoice.name})` })
                  : t('voiceAutoShort', { defaultValue: 'Auto' })}
              </option>
              {voiceOptions.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} {voice.lang ? `(${voice.lang})` : ''}
                </option>
              ))}
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

      {showWalletModal && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingWalletModal ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={() => closeWithAnim(setClosingWalletModal, setShowWalletModal)}
        >
          <div
            className={`rounded-2xl shadow-2xl w-full max-w-md p-6 relative border ${
              closingWalletModal ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            } ${
              isDark ? 'bg-slate-900 border-white/10 text-slate-100' : 'bg-white border-gray-100 text-gray-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg border ${
                    isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-100'
                  }`}
                >
                  <Wallet size={20} style={iconStyle('wallet')} />
                </div>
                <div>
                  <div className="font-semibold text-lg leading-tight">{t('wallet', { defaultValue: 'Wallet' })}</div>
                  <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                    {formatWallet(walletDisplay)}
                  </div>
                  {walletPending ? (
                    <div className={`text-xs font-semibold ${isDark ? 'text-amber-200' : 'text-amber-600'}`}>
                      {t('walletPendingLong', { defaultValue: 'En attente de confirmation' })}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
                placeholder={t('walletTopupPlaceholder', { defaultValue: 'Montant à ajouter' })}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold outline-none border ${
                  isDark
                    ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500'
                    : 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400'
                }`}
              />
              <button
                type="button"
                onClick={handleWalletAdd}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                  isDark
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30'
                    : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                }`}
              >
                {t('addFunds', { defaultValue: 'Ajouter' })}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ProfileView;
