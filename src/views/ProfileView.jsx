// src/views/ProfileView.jsx
import { X, Share, ArrowUpRight, ArrowDownLeft, Clock, CheckCircle2 } from 'lucide-react'; // Assurez-vous d'importer ces icônes
import React, { useState, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { FileText, ShieldCheck } from 'lucide-react'; // Assurez-vous d'avoir les icônes
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
  Sun,
  Moon,
  Globe,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PhoneAuthProvider, RecaptchaVerifier, updatePhoneNumber } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, appId, db } from '../firebase';
import { PHONE_COUNTRIES, formatPhoneForDisplay, formatPhoneInput, guessPhoneCountry, toE164Phone } from '../utils/phone';
import { PRIVACY_POLICY_TEXT } from '../legal/privacyPolicyText';
import { TERMS_AND_CONDITIONS_TEXT } from '../legal/termsAndConditionsText';

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
  const legalLocale = String(i18n.language || 'en')
    .toLowerCase()
    .startsWith('fr')
    ? 'fr'
    : 'en';
  const privacyPolicyText = PRIVACY_POLICY_TEXT[legalLocale] || PRIVACY_POLICY_TEXT.en || '';
  const termsAndConditionsText = TERMS_AND_CONDITIONS_TEXT[legalLocale] || TERMS_AND_CONDITIONS_TEXT.en || '';
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

    // Extraction souple des segments
    for (const ch of cleaned) {
      if (letters1.length < 2 && /[A-Z]/.test(ch) && digits.length === 0) {
        letters1 += ch;
      } else if (letters1.length === 2 && digits.length < 3 && /[0-9]/.test(ch)) {
        digits += ch;
      } else if (letters1.length === 2 && digits.length === 3 && letters2.length < 2 && /[A-Z]/.test(ch)) {
        letters2 += ch;
      }
    }

    // Construction avec les tirets au bon moment
    let res = letters1;
    if (letters1.length === 2 && (digits.length > 0 || cleaned.length > 2)) res += '-';
    res += digits;
    if (digits.length === 3 && (letters2.length > 0 || cleaned.length > 5)) res += '-';
    res += letters2;

    return res;
  };
  const isFullPlate = (plate) => /^[A-Z]{2}-\d{3}-[A-Z]{2}$/.test(plate || '');
  const [form, setForm] = useState({ model: '' });

  const [plateSlots, setPlateSlots] = useState(Array(7).fill(''));
  

  const [plateValue, setPlateValue] = useState('');
  const [plateFocused, setPlateFocused] = useState(false);
  
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
    verificationId: '',
    code: '',
    error: '',
    phoneE164: '',
  });
  const [emailVerification, setEmailVerification] = useState({ status: 'idle', error: '' });
  const [showRankInfo, setShowRankInfo] = useState(null);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const recaptchaRenderPromiseRef = React.useRef(null);
  const [phoneCountry, setPhoneCountry] = useState(() => guessPhoneCountry(user?.phone).code);
  const nameInputRef = React.useRef(null);
  const emailInputRef = React.useRef(null);
  const phoneInputRef = React.useRef(null);
  const lastAddVehicleRequestRef = React.useRef(0);
  const lastHighlightVehiclesRef = React.useRef(0);
  const vehiclesRowRef = React.useRef(null);
  const [highlightVehiclesRow, setHighlightVehiclesRow] = useState(false);
  const highlightVehiclesTimerRef = React.useRef(null);
  const [highlightAddVehicleButton, setHighlightAddVehicleButton] = useState(false);
  const highlightAddVehicleTimerRef = React.useRef(null);
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

  const userPhoneE164 = String(user?.phone || '');
  const parsedPhone = toE164Phone(profileForm.phone, phoneCountry);
  const phoneInputHasValue = String(profileForm.phone || '').trim().length > 0;
  const phoneDirty = phoneInputHasValue ? parsedPhone.e164 !== userPhoneE164 : userPhoneE164 !== '';
  const phoneChanged = !!parsedPhone.e164 && parsedPhone.e164 !== userPhoneE164;
  const emailChanged = profileForm.email !== (user?.email || '');
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
    const nextCountryCode = guessPhoneCountry(user?.phone).code;
    setProfileForm({
      displayName: user?.displayName || '',
      email: user?.email || '',
      phone: formatPhoneForDisplay(user?.phone || '', nextCountryCode),
      language: user?.language || 'en',
    });
    setPhoneVerification({ status: 'idle', verificationId: '', code: '', error: '', phoneE164: '' });
    setEmailVerification({ status: 'idle', error: '' });
    setPhoneCountry(nextCountryCode);
  }, [user]);

  useEffect(() => {
    const id = Number(openAddVehicleRequestId) || 0;
    if (!id) return;
    if (lastAddVehicleRequestRef.current === id) return;
    lastAddVehicleRequestRef.current = id;
    setClosingModal(false);
    setShowModal(true);
  }, [openAddVehicleRequestId]);

  useEffect(() => {
    const id = Number(highlightVehiclesRequestId) || 0;
    if (!id) return;
    if (lastHighlightVehiclesRef.current === id) return;
    lastHighlightVehiclesRef.current = id;

    setHighlightVehiclesRow(true);
    try {
      vehiclesRowRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    } catch (_) {}

    if (highlightVehiclesTimerRef.current) window.clearTimeout(highlightVehiclesTimerRef.current);
    highlightVehiclesTimerRef.current = window.setTimeout(() => setHighlightVehiclesRow(false), 4200);

    return () => {};
  }, [highlightVehiclesRequestId, vehicles.length]);

  useEffect(() => {
    return () => {
      if (highlightVehiclesTimerRef.current) window.clearTimeout(highlightVehiclesTimerRef.current);
      if (highlightAddVehicleTimerRef.current) window.clearTimeout(highlightAddVehicleTimerRef.current);
    };
  }, []);

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
    setProfileForm((prev) => ({ ...prev, language: lng }));
    i18n.changeLanguage(lng);
    if (!user?.uid) return;
    await onUpdateProfile?.({
      displayName: user?.displayName ?? profileForm.displayName ?? '',
      email: user?.email ?? profileForm.email ?? '',
      phone: user?.phone ?? profileForm.phone ?? '',
      language: lng,
      phoneVerified: user?.phoneVerified,
    });
  };

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

  const resetVehicleModal = () => {
    setForm({ model: '' });
    setPlateSlots(Array(7).fill(''));
    setPlateFocused(false);
    setFormImage(null);
  };

  const handleSubmit = () => {
    const plateValue = plateSlots.join('');
    const formattedPlate = formatPlate(plateValue);
    if (!form.model.trim() || !isFullPlate(formattedPlate)) return;
    onAddVehicle?.({
      model: form.model.trim(),
      plate: formattedPlate,
      photo: formImage,
    });
    resetVehicleModal();
  };

  const closeVehicleModal = () => {
    resetVehicleModal();
    closeWithAnim(setClosingModal, setShowModal);
  };

  const PLATE_TEMPLATE = 'AB-123-CD';
  const PLATE_EDIT_POSITIONS = [0, 1, 3, 4, 5, 7, 8];
  const plateNextKind = useMemo(() => {
    const lettersDone = Boolean(plateSlots[0] && plateSlots[1]);
    const digitsDone = Boolean(plateSlots[2] && plateSlots[3] && plateSlots[4]);
    if (lettersDone && !digitsDone) return 'digits';
    if (lettersDone && digitsDone) return 'letters';
    return 'letters';
  }, [plateSlots]);
  const buildPlateDisplay = (slots) => {
    const chars = PLATE_TEMPLATE.split('');
    for (let i = 0; i < PLATE_EDIT_POSITIONS.length; i += 1) {
      const pos = PLATE_EDIT_POSITIONS[i];
      const v = slots[i];
      if (v) chars[pos] = v;
    }
    return chars.join('');
  };
  const clampPlateCaret = (pos) => {
    const p = Math.max(0, Math.min(PLATE_TEMPLATE.length, Number(pos) || 0));
    if (p === 2) return 3;
    if (p === 6) return 7;
    return p;
  };
  const prevEditablePos = (pos) => {
    const p = clampPlateCaret(pos);
    for (let i = PLATE_EDIT_POSITIONS.length - 1; i >= 0; i -= 1) {
      if (PLATE_EDIT_POSITIONS[i] < p) return PLATE_EDIT_POSITIONS[i];
    }
    return PLATE_EDIT_POSITIONS[0];
  };
  const nextEditablePos = (pos) => {
    const p = clampPlateCaret(pos);
    for (let i = 0; i < PLATE_EDIT_POSITIONS.length; i += 1) {
      if (PLATE_EDIT_POSITIONS[i] > p) return PLATE_EDIT_POSITIONS[i];
    }
    return PLATE_EDIT_POSITIONS[PLATE_EDIT_POSITIONS.length - 1] + 1;
  };
  const slotIndexForPos = (pos) => PLATE_EDIT_POSITIONS.indexOf(pos);
  const coercePlateChar = (pos, ch) => {
    const c = String(ch || '').toUpperCase();
    if (!c) return '';
    const isLetterPos = pos === 0 || pos === 1 || pos === 7 || pos === 8;
    if (isLetterPos) return /[A-Z]/.test(c) ? c : '';
    return /[0-9]/.test(c) ? c : '';
  };
  const clearPlateRange = (start, end) => {
    const a = clampPlateCaret(start);
    const b = clampPlateCaret(end);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    setPlateSlots((prev) => {
      const next = [...prev];
      for (let pos = lo; pos <= hi; pos += 1) {
        const idx = slotIndexForPos(pos);
        if (idx >= 0) next[idx] = '';
      }
      return next;
    });
  };
  const insertPlateCharAt = (pos, ch) => {
    const p = clampPlateCaret(pos);
    const idx = slotIndexForPos(p);
    const coerced = coercePlateChar(p, ch);
    if (idx < 0 || !coerced) return { nextPos: p };
    setPlateSlots((prev) => {
      const next = [...prev];
      next[idx] = coerced;
      return next;
    });
    return { nextPos: nextEditablePos(p) };
  };

  const ensureRecaptcha = () => {
    if (window.recaptchaVerifier) return window.recaptchaVerifier;
    recaptchaRenderPromiseRef.current = null;
    window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    return window.recaptchaVerifier;
  };

  const handleSendPhoneCode = async () => {
    if (!auth.currentUser || !profileForm.phone) return;
    if (!phoneDirty) return;
    const parsed = toE164Phone(profileForm.phone, phoneCountry);
    if (!parsed.e164) {
      setPhoneVerification((prev) => ({ ...prev, error: t('phoneFormatError', 'Use international format, e.g. +33123456789.') }));
      return;
    }
    if (parsed.e164 === userPhoneE164) {
      setPhoneVerification((prev) => ({ ...prev, error: t('phoneSameError', 'This phone number is already set.') }));
      return;
    }
    setPhoneVerification((prev) => ({ ...prev, status: 'sending', error: '' }));
    try {
      const verifier = ensureRecaptcha();
      if (!recaptchaRenderPromiseRef.current) {
        recaptchaRenderPromiseRef.current = verifier.render();
      }
      try {
        await recaptchaRenderPromiseRef.current;
      } catch (err) {
        const message = String(err?.message || err || '');
        if (message.toLowerCase().includes('already been rendered')) {
          recaptchaRenderPromiseRef.current = Promise.resolve();
        } else {
          throw err;
        }
      }
      const provider = new PhoneAuthProvider(auth);
      const verificationId = await provider.verifyPhoneNumber(parsed.e164, verifier);
      setPhoneVerification({ status: 'code-sent', verificationId, code: '', error: '', phoneE164: parsed.e164 });
      setInfoMsg(t('phoneCodeSent', 'Verification code sent to your phone.'));
    } catch (err) {
      setPhoneVerification({
        status: 'idle',
        verificationId: '',
        code: '',
        error: err.message || 'Unable to send code.',
        phoneE164: '',
      });
      if (window.recaptchaVerifier?.clear) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
        recaptchaRenderPromiseRef.current = null;
      }
    }
  };

  const handleSendEmailVerification = async () => {
    if (!isEditingProfile || !emailChanged) return;
    if (!profileForm.email) return;
    setEmailVerification({ status: 'sending', error: '' });
    try {
      const nextPhone = toE164Phone(profileForm.phone, phoneCountry).e164 || userPhoneE164;
      const safePhone = phoneDirty ? (phoneVerifiedStatus ? nextPhone : userPhoneE164) : userPhoneE164;
      const safePhoneVerified = phoneDirty ? (phoneVerifiedStatus ? true : user?.phoneVerified) : user?.phoneVerified;
      const res = await onUpdateProfile?.({
        ...profileForm,
        phone: safePhone,
        phoneVerified: safePhoneVerified,
        email: profileForm.email,
      });
      if (res?.error) {
        const msg = res.reauthRequired
          ? t('emailUpdateReauth', 'Please sign out/in again to verify and update your email.')
          : t('updateProfileError', 'Unable to update profile. Please try again.');
        setEmailVerification({ status: 'idle', error: msg });
        return;
      }
      if (res?.needsEmailVerify) {
        setInfoMsg(t('emailVerificationSent', 'Verification email sent. Confirm it to finalize your email update.'));
      } else {
        setInfoMsg('');
      }
      setEmailVerification({ status: 'sent', error: '' });
    } catch (err) {
      setEmailVerification({
        status: 'idle',
        error: err?.message || t('updateProfileError', 'Unable to update profile. Please try again.'),
      });
    }
  };

  const handleVerifyPhoneCode = async () => {
    if (!auth.currentUser || !phoneVerification.verificationId || !phoneVerification.code) return;
    const verifiedPhone = phoneVerification.phoneE164 || toE164Phone(profileForm.phone, phoneCountry).e164;
    if (!verifiedPhone) {
      setPhoneVerification((prev) => ({ ...prev, error: t('phoneFormatError', 'Use international format, e.g. +33123456789.') }));
      return;
    }
    setPhoneVerification((prev) => ({ ...prev, status: 'verifying', error: '' }));
    try {
      const credential = PhoneAuthProvider.credential(phoneVerification.verificationId, phoneVerification.code);
      await updatePhoneNumber(auth.currentUser, credential);
	      await onUpdateProfile?.({
	        displayName: user?.displayName || '',
	        email: user?.email || '',
	        phone: verifiedPhone,
	        language: profileForm.language || i18n.language || 'en',
	        phoneVerified: true,
	      });
      const verifiedCountryCode = guessPhoneCountry(verifiedPhone).code;
      setPhoneCountry(verifiedCountryCode);
      setProfileForm((prev) => ({ ...prev, phone: formatPhoneForDisplay(verifiedPhone, verifiedCountryCode) }));
      setPhoneVerification({ status: 'verified', verificationId: '', code: '', error: '', phoneE164: verifiedPhone });
      setInfoMsg(t('phoneVerified', 'Phone verified!'));
    } catch (err) {
      setPhoneVerification((prev) => ({ ...prev, status: 'code-sent', error: err.message || 'Invalid code.' }));
    }
  };

  const collapseFullSelectionOnFocus = (e) => {
    const el = e?.target;
    if (!el || typeof el.value !== 'string') return;
    if (typeof el.selectionStart !== 'number' || typeof el.selectionEnd !== 'number') return;
    window.requestAnimationFrame(() => {
      try {
        const len = el.value.length;
        if (len > 0 && el.selectionStart === 0 && el.selectionEnd === len) {
          el.setSelectionRange(len, len);
        }
      } catch (_) {}
    });
  };

  const cancelProfileEdit = () => {
    const nextCountryCode = guessPhoneCountry(user?.phone).code;
    setProfileForm({
      displayName: user?.displayName || '',
      email: user?.email || '',
      phone: formatPhoneForDisplay(user?.phone || '', nextCountryCode),
      language: user?.language || 'en',
    });
    setPhoneVerification({ status: 'idle', verificationId: '', code: '', error: '', phoneE164: '' });
    setEmailVerification({ status: 'idle', error: '' });
    setInfoMsg('');
    setPhoneCountry(nextCountryCode);
    setIsEditingProfile(false);
  };

  const startProfileEdit = (field) => {
    setInfoMsg('');
    flushSync(() => setIsEditingProfile(true));
    try {
      if (field === 'name') nameInputRef.current?.focus?.();
      if (field === 'email') emailInputRef.current?.focus?.();
      if (field === 'phone') phoneInputRef.current?.focus?.();
    } catch (_) {}
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
            ref={vehiclesRowRef}
            className={`relative overflow-hidden w-full p-4 flex items-center justify-between text-left transition ${
              isDark
                ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100'
                : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
            }`}
          >
            {highlightVehiclesRow ? (
              <>
                <span
                  className="pointer-events-none absolute inset-0 bg-orange-400/10"
                  aria-hidden="true"
                />
                <span
                  className="pointer-events-none absolute inset-2 rounded-2xl border border-orange-300/70 animate-pulse"
                  aria-hidden="true"
                />
              </>
            ) : null}
            <div className="relative z-10 flex items-center space-x-3">
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                <Car size={20} style={iconStyle('vehicle')} />
              </div>
              <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>{t('myVehicles')}</span>
            </div>
            <ArrowRight size={16} className={`relative z-10 ${isDark ? 'text-slate-500' : 'text-gray-300'}`} />
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

	          <div
	            className={`w-full p-4 flex items-center justify-between text-left ${
	              isDark ? 'text-slate-100' : 'text-gray-900'
	            }`}
	          >
	            <div className="flex items-center space-x-3">
	              <div className="bg-white p-2 rounded-lg border border-gray-100">
	                {getLanguageFlag(profileForm.language) ? (
	                  <span className="text-lg leading-none">{getLanguageFlag(profileForm.language)}</span>
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
              value={profileForm.language}
              onChange={(e) => handleChangeLanguage(e.target.value)}
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
          </div>

	          <div className="w-full">
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
	            <div
	              className={`overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
	                showLegal ? 'max-h-40 opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-1 pointer-events-none'
	              }`}
		            >
		              <div className="px-4 pb-4 pt-2">
		                <div className="grid grid-cols-3 items-center justify-items-center gap-2 w-full text-sm">
		                <button
		                  type="button"
		                  onClick={() => {
		                    collapseLegal();
		                    setShowTerms(true);
	                  }}
	                  className={`px-4 font-semibold py-2 rounded-xl border transition ${
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
	                  className={`px-4 font-semibold py-2 rounded-xl border transition ${
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
	                  className={`px-4 font-semibold py-2 rounded-xl border transition ${
	                    isDark
	                      ? 'bg-slate-900 text-slate-100 border-slate-700 hover:border-slate-600 hover:bg-slate-800'
	                      : 'bg-white text-gray-800 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
	                  }`}
		                >
		                  {t('contactUs', 'Contact')}
		                </button>
		                </div>
		              </div>
		            </div>
		          </div>
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
          onClick={() => {
            cancelProfileEdit();
            closeWithAnim(setClosingProfile, setShowProfileModal);
          }}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative max-h-[85vh] overflow-y-auto ${
              closingProfile ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            }`}
            onClick={(e) => e.stopPropagation()}
			          >
			            <div className="flex items-center justify-between mb-4">
			              <div className="flex items-center space-x-3">
			                <div className="bg-white p-2 rounded-lg border border-gray-100">
			                  <User size={20} style={iconStyle('profile')} />
			                </div>
			                <span className="font-semibold text-lg">{t('profile')}</span>
			              </div>
			            </div>

	            <div className="space-y-4">
	              {infoMsg && (
	                <div className="mb-3 text-sm text-orange-700 bg-orange-50 border border-orange-100 rounded-xl px-4 py-2">
	                  {infoMsg}
	                </div>
	              )}

		              <div className="space-y-3">
		                <div className="grid grid-cols-1 gap-2">
		                  <label className="text-xs text-gray-500 font-semibold">{t('name')}</label>
		                  {!isEditingProfile ? (
		                    <button
		                      type="button"
		                      onClick={() => startProfileEdit('name')}
		                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-left hover:bg-white/70 transition"
		                    >
		                      {profileForm.displayName || t('unknown', 'Unknown')}
		                    </button>
		                  ) : (
		                    <input
		                      ref={nameInputRef}
		                      type="text"
		                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
		                      value={profileForm.displayName}
		                      onChange={(e) => setProfileForm((prev) => ({ ...prev, displayName: e.target.value }))}
		                    />
		                  )}
		                </div>
		                <div className="grid grid-cols-1 gap-2">
		                  <label className="text-xs text-gray-500 font-semibold">{t('email')}</label>
		                  {!isEditingProfile ? (
		                    <button
		                      type="button"
		                      onClick={() => startProfileEdit('email')}
		                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-left hover:bg-white/70 transition"
		                    >
		                      {profileForm.email || '—'}
		                    </button>
		                  ) : (
		                    <>
		                      <input
		                        ref={emailInputRef}
		                        type="email"
		                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
		                        value={profileForm.email}
		                        onFocus={collapseFullSelectionOnFocus}
		                        onChange={(e) => {
		                          const next = e.target.value;
		                          setProfileForm((prev) => ({ ...prev, email: next }));
		                          if (emailVerification.status !== 'idle' || emailVerification.error) {
		                            setEmailVerification({ status: 'idle', error: '' });
		                          }
		                        }}
		                      />
		                      {emailVerification.error ? (
		                        <p className="text-xs text-red-500">{emailVerification.error}</p>
		                      ) : null}
		                    </>
		                  )}
		                </div>
		                <div className="grid grid-cols-1 gap-2">
		                  <label className="text-xs text-gray-500 font-semibold">{t('phone')}</label>
		                  {!isEditingProfile ? (
		                    <button
		                      type="button"
		                      onClick={() => startProfileEdit('phone')}
		                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-left hover:bg-white/70 transition"
		                    >
		                      {profileForm.phone || '—'}
		                    </button>
		                  ) : (
		                    <>
		                      <div className="flex items-center space-x-2">
		                        <select
		                          className="border border-gray-200 rounded-xl px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-200"
		                          value={phoneCountry}
		                          onChange={(e) => {
		                            const nextCountry = e.target.value;
		                            setPhoneCountry(nextCountry);
		                            setProfileForm((prev) => ({ ...prev, phone: formatPhoneInput(prev.phone, nextCountry) }));
			                            if (phoneVerification.status !== 'idle' || phoneVerification.code || phoneVerification.error) {
			                              setPhoneVerification({
			                                status: 'idle',
			                                verificationId: '',
			                                code: '',
			                                error: '',
			                                phoneE164: '',
			                              });
			                            }
		                          }}
		                        >
		                          {PHONE_COUNTRIES.map((c) => (
		                            <option key={c.code} value={c.code}>
		                              {c.flag} {c.callingCode}
		                            </option>
		                          ))}
		                        </select>
		                        <input
		                          ref={phoneInputRef}
		                          type="tel"
		                          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
		                          value={profileForm.phone}
		                          placeholder={phoneCountry === 'FR' ? '06 12 34 56 78' : ''}
		                          onFocus={collapseFullSelectionOnFocus}
		                          onChange={(e) => {
		                            const next = formatPhoneInput(e.target.value, phoneCountry);
		                            setProfileForm((prev) => ({ ...prev, phone: next }));
			                            if (phoneVerification.status !== 'idle' || phoneVerification.code || phoneVerification.error) {
			                              setPhoneVerification({
			                                status: 'idle',
			                                verificationId: '',
			                                code: '',
			                                error: '',
			                                phoneE164: '',
			                              });
			                            }
		                          }}
		                        />
		                      </div>
		                      {phoneVerification.status === 'code-sent' || phoneVerification.status === 'verifying' ? (
		                        <div className="flex items-center space-x-2">
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
		                        </div>
		                      ) : null}
		                      {phoneVerification.error && (
		                        <p className="text-xs text-red-500">{phoneVerification.error}</p>
		                      )}
		                    </>
		                  )}
		                </div>
		                {isEditingProfile ? (
		                  <div className="flex space-x-2">
		                    <button
		                      onClick={cancelProfileEdit}
		                      className="flex-1 bg-white border border-gray-200 text-gray-600 py-3 rounded-xl font-bold shadow-sm hover:bg-gray-50 transition"
		                    >
		                      {t('cancel', 'Cancel')}
		                    </button>
		                    {emailChanged ? (
		                      <button
		                        type="button"
		                        onClick={handleSendEmailVerification}
		                        className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500 text-white py-3 rounded-xl font-bold shadow-md hover:brightness-110 active:scale-[0.99] transition disabled:opacity-60"
		                        disabled={emailVerification.status === 'sending' || !String(profileForm.email || '').trim()}
		                      >
		                        {emailVerification.status === 'sending'
		                          ? t('pleaseWait', 'Please wait...')
		                          : t('sendVerificationEmail', 'Send verification email')}
		                      </button>
		                    ) : phoneDirty && phoneVerification.status !== 'verified' ? (
		                      <button
		                        type="button"
		                        onClick={handleSendPhoneCode}
		                        className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500 text-white py-3 rounded-xl font-bold shadow-md hover:brightness-110 active:scale-[0.99] transition disabled:opacity-60"
		                        disabled={phoneVerification.status === 'sending' || !toE164Phone(profileForm.phone, phoneCountry).e164}
		                      >
		                        {phoneVerification.status === 'sending'
		                          ? t('pleaseWait', 'Please wait...')
		                          : t('sendCode', 'Send code')}
		                      </button>
		                    ) : (
		                      <button
		                        onClick={async () => {
		                          const res = await onUpdateProfile?.({
		                            ...profileForm,
	                            phone: userPhoneE164,
	                            phoneVerified: user?.phoneVerified,
	                          });
	                          if (res?.error) {
	                            const msg = res.reauthRequired
	                              ? t('emailUpdateReauth', 'Please sign out/in again to verify and update your email.')
	                              : t('updateProfileError', 'Unable to update profile. Please try again.');
	                            setInfoMsg(msg);
	                          } else {
	                            setInfoMsg('');
	                          }
	                          setIsEditingProfile(false);
	                        }}
		                        className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500 text-white py-3 rounded-xl font-bold shadow-md hover:scale-[1.01] transition"
		                      >
		                        {t('saveProfile', 'Save profile')}
		                      </button>
		                    )}
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
          onClick={closeVehicleModal}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative ${
              closingModal ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            }`}
            onClick={(e) => e.stopPropagation()}
		          >
		            <div className="flex items-center space-x-2 mb-4">
		              <div className="bg-white p-2 rounded-lg border border-gray-100">
		                <Car size={20} style={iconStyle('vehicle')} />
		              </div>
		              <h3 className="text-xl font-bold text-gray-900">{t('manageVehiclesTitle', 'Manage my vehicles')}</h3>
		            </div>

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
				                placeholder={plateFocused ? 'AB-123-CD' : t('platePlaceholderFull', 'Plate')}
				                className={`flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 placeholder:text-gray-300 ${
				                  plateFocused || plateSlots.some(Boolean) ? 'text-center uppercase tracking-widest font-mono' : 'text-left normal-case tracking-normal font-sans'
				                }`}
				                inputMode={plateNextKind === 'digits' ? 'numeric' : 'text'}
				                pattern={plateNextKind === 'digits' ? '[0-9]*' : '[A-Za-z]*'}
				                autoCapitalize="characters"
				                value={plateFocused || plateSlots.some(Boolean) ? buildPlateDisplay(plateSlots) : ''}
				                onFocus={(e) => {
				                  setPlateFocused(true);
				                  const start = clampPlateCaret(e.target.selectionStart ?? 0);
				                  window.requestAnimationFrame(() => {
				                    try {
				                      e.target.setSelectionRange(start, start);
				                    } catch (_) {}
				                  });
				                }}
				                onBlur={() => setPlateFocused(false)}
				                onKeyDown={(e) => {
				                  const el = e.currentTarget;
				                  const selStart = typeof el.selectionStart === 'number' ? el.selectionStart : 0;
				                  const caret = clampPlateCaret(selStart);

		                  if (e.key === 'ArrowLeft') {
		                    e.preventDefault();
		                    const next = prevEditablePos(caret);
		                    el.setSelectionRange(next, next);
		                    return;
		                  }
		                  if (e.key === 'ArrowRight') {
		                    e.preventDefault();
		                    const next = nextEditablePos(caret);
		                    el.setSelectionRange(next, next);
		                    return;
		                  }
		                  if (e.key === 'Backspace') {
                    e.preventDefault();
                    const pos = prevEditablePos(caret);
                    const idx = slotIndexForPos(pos);
                    if (idx >= 0) {
                      setPlateSlots((prev) => {
                        const next = [...prev];
                        next[idx] = '';
                        return next;
                      });
                    }
                    // CORRECTION ICI : On attend que React efface le caractère avant de bouger le curseur
                    window.requestAnimationFrame(() => {
                      el.setSelectionRange(pos, pos);
                    });
                    return;
                  }

                  if (e.key === 'Delete') {
                    e.preventDefault();
                    const pos = clampPlateCaret(caret);
                    const idx = slotIndexForPos(pos);
                    if (idx >= 0) {
                      setPlateSlots((prev) => {
                        const next = [...prev];
                        next[idx] = '';
                        return next;
                      });
                    }
                    // CORRECTION ICI AUSSI
                    window.requestAnimationFrame(() => {
                      el.setSelectionRange(pos, pos);
                    });
                    return;
                  }

		                  if (e.key && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
		                    e.preventDefault();
		                    const pos = clampPlateCaret(caret);
		                    const idx = slotIndexForPos(pos);
		                    const coerced = coercePlateChar(pos, e.key);
		                    if (idx >= 0 && coerced) {
  setPlateSlots((prev) => {
    const next = [...prev];
    next[idx] = coerced;
    return next;
  });
  
  const nextPos = nextEditablePos(pos);
  
  // CORRECTION : On attend que React ait fini l'affichage pour placer le curseur
  window.requestAnimationFrame(() => {
    el.setSelectionRange(nextPos, nextPos);
  });
}
		                  }
				                }}
				                onPaste={(e) => {
				                  e.preventDefault();
				                  const text = (e.clipboardData?.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
				                  if (!text) return;
				                  const chars = text.split('');
				                  setPlateSlots((prev) => {
				                    const next = [...prev];
				                    let j = 0;
				                    for (let i = 0; i < PLATE_EDIT_POSITIONS.length && j < chars.length; i += 1) {
				                      const pos = PLATE_EDIT_POSITIONS[i];
				                      const coerced = coercePlateChar(pos, chars[j]);
				                      if (coerced) {
				                        next[i] = coerced;
				                        j += 1;
				                      } else {
				                        j += 1;
				                        i -= 1;
				                      }
				                    }
				                    return next;
				                  });
				                }}
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
	                type="button"
	                onClick={closeVehicleModal}
	                className="flex-1 bg-white border border-gray-200 text-gray-600 py-3 rounded-xl font-bold shadow-sm hover:bg-gray-50 transition"
	              >
	                {t('cancel', 'Cancel')}
	              </button>
	              <button
	                type="button"
	                onClick={handleSubmit}
	                className={`relative flex-1 bg-orange-600 text-white py-3 rounded-xl font-bold shadow-md hover:bg-orange-700 transition overflow-hidden ${
	                  highlightAddVehicleButton ? 'ring-2 ring-orange-300 shadow-[0_0_0_10px_rgba(249,115,22,0.16)] animate-pulse' : ''
	                }`}
	              >
	                {highlightAddVehicleButton ? (
	                  <>
	                    <span
	                      className="pointer-events-none absolute -inset-1 bg-gradient-to-r from-orange-400/25 to-amber-300/20 blur-lg"
                      aria-hidden="true"
                    />
                    <span
                      className="pointer-events-none absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-orange-600 text-xs font-extrabold flex items-center justify-center shadow"
                      aria-hidden="true"
                    >
                      !
                    </span>
	                  </>
	                ) : null}
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
		            <div className="flex items-center space-x-2 mb-4">
		              <div className="bg-white p-2 rounded-lg border border-gray-100">
		                <Trophy size={20} style={iconStyle('leaderboard')} />
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
    className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${
      closingHistory ? 'bg-black/0' : 'bg-black/30 backdrop-blur-sm'
    }`}
    onClick={() => closeWithAnim(setClosingHistory, setShowHistory)}
  >
    <div
      className={`
        bg-white/90 backdrop-blur-xl border border-white/20 
        rounded-3xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]
        ${closingHistory ? 'animate-[modalOut_0.2s_ease_forwards] scale-95 opacity-0' : 'animate-[modalIn_0.3s_ease-out] scale-100 opacity-100'}
      `}
      onClick={(e) => e.stopPropagation()}
    >
      {/* HEADER */}
      <div className="flex items-center justify-between p-6 pb-3">
        <div className="flex items-center space-x-3">
          <div className="bg-white p-2 rounded-lg border border-gray-100">
            <History size={20} style={iconStyle('history')} />
          </div>
          <span className="text-base font-medium text-gray-900">
            {t('historyTitle', { defaultValue: 'Historique' })}
          </span>
        </div>
        <button 
          onClick={() => closeWithAnim(setClosingHistory, setShowHistory)}
          className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors text-gray-500"
        >
          <X size={20} />
        </button>
      </div>

      {/* LISTE */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
        {transactions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 space-y-2">
            <Clock size={48} className="opacity-20" />
            <p className="text-sm font-medium">{t('noTransactions', 'Aucune transaction.')}</p>
          </div>
        )}

        {transactions.map((tx, index) => {
          const meLabel = t('me', 'Moi');
          const meName = String(user?.displayName || '').trim();
          const hostName = String(tx.hostName || '').trim();
          const bookerName = String(tx.bookerName || '').trim();
          
          const isMeHost = hostName && hostName.toLowerCase() === meName.toLowerCase();
          const isMeBooker = bookerName && bookerName.toLowerCase() === meName.toLowerCase();

          // Logique d'affichage "Intelligent"
          let displayTitle = t('unknown', 'Inconnu');
          let displaySubtitle = '';
          let isIncoming = false; // Pour la couleur/icône

          if (isMeHost) {
             displayTitle = bookerName || t('unknown', 'Inconnu');
             displaySubtitle = t('receivedFrom', 'Reçu de');
             isIncoming = true;
          } else if (isMeBooker) {
             displayTitle = hostName || t('unknown', 'Inconnu');
             displaySubtitle = t('sentTo', 'Envoyé à');
             isIncoming = false;
          } else {
             // Cas fallback (historique brut)
             displayTitle = `${bookerName} ➜ ${hostName}`;
          }

	          return (
	            <div
	              key={tx.id}
	              className="group flex items-center justify-between p-3 rounded-2xl transition-colors cursor-default hover:bg-orange-400/10 active:bg-orange-400/10 focus-within:bg-orange-400/10"
	            >
	              <div className="flex items-center space-x-4">
	                {/* ICONE AVATAR / STATUS */}
	                <div
	                  className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm ring-1 ring-inset ${
	                    isIncoming
	                      ? 'bg-orange-500/15 text-orange-600 ring-orange-500/20'
	                      : 'bg-gray-900/5 text-gray-900 ring-gray-900/10'
	                  }`}
	                >
	                  {isIncoming ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
	                </div>

                {/* INFO GAUCHE */}
                <div className="flex flex-col">
                  <span className="text-base font-semibold text-gray-900 leading-tight">
                    {displayTitle}
                  </span>
                  <span className="text-xs text-gray-400 font-medium">
                    {tx.createdAt?.toDate
                      ? tx.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' })
                      : tx.createdAt?.toString?.() || ''}
                  </span>
                </div>
              </div>

	              {/* INFO DROITE */}
	              <div className="flex flex-col items-end space-y-0.5">
	                 <span
	                   className={`text-base font-bold tracking-tight tabular-nums ${
	                     isIncoming ? 'text-orange-600' : 'text-gray-900'
	                   }`}
	                 >
	                    {isIncoming ? '+' : ''}{tx.amount != null ? `${tx.amount} €` : ''}
	                 </span>
                 
                 <div className="flex items-center space-x-2">
                    {/* Status Badge */}
                    {tx.status === 'completed' ? (
                       <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">
                         {tx.status}
                       </span>
                    ) : (
                       <span className="text-[10px] text-gray-400 capitalize">{tx.status}</span>
                    )}

                    {/* Bouton Share Discret */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const body = `ParkSwap: ${displayTitle} - ${tx.amount}€`;
                        if (navigator.share) {
                          navigator.share({ title: 'ParkSwap', text: body }).catch(() => {});
                        } else {
                          navigator.clipboard.writeText(body);
                          // Idéalement un petit toast ici
                        }
	                      }}
	                      className="text-gray-300 hover:text-orange-600 transition-colors p-1"
	                    >
	                      <Share size={14} />
	                    </button>
	                 </div>
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
	          className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${
	            closingPrivacy ? 'bg-black/0' : 'bg-black/30 backdrop-blur-sm'
	          }`}
	          onClick={() => closeWithAnim(setClosingPrivacy, setShowPrivacy)}
	        >
	          <div
	            className={`
	              ${isDark ? 'bg-slate-900/90 border-slate-700/30' : 'bg-white/95 border-white/20'}
	              backdrop-blur-xl border shadow-2xl rounded-3xl w-full max-w-lg 
	              flex flex-col max-h-[85vh] overflow-hidden
	              ${closingPrivacy ? 'animate-[modalOut_0.2s_ease_forwards] scale-95 opacity-0' : 'animate-[modalIn_0.3s_ease-out] scale-100 opacity-100'}
	            `}
	            onClick={(e) => e.stopPropagation()}
	          >
	            {/* HEADER FIXE : Titre + Croix de fermeture */}
	            <div
	              className={`flex items-center justify-between px-6 py-4 border-b backdrop-blur-md z-10 shrink-0 ${
	                isDark ? 'border-slate-800 bg-slate-900/40' : 'border-gray-100 bg-white/50'
	              }`}
	            >
	              <div className="flex items-center space-x-3">
	                <div className={`p-2 rounded-full ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-gray-100 text-gray-600'}`}>
	                  <ShieldCheck size={20} />
	                </div>
	                <h3 className={`text-lg font-bold ${isDark ? 'text-slate-50' : 'text-gray-900'}`}>
	                  {t('privacy', 'Privacy Policy')}
	                </h3>
	              </div>
	              <button
	                onClick={() => closeWithAnim(setClosingPrivacy, setShowPrivacy)}
	                className={`p-2 rounded-full transition-colors ${
	                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-500'
	                }`}
	              >
	                <X size={20} />
	              </button>
	            </div>
	
	            {/* CONTENU SCROLLABLE */}
	            <div className="overflow-y-auto p-6 no-scrollbar grow">
	              <p className={`text-sm leading-relaxed whitespace-pre-wrap font-normal ${isDark ? 'text-slate-200' : 'text-gray-600'}`}>
	                {privacyPolicyText}
	              </p>
	              
	              {/* Gros bouton de fermeture en bas (remplace la flèche) */}
	              <div className={`mt-8 pt-6 border-t flex justify-center ${isDark ? 'border-slate-800' : 'border-gray-100'}`}>
	                <button
	                  type="button"
	                  onClick={() => closeWithAnim(setClosingPrivacy, setShowPrivacy)}
	                  className={`w-full text-white font-semibold py-3.5 px-6 rounded-2xl active:scale-95 transition-all shadow-lg ${
	                    isDark ? 'bg-orange-600 hover:bg-orange-700' : 'bg-gray-900 hover:bg-gray-800'
	                  }`}
	                >
	                  {t('close', 'Fermer')}
	                </button>
	              </div>
	            </div>
	          </div>
	        </div>
	      )}

	      {showTerms && (
	        <div
	          className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${
	            closingTerms ? 'bg-black/0' : 'bg-black/30 backdrop-blur-sm'
	          }`}
	          onClick={() => closeWithAnim(setClosingTerms, setShowTerms)}
	        >
	          <div
	            className={`
	              ${isDark ? 'bg-slate-900/90 border-slate-700/30' : 'bg-white/95 border-white/20'}
	              backdrop-blur-xl border shadow-2xl rounded-3xl w-full max-w-lg 
	              flex flex-col max-h-[85vh] overflow-hidden
	              ${closingTerms ? 'animate-[modalOut_0.2s_ease_forwards] scale-95 opacity-0' : 'animate-[modalIn_0.3s_ease-out] scale-100 opacity-100'}
	            `}
	            onClick={(e) => e.stopPropagation()}
	          >
	            {/* HEADER FIXE */}
	            <div
	              className={`flex items-center justify-between px-6 py-4 border-b backdrop-blur-md z-10 shrink-0 ${
	                isDark ? 'border-slate-800 bg-slate-900/40' : 'border-gray-100 bg-white/50'
	              }`}
	            >
	              <div className="flex items-center space-x-3">
	                <div className={`p-2 rounded-full ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-gray-100 text-gray-600'}`}>
	                  <FileText size={20} style={iconStyle('legal')} />
	                </div>
	                <h3 className={`text-lg font-bold ${isDark ? 'text-slate-50' : 'text-gray-900'}`}>
	                  {t('terms', 'Terms & Conditions')}
	                </h3>
	              </div>
	              <button
	                onClick={() => closeWithAnim(setClosingTerms, setShowTerms)}
	                className={`p-2 rounded-full transition-colors ${
	                  isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-500'
	                }`}
	              >
	                <X size={20} />
	              </button>
	            </div>
	
	            {/* CONTENU SCROLLABLE */}
	            <div className="overflow-y-auto p-6 no-scrollbar grow">
	              <p className={`text-sm leading-relaxed whitespace-pre-wrap font-normal ${isDark ? 'text-slate-200' : 'text-gray-600'}`}>
	                {termsAndConditionsText}
	              </p>
	              
	              {/* Gros bouton de fermeture en bas */}
	              <div className={`mt-8 pt-6 border-t flex justify-center ${isDark ? 'border-slate-800' : 'border-gray-100'}`}>
	                <button
	                  type="button"
	                  onClick={() => closeWithAnim(setClosingTerms, setShowTerms)}
	                  className={`w-full text-white font-semibold py-3.5 px-6 rounded-2xl active:scale-95 transition-all shadow-lg ${
	                    isDark ? 'bg-orange-600 hover:bg-orange-700' : 'bg-gray-900 hover:bg-gray-800'
	                  }`}
	                >
	                  {t('close', 'Fermer')}
	                </button>
	              </div>
	            </div>
	          </div>
	        </div>
	      )}
    </div>
  );
};

export default ProfileView;
