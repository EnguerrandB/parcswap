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

  return (
    <>
      <div id="recaptcha-container" className="hidden" />
      <button
        type="button"
        onClick={() => setShowProfileModal(true)}
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
    </>
  );
};

export default MyProfile;
