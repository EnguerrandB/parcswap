// src/components/BottomNav.jsx
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, HandCoins } from 'lucide-react';

// ==================================================================================
// 🎛️ ZONE DE CONFIGURATION DU HALO
// ==================================================================================

const HALO_SPREAD = '-inset-0';
const HALO_OPACITY = 0.02;
const HALO_SCALE = 1.01;
const HALO_BLUR_CLASS = 'blur-lg';

// ==================================================================================

const BottomNav = ({ activeTab, setActiveTab }) => {
  const { t } = useTranslation('common');
  
  // Sécurisation de l'appel
  const activateTab = (tab) => {
    if (setActiveTab) setActiveTab(tab);
  };

  const [tapDebug, setTapDebug] = useState(null);
  const tapTimerRef = useRef(null);

  // Debug visuel uniquement (optionnel)
  const showTapDebug = (tab, label) => {
    if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setTapDebug({ tab, label, id });
    tapTimerRef.current = window.setTimeout(() => {
      setTapDebug(null);
      tapTimerRef.current = null;
    }, 650);
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9999] flex justify-center pb-[calc(env(safe-area-inset-bottom)+24px)]"
      data-role="bottom-nav-wrapper"
      // translateZ force l'accélération matérielle sur iOS pour éviter les bugs de 'fixed'
      style={{ transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
    >
      {/* CONTENEUR PRINCIPAL */}
      <div className="relative w-[90%] max-w-[320px]">
        {tapDebug && (
          <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 z-50">
            <div className="px-3 py-1 rounded-full text-xs font-semibold bg-black/70 text-white backdrop-blur">
              {tapDebug.label}: {tapDebug.tab}
            </div>
          </div>
        )}
        
        {/* LE HALO */}
        <div
          className={`
            pointer-events-none absolute rounded-full halo-pulse scale-115
            bg-white/35
            ${HALO_SPREAD}
            ${HALO_BLUR_CLASS}
          `}
          style={{ opacity: HALO_OPACITY, transform: `scale(${HALO_SCALE})` }}
        />

        {/* LA BARRE DE NAVIGATION */}
        <div
          id="bottom-nav"
          className="
            pointer-events-auto relative flex items-center p-1.5
            bg-white/80 backdrop-blur-2xl 
            border border-white/60 
            shadow-[0_8px_32px_rgba(0,0,0,0.12)] 
            rounded-full w-full
            overflow-hidden
          "
        >
          {/* FOND ACTIF QUI GLISSE */}
          <div
            className={`
              pointer-events-none absolute top-1.5 bottom-1.5 rounded-full 
              bg-orange-500 
              shadow-[0_2px_10px_rgba(249,115,22,0.3)]
              transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]
              w-[calc(50%-9px)]
              ${activeTab === 'search' 
                ? 'left-1.5'
                : 'left-[calc(50%+3px)]'
              }
            `}
          />

          {/* =================================================================
             BOUTONS (Foreground)
             ================================================================= */}
          
          {/* Bouton Recherche */}
          <button
            type="button"
            // ✅ CORRECTION MAJEURE : On garde uniquement onClick pour la logique
            onClick={() => activateTab('search')}
            // On garde les événements de debug visuel séparés, mais ils ne déclenchent pas la navigation
            onTouchStart={() => showTapDebug('search', 'tap')}
            // touchAction: manipulation est CRUCIAL sur iOS pour la réactivité (enlève le délai de 300ms)
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
            className={`
              flex-1 relative z-10 flex items-center justify-center gap-2 h-12 rounded-full transition-colors duration-300
              outline-none focus:outline-none select-none cursor-pointer
              ${activeTab === 'search' ? 'text-white' : 'text-gray-500 hover:text-gray-700'}
              ${tapDebug?.tab === 'search' ? 'bg-black/10' : ''}
            `}
          >
            <Search 
              size={20} 
              strokeWidth={2.5} 
              className={`transition-transform duration-300 ${activeTab === 'search' ? 'scale-105' : 'scale-100'}`} 
            />
            <span className="text-sm font-semibold tracking-wide">{t('tabSearch', 'Rechercher')}</span>
          </button>

          {/* Bouton Proposer */}
          <button
            type="button"
            // ✅ CORRECTION MAJEURE : Uniquement onClick
            onClick={() => activateTab('propose')}
            onTouchStart={() => showTapDebug('propose', 'tap')}
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
            className={`
              flex-1 relative z-10 flex items-center justify-center gap-2 h-12 rounded-full transition-colors duration-300
              outline-none focus:outline-none select-none cursor-pointer
              ${activeTab === 'propose' ? 'text-white' : 'text-gray-500 hover:text-gray-700'}
              ${tapDebug?.tab === 'propose' ? 'bg-black/10' : ''}
            `}
          >
            <HandCoins 
              size={20} 
              strokeWidth={2.5} 
              className={`transition-transform duration-300 ${activeTab === 'propose' ? 'scale-105' : 'scale-100'}`} 
            />
            <span className="text-sm font-semibold tracking-wide">{t('tabPropose', 'Proposer')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default BottomNav;