// src/views/AuthView.jsx
import React, { useEffect, useState, useRef } from 'react';
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
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import { auth } from '../firebase';
import { useTranslation } from 'react-i18next';

const AuthView = ({ noticeMessage = '' }) => {
  const { t } = useTranslation('common');

  // État du formulaire
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [phoneForm, setPhoneForm] = useState({ phone: '', code: '' });
  
  // État de l'interface
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [method, setMethod] = useState('email'); // 'email' | 'phone'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(noticeMessage || '');

  // État spécifique Téléphone
  const [confirmationResult, setConfirmationResult] = useState(null);
  const recaptchaVerifierRef = useRef(null);

  const googleProvider = new GoogleAuthProvider();
  const appleProvider = new OAuthProvider('apple.com');

  // --- Gestion du cycle de vie & Persistence ---

  useEffect(() => {
    // S'assurer que la session persiste (important pour mobile redirect)
    setPersistence(auth, browserLocalPersistence).catch((e) => console.error(e));

    // Nettoyage au démontage
    return () => {
      clearRecaptcha();
    };
  }, []);

  useEffect(() => {
    // Gestion du retour de redirection (OAuth sur mobile)
    const handleRedirect = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          onAuthSuccess(result.user);
        }
      } catch (err) {
        console.error(err);
        setError(t('providerSignInFailed', 'Authentication failed. Please try again.'));
      }
    };
    handleRedirect();
  }, []);

  // --- Helpers ---

  const onAuthSuccess = (user) => {
    setError('');
    setInfo(t('loginSuccess', 'Connexion réussie !'));
    // L'app n'utilise pas react-router: App.jsx bascule l'UI via onAuthStateChanged().
    void user;
  };

  const clearRecaptcha = () => {
    if (recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current.clear();
      recaptchaVerifierRef.current = null;
    }
  };

  // Registration is email-only (phone is for login only)
  useEffect(() => {
    if (mode !== 'register') return;
    if (method !== 'email') setMethod('email');
    setConfirmationResult(null);
    setPhoneForm((prev) => ({ ...prev, phone: '', code: '' }));
    clearRecaptcha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const setupRecaptcha = () => {
    clearRecaptcha(); // Nettoyer l'ancien si existe
    const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
      callback: () => {
        // Recaptcha résolu automatiquement
      }
    });
    recaptchaVerifierRef.current = verifier;
    return verifier;
  };

  // --- Handlers ---

  const handleGlobalSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (method === 'email') {
      await handleEmailAuth();
    } else {
      await handlePhoneAuth();
    }
  };

  const handleEmailAuth = async () => {
    if (!form.email || !form.password) {
      setError(t('authFillEmailPassword', 'Please fill email and password'));
      return;
    }

    setLoading(true);
    try {
      if (mode === 'register') {
        // --- INSCRIPTION ---
        if (!form.name.trim()) {
          setError(t('nameRequired', 'Please enter your name.'));
          setLoading(false);
          return;
        }
        
        const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
        await updateProfile(cred.user, { displayName: form.name });
        
        // Envoi email de vérification
        await sendEmailVerification(cred.user);
        setInfo(t('verificationEmailSent', 'Compte créé ! Vérifiez votre email.'));
        
        // On connecte l'utilisateur directement sans le déconnecter
        onAuthSuccess(cred.user);

      } else {
        // --- CONNEXION ---
        const cred = await signInWithEmailAndPassword(auth, form.email, form.password);
        
        if (!cred.user.emailVerified) {
          // Optionnel : avertir mais laisser entrer
          setInfo(t('verifyEmailWarning', 'Pensez à vérifier votre email pour accéder à tout.'));
        }
        onAuthSuccess(cred.user);
      }
    } catch (err) {
      let msg = err.message;
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        msg = t('invalidCreds', "Email ou mot de passe incorrect.");
      } else if (err.code === 'auth/email-already-in-use') {
        msg = t('emailInUse', "Cet email est déjà utilisé.");
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneAuth = async () => {
    // Cas 1 : Validation du code SMS
    if (confirmationResult) {
      const code = String(phoneForm.code || '').replace(/\D/g, '').slice(0, 6);
      if (code.length < 6) {
        setError(t('enterCode', 'Enter the verification code.'));
        return;
      }
      setLoading(true);
      try {
        const result = await confirmationResult.confirm(code);
        onAuthSuccess(result.user);
      } catch (err) {
        setError(t('invalidCode', "Code invalide ou expiré."));
      } finally {
        setLoading(false);
      }
      return;
    }

    // Cas 2 : Envoi du SMS
    let phoneInput = phoneForm.phone.replace(/\s+/g, '');
    
    // Ajout simple du préfixe FR si aucun préfixe (+) n'est présent
    if (!phoneInput.startsWith('+')) {
      if (phoneInput.startsWith('0')) {
        phoneInput = phoneInput.replace(/^0/, '+33');
      } else {
         // Si l'utilisateur tape "61234..." sans 0 ni +, on suppose FR, 
         // mais c'est risqué. Mieux vaut demander le format international.
         phoneInput = '+33' + phoneInput;
      }
    }

    if (phoneInput.length < 8) {
        setError(t('phoneFormatError', "Numéro invalide."));
        return;
    }

    setLoading(true);
    try {
      const verifier = setupRecaptcha();
      const confirmation = await signInWithPhoneNumber(auth, phoneInput, verifier);
      setConfirmationResult(confirmation);
      setInfo(t('phoneCodeSent', 'Code envoyé par SMS.'));
    } catch (err) {
      console.error(err);
      setError(err.message || t('errorSendingSMS', "Erreur d'envoi SMS."));
      clearRecaptcha(); // Reset recaptcha en cas d'erreur
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit phone code when 6 digits are entered
  useEffect(() => {
    if (method !== 'phone') return;
    if (!confirmationResult) return;
    if (loading) return;
    const code = String(phoneForm.code || '').replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) return;
    handlePhoneAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, confirmationResult, phoneForm.code]);

  const handlePopupSignIn = async (provider) => {
    setError('');
    setLoading(true);
    try {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      if (isMobile) {
        await signInWithRedirect(auth, provider);
        // Le code s'arrête ici, la page va recharger
        return;
      }

      const result = await signInWithPopup(auth, provider);
      onAuthSuccess(result.user);
    } catch (err) {
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
        // Fallback desktop si popup bloquée
        try {
          await signInWithRedirect(auth, provider);
        } catch (redirErr) {
          setError(redirErr.message);
        }
      } else {
        setError(err.message || t('providerSignInFailed', 'Erreur de connexion sociale.'));
      }
    } finally {
      setLoading(false); // Seulement utile si pas de redirect
    }
  };

  // --- Reset lors du changement de méthode ---
  const switchMethod = (newMethod) => {
    if (mode === 'register' && newMethod === 'phone') return;
    setMethod(newMethod);
    setError('');
    setInfo('');
    setConfirmationResult(null); // Reset état téléphone
    clearRecaptcha();
  };

  return (
    <div className="h-full min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 flex items-center justify-center px-6 overflow-hidden">
      <div className="w-full max-w-md bg-white/80 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/80 p-8 space-y-6">
        
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">{t('authWelcome', 'Welcome to ParkSwap')}</h1>
          <p className="text-sm text-gray-500">
            {method === 'email'
              ? mode === 'login'
                ? t('authLoginSubtitle', 'Log in to continue')
                : t('authRegisterSubtitle', 'Create an account')
              : t('authPhoneSubtitle', 'Sign in with your phone')}
          </p>
        </div>

        {/* Notifications */}
        {(info) && (
          <div className="text-sm text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-center animate-pulse">
            {info}
          </div>
        )}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-center">
            {error}
          </div>
        )}

        {/* Onglets Méthode (login seulement) */}
        {mode === 'login' && (
          <div className="flex justify-center space-x-2 bg-gray-100 p-1 rounded-full w-fit mx-auto">
            <button
              type="button"
              onClick={() => switchMethod('email')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                method === 'email' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t('useEmail', 'Email')}
            </button>
            <button
              type="button"
              onClick={() => switchMethod('phone')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                method === 'phone' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t('usePhone', 'Téléphone')}
            </button>
          </div>
        )}

        {/* Formulaire Principal */}
        <form className="space-y-4" onSubmit={handleGlobalSubmit}>
          
          {/* --- CHAMPS EMAIL --- */}
          {method === 'email' && (
            <>
              {mode === 'register' && (
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-gray-600">{t('name', 'Nom')}</label>
                  <input
                    type="text"
                    required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="John Doe"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-600">{t('email', 'Email')}</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-600">{t('password', 'Mot de passe')}</label>
                <input
                  type="password"
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
            </>
          )}

          {/* --- CHAMPS TÉLÉPHONE --- */}
	          {method === 'phone' && (
	            <div className="space-y-4">
	              {!confirmationResult ? (
                // Étape 1 : Numéro
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-gray-600">{t('phone', 'Numéro de mobile')}</label>
                  <input
                    type="tel"
                    required
                    autoComplete="tel"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                    value={phoneForm.phone}
                    onChange={(e) => setPhoneForm({ ...phoneForm, phone: e.target.value })}
                    placeholder="06 12 34 56 78"
                  />
                </div>
              ) : (
                // Étape 2 : Code SMS
	                <div className="space-y-2 animate-fadeIn">
	                  <div className="flex justify-between items-center">
	                    <label className="text-sm font-semibold text-gray-600">{t('enterCode', 'Code SMS')}</label>
	                    <button 
	                      type="button" 
	                      onClick={() => setConfirmationResult(null)}
	                      className="text-xs text-orange-500 hover:underline"
	                    >
	                      {t('changeNumber', 'Changer de numéro')}
	                    </button>
	                  </div>
	                  <input
	                    type="tel"
	                    inputMode="numeric"
	                    autoComplete="one-time-code"
	                    pattern="[0-9]*"
	                    maxLength={6}
	                    required
	                    value={phoneForm.code}
	                    onChange={(e) => {
	                      const next = String(e.target.value || '').replace(/\D/g, '').slice(0, 6);
	                      setPhoneForm({ ...phoneForm, code: next });
	                      setError('');
	                    }}
	                    placeholder="123456"
	                    className="w-full border border-orange-300 bg-orange-50 rounded-xl px-3 py-2 text-center text-xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
	                  />
	                  <p className="text-xs text-gray-500">
	                    {loading
	                      ? t('verifying', { defaultValue: 'Vérification…' })
	                      : t('autoVerifyHint', { defaultValue: 'Le code est vérifié automatiquement.' })}
	                  </p>
	                </div>
	              )}
	            </div>
	          )}

          {/* BOUTON D'ACTION PRINCIPAL */}
	          {(method !== 'phone' || !confirmationResult) && (
	            <button
	              type="submit"
	              disabled={loading}
	              className="w-full bg-gradient-to-r from-orange-500 to-amber-400 text-white py-3 rounded-xl font-bold shadow-lg hover:scale-[1.01] transition disabled:opacity-60 disabled:scale-100 flex justify-center items-center"
	            >
	              {loading && (
	                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
	                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
	                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
	                </svg>
	              )}
	              {method === 'phone'
	                ? t('sendCode', 'Envoyer le code')
	                : mode === 'login'
	                  ? t('login', 'Se connecter')
	                  : t('register', "S'inscrire")}
	            </button>
	          )}
	        </form>

        {/* Séparateur */}
        <div className="flex items-center space-x-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">ou continuer avec</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Boutons Sociaux */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => handlePopupSignIn(googleProvider)}
            className="flex items-center justify-center bg-white border border-gray-200 rounded-xl py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
          >
             <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" />
                <path fill="#EA4335" d="M12 4.36c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.09 14.97 0 12 0 7.7 0 3.99 2.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            Google
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => handlePopupSignIn(appleProvider)}
            className="flex items-center justify-center bg-black text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 transition"
          >
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.74 1.18 0 2.21-.93 3.69-.93.95 0 1.95.29 2.58.74-.69.35-2.29 1.5-2.29 3.63 0 3.61 3.2 4.33 3.2 4.33l-.03.1c-.43 1.35-1.53 3.14-2.23 4.29zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.18 2.32-2.47 4.07-3.74 4.25z" />
            </svg>
            Apple
          </button>
        </div>

        {/* Toggle Login/Register (Uniquement pour Email) */}
        {method === 'email' && (
          <div className="text-center text-sm text-gray-600 pt-2">
            {mode === 'login' ? (
              <p>
                {t('needAccount', 'Pas de compte ?')} {' '}
                <button className="font-bold text-orange-600 hover:underline" onClick={() => setMode('register')}>
                  {t('registerLink', "S'inscrire")}
                </button>
              </p>
            ) : (
              <p>
                {t('haveAccount', 'Déjà un compte ?')} {' '}
                <button className="font-bold text-orange-600 hover:underline" onClick={() => setMode('login')}>
                  {t('loginLink', "Se connecter")}
                </button>
              </p>
            )}
          </div>
        )}
      </div>
      
      {/* Container Recaptcha (ne pas supprimer) */}
      <div id="recaptcha-container"></div>
    </div>
  );
};

export default AuthView;
