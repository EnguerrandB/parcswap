// src/components/BottomNav.jsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search, HandCoins, User } from 'lucide-react';

const BottomNav = ({ activeTab, setActiveTab }) => {
  const { t } = useTranslation('common');

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[300] flex justify-center pointer-events-none"
      data-role="bottom-nav-wrapper"
      style={{ height: 'var(--bottom-nav-height, auto)' }}
    >
      <div
        id="bottom-nav"
        data-role="bottom-nav"
        className="pointer-events-auto w-full max-w-md bg-white border-t border-gray-200 flex justify-around items-center p-4 h-20 pb-[calc(env(safe-area-inset-bottom)+8px)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]"
      >
        <button
          onClick={() => setActiveTab('search')}
          className={`flex flex-col items-center space-y-1 ${activeTab === 'search' ? 'text-orange-600' : 'text-gray-400'}`}
        >
          <div className={`p-1 rounded-xl transition-all ${activeTab === 'search' ? 'bg-orange-50' : ''}`}>
            <Search
              size={28}
              strokeWidth={activeTab === 'search' ? 3 : 2}
              className={activeTab === 'search' ? 'text-orange-600' : 'text-gray-400'}
            />
          </div>
          <span className={`text-xs font-medium ${activeTab === 'search' ? 'text-orange-600' : 'text-gray-400'}`}>
            {t('tabSearch', 'Search')}
          </span>
        </button>

        <button
          id="propose-tab-button"
          onClick={() => setActiveTab('propose')}
          className={`flex flex-col items-center space-y-1 ${activeTab === 'propose' ? 'text-orange-600' : 'text-gray-400'}`}
        >
          <div className="bg-orange-100 p-3 rounded-full -mt-8 border-4 border-white shadow-lg transform transition active:scale-95">
            <HandCoins size={28} className="text-orange-600" strokeWidth={2.5} />
          </div>
          <span className="text-xs font-medium mt-1">{t('tabPropose', 'Propose')}</span>
        </button>

        <button
          onClick={() => setActiveTab('profile')}
          className={`flex flex-col items-center space-y-1 ${activeTab === 'profile' ? 'text-orange-600' : 'text-gray-400'}`}
        >
          <div className={`p-1 rounded-xl transition-all ${activeTab === 'profile' ? 'bg-orange-50' : ''}`}>
            <User
              size={28}
              strokeWidth={activeTab === 'profile' ? 3 : 2}
              className={activeTab === 'profile' ? 'text-orange-600' : 'text-gray-400'}
            />
          </div>
          <span className={`text-xs font-medium ${activeTab === 'profile' ? 'text-orange-600' : 'text-gray-400'}`}>
            {t('tabProfile', 'Account')}
          </span>
        </button>
      </div>
    </div>
  );
};

export default BottomNav;
