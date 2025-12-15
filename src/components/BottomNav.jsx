// src/components/BottomNav.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, HandCoins } from 'lucide-react';

const BottomNav = ({ activeTab, setActiveTab }) => {
  const { t } = useTranslation('common');

  // Définition des styles pour éviter la répétition
  // Active : Fond orange vibrant, texte blanc, ombre colorée (Glow), pas de transparence
  const activeStyle = "bg-orange-500 text-white shadow-[0_4px_14px_0_rgba(249,115,22,0.35)] scale-100 font-semibold";
  
  // Inactive : Gris discret, fond transparent, effet de réduction au clic
  const inactiveStyle = "text-gray-400 hover:bg-gray-50/50 font-medium active:scale-95";

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[300] flex justify-center pointer-events-none pb-[calc(env(safe-area-inset-bottom)+24px)]"
      data-role="bottom-nav-wrapper"
    >
      <div
        id="bottom-nav"
        className="
          pointer-events-auto 
          flex items-center p-2 gap-3
          bg-white/80 backdrop-blur-2xl 
          border border-white/50 
          shadow-[0_8px_32px_rgba(0,0,0,0.12)]
          rounded-full
          w-[90%] max-w-[320px]
          transition-all duration-300
        "
      >
        {/* Bouton Recherche */}
        <button
          onClick={() => setActiveTab('search')}
          className={`
            flex-[1.2] flex items-center justify-center gap-2.5 h-12 rounded-full transition-all duration-300 ease-out
            ${activeTab === 'search' ? activeStyle : inactiveStyle}
          `}
        >
          <Search 
            size={20} 
            strokeWidth={activeTab === 'search' ? 2.5 : 2} 
          />
          <span className="text-sm tracking-wide">{t('tabSearch', 'Rechercher')}</span>
        </button>

        {/* Bouton Proposer */}
        <button
          onClick={() => setActiveTab('propose')}
          className={`
            flex-[1.2] flex items-center justify-center gap-2.5 h-12 rounded-full transition-all duration-300 ease-out
            ${activeTab === 'propose' ? activeStyle : inactiveStyle}
          `}
        >
          <HandCoins 
            size={20} 
            strokeWidth={activeTab === 'propose' ? 2.5 : 2} 
          />
          <span className="text-sm tracking-wide">{t('tabPropose', 'Proposer')}</span>
        </button>
      </div>
    </div>
  );
};

export default BottomNav;
