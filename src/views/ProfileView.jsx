// src/views/ProfileView.jsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  Camera,
  Car,
  Check,
  Compass,
  CreditCard,
  Flame,
  Gem,
  Gift,
  Handshake,
  Heart,
  History,
  LogOut,
  MapPin,
  ArrowRight,
  ChevronDown,
  Search,
  Sunrise,
  User,
  Trophy,
  Laptop,
  Smartphone,
  FileText,
  Sun,
  Moon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RecaptchaVerifier, linkWithPhoneNumber } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, appId, db } from '../firebase';

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
  const formatPlate = (value) => {
    const cleaned = (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let letters1 = '';
    let digits = '';
    let letters2 = '';
    for (const ch of cleaned) {
      if (letters1.length < 2 && /[A-Z]/.test(ch)) {
        letters1 += ch;
        continue;
      }
      if (letters1.length === 2 && digits.length < 3 && /[0-9]/.test(ch)) {
        digits += ch;
        continue;
      }
      if (letters1.length === 2 && digits.length === 3 && letters2.length < 2 && /[A-Z]/.test(ch)) {
        letters2 += ch;
      }
    }
    return [letters1, digits, letters2].filter(Boolean).join('-');
  };
  const isFullPlate = (plate) => /^[A-Z]{2}-\d{3}-[A-Z]{2}$/.test(plate || '');
  const plateMaskPreview = (value) => {
    const formatted = formatPlate(value);
    const clean = formatted.replace(/-/g, '');
    const template = ['A', 'B', '-', '1', '2', '3', '-', 'C', 'D'];
    let idx = 0;
    return template
      .map((ch) => {
        if (ch === '-') return '-';
        const val = clean[idx];
        idx += 1;
        return val || '_';
      })
      .join('');
  };
  const [form, setForm] = useState({ model: '', plate: '' });
  const [formImage, setFormImage] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [leaderboardCountdown, setLeaderboardCountdown] = useState({
    days: '00',
    hours: '00',
    minutes: '00',
    seconds: '00',
  });
  const [profileForm, setProfileForm] = useState({
    displayName: user?.displayName || '',
    email: user?.email || '',
    phone: user?.phone || '',
    language: user?.language || 'en',
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [infoMsg, setInfoMsg] = useState('');
  const [phoneVerification, setPhoneVerification] = useState({
    status: 'idle',
    confirmation: null,
    code: '',
    error: '',
  });
  const [showRankInfo, setShowRankInfo] = useState(null);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
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
      const dow = date.getDay(); // 0 = Sunday, 6 = Saturday
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
  const [privacyCloseVisible, setPrivacyCloseVisible] = useState(true);
  const [termsCloseVisible, setTermsCloseVisible] = useState(true);
  const [closingModal, setClosingModal] = useState(false);
  const [closingRank, setClosingRank] = useState(false);
  const [closingPrivacy, setClosingPrivacy] = useState(false);
  const [closingTerms, setClosingTerms] = useState(false);
  const [closingHistory, setClosingHistory] = useState(false);
  const [closingLeaderboard, setClosingLeaderboard] = useState(false);
  const [showAchievementsModal, setShowAchievementsModal] = useState(false);
  const [selectedAchievementId, setSelectedAchievementId] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [closingProfile, setClosingProfile] = useState(false);
  const [showPremiumParksInfo, setShowPremiumParksInfo] = useState(false);
  const [closingPremiumParksInfo, setClosingPremiumParksInfo] = useState(false);
  const [buyingPremiumParks, setBuyingPremiumParks] = useState(false);
  const [premiumParksPurchaseMsg, setPremiumParksPurchaseMsg] = useState('');
  const [premiumParksPurchaseError, setPremiumParksPurchaseError] = useState('');
  const selectedAchievement = useMemo(() => {
    if (!achievements.length) return null;
    return achievements.find((a) => a.id === selectedAchievementId) || achievements[0];
  }, [achievements, selectedAchievementId]);

  useEffect(() => {
    if (showModal) setClosingModal(false);
  }, [showModal]);
  useEffect(() => {
    if (showRankInfo) setClosingRank(false);
  }, [showRankInfo]);
  useEffect(() => {
    if (showPrivacy) setClosingPrivacy(false);
  }, [showPrivacy]);
  useEffect(() => {
    if (showTerms) setClosingTerms(false);
  }, [showTerms]);
  useEffect(() => {
    if (showHistory) setClosingHistory(false);
  }, [showHistory]);
  useEffect(() => {
    if (showLeaderboard) setClosingLeaderboard(false);
  }, [showLeaderboard]);
  useEffect(() => {
    if (showProfileModal) setClosingProfile(false);
  }, [showProfileModal]);
  useEffect(() => {
    if (showPremiumParksInfo) setClosingPremiumParksInfo(false);
  }, [showPremiumParksInfo]);

  const phoneChanged = profileForm.phone !== (user?.phone || '');
  const phoneVerifiedStatus =
    phoneVerification.status === 'verified' || (!phoneChanged && user?.phoneVerified);
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
	  const collapseLegal = () => setShowLegal(false);
	  const closeWithAnim = (setClosing, setShow) => {
	    setClosing(true);
	    setTimeout(() => {
      setShow(false);
      setClosing(false);
    }, 260);
  };
  const openAchievement = (achv) => {
    setSelectedAchievementId(achv?.id || null);
    setShowAchievementsModal(true);
  };
  const openAchievementsModal = () => {
    if (!selectedAchievementId && achievements.length > 0) setSelectedAchievementId(achievements[0].id);
    setShowAchievementsModal(true);
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

  useEffect(() => {
    setProfileForm({
      displayName: user?.displayName || '',
      email: user?.email || '',
      phone: user?.phone || '',
      language: user?.language || 'en',
    });
    setPhoneVerification({ status: 'idle', confirmation: null, code: '', error: '' });
  }, [user]);

  useEffect(() => {
    if (user?.language) {
      i18n.changeLanguage(user.language);
    }
  }, [user?.language, i18n]);

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

  const handleSubmit = () => {
    const formattedPlate = formatPlate(form.plate);
    if (!form.model.trim() || !isFullPlate(formattedPlate)) return;
    onAddVehicle?.({
      model: form.model.trim(),
      plate: formattedPlate,
      photo: formImage,
    });
    setForm({ model: '', plate: '' });
    setFormImage(null);
  };

  const ensureRecaptcha = () => {
    if (window.recaptchaVerifier) return window.recaptchaVerifier;
    window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    return window.recaptchaVerifier;
  };

  const normalizePhone = (value) => {
    const v = (value || '').replace(/\s+/g, '');
    if (v.startsWith('0')) return `+33${v.slice(1)}`;
    return v;
  };

  const handleSendPhoneCode = async () => {
    if (!auth.currentUser || !profileForm.phone) return;
    const normalized = normalizePhone(profileForm.phone);
    if (!/^\+\d{6,15}$/.test(normalized)) {
      setPhoneVerification((prev) => ({ ...prev, error: t('phoneFormatError', 'Use international format, e.g. +33123456789.') }));
      return;
    }
    setPhoneVerification((prev) => ({ ...prev, status: 'sending', error: '' }));
    try {
      const verifier = ensureRecaptcha();
      await verifier.render();
      const confirmation = await linkWithPhoneNumber(auth.currentUser, normalized, verifier);
      setPhoneVerification({ status: 'code-sent', confirmation, code: '', error: '' });
      setInfoMsg(t('phoneCodeSent', 'Verification code sent to your phone.'));
    } catch (err) {
      setPhoneVerification({ status: 'idle', confirmation: null, code: '', error: err.message || 'Unable to send code.' });
      if (window.recaptchaVerifier?.clear) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
      }
    }
  };

  const handleVerifyPhoneCode = async () => {
    if (!phoneVerification.confirmation || !phoneVerification.code) return;
    setPhoneVerification((prev) => ({ ...prev, status: 'verifying', error: '' }));
    try {
      await phoneVerification.confirmation.confirm(phoneVerification.code);
      await onUpdateProfile?.({
        ...profileForm,
        phone: profileForm.phone,
        phoneVerified: true,
      });
      setPhoneVerification({ status: 'verified', confirmation: null, code: '', error: '' });
      setInfoMsg(t('phoneVerified', 'Phone verified!'));
    } catch (err) {
      setPhoneVerification((prev) => ({ ...prev, status: 'code-sent', error: err.message || 'Invalid code.' }));
    }
  };

  return (
    <div
      className="relative h-full bg-gray-50 overflow-y-auto no-scrollbar"
      style={{ WebkitTapHighlightColor: 'transparent' }}
      data-role="account-sheet-scroll"
    >
      <div className="p-6 pb-6">
        <div id="recaptcha-container" className="hidden" />
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
          <Trophy size={22} style={iconStyle('leaderboard')} />
        </button>
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
          <button
            type="button"
            onClick={() => {
              collapseLegal();
              setShowProfileModal(true);
            }}
            className={`w-full p-4 flex items-center justify-between text-left transition ${
              isDark
                ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100'
                : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                <User size={20} style={iconStyle('profile')} />
              </div>
              <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>{t('profile')}</span>
            </div>
            <ArrowRight size={16} className={isDark ? 'text-slate-500' : 'text-gray-300'} />
          </button>

          <button
            type="button"
            onClick={() => {
              collapseLegal();
              setShowModal(true);
            }}
            className={`w-full p-4 flex items-center justify-between text-left transition ${
              isDark
                ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100'
                : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                <Car size={20} style={iconStyle('vehicle')} />
              </div>
              <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>{t('myVehicles')}</span>
            </div>
            <ArrowRight size={16} className={isDark ? 'text-slate-500' : 'text-gray-300'} />
          </button>

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
              onClick={openPremiumParksModal}
              className={`w-full p-4 flex items-center justify-between text-left transition ${
                isDark
                  ? 'text-slate-100 [@media(hover:hover)]:hover:bg-slate-800'
                  : 'text-gray-900 [@media(hover:hover)]:hover:bg-gray-50'
              }`}
            >
	            <div className="flex items-center space-x-3">
	              <div className="bg-white p-2 rounded-lg border border-gray-100">
	                <Heart size={20} style={iconStyle('premiumParks')} />
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
            onClick={() => {
              collapseLegal();
              onInvite?.();
            }}
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

          <button
            type="button"
            onClick={() => {
              collapseLegal();
              openAchievementsModal();
            }}
            className={`w-full p-4 flex items-center justify-between text-left transition ${
              isDark
                ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100'
                : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
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

          <button
            type="button"
            onClick={() => {
              collapseLegal();
              setShowHistory(true);
            }}
            className={`w-full p-4 flex items-center justify-between text-left transition ${
              isDark
                ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100'
                : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                <History size={20} style={iconStyle('history')} />
              </div>
              <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
                {t('historyTitle', { defaultValue: 'Historique' })}
              </span>
            </div>
            <ArrowRight size={16} className={isDark ? 'text-slate-500' : 'text-gray-300'} />
          </button>
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
            onClick={() => {
              collapseLegal();
              toggleTheme();
            }}
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

          <button
            type="button"
            onClick={() => setShowLegal((s) => !s)}
            className={`w-full p-4 flex items-center justify-between text-left transition ${
              isDark
                ? 'text-slate-100 [@media(hover:hover)]:hover:bg-slate-800'
                : 'text-gray-900 [@media(hover:hover)]:hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                <FileText size={20} style={iconStyle('legal')} />
              </div>
              <span className={`font-semibold ${isDark ? 'text-slate-50' : 'text-gray-900'}`}>
                {t('legalAndContact', 'Legal & Contact')}
              </span>
            </div>
            <ArrowRight
              size={16}
              className={`${isDark ? 'text-slate-500' : 'text-gray-300'} transition-transform ${
                showLegal ? 'rotate-90' : 'rotate-0'
              }`}
            />
          </button>
          {showLegal && (
            <div
              className={`px-4 pb-4 pt-2 grid grid-cols-3 gap-2 text-sm ${
                isDark ? 'bg-slate-800/80' : 'bg-gray-50'
              } animate-[accordionDown_0.25s_ease]`}
              style={{ '--accordion-height': 'auto' }}
            >
              <button
                type="button"
                onClick={() => {
                  collapseLegal();
                  setShowTerms(true);
                }}
                className={`w-full font-semibold py-2 rounded-xl border transition ${
                  isDark
                    ? 'bg-slate-900 text-slate-100 border-slate-700 hover:border-slate-600 hover:bg-slate-800'
                    : 'bg-white text-gray-800 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t('terms', 'Terms')}
              </button>
              <button
                type="button"
                onClick={() => {
                  collapseLegal();
                  setShowPrivacy(true);
                }}
                className={`w-full font-semibold py-2 rounded-xl border transition ${
                  isDark
                    ? 'bg-slate-900 text-slate-100 border-slate-700 hover:border-slate-600 hover:bg-slate-800'
                    : 'bg-white text-gray-800 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t('privacy', 'Privacy')}
              </button>
              <button
                type="button"
                onClick={() => {
                  collapseLegal();
                  window.location.assign('mailto:enguerrand.boitel@gmail.com');
                }}
                className={`w-full font-semibold py-2 rounded-xl border transition ${
                  isDark
                    ? 'bg-slate-900 text-slate-100 border-slate-700 hover:border-slate-600 hover:bg-slate-800'
                    : 'bg-white text-gray-800 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t('contactUs', 'Contact')}
              </button>
            </div>
          )}
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
      {showPremiumParksInfo && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingPremiumParksInfo ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={() => closeWithAnim(setClosingPremiumParksInfo, setShowPremiumParksInfo)}
        >
          <div
            className={`rounded-2xl shadow-2xl w-full max-w-md p-6 relative ${
              isDark ? 'bg-slate-950 text-slate-100' : 'bg-white text-gray-900'
            } ${closingPremiumParksInfo ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'}`}
            onClick={(e) => e.stopPropagation()}
            style={{ backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)' }}
          >
            <div className="flex items-center space-x-3 mb-4">
              <div
                className={`p-2 rounded-lg border ${
                  isDark ? 'bg-white/10 border-white/10' : 'bg-white border-gray-100'
                }`}
              >
                <Heart size={20} style={iconStyle('premiumParks')} />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-lg leading-tight">{t('premiumParks', 'Premium Parks')}</div>
                <div className={`text-xs ${isDark ? 'text-slate-300' : 'text-gray-500'}`}>
                  {t('premiumParksInfoSubtitle', { defaultValue: 'Hearts for free spots' })}
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
            </div>

            <div className={`mt-4 text-sm ${isDark ? 'text-slate-300' : 'text-gray-600'}`}>
              {t('premiumParksInfoRule', { defaultValue: "You can't accept a free spot with 0 hearts." })}
            </div>

            {premiumParksPurchaseError ? (
              <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">
                {premiumParksPurchaseError}
              </div>
            ) : null}
            {premiumParksPurchaseMsg ? (
              <div className={`mt-3 text-sm rounded-xl px-4 py-2 border ${
                isDark
                  ? 'text-emerald-200 bg-emerald-500/10 border-emerald-400/10'
                  : 'text-emerald-800 bg-emerald-50 border-emerald-100'
              }`}
              >
                {premiumParksPurchaseMsg}
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleBuyPremiumParks}
              disabled={buyingPremiumParks}
              className="w-full mt-4 h-12 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 text-white font-extrabold shadow-[0_12px_30px_rgba(249,115,22,0.35)] hover:brightness-110 transition active:scale-[0.99] disabled:opacity-60"
            >
              {buyingPremiumParks
                ? t('pleaseWait', 'Please wait...')
                : t('premiumParksBuyCta', { defaultValue: 'Refill to 5 hearts • 10€' })}
            </button>
            <div className={`mt-2 text-xs ${isDark ? 'text-slate-400' : 'text-gray-400'} text-center`}>
              {t('premiumParksBuyNote', { defaultValue: 'Refills your hearts back to 5.' })}
            </div>
          </div>
        </div>
      )}

{/* Modale Profil */}
      {showProfileModal && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingProfile ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={() => closeWithAnim(setClosingProfile, setShowProfileModal)}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative max-h-[85vh] overflow-y-auto ${
              closingProfile ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            }`}
            onClick={(e) => e.stopPropagation()}
	          >
	            <div className="flex items-center space-x-3 mb-4">
	              <div className="bg-white p-2 rounded-lg border border-gray-100">
	                <User size={20} style={iconStyle('profile')} />
	              </div>
              <span className="font-semibold text-lg">{t('profile')}</span>
            </div>

            <div className="relative rounded-2xl border border-white/60 bg-white/70 backdrop-blur-sm p-4 shadow-inner shadow-black/5 overflow-hidden">
              {infoMsg && (
                <div className="mb-3 text-sm text-orange-700 bg-orange-50 border border-orange-100 rounded-xl px-4 py-2">
                  {infoMsg}
                </div>
              )}

              {!isEditingProfile ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingProfile(true);
                      setInfoMsg('');
                    }}
                    className="text-sm font-semibold text-orange-600 bg-white/90 backdrop-blur px-5 py-3 rounded-xl border border-orange-100 shadow-md hover:bg-orange-50 transition"
                  >
                    {t('editProfile', 'Edit')}
                  </button>
                </div>
              ) : null}

              <div className={`space-y-3 transition ${!isEditingProfile ? 'blur-sm pointer-events-none select-none' : ''}`}>
                <div className="grid grid-cols-1 gap-2">
                  <label className="text-xs text-gray-500 font-semibold">{t('name')}</label>
                  <input
                    type="text"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                    value={profileForm.displayName}
                    disabled={!isEditingProfile}
                    onChange={(e) => setProfileForm((prev) => ({ ...prev, displayName: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <label className="text-xs text-gray-500 font-semibold">{t('email')}</label>
                  <input
                    type="email"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                    value={profileForm.email}
                    disabled={!isEditingProfile}
                    onChange={(e) => setProfileForm((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <label className="text-xs text-gray-500 font-semibold">{t('phone')}</label>
                  <input
                    type="tel"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                    value={profileForm.phone}
                    disabled={!isEditingProfile}
                    onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                  {isEditingProfile ? (
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={handleSendPhoneCode}
                        className="text-xs font-semibold text-orange-600 bg-orange-50 px-2 py-1 rounded-lg border border-orange-100 hover:bg-orange-100 disabled:opacity-50"
                        disabled={phoneVerification.status === 'sending'}
                      >
                        {phoneVerification.status === 'sending'
                          ? t('pleaseWait', 'Please wait...')
                          : t('sendCode', 'Send code')}
                      </button>
                      {phoneVerification.status === 'code-sent' || phoneVerification.status === 'verifying' ? (
                        <>
                          <input
                            type="tel"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={phoneVerification.code}
                            onChange={(e) => setPhoneVerification((prev) => ({ ...prev, code: e.target.value }))}
                            placeholder="123456"
                            className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={handleVerifyPhoneCode}
                            className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-lg border border-green-100 hover:bg-green-100 disabled:opacity-50"
                            disabled={phoneVerification.status === 'verifying'}
                          >
                            {t('verifyCode', 'Verify code')}
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {phoneVerification.error && (
                    <p className="text-xs text-red-500">{phoneVerification.error}</p>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <label className="text-xs text-gray-500 font-semibold">{t('languageLabel')}</label>
                  <select
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 bg-white"
                    value={profileForm.language}
                    disabled={!isEditingProfile}
                    onChange={(e) => {
                      const lng = e.target.value;
                      setProfileForm((prev) => ({ ...prev, language: lng }));
                      i18n.changeLanguage(lng);
                    }}
                  >
                    <option value="en">English</option>
                    <option value="fr">Français</option>
                  </select>
                </div>
                {isEditingProfile ? (
                  <div className="flex space-x-2">
                    <button
                      onClick={async () => {
                        if (phoneChanged && !phoneVerifiedStatus) {
                          setInfoMsg(t('verifyPhoneToSave', 'Please verify your phone before saving.'));
                          return;
                        }
                        const res = await onUpdateProfile?.({
                          ...profileForm,
                          phoneVerified: phoneChanged ? true : user?.phoneVerified,
                        });
                        if (res?.error) {
                          const msg = res.reauthRequired
                            ? t('emailUpdateReauth', 'Please sign out/in again to verify and update your email.')
                            : t('updateProfileError', 'Unable to update profile. Please try again.');
                          setInfoMsg(msg);
                        } else if (res?.needsEmailVerify) {
                          setInfoMsg(t('emailVerificationSent', 'Verification email sent. Confirm it to finalize your email update.'));
                        } else {
                          setInfoMsg('');
                        }
                        setIsEditingProfile(false);
                      }}
                      disabled={phoneChanged && !phoneVerifiedStatus}
                      className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500 text-white py-3 rounded-xl font-bold shadow-md hover:scale-[1.01] transition disabled:opacity-60"
                    >
                      {t('saveProfile', 'Save profile')}
                    </button>
                    <button
                      onClick={() => {
                        setProfileForm({
                          displayName: user?.displayName || '',
                          email: user?.email || '',
                          phone: user?.phone || '',
                          language: user?.language || 'en',
                        });
                        setIsEditingProfile(false);
                      }}
                      className="flex-1 bg-white border border-gray-200 text-gray-600 py-3 rounded-xl font-bold shadow-sm hover:bg-gray-50 transition"
                    >
                      {t('cancel', 'Cancel')}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingModal ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={() => closeWithAnim(setClosingModal, setShowModal)}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative ${
              closingModal ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            }`}
            onClick={(e) => e.stopPropagation()}
	          >
	            <h3 className="text-xl font-bold text-gray-900 mb-4">{t('manageVehiclesTitle', 'Manage my vehicles')}</h3>

	            <div className="space-y-3 mb-4 max-h-64 overflow-y-auto pr-1">
              {vehicles.length === 0 && (
                <p className="text-sm text-gray-400">{t('noVehiclesModal', 'No vehicles yet. Add one below.')}</p>
              )}
              {vehicles.map((v) => (
                <div
                  key={v.id}
                  className={`flex items-center justify-between border rounded-xl px-3 py-2 ${
                    v.isDefault ? 'border-orange-200 bg-orange-50' : 'border-gray-100'
                  }`}
                >
                  <div>
                    <p className="font-semibold text-gray-900">{v.model}</p>
                    <p className="text-xs text-gray-500 tracking-widest font-mono">{v.plate}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onSelectVehicle?.(v.id)}
                      className={`text-sm font-semibold px-3 py-1 rounded-lg ${
                        v.isDefault
                          ? 'bg-orange-600 text-white'
                          : 'bg-white border border-gray-200 text-gray-600 hover:border-orange-200 hover:text-orange-600'
                      }`}
                    >
                      {v.isDefault ? t('selected', 'Selected') : t('select', 'Select')}
                    </button>
                    <button
                      onClick={() => onDeleteVehicle?.(v.id)}
                      className="text-sm text-rose-500 hover:text-rose-600 px-2"
                    >
                      {t('delete', 'Delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-3">
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder={t('modelPlaceholder', 'Model (e.g., Tesla Model 3)')}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                value={form.model}
                onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
              />
            </div>
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder={t('platePlaceholderFull', 'Plate (e.g., AB-123-CD)')}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm uppercase tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-orange-200"
                value={form.plate}
                onChange={(e) => setForm((prev) => ({ ...prev, plate: formatPlate(e.target.value) }))}
              />
            </div>
            <div className="flex space-x-2 items-center">
              <label className="w-full cursor-pointer">
                <div className="border border-dashed border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-600 hover:border-orange-300 hover:text-orange-600 transition">
                  {formImage ? t('imageSelected', 'Image selected') : t('uploadPhoto', 'Upload vehicle photo')}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) {
                      setFormImage(null);
                      return;
                    }
                    const reader = new FileReader();
                    reader.onloadend = () => setFormImage(reader.result);
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handleSubmit}
                className="flex-1 bg-orange-600 text-white py-3 rounded-xl font-bold shadow-md hover:bg-orange-700 transition"
              >
                {t('addVehicle', 'Add vehicle')}
              </button>
            </div>
          </div>
        </div>
        </div>
      )}

      {showAchievementsModal && selectedAchievement && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 animate-[overlayFade_0.2s_ease]"
          onClick={() => setShowAchievementsModal(false)}
        >
	          <div
	            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative animate-[modalIn_0.28s_ease]"
	            onClick={(e) => e.stopPropagation()}
	          >
	            <p className="text-xs uppercase tracking-wide text-gray-500 mb-3">
	              {t('achievements', 'Achievements')}
	            </p>
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
	              <div className="bg-gray-50 p-2 rounded-lg shadow-sm shadow-gray-200/60">
	                <Trophy size={20} style={iconStyle('leaderboard')} />
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
	                          src={rankIcon(txnCount)}
	                          alt="Rank"
	                          className="w-8 h-8 rounded-full object-contain bg-white p-1"
	                        />
	                        <div className="truncate max-w-[180px]">
	                          <p className="font-semibold text-gray-900 truncate">{u.displayName || t('unknown', 'Unknown')}</p>
	                          <p className="text-[11px] font-semibold text-orange-600 truncate">{rankLabel(txnCount)}</p>
	                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold text-gray-900">{txnCount}</p>
                      <div className="mt-1 flex justify-end">
                        {idx === 0 && <Car size={16} style={iconStyle('tierCar')} />}
                        {idx > 0 && idx < 5 && <Laptop size={16} style={iconStyle('tierLaptop')} />}
                        {idx >= 5 && idx < 10 && <Smartphone size={16} style={iconStyle('tierPhone')} />}
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
		                onClick={() => setShowRankInfo(tier)}
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

      {showHistory && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingHistory ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={() => closeWithAnim(setClosingHistory, setShowHistory)}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative ${
              closingHistory ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            }`}
            onClick={(e) => e.stopPropagation()}
	          >
	            <div className="flex items-center space-x-2 mb-4">
	              <div className="bg-white p-2 rounded-lg border border-gray-100">
	                <History size={20} style={iconStyle('history')} />
	              </div>
              <h3 className="text-xl font-bold text-gray-900">{t('transactionHistory', 'Transaction History')}</h3>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {transactions.length === 0 && (
                <p className="text-sm text-gray-400">{t('noTransactions', 'No transactions yet.')}</p>
              )}
              {transactions.map((tx) => {
                const replaceUserName = (value) => {
                  if (!value) return value;
                  const name = user?.displayName;
                  if (!name) return value;
                  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  return value.replace(new RegExp(escaped, 'gi'), 'Me');
                };
                const title = replaceUserName(tx.title || t('transactionHistory', 'Transaction'));
                return (
                  <div
                    key={tx.id}
                    className="border border-gray-100 rounded-xl px-3 py-2 flex items-center justify-between"
                  >
                    <div className="pr-2">
                      <p className="font-semibold text-gray-900">{title}</p>
                      <p className="text-xs text-gray-500">
                        {tx.createdAt?.toDate
                          ? tx.createdAt.toDate().toLocaleString()
                          : tx.createdAt?.toString?.() || ''}
                      </p>
                    </div>
                    <div className="text-right flex flex-col items-end space-y-1">
                      <p className="text-sm font-bold text-gray-900">
                        {tx.amount != null ? `${tx.amount} €` : ''}
                      </p>
                      <p className="text-xs text-gray-500 capitalize">{tx.status || t('completed', 'completed')}</p>
                      <button
                        type="button"
                        onClick={() => {
                          const body = `${title} - ${tx.amount != null ? `${tx.amount} €` : ''} - ${tx.status || ''}`;
                          if (navigator.share) {
                            navigator.share({ title: 'ParkSwap', text: body }).catch(() => {});
                          } else if (navigator.clipboard?.writeText) {
                            navigator.clipboard.writeText(body).catch(() => {});
                            alert(t('copiedTx', 'Transaction copied to clipboard'));
                          }
                        }}
                        className="text-[11px] text-orange-600 underline"
                      >
                        {t('share', 'Share')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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

      {showPrivacy && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingPrivacy ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={() => closeWithAnim(setClosingPrivacy, setShowPrivacy)}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative max-h-[80vh] overflow-y-auto ${
              closingPrivacy ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            }`}
            onClick={(e) => e.stopPropagation()}
            onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
              setPrivacyCloseVisible(!atBottom);
            }}
	          >
	            <h3 className="text-xl font-bold text-gray-900 mb-3">{t('privacy', 'Privacy Policy')}</h3>
	            <p className="text-sm text-gray-600 leading-relaxed space-y-2 whitespace-pre-line">
	              {t(
                'privacyBody',
                `Privacy Policy

Thank you for using LoulouPark!

At LoulouPark, we are committed to respecting your privacy. We wrote this policy to help you understand how we collect, use, and share information that we collect through the LoulouPark mobile applications. Because we're an internet company, some of the concepts below are a little technical, but we've tried our best to explain things simply and transparently. If you have any questions about our privacy policy, please let us know.

What information we collect
You may be asked to provide personal information anytime you interact with us or one of our affiliates, such as when you use one of our mobile apps. The types of information we collect such as:

1 - When you give it to us or give us permission to obtain it.
When you sign up for or use LoulouPark, you voluntarily share certain information including your name, telephone number, email address, payment card information, vehicle information, and any other information you give us.

2 - When a third-party gives it to us.
We may collect your information when a third-party provides your information to us to use our services such as login or signup using third party to set up your account

· Internet or other electronic network activity information, such as information about your interactions with our Services. This includes information about the content you view, the time you spend viewing the content, and the features you access on the Services that we collect using cookies, pixels, and other technologies;
· Identifiers, such as your Internet Protocol (IP) address, device identifiers (including the manufacturer and model), and Media Access Control (MAC) address;
· Geo-location data;
· Standard server log data, such as your application version number, Device type, screen resolution, operating system, browser type and version, and the date and time of your visit.
We may also aggregate or de-identify the information described above. Aggregated or de-identified data is not subject to this policy.

How we use your information
We collect and use your information so that we can operate effectively and provide you with the best experience. We also use the information we collect for the following purposes:

· Fulfillment of parking transactions and other purchases, such as completing your parking transaction; and communicating with you about and keeping proper records of those transactions;
· Customer support, such as notifying you of any changes to our services; responding to your inquiries via email, phone, writing, or social media; investigating and addressing concerns raised by you; and monitoring and improving our customer support responses;
· Improving our services, such as conducting data analysis and audits; developing new products and services; enhancing our websites and mobile apps improving our services; identifying usage trends and visiting patterns; conducting customer satisfaction, market research, and quality assurance surveys; determining the effectiveness of our promotions; meeting contractual obligations;
· Marketing and promotions, such as sending you emails and messages about news and new promotions, features, products and services, and content; providing you with relevant advertising on and off our services; and administering your participation in contests, sweepstakes and promotions; and
· Legal proceedings and requirements, such as investigating or addressing claims or disputes relating to your use of our services; or as otherwise allowed by applicable law; or as requested by regulators, government entities, and official inquiries.

How and when we share your information

We do not sell your name or other personal information to third parties.
We may share the information we collect with:

1 - Our wholly-owned subsidiaries and affiliates
We share information within the LoulouPark group of companies to help us provide our services or conduct data processing on our behalf. If we were to engage in a merger, acquisition, bankruptcy, dissolution, reorganization, or similar transaction or proceeding that involves the transfer of the information described in this policy, we would share your information with a party involved in such a process (for example, a potential purchaser).

2 - Third-party companies, service providers or business partners
We rely on third parties to perform a number of contractual services on our behalf. To do so, we may need to share your information with them. For example, we may rely on service providers to enable functionality on our Services, to provide you with relevant content (including advertisements), to process your payments, and for other business purposes.

3 - Law enforcement agencies or government agencies
We may share information with law enforcement agencies and/or the judicial system to confirm or dispute a traffic citation issued to you.

4 - Your consent
We may share your information other than as described in this policy if we notify you, and you agree.

5 - Other services
We may share your information with third-parties to enable you to sign up for or log in to LoulouPark, or when you decide to link your LoulouPark account to those services.

Where we store your information
We process and store personal information inside and outside of France, including in countries that have privacy protections that may be less stringent than your jurisdiction.

How we secure your information
Although we take steps to safeguard personal information, no practices are 100% secure, and we do not guarantee the security of your information.

How we use cookies
We, along with our partners, use various technologies to collect and store information when you visit one of our services, and this may include using cookies or similar technologies to identify your browser or device. We also use these technologies to collect and store information when you interact with services from our partners, such as advertising services.
The technologies we use for this automatic data collection may include:

· Cookies. A cookie is a small file placed on the hard drive of your computer. We use cookies to store information, such as your login credentials and website preferences, so that we can remember certain choices you’ve made Cookies can also be used to recognize your device so that you do not have to provide the same information more than once.

· Mobile device identifiers and SDKs. The SDK is a bit of computer code that app developers can include in their apps to enable ads to be shown, data to be collected and related services or analytics to be performed.

· Other technologies. There are other local storage and Internet technologies, such as local shared objects (also referred to as “Flash cookies”) and HTML5 local storage that operate similarly to the technologies discussed above.

Children's data
Children under 16 are not allowed to use our services. If we learn we have collected or received personal information from a child under 16 without verification of parental consent, we will delete that information. If you believe we might have any information from or about a child under 16, please contact us at enguerrand.boitel@gmail.com.

How we make changes to this policy
We may change this policy from time to time, and if we do, we’ll post any changes on this page. If you continue to use LoulouPark after those changes are in effect, you agree to the new policy. If the changes are significant, we may provide a more prominent notice or get your consent, as required by law.

Contact us
If you have any questions or suggestions about our Privacy Policy, do not hesitate to contact us at enguerrand.boitel@gmail.com.`,
              )}
            </p>
            <div className="sticky bottom-0 left-0 right-0 pt-4 mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => setShowPrivacy(false)}
                className={`mx-auto flex items-center justify-center w-12 h-12 bg-orange-500 text-white text-xl font-bold rounded-full shadow-[0_12px_24px_-12px_rgba(255,132,0,0.55)] hover:bg-orange-600 transition transform-gpu ${
                  privacyCloseVisible
                    ? 'animate-[slideUpFade_0.3s_ease]'
                    : 'animate-[slideDownFadeOut_0.25s_ease_forwards]'
                } dark:shadow-[0_16px_32px_-14px_rgba(0,0,0,0.65)]`}
	              >
	                <ChevronDown size={22} strokeWidth={3} />
	              </button>
	            </div>
	          </div>
	        </div>
      )}

      {showTerms && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingTerms ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={() => closeWithAnim(setClosingTerms, setShowTerms)}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative max-h-[80vh] overflow-y-auto ${
              closingTerms ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            }`}
            onClick={(e) => e.stopPropagation()}
            onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
              setTermsCloseVisible(!atBottom);
            }}
	          >
	            <h3 className="text-xl font-bold text-gray-900 mb-3">{t('terms', 'Terms & Conditions')}</h3>
	            <p className="text-sm text-gray-600 leading-relaxed space-y-2 whitespace-pre-line">
	              {t(
                'termsBody',
                `Terms and Conditions

By using our Services, you are agreeing to these terms and our Privacy Policy. Please read them carefully.

We offer a variety of Services so sometimes additional terms may apply. Additional terms will be available with the relevant Services, and those additional terms will also become part of your agreement with us, if you use those Services.

These terms and conditions also apply to all parties with whom LoulouPark has entered or will enter an End User License Agreement (EULA). To the extent that a provision of the service conflicts with either (or both) the EULA or Privacy Policy, the EULA shall be deemed to control the relationship between the parties as to that provision. HOWEVER, IN NO CASE SHALL LOULOUPARK BE DEEMED TO WAIVE ANY RIGHT OR PROTECTION TO WHICH IT IS ENTITLED UNDER THE LAWS OF FRANCE OR INTERNATIONAL CONVENTIONS RELATING TO LOULOUPARK INTELLECTUAL PROPERTY RIGHTS.

Changes to the Terms
We may modify these terms or any additional terms that apply to a Service to, for example, reflect changes to the law or changes to our Services. You should look at the terms regularly. We'll post notice of modifications to these terms on this page. We'll post notice of modified additional terms in the applicable Service. Changes will not apply retroactively after they are posted. However, changes addressing new functions for a Service or changes made for legal reasons will be effective immediately. If you do not agree to the modified terms for a Service, you should discontinue your use of that Service.

Using our Services
You may use our Services only if you can legally form a binding contract with us, and only in accordance with these terms and all applicable laws. You can't use our Services if it would be prohibited by applicable sanctions. Any use or access by anyone under the age of 16 is not allowed. Using LoulouPark may include downloading an app to your phone, or other device. You agree that we may automatically update that software, and these terms will apply to any updates.
We are a technology company based in Paris. We do not own, operate, or maintain any parking facility, and we do not provide parking enforcement services. Parking facilities are operated by users. Parking restrictions (i.e. no parking signs) take precedence over any information that you receive from us. All applicable parking rules and regulations apply to you, and your use of the Services does not excuse you from following the rules.

Network Access and Devices
You are responsible for obtaining the data network access necessary to use the Services. Your mobile network's data and messaging rates and fees may apply if you access or use the Services from your device. You are responsible for acquiring and updating compatible hardware or devices necessary to access and use the Services and any updates. We do not guarantee that the Services will function on any particular hardware or devices. In addition, the Services may be subject to malfunctions and delays inherent in the use of the internet and electronic communications.

Payment
You understand that use of the Services may result in charges to you for the services you receive ("Charges"). We will receive and/or enable your payment of the applicable Charges for services obtained through your use of the Services. Charges will be inclusive of applicable taxes where required by law. Charges may include other applicable fees or processing fees.
All Charges and payments will be enabled by LoulouPark using the preferred payment method designated by you in your account, after which you can see transaction. If your primary account payment method is determined to be expired, invalid or otherwise not able to be charged, you agree that we may use a secondary payment method in your account, if available. Charges paid by you are final and non-refundable, unless otherwise determined by LoulouPark.

As between you and LoulouPark, LoulouPark reserves the right to establish, remove and/or revise Charges for any or all services obtained through the use of the Services at any time in our sole discretion. We will use reasonable efforts to inform you of Charges that may apply, provided that you will be responsible for Charges incurred under your account regardless of your awareness of such Charges or the amounts thereof, and shall have no bearing on your use of the Services or the Charges applied to you.
In certain cases, with respect to third party providers, Charges you incur will be owed directly to third party providers, and LoulouPark will collect payment of those charges from you, on the third party provider's behalf as their limited payment collection agent, and payment of the Charges shall be considered the same as payment made directly by you to the third party provider.

Sweepstakes and Other Promotions
In addition to these terms, sweepstakes, contests or other promotions (collectively, "Promotions") made available through the Services may have specific rules that are different from these terms. By participating in a Promotion, you will become subject to those rules. We urge you to review the rules before you participate in a Promotion. Promotion rules will control over any conflict with these terms.

Intellectual Property
We reserve all of our intellectual property rights in the Services. Trademarks and logos used in connection with the Services are the trademarks of their respective owners. LoulouPark trademarks, service marks, graphics and logos used for our Services are trademarks or registered trademarks of LoulouPark.

Licence
If you have entered an End User License Agreement (EULA) with LoulouPark, your EULA may provide you with greater rights and license as defined by that EULA. Otherwise, you acquire absolutely no rights or licenses in or to the Service and materials contained within the Service other than the limited right to utilize the Service in accordance with the Terms. Should you choose to download content from the Service, you must do so in accordance with the Terms of service. Such download is licensed to you by LoulouPark ONLY for your own personal use in accordance with the Terms of service and does not transfer any other rights to you.

Security
We care about the security of our users. While we work to protect the security of your content and account, we can't guarantee that unauthorized third parties won't be able to defeat our security measures. We ask that you keep your password secure. Please notify us immediately of any unauthorized use of your account.

Modifying and Terminating our Services
We are constantly changing and improving our Services. We may add or remove functionalities or features, and we may suspend or stop a Service altogether.
You can stop using our Services at any time, although we'll be sorry to see you go! We may terminate or suspend your right to access or use our Services for any reason with or without notice. LoulouPark may also stop providing Services to you or add or create new limits to our Services at any time.

Third-party Links
Our Services may contain links to other websites and resources provided by third parties that are not owned or controlled by us. We have no control over the contents of those websites or resources. If you access any third-party content from our Services, you do so at your own risk and subject to the terms and conditions of use for such third-party content.

Disclaimer of Warranties
Our Services are provided on an "as is" basis without warranty of any kind, whether express or implied, statutory or otherwise. We specifically disclaim any and all warranties of merchantability, non-infringement, and fitness for a particular purpose.

Limitation of Liability
TO THE MAXIMUM EXTENT ALLOWED BY LAW, IN NO EVENT WILL THE COLLECTIVE LIABILITY OF LOULOUPARK AND ITS SUBSIDIARIES AND AFFILIATES, AND THEIR RESPECTIVE LICENSORS, SERVICE PROVIDERS, EMPLOYEES, AGENTS, OFFICERS, MEMBERS, MANAGERS AND DIRECTORS, TO ANY PARTY (REGARDLESS OF THE FORM OF ACTION, WHETHER IN CONTRACT, TORT, OR OTHERWISE) EXCEED THE AMOUNT YOU HAVE PAID TO LOULOUPARK TO USE THE SERVICES.

General Terms
If there is a conflict between these terms and the additional terms, the additional terms will control for that conflict.
These terms control the relationship between LoulouPark and you. They do not create any third-party beneficiary rights.
If you do not comply with these terms, and we don't take action right away, this doesn't mean that we are giving up any rights that we may have (such as taking action in the future).
If it turns out that a particular term is not enforceable, this will not affect any other terms.
The laws of France will apply to any disputes arising out of or relating to these terms or the Services. All claims arising out of or relating to these terms or the Services will be litigated exclusively in the courts of Paris, France, and you and LoulouPark consent to personal jurisdiction in those courts.`,
              )}
            </p>
            <div className="sticky bottom-0 left-0 right-0 pt-4 mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => setShowTerms(false)}
                className={`mx-auto flex items-center justify-center w-12 h-12 bg-orange-500 text-white text-xl font-bold rounded-full shadow-[0_12px_24px_-12px_rgba(255,132,0,0.55)] hover:bg-orange-600 transition transform-gpu ${
                  termsCloseVisible
                    ? 'animate-[slideUpFade_0.3s_ease]'
                    : 'animate-[slideDownFadeOut_0.25s_ease_forwards]'
	                } dark:shadow-[0_16px_32px_-14px_rgba(0,0,0,0.65)]`}
	              >
	                <ChevronDown size={22} strokeWidth={3} />
	              </button>
	            </div>
	          </div>
	        </div>
      )}
    </div>
  );
};

export default ProfileView;
