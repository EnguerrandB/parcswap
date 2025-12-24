// src/components/BottomNav.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, HandCoins } from 'lucide-react';

// ==================================================================================
// 🎛️ CONFIGURATION
// ==================================================================================

const HALO_SPREAD = '-inset-0';
const HALO_OPACITY = 0.02;
const HALO_SCALE = 1.05; // Réduit légèrement pour éviter tout dépassement d'écran
const HALO_BLUR_CLASS = 'blur-lg';

// ==================================================================================

const BottomNav = ({ activeTab, setActiveTab }) => {
  const { t } = useTranslation('common');
  
  const activateTab = (tab) => {
    if (setActiveTab) setActiveTab(tab);
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9999] flex justify-center pb-[calc(env(safe-area-inset-bottom)+24px)] pointer-events-auto"
      data-role="bottom-nav-wrapper"
      style={{ transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
    >
      {/* CONTENEUR PRINCIPAL */}
      <div className="relative w-[90%] max-w-[320px] pointer-events-auto">
        
        {/* LE HALO */}
        <div
          className={`
            pointer-events-none absolute rounded-full halo-pulse
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
            relative flex items-center p-1.5
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
            onClick={() => activateTab('search')}
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
              ${activeTab === 'search' ? 'text-white' : 'text-gray-500 hover:text-gray-700'}
            `}
          >
            <Search 
              size={20} 
              strokeWidth={2.5} 
              className={`transition-transform duration-300 ${activeTab === 'search' ? 'scale-105' : 'scale-100'}`} 
            />
            <span className="text-sm font-semibold tracking-wide pointer-events-none">{t('tabSearch', 'Rechercher')}</span>
          </button>

          {/* Bouton Proposer */}
          <button
            type="button"
            onClick={() => activateTab('propose')}
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
              ${activeTab === 'propose' ? 'text-white' : 'text-gray-500 hover:text-gray-700'}
            `}
          >
            <HandCoins 
              size={20} 
              strokeWidth={2.5} 
              className={`transition-transform duration-300 ${activeTab === 'propose' ? 'scale-105' : 'scale-100'}`} 
            />
            <span className="text-sm font-semibold tracking-wide pointer-events-none">{t('tabPropose', 'Proposer')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default BottomNav;
