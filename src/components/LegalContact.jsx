import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, FileText, ShieldCheck, X } from 'lucide-react';
import { PRIVACY_POLICY_TEXT } from '../legal/privacyPolicyText';
import { TERMS_AND_CONDITIONS_TEXT } from '../legal/termsAndConditionsText';

const LegalContact = ({ isDark = false, iconStyle }) => {
  const { t, i18n } = useTranslation('common');
  const legalLocale = String(i18n.language || 'en')
    .toLowerCase()
    .startsWith('fr')
    ? 'fr'
    : 'en';
  const privacyPolicyText = PRIVACY_POLICY_TEXT[legalLocale] || PRIVACY_POLICY_TEXT.en || '';
  const termsAndConditionsText = TERMS_AND_CONDITIONS_TEXT[legalLocale] || TERMS_AND_CONDITIONS_TEXT.en || '';
  const [showLegal, setShowLegal] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [closingPrivacy, setClosingPrivacy] = useState(false);
  const [closingTerms, setClosingTerms] = useState(false);

  useEffect(() => {
    if (showPrivacy) setClosingPrivacy(false);
  }, [showPrivacy]);

  useEffect(() => {
    if (showTerms) setClosingTerms(false);
  }, [showTerms]);

  const closeWithAnim = (setClosing, setShow) => {
    setClosing(true);
    setTimeout(() => {
      setShow(false);
      setClosing(false);
    }, 260);
  };

  const collapseLegal = () => setShowLegal(false);

  return (
    <>
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
              <FileText size={20} style={iconStyle ? iconStyle('legal') : undefined} />
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

            <div className="overflow-y-auto p-6 no-scrollbar grow">
              <p className={`text-sm leading-relaxed whitespace-pre-wrap font-normal ${isDark ? 'text-slate-200' : 'text-gray-600'}`}>
                {privacyPolicyText}
              </p>

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
            <div
              className={`flex items-center justify-between px-6 py-4 border-b backdrop-blur-md z-10 shrink-0 ${
                isDark ? 'border-slate-800 bg-slate-900/40' : 'border-gray-100 bg-white/50'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-full ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-gray-100 text-gray-600'}`}>
                  <FileText size={20} style={iconStyle ? iconStyle('legal') : undefined} />
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

            <div className="overflow-y-auto p-6 no-scrollbar grow">
              <p className={`text-sm leading-relaxed whitespace-pre-wrap font-normal ${isDark ? 'text-slate-200' : 'text-gray-600'}`}>
                {termsAndConditionsText}
              </p>

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
    </>
  );
};

export default LegalContact;
