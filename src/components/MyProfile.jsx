import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, User } from 'lucide-react';
import { PhoneAuthProvider, RecaptchaVerifier, updatePhoneNumber } from 'firebase/auth';
import { auth } from '../firebase';
import { formatPhoneForDisplay, formatPhoneInput, guessPhoneCountry, toE164Phone } from '../utils/phone';

const MyProfile = ({ user, onUpdateProfile, isDark = false, iconStyle }) => {
  const { t, i18n } = useTranslation('common');
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
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [closingProfile, setClosingProfile] = useState(false);
  const recaptchaRenderPromiseRef = useRef(null);
  const [phoneCountry, setPhoneCountry] = useState(() => guessPhoneCountry(user?.phone).code);
  const nameInputRef = useRef(null);
  const emailInputRef = useRef(null);
  const phoneInputRef = useRef(null);

  useEffect(() => {
    if (showProfileModal) setClosingProfile(false);
  }, [showProfileModal]);

  const userPhoneE164 = String(user?.phone || '');
  const parsedPhone = toE164Phone(profileForm.phone, phoneCountry);
  const phoneInputHasValue = String(profileForm.phone || '').trim().length > 0;
  const phoneDirty = phoneInputHasValue ? parsedPhone.e164 !== userPhoneE164 : userPhoneE164 !== '';
  const phoneChanged = !!parsedPhone.e164 && parsedPhone.e164 !== userPhoneE164;
  const emailChanged = profileForm.email !== (user?.email || '');
  const phoneVerifiedStatus =
    phoneVerification.status === 'verified' || (!phoneChanged && user?.phoneVerified);

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
    setInfoMsg('');
    setPhoneCountry(nextCountryCode);
    setIsEditingProfile(false);
  }, [user]);

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
      setEmailVerification({ status: 'sent', error: '' });
      setInfoMsg(t('emailVerificationSent', 'Verification email sent. Confirm it to finalize your email update.'));
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
      setProfileForm((prev) => ({ ...prev, phone: formatPhoneForDisplay(verifiedPhone, verifiedCountryCode) }));
      setPhoneVerification({ status: 'verified', verificationId: '', code: '', error: '', phoneE164: verifiedPhone });
      setInfoMsg(t('phoneVerified', 'Phone verified!'));
    } catch (err) {
      setPhoneVerification((prev) => ({ ...prev, error: err?.message || t('updateProfileError', 'Unable to update profile. Please try again.') }));
    }
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
    setIsEditingProfile(true);
    try {
      if (field === 'name') nameInputRef.current?.focus?.();
      if (field === 'email') emailInputRef.current?.focus?.();
      if (field === 'phone') phoneInputRef.current?.focus?.();
    } catch (_) {}
  };

  const closeWithAnim = (setClosing, setShow) => {
    setClosing(true);
    setTimeout(() => {
      setShow(false);
      setClosing(false);
    }, 260);
  };

  const handleProfileClick = () => {
    console.log('[MyProfile] Profile button clicked');
    setShowProfileModal(true);
  };

  useEffect(() => {
    console.log('[MyProfile] showProfileModal changed:', showProfileModal);
  }, [showProfileModal]);

  const handleSaveProfile = async () => {
    console.log('[MyProfile] Saving profile', profileForm);
    setInfoMsg('');
    
    if (!profileForm.displayName?.trim()) {
      setInfoMsg(t('nameRequired', 'Name is required'));
      return;
    }

    const nextPhone = toE164Phone(profileForm.phone, phoneCountry).e164 || userPhoneE164;
    const safePhone = phoneDirty ? (phoneVerifiedStatus ? nextPhone : userPhoneE164) : userPhoneE164;
    const safePhoneVerified = phoneDirty ? (phoneVerifiedStatus ? true : user?.phoneVerified) : user?.phoneVerified;

    try {
      const res = await onUpdateProfile?.({
        ...profileForm,
        phone: safePhone,
        phoneVerified: safePhoneVerified,
      });

      if (res?.error) {
        setInfoMsg(t('updateProfileError', 'Unable to update profile. Please try again.'));
        return;
      }

      setInfoMsg(t('profileUpdated', 'Profile updated successfully!'));
      setTimeout(() => {
        closeWithAnim(setClosingProfile, setShowProfileModal);
      }, 1000);
    } catch (err) {
      console.error('[MyProfile] Error saving profile:', err);
      setInfoMsg(t('updateProfileError', 'Unable to update profile. Please try again.'));
    }
  };

  return (
    <>
      <div id="recaptcha-container" className="hidden" />
      <button
        type="button"
        onClick={handleProfileClick}
        className={`w-full p-4 flex items-center justify-between text-left transition ${
          isDark ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100' : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
        }`}
      >
        <div className="flex items-center space-x-3">
          <div className="bg-white p-2 rounded-lg border border-gray-100">
            <User size={20} style={iconStyle ? iconStyle('profile') : undefined} />
          </div>
          <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>{t('profile')}</span>
        </div>
        <ArrowRight size={16} className={isDark ? 'text-slate-500' : 'text-gray-300'} />
      </button>

      {showProfileModal && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingProfile ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={() => {
            console.log('[MyProfile] Modal overlay clicked - closing');
            closeWithAnim(setClosingProfile, setShowProfileModal);
          }}
        >
          <div
            className={`rounded-2xl shadow-2xl w-full max-w-md p-6 relative border max-h-[90vh] overflow-y-auto ${
              closingProfile ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
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
                  <User size={20} style={iconStyle ? iconStyle('profile') : undefined} />
                </div>
                <div className="font-semibold text-lg leading-tight">{t('editProfile', 'Edit Profile')}</div>
              </div>
            </div>

            {infoMsg && (
              <div
                className={`mb-4 p-3 rounded-lg text-sm ${
                  isDark ? 'bg-blue-500/20 text-blue-200' : 'bg-blue-50 text-blue-700'
                }`}
              >
                {infoMsg}
              </div>
            )}

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                  {t('name', 'Name')}
                </label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={profileForm.displayName}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, displayName: e.target.value }))}
                  onFocus={() => startProfileEdit('name')}
                  className={`w-full rounded-xl px-3 py-2 text-sm font-semibold outline-none border ${
                    isDark
                      ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500'
                      : 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400'
                  }`}
                  placeholder={t('enterName', 'Enter your name')}
                />
              </div>

              {/* Email */}
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                  {t('email', 'Email')}
                </label>
                <input
                  ref={emailInputRef}
                  type="email"
                  value={profileForm.email}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, email: e.target.value }))}
                  onFocus={() => startProfileEdit('email')}
                  className={`w-full rounded-xl px-3 py-2 text-sm font-semibold outline-none border ${
                    isDark
                      ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500'
                      : 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400'
                  }`}
                  placeholder={t('enterEmail', 'Enter your email')}
                />
                {emailChanged && emailVerification.status !== 'sent' && (
                  <button
                    type="button"
                    onClick={handleSendEmailVerification}
                    disabled={emailVerification.status === 'sending'}
                    className={`mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg ${
                      isDark
                        ? 'bg-blue-500/20 text-blue-200 border border-blue-400/30'
                        : 'bg-blue-50 text-blue-600 border border-blue-200'
                    }`}
                  >
                    {emailVerification.status === 'sending'
                      ? t('sending', 'Sending...')
                      : t('verifyEmail', 'Verify Email')}
                  </button>
                )}
                {emailVerification.error && (
                  <p className={`mt-1 text-xs ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>
                    {emailVerification.error}
                  </p>
                )}
              </div>

              {/* Phone */}
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                  {t('phone', 'Phone')}
                </label>
                <div className="flex gap-2">
                  <select
                    value={phoneCountry}
                    onChange={(e) => {
                      const newCountry = e.target.value;
                      setPhoneCountry(newCountry);
                      const reformatted = formatPhoneForDisplay(
                        toE164Phone(profileForm.phone, phoneCountry).e164 || profileForm.phone,
                        newCountry
                      );
                      setProfileForm((prev) => ({ ...prev, phone: reformatted }));
                    }}
                    className={`rounded-xl px-2 py-2 text-sm font-semibold outline-none border ${
                      isDark
                        ? 'bg-slate-800 border-slate-700 text-slate-100'
                        : 'bg-gray-50 border-gray-200 text-gray-900'
                    }`}
                  >
                    <option value="FR">🇫🇷 +33</option>
                    <option value="US">🇺🇸 +1</option>
                    <option value="GB">🇬🇧 +44</option>
                  </select>
                  <input
                    ref={phoneInputRef}
                    type="tel"
                    value={profileForm.phone}
                    onChange={(e) => {
                      const formatted = formatPhoneInput(e.target.value, phoneCountry);
                      setProfileForm((prev) => ({ ...prev, phone: formatted }));
                    }}
                    onFocus={() => startProfileEdit('phone')}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold outline-none border ${
                      isDark
                        ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500'
                        : 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400'
                    }`}
                    placeholder={t('enterPhone', 'Enter phone number')}
                  />
                </div>
                {phoneDirty && !phoneVerifiedStatus && phoneVerification.status !== 'code-sent' && (
                  <button
                    type="button"
                    onClick={handleSendPhoneCode}
                    disabled={phoneVerification.status === 'sending'}
                    className={`mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg ${
                      isDark
                        ? 'bg-blue-500/20 text-blue-200 border border-blue-400/30'
                        : 'bg-blue-50 text-blue-600 border border-blue-200'
                    }`}
                  >
                    {phoneVerification.status === 'sending'
                      ? t('sending', 'Sending...')
                      : t('verifyPhone', 'Verify Phone')}
                  </button>
                )}
                {phoneVerification.status === 'code-sent' && (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={phoneVerification.code}
                      onChange={(e) =>
                        setPhoneVerification((prev) => ({ ...prev, code: e.target.value.replace(/\D/g, '') }))
                      }
                      placeholder={t('enterCode', 'Enter code')}
                      className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold outline-none border ${
                        isDark
                          ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500'
                          : 'bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleVerifyPhoneCode}
                      className={`px-3 py-2 rounded-xl text-xs font-bold ${
                        isDark
                          ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30'
                          : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                      }`}
                    >
                      {t('verify', 'Verify')}
                    </button>
                  </div>
                )}
                {phoneVerification.error && (
                  <p className={`mt-1 text-xs ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>
                    {phoneVerification.error}
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  console.log('[MyProfile] Cancel button clicked');
                  cancelProfileEdit();
                  closeWithAnim(setClosingProfile, setShowProfileModal);
                }}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
                  isDark
                    ? 'bg-slate-800 text-slate-100 border border-slate-700'
                    : 'bg-gray-100 text-gray-700 border border-gray-200'
                }`}
              >
                {t('cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
                  isDark
                    ? 'bg-pink-500/20 text-pink-200 border border-pink-400/30'
                    : 'bg-pink-50 text-pink-600 border border-pink-200'
                }`}
              >
                {t('save', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MyProfile;
