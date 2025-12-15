// src/components/BottomNav.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, HandCoins } from 'lucide-react';

// ==================================================================================
// 🎛️ ZONE DE CONFIGURATION DU HALO
// ==================================================================================

// Réglages du halo (aligné sur le halo discret du logo)
// Ajustez ici si besoin : plus l'opacité/scale/blur sont bas, plus le halo est diffus.
const HALO_SPREAD = '-inset-0'; // étendue
const HALO_OPACITY = 0.02; // intensité max (0-1)
const HALO_SCALE = 1.01; // 1 = pile la taille du nav
const HALO_BLUR_CLASS = 'blur-lg'; // blur-sm | blur-md | blur-lg

// ==================================================================================

const BottomNav = ({ activeTab, setActiveTab }) => {
  const { t } = useTranslation('common');

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[300] flex justify-center pointer-events-none pb-[calc(env(safe-area-inset-bottom)+24px)]"
      data-role="bottom-nav-wrapper"
    >
      {/* CONTENEUR PRINCIPAL */}
      <div className="relative w-[90%] max-w-[320px]">
        
        {/* =================================================================
           LE HALO (Arrière-plan vibrant)
           Piloté par les variables de configuration ci-dessus
           ================================================================= */}
        <div
          className={`
            absolute rounded-full halo-pulse scale-115
            bg-white/35
            ${HALO_SPREAD}
            ${HALO_BLUR_CLASS}
          `}
          style={{ opacity: HALO_OPACITY, transform: `scale(${HALO_SCALE})` }}
        />

        {/* =================================================================
           LA BARRE DE NAVIGATION (Glassmorphism)
           ================================================================= */}
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
          {/* FOND ACTIF QUI GLISSE (Sliding Pill) */}
          <div
            className={`
              absolute top-1.5 bottom-1.5 rounded-full 
              bg-orange-500 
              shadow-[0_2px_10px_rgba(249,115,22,0.3)]
              transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]
              /* CORRECTION ICI : Largeur ajustée à -9px pour compenser le gap central */
              w-[calc(50%-9px)]
              ${activeTab === 'search' 
                ? 'left-1.5'  /* Start at 6px */
                : 'left-[calc(50%+3px)]' /* Start at 50% + 3px */
              }
            `}
          />

          {/* =================================================================
             BOUTONS (Foreground)
             ================================================================= */}
          
          {/* Bouton Recherche */}
          <button
            onClick={() => setActiveTab('search')}
            className={`
              flex-1 relative z-10 flex items-center justify-center gap-2 h-12 rounded-full transition-colors duration-300
              ${activeTab === 'search' ? 'text-white' : 'text-gray-500 hover:text-gray-700'}
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
            onClick={() => setActiveTab('propose')}
            className={`
              flex-1 relative z-10 flex items-center justify-center gap-2 h-12 rounded-full transition-colors duration-300
              ${activeTab === 'propose' ? 'text-white' : 'text-gray-500 hover:text-gray-700'}
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
