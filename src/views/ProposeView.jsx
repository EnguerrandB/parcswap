// src/views/ProposeView.jsx
import React, { useState, useEffect } from 'react';
import { Car, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MOCK_CARS, formatPrice } from '../constants';
import WaitingView from './WaitingView';

const ProposeView = ({ myActiveSpot, onProposeSpot, onConfirmPlate, onCancelSpot, onRenewSpot, vehicles = [] }) => {
  const { t } = useTranslation('common');
  const formatPlate = (value) => {
    const cleaned = (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let letters1 = '';
    let digits = '';
    let letters2 = '';
    for (const ch of cleaned) {
      if (letters1.length < 2 && /[A-Z]/.test(ch)) {
        letters1 += ch;
        continue;
      }
      if (letters1.length === 2 && digits.length < 3 && /[0-9]/.test(ch)) {
        digits += ch;
        continue;
      }
      if (letters1.length === 2 && digits.length === 3 && letters2.length < 2 && /[A-Z]/.test(ch)) {
        letters2 += ch;
      }
    }
    return [letters1, digits, letters2].filter(Boolean).join('-');
  };
  const isFullPlate = (plate) => /^[A-Z]{2}-\d{3}-[A-Z]{2}$/.test(plate || '');
  const firstVehicle = vehicles.find((v) => v.isDefault) || vehicles[0];
  const [proposeForm, setProposeForm] = useState({
    car: firstVehicle?.model || MOCK_CARS[0].model,
    time: 5,
    price: 5,
    length: 5,
  });
  const [plateInput, setPlateInput] = useState('');
  const [remainingMs, setRemainingMs] = useState(null);

  useEffect(() => {
    const next = vehicles.find((v) => v.isDefault) || vehicles[0];
    if (next?.model) {
      setProposeForm((prev) => ({ ...prev, car: next.model }));
    }
  }, [vehicles]);

  useEffect(() => {
    if (
      !myActiveSpot?.status ||
      (myActiveSpot.status !== 'available' && myActiveSpot.status !== 'expired')
    ) {
      setRemainingMs(null);
      return;
    }
    const startedAt = myActiveSpot.createdAt?.toMillis
      ? myActiveSpot.createdAt.toMillis()
      : typeof myActiveSpot.createdAt === 'number'
        ? myActiveSpot.createdAt
        : Date.now();
    const durationMs = (myActiveSpot.time ?? 5) * 60_000;
    const update = () => {
      const left = startedAt + durationMs - Date.now();
      setRemainingMs(Math.max(0, left));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [myActiveSpot]);

  if (myActiveSpot) {
    return (
      <WaitingView
        myActiveSpot={myActiveSpot}
        remainingMs={remainingMs}
        onCancel={onCancelSpot}
        onRenew={onRenewSpot}
        onConfirmPlate={onConfirmPlate}
      />
    );
  }

  // --- Formulaire par défaut ---
  return (
    <div
      className="h-full flex flex-col bg-white px-6 pb-8 pt-20 overflow-hidden relative app-surface"
      style={{ touchAction: 'pan-x' }}
    >
      <div className="flex items-center space-x-2 text-orange-500 uppercase tracking-[0.15em] text-[11px] font-semibold -mt-4 mb-2">
        <div className="w-9 h-9 rounded-full bg-orange-50 border border-orange-100 shadow-sm flex items-center justify-center text-lg leading-none">
          🚗
        </div>
        <span className="-translate-y-[1px]">{t('liveNearby', 'Live nearby')}</span>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6 mt-1">{t('leavingTitle', 'Leaving my spot')}</h2>

      <div className="space-y-6">
        {/* Car */}
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-2">{t('myCarLabel', 'My Car')}</label>
          <div className="w-full overflow-x-auto no-scrollbar -mx-2 px-2 pb-2 touch-pan-x">
            <div className="flex space-x-3 pr-10 snap-x snap-mandatory">
              {vehicles.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setProposeForm({ ...proposeForm, car: v.model })}
                  className={`min-w-[190px] snap-start shrink-0 p-4 rounded-2xl border-2 text-left transition ${
                    proposeForm.car === v.model
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <Car
                    className={`mb-2 ${
                      proposeForm.car === v.model ? 'text-orange-500' : 'text-gray-400'
                    }`}
                  />
                  <p className="font-semibold text-sm">{v.model}</p>
                  <p className="text-xs text-gray-400">{v.plate}</p>
                </button>
              ))}
            {vehicles.length === 0 && (
              MOCK_CARS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setProposeForm({ ...proposeForm, car: c.model })}
                  className={`min-w-[190px] snap-start shrink-0 p-4 rounded-2xl border-2 text-left transition ${
                    proposeForm.car === c.model
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <Car
                    className={`mb-2 ${
                      proposeForm.car === c.model ? 'text-orange-500' : 'text-gray-400'
                    }`}
                  />
                  <p className="font-semibold text-sm">{c.model}</p>
                  <p className="text-xs text-gray-400">{c.plate}</p>
                </button>
              ))
            )}
            </div>
          </div>
        </div>

        {/* Time */}
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-2">{t('leavingInLabel', 'Leaving in')}</label>
          <div className="flex items-center space-x-4 bg-gray-50 p-4 rounded-xl">
            <Clock className="text-orange-500" />
            <input
              type="range"
              min="1"
              max="30"
              value={proposeForm.time}
              onChange={(e) =>
                setProposeForm({ ...proposeForm, time: parseInt(e.target.value, 10) })
              }
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
            />
            <span className="font-bold text-lg w-16 text-right">
              {t('minutes', { count: proposeForm.time, defaultValue: '{{count}} minutes' })}
            </span>
          </div>
        </div>

        {/* Price */}
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-2">{t('askingPrice', 'Asking Price')}</label>
          <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl">
            <button
              onClick={() =>
                setProposeForm((prev) => ({ ...prev, price: Math.max(0, prev.price - 1) }))
              }
              className="w-8 h-8 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 shadow text-white font-bold text-xl flex items-center justify-center hover:scale-105 transition"
            >
              -
            </button>
            <span className="text-3xl font-bold text-gray-900">{formatPrice(proposeForm.price)}</span>
            <button
              onClick={() =>
                setProposeForm((prev) => ({ ...prev, price: prev.price + 1 }))
              }
              className="w-8 h-8 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 shadow text-white font-bold text-xl flex items-center justify-center hover:scale-105 transition"
            >
              +
            </button>
          </div>
        </div>

        {/* Length */}
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-2">{t('spotLengthLabel', 'Length of the spot')}</label>
          <div className="flex items-center space-x-4 bg-gray-50 p-4 rounded-xl">
            <Car className="text-orange-500" />
            <input
              type="range"
              min="4"
              max="6"
              step="0.5"
              value={proposeForm.length}
              onChange={(e) =>
                setProposeForm({ ...proposeForm, length: parseFloat(e.target.value) })
              }
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
            />
            <span className="font-bold text-lg w-16 text-right">
              {t('lengthValue', { value: proposeForm.length, defaultValue: '{{value}} meters' })}
            </span>
          </div>
        </div>
      </div>

      <div
        className="fixed left-0 right-0 px-6 pb-6 pt-3 bg-gradient-to-t from-white via-white/90 to-white/40 z-40 propose-publish-bar"
        style={{ bottom: 'var(--bottom-safe-offset, 96px)' }} // sit just above bottom nav
      >
        <button
          onClick={() => onProposeSpot(proposeForm)}
          className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white py-4 rounded-xl font-bold shadow-lg hover:scale-[1.01] transition text-lg flex items-center justify-center space-x-2"
        >
          <span>{t('publishSpot', 'Publish Spot')}</span>
        </button>
      </div>
    </div>
  );
};

export default ProposeView;
