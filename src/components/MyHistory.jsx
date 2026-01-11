import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Clock, History, Share, X } from 'lucide-react';

const MyHistory = ({ transactions = [], user, isDark = false, iconStyle, onCollapse }) => {
  const { t } = useTranslation('common');
  const [showHistory, setShowHistory] = useState(false);
  const [closingHistory, setClosingHistory] = useState(false);

  useEffect(() => {
    if (showHistory) setClosingHistory(false);
  }, [showHistory]);

  const closeWithAnim = (setClosing, setShow) => {
    setClosing(true);
    setTimeout(() => {
      setShow(false);
      setClosing(false);
    }, 260);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          onCollapse?.();
          setShowHistory(true);
        }}
        className={`w-full p-4 flex items-center justify-between text-left transition ${
          isDark ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100' : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
        }`}
      >
        <div className="flex items-center space-x-3">
          <div className="bg-white p-2 rounded-lg border border-gray-100">
            <History size={20} style={iconStyle ? iconStyle('history') : undefined} />
          </div>
          <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
            {t('historyTitle', { defaultValue: 'Historique' })}
          </span>
        </div>
        <ArrowRight size={16} className={isDark ? 'text-slate-500' : 'text-gray-300'} />
      </button>

      {showHistory && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${
            closingHistory ? 'bg-black/0' : 'bg-black/30 backdrop-blur-sm'
          }`}
          onClick={() => closeWithAnim(setClosingHistory, setShowHistory)}
        >
          <div
            className={`
              bg-white/90 backdrop-blur-xl border border-white/20 
              rounded-3xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]
              ${closingHistory ? 'animate-[modalOut_0.2s_ease_forwards] scale-95 opacity-0' : 'animate-[modalIn_0.3s_ease-out] scale-100 opacity-100'}
            `}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 pb-3">
              <div className="flex items-center space-x-3">
                <div className="bg-white p-2 rounded-lg border border-gray-100">
                  <History size={20} style={iconStyle ? iconStyle('history') : undefined} />
                </div>
                <span className="text-base font-medium text-gray-900">
                  {t('historyTitle', { defaultValue: 'Historique' })}
                </span>
              </div>
              <button
                onClick={() => closeWithAnim(setClosingHistory, setShowHistory)}
                className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors text-gray-500"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
              {transactions.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400 space-y-2">
                  <Clock size={48} className="opacity-20" />
                  <p className="text-sm font-medium">{t('noTransactions', 'Aucune transaction.')}</p>
                </div>
              )}

              {transactions.map((tx) => {
                const meName = String(user?.displayName || '').trim();
                const hostName = String(tx.hostName || '').trim();
                const bookerName = String(tx.bookerName || '').trim();
                const isMeHost = hostName && hostName.toLowerCase() === meName.toLowerCase();
                const isMeBooker = bookerName && bookerName.toLowerCase() === meName.toLowerCase();

                let displayTitle = t('unknown', 'Inconnu');
                let isIncoming = false;

                if (isMeHost) {
                  displayTitle = bookerName || t('unknown', 'Inconnu');
                  isIncoming = true;
                } else if (isMeBooker) {
                  displayTitle = hostName || t('unknown', 'Inconnu');
                  isIncoming = false;
                } else {
                  displayTitle = `${bookerName} ➜ ${hostName}`;
                }

                return (
                  <div
                    key={tx.id}
                    className="group flex items-center justify-between p-3 rounded-2xl transition-colors cursor-default hover:bg-orange-400/10 active:bg-orange-400/10 focus-within:bg-orange-400/10"
                  >
                    <div className="flex items-center space-x-4">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm ring-1 ring-inset ${
                          isIncoming
                            ? 'bg-orange-500/15 text-orange-600 ring-orange-500/20'
                            : 'bg-gray-900/5 text-gray-900 ring-gray-900/10'
                        }`}
                      >
                        {isIncoming ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                      </div>

                      <div className="flex flex-col">
                        <span className="text-base font-semibold text-gray-900 leading-tight">
                          {displayTitle}
                        </span>
                        <span className="text-xs text-gray-400 font-medium">
                          {tx.createdAt?.toDate
                            ? tx.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : tx.createdAt?.toString?.() || ''}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end space-y-0.5">
                      <span
                        className={`text-base font-bold tracking-tight tabular-nums ${
                          isIncoming ? 'text-orange-600' : 'text-gray-900'
                        }`}
                      >
                        {isIncoming ? '+' : ''}{tx.amount != null ? `${tx.amount} €` : ''}
                      </span>

                      <div className="flex items-center space-x-2">
                        {tx.status === 'completed' ? (
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">
                            {tx.status}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400 capitalize">{tx.status}</span>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const body = `ParkSwap: ${displayTitle} - ${tx.amount}€`;
                            if (navigator.share) {
                              navigator.share({ title: 'ParkSwap', text: body }).catch(() => {});
                            } else {
                              navigator.clipboard.writeText(body);
                            }
                          }}
                          className="text-gray-300 hover:text-orange-600 transition-colors p-1"
                        >
                          <Share size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MyHistory;
