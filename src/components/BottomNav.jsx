// src/components/BottomNav.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, HandCoins, Send, RotateCw, X } from 'lucide-react';

// ==================================================================================
// 🎛️ CONFIGURATION
// ==================================================================================

const HALO_SPREAD = '-inset-0';
const HALO_OPACITY = 0.02;
const HALO_SCALE = 1.05; // Réduit légèrement pour éviter tout dépassement d'écran
const HALO_BLUR_CLASS = 'blur-lg';

// ==================================================================================

const BottomNav = ({
  activeTab,
  setActiveTab,
  onProposePress,
  waitingMode = false,
  onCancelPress,
  onRenewPress,
  canPublish = true,
  onPublishDisabledPress,
  customActions,
}) => {
  const { t } = useTranslation('common');
  const [publishHintOpen, setPublishHintOpen] = useState(false);
  const publishHintTimerRef = useRef(null);
  const customMode = !!customActions;
  const singleAction = !!customActions?.single;
  const effectiveTab = customActions?.activeTab || activeTab;
  const effectiveWaitingMode = customMode ? false : waitingMode;
  
  const activateTab = (tab) => {
    if (setActiveTab) setActiveTab(tab);
  };

  const publishDisabled = !customMode && activeTab === 'propose' && !waitingMode && !canPublish;
  const shouldPulsePublish = !customMode && activeTab === 'propose' && !waitingMode && !publishDisabled;
  const barSurfaceClass =
    customActions?.barClassName ||
    'bg-white/80 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.12)]';
  const activePillClass =
    customActions?.activeClassName ||
    (publishDisabled
      ? 'bg-gray-300/90 shadow-[0_2px_10px_rgba(15,23,42,0.12)]'
      : 'bg-orange-500 shadow-[0_2px_10px_rgba(249,115,22,0.3)]');

  const showPublishHint = () => {
    setPublishHintOpen(true);
    if (publishHintTimerRef.current) window.clearTimeout(publishHintTimerRef.current);
    publishHintTimerRef.current = window.setTimeout(() => setPublishHintOpen(false), 2400);
  };

  useEffect(() => {
    if (customMode) {
      setPublishHintOpen(false);
      return;
    }
    if (!publishDisabled) setPublishHintOpen(false);
  }, [publishDisabled, customMode]);

  useEffect(() => {
    return () => {
      if (publishHintTimerRef.current) window.clearTimeout(publishHintTimerRef.current);
      publishHintTimerRef.current = null;
    };
  }, []);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9999] flex justify-center pb-[calc(env(safe-area-inset-bottom)+24px)] pointer-events-auto"
      data-role="bottom-nav-wrapper"
      style={{ transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
    >
      {/* CONTENEUR PRINCIPAL */}
      <div className="relative w-[90%] max-w-[320px] pointer-events-auto">
        
        {/* LA BARRE DE NAVIGATION */}
        <div
          id="bottom-nav"
          className={`
            relative flex items-center p-1.5
            ${barSurfaceClass}
            rounded-full w-full
            overflow-hidden
          `}
        >
          {/* FOND ACTIF QUI GLISSE */}
          <div
            className={`
              pointer-events-none absolute top-1.5 bottom-1.5 rounded-full 
              ${activePillClass}
              transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]
              ${singleAction ? 'left-1.5 w-[calc(100%-12px)]' : 'w-[calc(50%-9px)]'}
              ${!singleAction && (effectiveTab === 'search' 
                ? 'left-1.5'
                : 'left-[calc(50%+3px)]'
              )}
            `}
          />

          {/* =================================================================
             BOUTONS (Foreground)
             ================================================================= */}
          
          {/* Bouton Recherche */}
          <button
            type="button"
            onClick={() => {
              if (customMode) {
                customActions.left?.onClick?.();
                return;
              }
              if (waitingMode) {
                onCancelPress?.();
                return;
              }
              activateTab('search');
            }}
            onContextMenu={(e) => e.preventDefault()}
            style={{ 
              touchAction: 'none', 
              WebkitTapHighlightColor: 'transparent',
              WebkitUserSelect: 'none',
              userSelect: 'none',
              WebkitTouchCallout: 'none'
            }}
            className={`
              flex-1 relative z-20 flex items-center justify-center gap-2 h-12 rounded-full transition-colors duration-300
              outline-none focus:outline-none cursor-pointer
              ${effectiveTab === 'search' && !effectiveWaitingMode ? 'text-white' : 'text-gray-500 hover:text-gray-700'}
            `}
          >
            {customMode ? (
              customActions.left?.icon
                ? React.createElement(customActions.left.icon, { size: 20, strokeWidth: 2.5 })
                : null
            ) : effectiveWaitingMode ? (
              <X
                size={20}
                strokeWidth={2.5}
                className="transition-transform duration-300 scale-100"
              />
            ) : (
              <Search
                size={20}
                strokeWidth={2.5}
                className={`transition-transform duration-300 ${effectiveTab === 'search' ? 'scale-105' : 'scale-100'}`}
              />
            )}
            <span className="text-sm font-semibold tracking-wide pointer-events-none">
              {customMode
                ? customActions.left?.label || t('cancel', 'Cancel')
                : effectiveWaitingMode
                  ? t('cancel', 'Cancel')
                  : t('tabSearch', 'Rechercher')}
            </span>
          </button>

          {/* Bouton Proposer */}
          {!singleAction && (
            <button
              type="button"
              data-role="bottomnav-propose-button"
              onClick={() => {
                if (customMode) {
                  customActions.right?.onClick?.();
                  return;
                }
                if (waitingMode) {
                  onRenewPress?.();
                  return;
                }
                if (activeTab !== 'propose') {
                  activateTab('propose');
                  return;
                }
                if (publishDisabled) {
                  showPublishHint();
                  onPublishDisabledPress?.();
                  return;
                }
                if (onProposePress) onProposePress();
                else activateTab('propose');
              }}
              // Bloque le menu contextuel (clic long)
              onContextMenu={(e) => e.preventDefault()}
              // ⚡️ CRUCIAL : touchAction: 'none' désactive le scroll/zoom sur le bouton
              // ⚡️ userSelect: 'none' empêche la sélection de texte (l'effet "div bleue")
              style={{ 
                touchAction: 'none', 
                WebkitTapHighlightColor: 'transparent',
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none'
              }}
              className={`
                flex-1 relative z-20 flex items-center justify-center gap-2 h-12 rounded-full transition-colors duration-300
                outline-none focus:outline-none cursor-pointer
                ${effectiveTab === 'propose' ? 'text-white' : 'text-gray-500 hover:text-gray-700'}
              `}
            >
              {publishHintOpen && publishDisabled ? (
                <div className="absolute -top-[64px] left-1/2 -translate-x-1/2 z-[60] pointer-events-none">
                  <div className="relative rounded-2xl border border-white/60 bg-white/90 backdrop-blur-xl px-3 py-2 shadow-[0_16px_40px_rgba(15,23,42,0.18)]">
                    <span
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2.5 w-2.5 rotate-45 bg-white/90 border-b border-r border-white/60"
                      aria-hidden="true"
                    />
                    <div className="flex items-center gap-2">
                      <span
                        className="h-5 w-5 rounded-full bg-gradient-to-br from-orange-500 to-amber-400 text-white text-[11px] font-extrabold flex items-center justify-center shadow"
                        aria-hidden="true"
                      >
                        ?
                      </span>
                      <span className="text-[12px] font-semibold text-slate-800 whitespace-nowrap">
                        {t('publishNeedVehicle', 'Ajoute un véhicule pour publier')}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
              {customMode ? (
                customActions.right?.icon
                  ? React.createElement(customActions.right.icon, { size: 20, strokeWidth: 2.5 })
                  : null
              ) : effectiveWaitingMode ? (
                <RotateCw
                  size={20}
                  strokeWidth={2.5}
                  className={`transition-transform duration-300 ${effectiveTab === 'propose' ? 'scale-105' : 'scale-100'}`}
                />
              ) : effectiveTab === 'propose' ? (
                <Send
                  size={20}
                  strokeWidth={2.5}
                  className={`transition-transform duration-300 scale-105 ${shouldPulsePublish ? 'publish-pulse' : ''}`}
                />
              ) : (
                <HandCoins size={20} strokeWidth={2.5} className="transition-transform duration-300 scale-100" />
              )}
              <span className={`text-sm font-semibold tracking-wide pointer-events-none ${shouldPulsePublish ? 'publish-pulse' : ''}`}>
                {customMode
                  ? customActions.right?.label || t('arrivedQuestion', 'Arrived ?')
                  : effectiveWaitingMode
                    ? t('renew', 'Renew')
                    : effectiveTab === 'propose'
                      ? t('publish', 'Publish')
                      : t('tabPropose', 'Proposer')}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BottomNav;
