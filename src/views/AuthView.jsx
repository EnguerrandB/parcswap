// src/views/AuthView.jsx
import React, { useEffect, useState, useRef } from 'react';
import {
  applyActionCode,
  checkActionCode,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  reload,
  sendEmailVerification,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { appId, auth, authPersistenceReady, db, functions } from '../firebase';
import { useTranslation } from 'react-i18next';
import { PHONE_COUNTRIES, formatPhoneInput, toE164Phone } from '../utils/phone';
import { getPublicWebBaseUrl, isNativeApp } from '../utils/mobile';
import {
  createUserWithNativeEmailAndPassword,
  shouldUseNativeFirebaseAuth,
  signInWithNativeEmailAndPassword,
  signOutFromAllLayers,
} from '../utils/nativeFirebaseAuth';

// --- CSS IN-JS pour l'animation de fond subtile (Mesh Gradient) ---
const styles = `
  @keyframes gradient-move {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  .animate-mesh {
    background-size: 200% 200%;
    animation: gradient-move 15s ease infinite;
  }

  @keyframes auth-photo-drift {
    0% { transform: scale(1.08) translate3d(0%, 0%, 0); }
    50% { transform: scale(1.16) translate3d(-2.8%, -1.6%, 0); }
    100% { transform: scale(1.08) translate3d(0%, 0%, 0); }
  }
  .auth-photo-bg {
    will-change: transform;
    background-repeat: no-repeat;
    background-size: cover;
    background-position: 50% 50%;
    animation: auth-photo-drift 26s ease-in-out infinite;
  }
  /* Cacher la scrollbar si besoin */
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
`;

const AUTH_ACTION_TIMEOUT_MS = 18_000;
const IOS_DEBUG_BUILD = 'IOS_DEBUG_2026_03_25_10';
const IOS_PATCH_LABEL = 'PATCH 10';

const logAuthDebug = (step, payload = {}) => {
  if (typeof console === 'undefined') return;
  console.info(`[${IOS_DEBUG_BUILD}] AuthView:${step}`, payload);
};

const withTimeout = async (promise, timeoutMs, code = 'auth/timeout') => {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          const error = new Error('Authentication request timed out.');
          error.code = code;
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

const AuthView = ({ noticeMessage = '' }) => {
  const { t } = useTranslation('common');
  const isDark =
    (typeof document !== 'undefined' && document.body?.dataset?.theme === 'dark') ||
    (typeof window !== 'undefined' && window.localStorage?.getItem('theme') === 'dark');
  const authBgUrl = import.meta.env.VITE_AUTH_BG_URL || '/auth-bg.png';
  const passwordInputBaseClass = 'w-full h-12 px-4 pr-20 bg-gray-50 hover:bg-gray-100 focus:bg-white border-2 border-transparent focus:border-orange-100 focus:ring-4 focus:ring-orange-50/50 rounded-2xl text-sm font-medium outline-none transition-all placeholder:text-gray-400';

  // --- État du formulaire ---
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '', name: '' });
  const [phoneForm, setPhoneForm] = useState({ phone: '', code: '' });
  const [phoneCountry, setPhoneCountry] = useState('FR');

  // --- État de l'interface ---
  const [mode, setMode] = useState('login');
  const [method, setMethod] = useState('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(noticeMessage || '');
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('');
  const [resendingVerification, setResendingVerification] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // --- État spécifique Téléphone ---
  const [confirmationResult, setConfirmationResult] = useState(null);
  const recaptchaVerifierRef = useRef(null);

  const googleProvider = new GoogleAuthProvider();

  // --- Logique Persistence & Redirect ---
  const pendingKey = 'lolopark_oauth_pending';
  const legacyPendingKey = 'parkswap_oauth_pending';
  const lastAuthNameKey = 'lolopark_last_auth_name';
  const legacyLastAuthNameKey = 'parkswap_last_auth_name';
  const setPendingAuth = (providerId) => {
    try {
      window.sessionStorage?.setItem(
        pendingKey,
        JSON.stringify({ providerId: String(providerId || ''), at: Date.now() }),
      );
      window.sessionStorage?.removeItem(legacyPendingKey);
    } catch (_) {}
  };
  const setLastAuthName = (name) => {
    try {
      const n = String(name || '').trim();
      if (!n) return;
      window.sessionStorage?.setItem(lastAuthNameKey, n);
      window.sessionStorage?.removeItem(legacyLastAuthNameKey);
    } catch (_) {}
  };
  const consumePendingAuth = () => {
    try {
      const raw = window.sessionStorage?.getItem(pendingKey)
        || window.sessionStorage?.getItem(legacyPendingKey);
      if (!raw) return null;
      window.sessionStorage?.removeItem(pendingKey);
      window.sessionStorage?.removeItem(legacyPendingKey);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  };
  const readPendingAuth = () => {
    try {
      const raw = window.sessionStorage?.getItem(pendingKey)
        || window.sessionStorage?.getItem(legacyPendingKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_) {
      return null;
    }
  };

  useEffect(() => {
    logAuthDebug('mount', { native: isNativeApp(), noticeMessage: noticeMessage || '' });
    return () => clearRecaptcha();
  }, []);

  useEffect(() => {
    setInfo(noticeMessage || '');
  }, [noticeMessage]);

  useEffect(() => {
    const handleRedirect = async () => {
      try {
        const pending = readPendingAuth();
        logAuthDebug('handleRedirect:start', { pending });
        if (!pending) return;
        await authPersistenceReady;
        const result = await getRedirectResult(auth);
        logAuthDebug('handleRedirect:result', { hasUser: Boolean(result?.user), providerId: pending?.providerId || '' });
        if (result?.user) {
          consumePendingAuth();
          onAuthSuccess(result.user);
          return;
        }
        consumePendingAuth();
        const pendingProvider = pending?.providerId;
        const pendingAt = Number(pending?.at);
        const stillRecent = Number.isFinite(pendingAt) && Date.now() - pendingAt < 2 * 60_000;
        if (pendingProvider === 'apple.com' && stillRecent) {
          setError(t('appleAuthNotCompleted', "Apple sign-in incomplete."));
        }
      } catch (err) {
        console.error(err);
        logAuthDebug('handleRedirect:error', { code: err?.code || '', message: err?.message || '' });
        setError(t('providerSignInFailed', 'Authentication failed.'));
      }
    };
    handleRedirect();
  }, []); // eslint-disable-line

  useEffect(() => {
    const maybeApplyCodeFromUrl = async () => {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      const modeParam = String(url.searchParams.get('mode') || '').trim();
      const oobCodeParam = String(url.searchParams.get('oobCode') || '').trim();
      if (modeParam !== 'verifyEmail' || !oobCodeParam) return;

      setPendingVerificationEmail(String(url.searchParams.get('email') || form.email || '').trim());
      await handleVerifyEmailCode(oobCodeParam, { fromUrl: true });
    };

    void maybeApplyCodeFromUrl();
  }, []); // eslint-disable-line

  // --- Helpers ---
  const onAuthSuccess = (user) => {
    setError('');
    setInfo('');
    setPendingVerificationEmail('');
    void user;
  };

  const isEmailPasswordUser = (user) => {
    if (!Array.isArray(user?.providerData)) return false;
    return user.providerData.some((provider) => provider?.providerId === 'password');
  };

  const buildEmailActionSettings = () => {
    return {
      url: getPublicWebBaseUrl(),
      handleCodeInApp: false,
    };
  };

  const normalizeEmailActionCodeInput = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        return String(url.searchParams.get('oobCode') || '').trim();
      } catch (_) {
        return '';
      }
    }

    const directMatch = raw.match(/[?&]oobCode=([^&]+)/i);
    if (directMatch?.[1]) {
      try {
        return decodeURIComponent(directMatch[1]).trim();
      } catch (_) {
        return String(directMatch[1]).trim();
      }
    }

    return raw;
  };

  const clearVerificationParamsFromUrl = () => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      url.searchParams.delete('oobCode');
      url.searchParams.delete('apiKey');
      url.searchParams.delete('lang');
      url.searchParams.delete('continueUrl');
      url.searchParams.delete('tenantId');
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  };

  const handleVerifyEmailCode = async (rawCode, options = {}) => {
    const normalizedCode = normalizeEmailActionCodeInput(rawCode);
    if (!normalizedCode) return false;

    setError('');
    if (!options.fromUrl) setInfo('');
    try {
      await checkActionCode(auth, normalizedCode);
      await applyActionCode(auth, normalizedCode);
      clearVerificationParamsFromUrl();
      setInfo(
        t(
          'emailVerificationCodeSuccess',
          'Email verifie. Vous pouvez maintenant vous connecter avec votre mot de passe.',
        ),
      );
      return true;
    } catch (err) {
      let msg = err?.message || t('invalidCode', 'Code invalide.');
      if (
        err?.code === 'auth/invalid-action-code'
        || err?.code === 'auth/expired-action-code'
        || err?.code === 'auth/user-disabled'
      ) {
        msg = t(
          'emailVerificationCodeInvalid',
          'Ce code email est invalide ou expire. Demandez un nouvel email de verification.',
        );
      }
      setError(msg);
      return false;
    }
  };

  const renderPasswordField = ({ value, onChange, placeholder, visible, onToggle }) => (
    <div className="group relative">
      <input
        type={visible ? 'text' : 'password'}
        className={passwordInputBaseClass}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required
      />
      <button
        type="button"
        onClick={onToggle}
        className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold transition-colors ${
          isDark ? 'text-slate-300 hover:text-slate-50' : 'text-gray-500 hover:text-gray-900'
        }`}
      >
        {visible ? t('hidePassword', 'Masquer') : t('showPassword', 'Afficher')}
      </button>
    </div>
  );

  const clearRecaptcha = () => {
    if (recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current.clear();
      recaptchaVerifierRef.current = null;
    }
  };

  useEffect(() => {
    if (mode !== 'register') return;
    if (method !== 'email') setMethod('email');
    setConfirmationResult(null);
    setPhoneForm((prev) => ({ ...prev, phone: '', code: '' }));
    setPhoneCountry('FR');
    clearRecaptcha();
  }, [mode]);

  const setupRecaptcha = () => {
    clearRecaptcha();
    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
      callback: () => {},
    });
    recaptchaVerifierRef.current = verifier;
    return verifier;
  };

  // --- Submit Handlers ---
  const handleGlobalSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (method === 'email') await handleEmailAuth();
    else await handlePhoneAuth();
  };

  const handleEmailAuth = async () => {
    logAuthDebug('handleEmailAuth:start', {
      mode,
      method,
      email: String(form.email || '').trim(),
      passwordLength: String(form.password || '').length,
    });
    if (!form.email || !form.password) {
      setError(t('authFillEmailPassword', 'Remplissez email et mot de passe'));
      return;
    }
    setLoading(true);
    try {
      if (mode === 'register') {
        if (!form.name.trim()) {
          setError(t('nameRequired', 'Votre nom est requis.'));
          setLoading(false);
          return;
        }
        if (!form.confirmPassword) {
          setError(t('confirmPasswordRequired', 'Confirmez votre mot de passe.'));
          setLoading(false);
          return;
        }
        if (form.password !== form.confirmPassword) {
          setError(t('passwordsDoNotMatch', 'Les mots de passe ne correspondent pas.'));
          setLoading(false);
          return;
        }
        const createdUser = shouldUseNativeFirebaseAuth()
          ? await withTimeout(
              createUserWithNativeEmailAndPassword({
                auth,
                functions,
                email: form.email,
                password: form.password,
              }),
              AUTH_ACTION_TIMEOUT_MS,
              'auth/signin-timeout',
            )
          : (
              await withTimeout(
                createUserWithEmailAndPassword(auth, form.email, form.password),
                AUTH_ACTION_TIMEOUT_MS,
              )
            ).user;
        const displayName = String(form.name || '').trim();
        await updateProfile(createdUser, { displayName });
        setLastAuthName(displayName);
        try {
          const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', createdUser.uid);
          await setDoc(
            userRef,
            {
              displayName,
              username: displayName,
              email: createdUser.email || form.email || '',
              createdAt: serverTimestamp(),
            },
            { merge: true },
          );
        } catch (e) {
          console.error('Error saving profile name:', e);
        }
        await sendEmailVerification(createdUser, buildEmailActionSettings());
        await signOutFromAllLayers({ auth, reason: 'post-register-email-verification' });
        setPendingVerificationEmail(createdUser.email || form.email || '');
        setForm((prev) => ({ ...prev, password: '', confirmPassword: '' }));
        setMode('login');
        setInfo(t('verificationEmailSent', 'Vérifiez votre email pour valider le compte.'));
      } else {
        logAuthDebug('handleEmailAuth:beforeSignIn', { email: String(form.email || '').trim() });
        const signedInUser = shouldUseNativeFirebaseAuth()
          ? await withTimeout(
              signInWithNativeEmailAndPassword({
                auth,
                functions,
                email: form.email,
                password: form.password,
              }),
              AUTH_ACTION_TIMEOUT_MS,
              'auth/signin-timeout',
            )
          : (() => {
              return withTimeout(
                signInWithEmailAndPassword(auth, form.email, form.password),
                AUTH_ACTION_TIMEOUT_MS,
                'auth/signin-timeout',
              ).then((cred) => auth.currentUser || cred.user);
            })();
        logAuthDebug('handleEmailAuth:afterSignIn', {
          uid: signedInUser?.uid || '',
          emailVerified: Boolean(signedInUser?.emailVerified),
          hasCurrentUser: Boolean(auth.currentUser),
        });
        if (isEmailPasswordUser(signedInUser) && !signedInUser.emailVerified) {
          try {
            logAuthDebug('handleEmailAuth:beforeReloadUnverified', { uid: signedInUser?.uid || '' });
            await withTimeout(reload(signedInUser), 2_500, 'auth/reload-timeout');
            logAuthDebug('handleEmailAuth:afterReloadUnverified', {
              uid: signedInUser?.uid || '',
              emailVerified: Boolean((auth.currentUser || signedInUser)?.emailVerified),
            });
          } catch (_) {}
          const refreshedUser = auth.currentUser || signedInUser;
          if (refreshedUser?.emailVerified) {
            logAuthDebug('handleEmailAuth:verifiedAfterReload', { uid: refreshedUser?.uid || '' });
            onAuthSuccess(refreshedUser);
            return;
          }
          logAuthDebug('handleEmailAuth:signOutUnverified', { uid: signedInUser?.uid || '' });
          setPendingVerificationEmail(signedInUser.email || form.email || '');
          await signOutFromAllLayers({ auth, reason: 'unverified-email-login' });
          setInfo(
            t(
              'verifyEmailWarning',
              'Email non vérifié. Vérifiez votre boîte mail avant de vous connecter.',
            ),
          );
          return;
        }
        logAuthDebug('handleEmailAuth:success', {
          uid: signedInUser?.uid || '',
          emailVerified: Boolean(signedInUser?.emailVerified),
        });
        onAuthSuccess(signedInUser);
      }
    } catch (err) {
      logAuthDebug('handleEmailAuth:error', { code: err?.code || '', message: err?.message || '' });
      let msg = err.message;
      if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(err.code)) {
        msg = t('invalidCreds', 'Identifiants incorrects.');
      } else if (err.code === 'auth/email-already-in-use') {
        msg = t('emailInUse', 'Email déjà utilisé.');
      } else if (err.code === 'auth/signin-timeout') {
        msg = t('authSignInTimeout', 'La connexion bloque pendant la verification des identifiants.');
      } else if (err.code === 'auth/reload-timeout') {
        msg = t('authReloadTimeout', 'La connexion bloque pendant la verification du compte.');
      } else if (['auth/timeout', 'auth/persistence-timeout'].includes(err.code)) {
        msg = t('authTimeout', 'La connexion prend trop de temps. Réessayez.');
      }
      setError(msg);
    } finally {
      logAuthDebug('handleEmailAuth:finally', {
        authCurrentUserUid: auth.currentUser?.uid || null,
        authCurrentUserVerified: auth.currentUser?.emailVerified ?? null,
      });
      setLoading(false);
    }
  };

  const handleResendVerificationEmail = async () => {
    const email = String(form.email || pendingVerificationEmail || '').trim();
    const password = String(form.password || '');

    if (!email || !password) {
      setError(
        t(
          'verificationResendNeedsPassword',
          'Entrez votre email et votre mot de passe pour renvoyer le mail de vérification.',
        ),
      );
      return;
    }

    setError('');
    setInfo('');
    setResendingVerification(true);
    try {
      const signedInUser = shouldUseNativeFirebaseAuth()
        ? await withTimeout(
            signInWithNativeEmailAndPassword({
              auth,
              functions,
              email,
              password,
            }),
            AUTH_ACTION_TIMEOUT_MS,
            'auth/signin-timeout',
          )
        : (
            await withTimeout(
              signInWithEmailAndPassword(auth, email, password),
              AUTH_ACTION_TIMEOUT_MS,
              'auth/signin-timeout',
            )
          ).user;

      try {
        await withTimeout(reload(signedInUser), 2_500, 'auth/reload-timeout');
      } catch (_) {}

      if (!isEmailPasswordUser(signedInUser)) {
        await signOutFromAllLayers({ auth, reason: 'resend-verification-invalid-provider' });
        setError(t('providerSignInFailed', 'Erreur de connexion.'));
        return;
      }

      if (signedInUser.emailVerified) {
        await signOutFromAllLayers({ auth, reason: 'resend-verification-already-verified' });
        setInfo(t('emailAlreadyVerified', 'Cet email est déjà vérifié. Vous pouvez vous connecter.'));
        return;
      }

      await sendEmailVerification(signedInUser, buildEmailActionSettings());
      await signOutFromAllLayers({ auth, reason: 'resend-verification-sent' });
      setPendingVerificationEmail(signedInUser.email || email);
      setInfo(
        t(
          'verificationEmailResent',
          'Un nouveau mail de vérification a été envoyé. Vérifiez aussi vos spams.',
        ),
      );
    } catch (err) {
      let msg = err?.message || t('providerSignInFailed', 'Erreur de connexion.');
      if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(err?.code)) {
        msg = t('invalidCreds', 'Identifiants incorrects.');
      } else if (err?.code === 'auth/too-many-requests') {
        msg = t('tooManyRequests', 'Trop de tentatives. Réessayez plus tard.');
      } else if (err?.code === 'auth/signin-timeout') {
        msg = t('authSignInTimeout', 'La connexion bloque pendant la verification des identifiants.');
      } else if (err?.code === 'auth/reload-timeout') {
        msg = t('authReloadTimeout', 'La connexion bloque pendant la verification du compte.');
      } else if (['auth/timeout', 'auth/persistence-timeout'].includes(err?.code)) {
        msg = t('authTimeout', 'La connexion prend trop de temps. Réessayez.');
      }
      setError(msg);
    } finally {
      setResendingVerification(false);
    }
  };

  const handlePhoneAuth = async () => {
    if (confirmationResult) {
      const code = String(phoneForm.code || '').replace(/\D/g, '').slice(0, 6);
      if (code.length < 6) {
        setError(t('enterCode', 'Code incomplet.'));
        return;
      }
      setLoading(true);
      try {
        const result = await confirmationResult.confirm(code);
        onAuthSuccess(result.user);
      } catch (err) {
        setError(t('invalidCode', 'Code invalide.'));
      } finally {
        setLoading(false);
      }
      return;
    }

    const parsedPhone = toE164Phone(phoneForm.phone, phoneCountry);
    if (!parsedPhone.e164) {
      setError(t('phoneFormatError', 'Numéro incorrect.'));
      return;
    }

    setLoading(true);
    try {
      const verifier = setupRecaptcha();
      const confirmation = await signInWithPhoneNumber(auth, parsedPhone.e164, verifier);
      setConfirmationResult(confirmation);
      setInfo(t('phoneCodeSent', 'Code SMS envoyé.'));
    } catch (err) {
      setError(t('errorSendingSMS', "Erreur d'envoi."));
      clearRecaptcha();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (method !== 'phone') return;
    if (!confirmationResult) return;
    if (loading) return;
    const code = String(phoneForm.code || '').replace(/\D/g, '').slice(0, 6);
    if (code.length === 6) handlePhoneAuth();
    // eslint-disable-next-line
  }, [method, confirmationResult, phoneForm.code]);

  const handlePopupSignIn = async (provider) => {
    setError('');
    setLoading(true);
    try {
      await authPersistenceReady;
      const providerId = provider?.providerId || '';
      setPendingAuth(providerId);
      if (isNativeApp()) {
        await signInWithRedirect(auth, provider);
        return;
      }
      const result = await signInWithPopup(auth, provider);
      consumePendingAuth();
      onAuthSuccess(result.user);
    } catch (err) {
      if (
        err.code === 'auth/popup-blocked'
        || err.code === 'auth/popup-closed-by-user'
        || err.code === 'auth/cancelled-popup-request'
        || err.code === 'auth/operation-not-supported-in-this-environment'
      ) {
        try {
          await signInWithRedirect(auth, provider);
        } catch (redirErr) {
          setError(redirErr.message);
        }
      } else {
        setError(t('providerSignInFailed', 'Erreur de connexion.'));
      }
    } finally {
      setLoading(false);
    }
  };

  const switchMethod = (newMethod) => {
    if (mode === 'register' && newMethod === 'phone') return;
    setMethod(newMethod);
    setError('');
    setInfo('');
    setConfirmationResult(null);
    clearRecaptcha();
  };

  // --- RENDER ---
  return (
    <>
      <style>{styles}</style>
      <div
        className={`relative overflow-hidden min-h-screen w-full flex items-center justify-center p-4 sm:p-6 animate-mesh font-sans ${
          isDark
            ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-black text-slate-50 selection:bg-orange-500/20 selection:text-orange-100'
            : 'bg-gradient-to-br from-gray-50 via-[#fdfbf7] to-orange-50 text-gray-900 selection:bg-orange-100 selection:text-orange-900'
        }`}
      >
        {/* Background photo (non interactive) */}
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0 auth-photo-bg"
            style={{
              backgroundImage: isDark
                ? `radial-gradient(65% 55% at 50% 40%, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.44) 78%, rgba(0,0,0,0.62) 100%), url("${authBgUrl}")`
                : `radial-gradient(65% 55% at 50% 40%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.46) 80%, rgba(255,255,255,0.62) 100%), url("${authBgUrl}")`,
              filter: isDark
                ? 'grayscale(1) contrast(1.08) brightness(0.72)'
                : 'grayscale(1) contrast(1.06) brightness(1.02)',
              opacity: isDark ? 0.62 : 0.5,
            }}
            aria-hidden="true"
          />
          <div
            className="absolute inset-0"
            style={{
              background: isDark
                ? 'linear-gradient(180deg, rgba(2,6,23,0.10) 0%, rgba(2,6,23,0.30) 55%, rgba(0,0,0,0.46) 100%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.26) 55%, rgba(255,255,255,0.42) 100%)',
              WebkitBackdropFilter: 'blur(2px)',
              backdropFilter: 'blur(2px)',
            }}
            aria-hidden="true"
          />
        </div>
        
        {/* Main Card Container */}
        <div
          className={`w-full max-w-[400px] rounded-[32px] border p-8 sm:p-10 relative z-10 overflow-hidden transition-all duration-500 ${
            isDark
              ? 'bg-slate-900/55 border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.55)]'
              : 'bg-white border-white/50 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] backdrop-blur-sm'
          }`}
          style={{
            WebkitBackdropFilter: isDark ? 'blur(20px) saturate(180%)' : undefined,
            backdropFilter: isDark ? 'blur(20px) saturate(180%)' : undefined,
          }}
        >
          
          {/* Header Minimaliste */}
          <div className="flex flex-col items-center mb-8 space-y-2">
            <div
              className={`w-12 h-12 bg-gradient-to-tr from-orange-400 to-amber-300 rounded-xl flex items-center justify-center mb-2 ${
                isDark ? 'shadow-[0_18px_46px_rgba(249,115,22,0.22)]' : 'shadow-lg shadow-orange-200'
              }`}
            >
               {/* Icone simple (Logo placeholder) */}
               <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
               </svg>
            </div>
            <h1 className={`text-2xl font-bold tracking-tight ${isDark ? 'text-slate-50' : 'text-gray-900'}`}>LoloPark</h1>
            <p className={`text-sm font-medium ${isDark ? 'text-slate-300/80' : 'text-gray-500'}`}>
              {method === 'email' 
                ? (mode === 'login' ? 'Content de vous revoir' : 'Créer votre espace')
                : 'Connexion rapide'}
            </p>
            <div className={`mt-1 rounded-full px-3 py-1 text-[10px] font-black tracking-[0.2em] ${isDark ? 'bg-white/10 text-orange-200 border border-white/10' : 'bg-orange-50 text-orange-700 border border-orange-100'}`}>
              {IOS_PATCH_LABEL}
            </div>
          </div>

          {/* Alertes (Discrètes) */}
          {(error || info) && (
            <div className={`mb-6 text-xs font-medium px-4 py-3 rounded-2xl text-center leading-relaxed ${
              error
                ? isDark
                  ? 'bg-red-500/10 text-red-200 border border-red-500/20'
                  : 'bg-red-50 text-red-600'
                : isDark
                  ? 'bg-sky-500/10 text-sky-200 border border-sky-500/20'
                  : 'bg-blue-50 text-blue-600'
            }`}>
              {error || info}
            </div>
          )}

          {/* Switcher Login/Phone (Style iOS Segmented) */}
          {mode === 'login' && (
            <div
              className={`p-1 rounded-2xl flex mb-6 relative ${
                isDark ? 'bg-white/10 border border-white/10' : 'bg-gray-100/80'
              }`}
            >
              <button
                type="button"
                onClick={() => switchMethod('email')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all duration-300 z-10 ${
                  method === 'email'
                    ? isDark
                      ? 'text-slate-50 bg-white/10'
                      : 'text-gray-900 shadow-sm bg-white'
                    : isDark
                      ? 'text-slate-300 hover:text-slate-100'
                      : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Email
              </button>
              <button
                type="button"
                onClick={() => switchMethod('phone')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all duration-300 z-10 ${
                  method === 'phone'
                    ? isDark
                      ? 'text-slate-50 bg-white/10'
                      : 'text-gray-900 shadow-sm bg-white'
                    : isDark
                      ? 'text-slate-300 hover:text-slate-100'
                      : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                SMS
              </button>
            </div>
          )}

          {method === 'email' && mode === 'login' && (pendingVerificationEmail || form.email) && (
            <div
              className={`mb-6 rounded-2xl border px-4 py-3 text-xs ${
                isDark
                  ? 'border-white/10 bg-white/5 text-slate-200'
                  : 'border-gray-200 bg-gray-50 text-gray-700'
              }`}
            >
              <div>
                {t(
                  'verificationResendHint',
                  'Pas de mail reçu ? Renvoyez le lien après avoir saisi votre mot de passe.',
                )}
              </div>
              <button
                type="button"
                onClick={handleResendVerificationEmail}
                disabled={loading || resendingVerification}
                className={`mt-3 h-10 w-full rounded-2xl text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                  isDark
                    ? 'bg-white/10 text-slate-50 hover:bg-white/15 border border-white/10'
                    : 'bg-white text-gray-900 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                {resendingVerification
                  ? t('sending', 'Envoi...')
                  : t('resendVerificationEmail', 'Renvoyer le mail de vérification')}
              </button>
            </div>
          )}

          <form onSubmit={handleGlobalSubmit} className="space-y-4">
            
            {/* EMAIL FIELDS */}
            {method === 'email' && (
              <div className="space-y-3">
                {mode === 'register' && (
                  <div className="group">
                    <input
                      type="text"
                      className="w-full h-12 px-4 bg-gray-50 hover:bg-gray-100 focus:bg-white border-2 border-transparent focus:border-orange-100 focus:ring-4 focus:ring-orange-50/50 rounded-2xl text-sm font-medium outline-none transition-all placeholder:text-gray-400"
                      placeholder={t('name', 'Nom complet')}
                      value={form.name}
                      onChange={(e) => setForm({...form, name: e.target.value})}
                      required
                    />
                  </div>
                )}
                <div className="group">
                  <input
                    type="email"
                    className="w-full h-12 px-4 bg-gray-50 hover:bg-gray-100 focus:bg-white border-2 border-transparent focus:border-orange-100 focus:ring-4 focus:ring-orange-50/50 rounded-2xl text-sm font-medium outline-none transition-all placeholder:text-gray-400"
                    placeholder="nom@exemple.com"
                    value={form.email}
                    onChange={(e) => setForm({...form, email: e.target.value})}
                    required
                  />
                </div>
                {renderPasswordField({
                  value: form.password,
                  onChange: (e) => setForm({ ...form, password: e.target.value }),
                  placeholder: t('password', 'Mot de passe'),
                  visible: showPassword,
                  onToggle: () => setShowPassword((prev) => !prev),
                })}
                {mode === 'register'
                  ? renderPasswordField({
                      value: form.confirmPassword,
                      onChange: (e) => setForm({ ...form, confirmPassword: e.target.value }),
                      placeholder: t('confirmPassword', 'Confirmer le mot de passe'),
                      visible: showConfirmPassword,
                      onToggle: () => setShowConfirmPassword((prev) => !prev),
                    })
                  : null}
              </div>
            )}

            {/* PHONE FIELDS */}
	            {method === 'phone' && (
	              <div className="space-y-4 pt-2">
	                {!confirmationResult ? (
	                  <div className="flex gap-2">
	                    <select
	                      className="h-12 px-3 bg-gray-50 hover:bg-gray-100 focus:bg-white border-2 border-transparent focus:border-orange-100 focus:ring-4 focus:ring-orange-50/50 rounded-2xl text-sm font-medium outline-none transition-all"
	                      value={phoneCountry}
	                      onChange={(e) => {
	                        const next = e.target.value;
	                        setPhoneCountry(next);
	                        setPhoneForm((prev) => ({ ...prev, phone: formatPhoneInput(prev.phone, next) }));
	                      }}
	                    >
	                      {PHONE_COUNTRIES.map((c) => (
	                        <option key={c.code} value={c.code}>
	                          {c.flag} {c.callingCode}
	                        </option>
	                      ))}
	                    </select>
	                    <input
	                      type="tel"
	                      className="flex-1 h-12 px-4 bg-gray-50 hover:bg-gray-100 focus:bg-white border-2 border-transparent focus:border-orange-100 focus:ring-4 focus:ring-orange-50/50 rounded-2xl text-sm font-medium outline-none transition-all placeholder:text-gray-400 text-center tracking-widest"
	                      placeholder={phoneCountry === 'FR' ? '06 12 34 56 78' : ''}
	                      value={phoneForm.phone}
	                      onChange={(e) => setPhoneForm({ ...phoneForm, phone: formatPhoneInput(e.target.value, phoneCountry) })}
	                      required
	                    />
	                  </div>
	                ) : (
	                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
	                     <div className="flex justify-between items-center px-1">
	                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Code de validation</span>
	                      <button type="button" onClick={() => setConfirmationResult(null)} className="text-xs text-orange-600 font-bold hover:underline">Modifier</button>
                    </div>
                    <input
                      type="tel"
                      maxLength={6}
                      className={`w-full h-14 rounded-2xl text-center text-2xl font-mono tracking-[0.5em] outline-none transition-all ${
                        isDark
                          ? 'bg-white/5 border border-white/10 text-slate-50 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10'
                          : 'bg-white border border-gray-200 text-gray-900 focus:border-orange-500 focus:ring-4 focus:ring-orange-50 shadow-sm'
                      }`}
                      placeholder="••••••"
                      value={phoneForm.code}
                      onChange={(e) => {
                         const val = e.target.value.replace(/\D/g,'');
                         setPhoneForm({...phoneForm, code: val});
                         setError('');
                      }}
                      autoFocus
                    />
                  </div>
                )}
              </div>
            )}

            {/* Main Action Button */}
            {(method !== 'phone' || !confirmationResult) && (
              <button
                type="submit"
                disabled={loading}
                className={`w-full h-12 mt-4 text-white font-bold rounded-2xl transform active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-70 disabled:cursor-not-allowed ${
                  isDark
                    ? 'bg-white/10 hover:bg-white/15 border border-white/10 shadow-[0_18px_50px_rgba(0,0,0,0.55)]'
                    : 'bg-gray-900 hover:bg-gray-800 shadow-lg shadow-gray-200 hover:shadow-gray-300'
                }`}
              >
                {loading ? (
                   <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span>
                    {method === 'phone' 
                     ? 'Recevoir le code' 
                     : (mode === 'login' ? 'Se connecter' : "S'inscrire")}
                  </span>
                )}
              </button>
            )}
          </form>

          {/* Divider */}
          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className={`w-full border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`} />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span
                className={`px-2 font-medium tracking-wide ${
                  isDark ? 'bg-slate-900/40 text-slate-300/80' : 'bg-white text-gray-400'
                }`}
              >
                Ou continuer avec
              </span>
            </div>
          </div>

	          {/* Social Buttons */}
	          <div className="grid grid-cols-2 gap-3">
	             <button
	               type="button"
	               onClick={() => handlePopupSignIn(googleProvider)}
	               disabled={loading}
	               className={`h-12 flex items-center justify-center rounded-2xl transition-all duration-200 ${
	                 isDark
	                   ? 'bg-white/8 border border-white/10 hover:bg-white/12 shadow-[0_14px_40px_rgba(0,0,0,0.45)]'
	                   : 'bg-white border border-gray-100 hover:border-gray-200 hover:bg-gray-50 shadow-sm'
	               }`}
	             >
                <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" /><path fill="#EA4335" d="M12 4.36c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.09 14.97 0 12 0 7.7 0 3.99 2.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
             </button>
	             <button
	               type="button"
	               disabled
	               className={`h-12 flex items-center justify-center rounded-2xl cursor-not-allowed opacity-50 ${
	                 isDark ? 'bg-white/5 border border-white/10' : 'bg-gray-50 border border-transparent'
	               }`}
	             >
	                <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.74 1.18 0 2.21-.93 3.69-.93.95 0 1.95.29 2.58.74-.69.35-2.29 1.5-2.29 3.63 0 3.61 3.2 4.33 3.2 4.33l-.03.1c-.43 1.35-1.53 3.14-2.23 4.29zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.18 2.32-2.47 4.07-3.74 4.25z" /></svg>
	             </button>
	          </div>

          {/* Footer Link */}
          {method === 'email' && (
            <div className="mt-8 text-center">
              <div className={`text-xs ${isDark ? 'text-slate-300/70' : 'text-gray-500'}`}>
                {mode === 'login' ? 'Pas encore de compte ?' : 'Déjà membre ?'}
              </div>

              <button
                type="button"
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                className={
                  mode === 'login'
                    ? `mt-3 w-full h-11 rounded-2xl font-bold text-sm text-white active:scale-[0.99] transition-all duration-200 ${
                        isDark
                          ? 'bg-gradient-to-r from-orange-500 to-amber-400 shadow-[0_18px_55px_rgba(249,115,22,0.28)]'
                          : 'bg-gradient-to-r from-orange-500 to-amber-400 shadow-lg shadow-orange-200'
                      }`
                    : `mt-2 font-bold text-sm transition-colors ${
                        isDark ? 'text-slate-50 hover:text-orange-300' : 'text-gray-900 hover:text-orange-600'
                      }`
                }
              >
                {mode === 'login' ? 'Créer un compte' : 'Se connecter'}
              </button>
            </div>
          )}

        </div>

        {/* Recaptcha Container (Hidden) */}
        <div id="recaptcha-container"></div>
      </div>
    </>
  );
};

export default AuthView;
