// src/views/AuthView.jsx
import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  sendEmailVerification,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import { auth } from '../firebase';
import { useTranslation } from 'react-i18next';

const AuthView = ({noticeMessage = '' }) => {
  const { t } = useTranslation('common');
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
  });
  const [mode, setMode] = useState('login'); // login or register
  const [method, setMethod] = useState('email'); // email or phone
  const [error, setError] = useState('');
  const [info, setInfo] = useState(noticeMessage || '');
  const [loading, setLoading] = useState(false);
  const [phoneForm, setPhoneForm] = useState({ phone: '', code: '' });
  const [phoneConfirmation, setPhoneConfirmation] = useState(null);
  const [autoVerifying, setAutoVerifying] = useState(false);
  const googleProvider = new GoogleAuthProvider();
  const appleProvider = new OAuthProvider('apple.com');
  const hostOrigin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  const actionCodeSettings = { url: hostOrigin, handleCodeInApp: false };

  const getRecaptcha = () => {
    if (window.recaptchaVerifier) return window.recaptchaVerifier;
    window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
    return window.recaptchaVerifier;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (method === 'phone') {
      return;
    }

    if (!form.email || !form.password) {
      setError(t('authFillEmailPassword', 'Please fill email and password'));
      return;
    }
    try {
      setLoading(true);
      if (mode === 'register') {
        if (!form.name.trim()) {
          setError(t('nameRequired', 'Please enter your name.'));
          setLoading(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
        if (form.name) {
          await updateProfile(cred.user, { displayName: form.name });
        }
        try {
          await sendEmailVerification(cred.user, actionCodeSettings);
          setInfo(t('verificationEmailSent', 'Verification email sent. Confirm it to finalize your email update.'));
        } catch (verifyErr) {
          const msg =
            verifyErr?.message || t('verifyEmailFirst', 'Please verify your email before signing in. We sent you a link.');
          setError(msg);
        }
        await signOut(auth);
        return;
      } else {
        const cred = await signInWithEmailAndPassword(auth, form.email, form.password);
        if (!cred.user.emailVerified) {
          try {
            await sendEmailVerification(cred.user, actionCodeSettings);
            setError(t('verifyEmailFirst', 'Please verify your email before signing in. We sent you a link.'));
          } catch (verifyErr) {
            setError(verifyErr.message || t('verifyEmailFirst', 'Please verify your email before signing in. We sent you a link.'));
          }
          await signOut(auth);
          return;
        }
        
      }
    } catch (err) {
      const funny = t('invalidCredsFunny', "That combo doesn't look right. Did a cat type it?");
      const msg = err?.code === 'auth/invalid-credential' ? funny : err.message || funny;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

const handlePopupSignIn = async (provider) => {
  setError('');
  try {
    setLoading(true);
    await setPersistence(auth, browserLocalPersistence);

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (isMobile) {
      // 👉 Sur mobile : flow redirect (popup bloquée sinon)
      await signInWithRedirect(auth, provider);
      return;
    }

    // 👉 Desktop : popup
    const cred = await signInWithPopup(auth, provider);
    if (!cred.user) throw new Error('No user returned from provider');
    
  } catch (err) {
    // Si une popup est quand même bloquée sur desktop → fallback redirect
    if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/popup-closed-by-user') {
      try {
        await signInWithRedirect(auth, provider);
        return;
      } catch (redirectErr) {
        setError(
          redirectErr?.message ||
            t('providerSignInFailed', 'Authentication failed. Please try again.')
        );
        return;
      }
    }

    setError(
      err?.message ||
        t('providerSignInFailed', 'Authentication failed. Please try again.')
    );
  } finally {
    setLoading(false);
  }
};

useEffect(() => {
  // Ensure session persists across redirects (mobile browsers)
  setPersistence(auth, browserLocalPersistence).catch(() => {});

  return () => {
    // Cleanup reCAPTCHA si présent
    if (window.recaptchaVerifier?.clear) {
      window.recaptchaVerifier.clear();
      window.recaptchaVerifier = null;
    }
  };
}, []); // ⬅︎ plus de onLogin ici

  useEffect(() => {
    let mounted = true;
    const finalizeRedirect = async () => {
      try {
        setLoading(true);
        const result = await getRedirectResult(auth);
        if (!mounted) return;
        if (result?.user) {
          setError('');
          setInfo(t('redirectLoginSuccess', 'Signed in successfully.'));
        }
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || t('providerSignInFailed', 'Authentication failed. Please try again.'));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    finalizeRedirect();
    return () => {
      mounted = false;
    };
  }, [t]);

  const confirmPhoneCode = async () => {
    if (!phoneConfirmation) {
      setError(t('sendCodeFirst', 'Please send the code to your phone first.'));
      return;
    }
    if (!phoneForm.code.trim()) {
      setError(t('enterCode', 'Enter the verification code.'));
      return;
    }
    setAutoVerifying(true);
    try {
      const cred = await phoneConfirmation.confirm(phoneForm.code.trim());
      setShowCodePrompt(false);
    } catch (err) {
      setError(err.message || 'Phone verification failed');
    } finally {
      setAutoVerifying(false);
      setLoading(false);
    }
  };

  const sendPhoneCode = async () => {
    setError('');
    setInfo('');
    const normalized = phoneForm.phone.replace(/\s+/g, '').replace(/^0/, '+33');
    if (!normalized) {
      setError(t('phoneFormatError', 'Use international format, e.g. +33123456789.'));
      return;
    }
    try {
      setLoading(true);
      const verifier = getRecaptcha();
      await verifier.render();
      const confirmation = await signInWithPhoneNumber(auth, normalized, verifier);
      setPhoneConfirmation(confirmation);
      setPhoneForm((prev) => ({ ...prev, code: '' }));
      setInfo(t('phoneCodeSent', 'Verification code sent to your phone.'));
    } catch (err) {
      const friendly =
        err?.code === 'auth/invalid-app-credential'
          ? t('invalidAppCredential', 'Phone auth needs proper setup (authorized domain & billing). Try again or use email.')
          : err.message || t('sendCodeFirst', 'Please send the code to your phone first.');
      setError(friendly);
      setPhoneConfirmation(null);
      if (window.recaptchaVerifier?.clear) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full bg-gradient-to-br from-orange-50 via-white to-amber-50 flex items-center justify-center px-6 overflow-hidden">
      <div className="w-full max-w-md bg-white/80 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/80 p-8 space-y-6 overflow-hidden">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">{t('authWelcome', 'Welcome to ParkSwap')}</h1>
          <p className="text-sm text-gray-500">
            {method === 'email'
              ? mode === 'login'
                ? t('authLoginSubtitle', 'Log in to continue')
                : t('authRegisterSubtitle', 'Create an account to get started')
              : t('authPhoneSubtitle', 'Use your phone to sign in')}
          </p>
        </div>
        {(info || noticeMessage) && (
          <div className="text-sm text-orange-600 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 text-center">
            {info || noticeMessage}
          </div>
        )}
        {info && <div className="text-sm text-orange-600 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">{info}</div>}
        <div className="flex justify-center space-x-2">
          <button
            type="button"
            onClick={() => setMethod('email')}
            onFocus={() => { setError(''); setInfo(''); }}
            className={`px-3 py-1 rounded-full text-xs font-semibold border ${
              method === 'email' ? 'border-orange-200 text-orange-600 bg-orange-50' : 'border-gray-200 text-gray-500'
            }`}
          >
            {t('useEmail', 'Use email')}
          </button>
          <button
            type="button"
            onClick={() => setMethod('phone')}
            onFocus={() => { setError(''); setInfo(''); }}
            className={`px-3 py-1 rounded-full text-xs font-semibold border ${
              method === 'phone' ? 'border-orange-200 text-orange-600 bg-orange-50' : 'border-gray-200 text-gray-500'
            }`}
          >
            {t('usePhone', 'Use phone')}
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {method === 'email' && (
            <>
              {mode === 'register' && (
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-gray-600">{t('name')}</label>
                  <input
                    type="text"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder={t('name', 'Name')}
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-600">{t('email')}</label>
                <input
                  type="email"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-600">{t('password', 'Password')}</label>
                <input
                  type="password"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="••••••••"
                  required
                />
              </div>
            </>
          )}

          {method === 'phone' && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-600">{t('phone')}</label>
                <input
                  type="tel"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                  value={phoneForm.phone}
                  onChange={(e) => {
                    setPhoneConfirmation(null);
                    setPhoneForm((prev) => ({ ...prev, phone: e.target.value }));
                  }}
                  placeholder="+33123456789"
                />
                {phoneConfirmation ? (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">{t('weSentCode', 'We sent a code to your phone.')}</p>
                    <div className="flex items-center space-x-2">
                      <input
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={phoneForm.code}
                        onChange={(e) => setPhoneForm((prev) => ({ ...prev, code: e.target.value }))}
                        placeholder="123456"
                        className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm tracking-[0.25em] font-mono text-center"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
          {method === 'phone' ? (
            <button
              type="button"
              onClick={sendPhoneCode}
              disabled={loading}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-400 text-white py-3 rounded-xl font-bold shadow-lg hover:scale-[1.01] transition disabled:opacity-60"
            >
              {loading ? t('pleaseWait', 'Please wait...') : t('getCode', 'Get code')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-400 text-white py-3 rounded-xl font-bold shadow-lg hover:scale-[1.01] transition disabled:opacity-60"
            >
              {loading
                ? t('pleaseWait', 'Please wait...')
                : mode === 'login'
                  ? t('login', 'Log in')
                  : t('createAccount', 'Create account')}
            </button>
          )}

          {method === 'phone' && phoneConfirmation ? (
            <div className="mt-3 space-y-2">
              <label className="text-sm font-semibold text-gray-600">{t('enterCode', 'Enter the verification code.')}</label>
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                value={phoneForm.code}
                onChange={(e) => setPhoneForm((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="123456"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-center text-lg tracking-[0.35em] font-mono"
              />
              <button
                type="button"
                onClick={confirmPhoneCode}
                className="w-full bg-gradient-to-r from-orange-500 to-amber-400 text-white py-3 rounded-xl font-bold shadow-lg hover:scale-[1.01] transition disabled:opacity-60"
                disabled={autoVerifying}
              >
                {autoVerifying ? t('pleaseWait', 'Please wait...') : t('login', 'Connexion')}
              </button>
            </div>
          ) : null}
        </form>
        <div className="flex items-center space-x-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>
        <div className="space-y-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => handlePopupSignIn(googleProvider)}
            className="w-full bg-white border border-gray-200 rounded-xl py-3 font-semibold text-gray-800 shadow-sm hover:bg-gray-50 transition disabled:opacity-60"
          >
            {t('continueWithGoogle', 'Continue with Google')}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => handlePopupSignIn(appleProvider)}
            className="w-full bg-black text-white rounded-xl py-3 font-semibold shadow-sm hover:opacity-90 transition disabled:opacity-60"
          >
            {t('continueWithApple', 'Continue with Apple')}
          </button>
        </div>
      <div className="text-center text-sm text-gray-600">
        {mode === 'login' ? (
          <button className="font-semibold text-orange-600" onClick={() => setMode('register')}>
            {t('needAccount', 'Need an account? Register')}
          </button>
          ) : (
            <button className="font-semibold text-orange-600" onClick={() => setMode('login')}>
              {t('haveAccount', 'Already have an account? Log in')}
            </button>
          )}
        </div>
      </div>
      <div id="recaptcha-container" className="hidden" />
    </div>
  );
};

export default AuthView;
