// src/views/ProposeView.jsx
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Car, Clock, Euro, Plus, Ruler, WifiOff, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MOCK_CARS } from '../constants';
import WaitingView from './WaitingView';
import useConnectionQuality from '../hooks/useConnectionQuality';

const ProposeView = forwardRef(({
  myActiveSpot,
  onProposeSpot,
  onConfirmPlate,
  onCancelSpot,
  onRenewSpot,
  onNudgeAddVehicle,
  renewFeedbackId = 0,
  renewWaveDurationMs = 650,
  vehicles = [],
}, ref) => {
  const { t } = useTranslation('common');
  const { isOnline, isPoorConnection } = useConnectionQuality();
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
    car: firstVehicle?.model || '',
    time: 5,
    price: 5,
    length: 5,
  });
  const [plateInput, setPlateInput] = useState('');
  const [remainingMs, setRemainingMs] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [titleFlash, setTitleFlash] = useState(false);
  const [vehicleIconSwapFor, setVehicleIconSwapFor] = useState(null);
  const titleFlashTimerRef = useRef(null);
  const timeSliderRef = useRef(null);
  const priceSliderRef = useRef(null);
  const lengthSliderRef = useRef(null);

  const publishSpot = async () => {
    if (publishing) return;
    if (!isOnline) {
      setPublishError(t('offlineTitle', { defaultValue: 'No connection' }));
      return;
    }
    if (!vehicles.length) {
      onNudgeAddVehicle?.();
      return;
    }
    setPublishError('');
    setPublishing(true);
    const selected =
      vehicles.find((v) => v.model === proposeForm.car) ||
      vehicles.find((v) => v.isDefault) ||
      vehicles[0] ||
      null;
    try {
      await onProposeSpot?.({
        ...proposeForm,
        vehiclePlate: selected?.plate || null,
        vehicleId: selected?.id || null,
      });
    } catch (err) {
      const code = err?.code || err?.message;
      if (code === 'active_spot_exists') {
        setPublishError(
          t(
            'publishBlockedActiveSpot',
            'Tu as déjà une place publiée. Annule-la ou renouvelle-la avant d’en publier une autre.',
          ),
        );
      } else {
        setPublishError(t('publishFailed', "Impossible de publier la place. Réessaie."));
      }
    } finally {
      setPublishing(false);
    }
  };

  useImperativeHandle(ref, () => ({ publish: publishSpot }), [publishSpot]);

  const flashTitle = () => {
    setTitleFlash(true);
    if (titleFlashTimerRef.current) window.clearTimeout(titleFlashTimerRef.current);
    titleFlashTimerRef.current = window.setTimeout(() => setTitleFlash(false), 1000);
  };

  useEffect(() => {
    return () => {
      if (titleFlashTimerRef.current) window.clearTimeout(titleFlashTimerRef.current);
      titleFlashTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!vehicleIconSwapFor) return undefined;
    const onDown = (e) => {
      const withinToggle = e.target?.closest?.('[data-vehicle-icon-toggle="1"]');
      if (withinToggle) return;
      setVehicleIconSwapFor(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [vehicleIconSwapFor]);

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
        onCancel={null}
        onRenew={null}
        onConfirmPlate={onConfirmPlate}
        renewFeedbackId={renewFeedbackId}
        renewWaveDurationMs={renewWaveDurationMs}
      />
    );
  }

  // --- Formulaire par défaut ---
  const startRangeDrag = (e, ref, min, max, step, setter, key) => {
    if (!ref?.current) return;
    e.preventDefault();
    const updateValue = (clientX) => {
      const rect = ref.current.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const raw = min + pct * (max - min);
      const value = Math.round(raw / step) * step;
      setter((prev) => ({ ...prev, [key]: value }));
      ref.current.value = value;
    };
    updateValue(e.clientX);
    const onMove = (ev) => updateValue(ev.clientX);
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const isFreePrice = Number(proposeForm.price) === 0;
  const handleVehicleIconClick = (id) => {
    if (vehicleIconSwapFor === id) {
      onNudgeAddVehicle?.();
      setVehicleIconSwapFor(null);
      return;
    }
    setVehicleIconSwapFor(id);
  };

  return (
    <div
      className="h-full flex flex-col bg-gray-50 px-6 pt-[calc(env(safe-area-inset-top)+16px)] overflow-y-auto overflow-x-hidden relative app-surface pb-[calc(env(safe-area-inset-bottom)+90px)]"
      style={{ touchAction: 'auto' }}
    >
      <h2
        className={`text-2xl font-bold mb-6 text-center select-none ${
          titleFlash ? 'text-orange-500' : 'text-gray-900'
        }`}
        style={{ WebkitTapHighlightColor: 'transparent', WebkitUserSelect: 'none', userSelect: 'none' }}
        onClick={flashTitle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') flashTitle();
        }}
      >
        {titleFlash ? t('leavingTitleNow', 'Now ?') : t('leavingTitle', 'Leaving my spot')}
      </h2>
      {isOnline && isPoorConnection ? (
        <div className="mb-4">
          <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-amber-200/70 bg-amber-50/90 text-amber-800 text-sm shadow-sm backdrop-blur">
            <Wifi size={16} className="text-amber-700" />
            {t('poorConnectionWarning', { defaultValue: 'Slow connection. Some actions may take longer.' })}
          </div>
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="space-y-6">
          {/* Car */}
          <div>
            {vehicles.length > 0 ? (
              vehicles.length === 1 ? (
                <div className="w-full">
                  <div className="w-full flex items-center justify-between px-4 py-3 rounded-[2rem] border border-gray-100 bg-white/80 shadow-sm backdrop-blur">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        data-vehicle-icon-toggle="1"
                        onClick={() => handleVehicleIconClick('single')}
                        className="w-10 h-10 flex items-center justify-center bg-orange-50 rounded-full text-orange-500 shadow-sm shadow-orange-100/50 transition-transform duration-200 ease-out active:scale-95 shrink-0"
                        aria-label={t('addVehicle', 'Add vehicle')}
                      >
                        {vehicleIconSwapFor === 'single' ? (
                          <Plus size={20} strokeWidth={2.8} className="text-orange-500" />
                        ) : (
                          <Car size={20} strokeWidth={2.5} />
                        )}
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-semibold text-sm text-gray-900 truncate">
                            {vehicles[0]?.model || t('unknown', 'Unknown')}
                          </span>
                          <span className="text-xs text-gray-500 font-mono tracking-widest truncate">
                            {vehicles[0]?.plate || '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                </div>
              </div>
            ) : (
              <div className="w-full overflow-x-auto no-scrollbar touch-pan-x">
                <div className="flex space-x-3 snap-x snap-mandatory">
                  {vehicles.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setProposeForm({ ...proposeForm, car: v.model })}
                      className={`min-w-[190px] snap-start shrink-0 p-4 rounded-[2rem] border text-left transition shadow-sm backdrop-blur ${
                        proposeForm.car === v.model
                          ? 'border-orange-200 bg-orange-50/60 ring-1 ring-orange-200/40'
                          : 'border-gray-100 bg-white/80 hover:border-gray-200'
                      }`}
                    >
                      <button
                        type="button"
                        data-vehicle-icon-toggle="1"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleVehicleIconClick(String(v.id || v.model || 'vehicle'));
                        }}
                        className="w-10 h-10 flex items-center justify-center bg-orange-50 rounded-full shadow-sm shadow-orange-100/50 transition-transform duration-200 ease-out active:scale-95 mb-2"
                        aria-label={t('addVehicle', 'Add vehicle')}
                      >
                        {vehicleIconSwapFor === String(v.id || v.model || 'vehicle') ? (
                          <Plus size={20} strokeWidth={2.8} className="text-orange-500" />
                        ) : (
                          <Car
                            size={20}
                            strokeWidth={2.5}
                            className={`${proposeForm.car === v.model ? 'text-orange-500' : 'text-gray-400'}`}
                          />
                        )}
                      </button>
                      <p className="font-semibold text-sm">{v.model}</p>
                      <p className="text-xs text-gray-400">{v.plate}</p>
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : (
            <button
              type="button"
              onClick={() => onNudgeAddVehicle?.()}
              className="w-full text-left"
            >
              <div className="w-full flex items-center justify-between px-4 py-3 rounded-[2rem] border border-gray-100 bg-white/80 shadow-sm backdrop-blur">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 flex items-center justify-center bg-orange-50 rounded-full text-orange-500 shadow-sm shadow-orange-100/50 transition-transform duration-200 ease-out active:scale-95 shrink-0">
                    <Car size={20} strokeWidth={2.5} className="text-orange-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="font-semibold text-sm text-gray-900 truncate">
                        {t('addVehicle', 'Add vehicle')}
                      </span>
                      <span className="text-xs text-gray-500 font-mono tracking-widest truncate">
                        —
                      </span>
                    </div>
                  </div>
                </div>
                <div
                  className="shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-orange-500 to-amber-400 text-white text-sm font-extrabold flex items-center justify-center shadow"
                  aria-hidden="true"
                >
                  +
                </div>
              </div>
            </button>
          )}
        </div>

          {/* Time - Modern Apple-like Card */}
          <div className="bg-white p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 relative overflow-hidden group">
          
          {/* Header: Label & Value */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center bg-orange-50 rounded-full text-orange-500 shadow-sm shadow-orange-100/50 transition-transform duration-200 ease-out active:scale-95 [@media(hover:hover)]:group-hover:scale-105">
                <Clock size={20} strokeWidth={2.5} />
              </div>
              <label className="text-gray-600 font-semibold text-[15px] tracking-wide">
                {t('leavingInLabel', 'Leaving in')}
              </label>
            </div>
            
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 tracking-tight font-sans">
                {proposeForm.time}
              </span>
              <span className="text-sm font-bold text-gray-400 uppercase tracking-wider translate-y-[-2px]">
                min
              </span>
            </div>
          </div>

          {/* Slider */}
          <div className="relative h-10 flex items-center px-1">
            <input
              ref={timeSliderRef}
              type="range"
              min="1"
              max="30"
              value={proposeForm.time}
              onPointerDown={(e) => startRangeDrag(e, timeSliderRef, 1, 30, 1, setProposeForm, 'time')}
              onChange={(e) =>
                setProposeForm({ ...proposeForm, time: parseInt(e.target.value, 10) })
              }
              // Astuce pour l'effet de progression (remplissage à gauche)
              style={{
                backgroundSize: `${((proposeForm.time - 1) * 100) / 29}% 100%`
              }}
              className="
                relative w-full h-2.5 bg-gray-100 rounded-full appearance-none cursor-pointer touch-none
                bg-[image:linear-gradient(to_right,#f97316,#f97316)] bg-no-repeat
                focus:outline-none focus:ring-0
                
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-7
                [&::-webkit-slider-thumb]:h-7
                [&::-webkit-slider-thumb]:bg-white
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:shadow-[0_4px_12px_rgba(0,0,0,0.15),0_0_0_1px_rgba(0,0,0,0.05)]
                [&::-webkit-slider-thumb]:border-0
                [&::-webkit-slider-thumb]:transition-transform
                [&::-webkit-slider-thumb]:duration-150
                [&::-webkit-slider-thumb]:ease-out
                [&::-webkit-slider-thumb]:hover:scale-110
                [&::-webkit-slider-thumb]:active:scale-95
              "
            />
            {/* Indicateurs Min/Max */}
            <div className="absolute top-8 left-1 text-[11px] font-semibold text-gray-300 pointer-events-none select-none">
              1 min
            </div>
            <div className="absolute top-8 right-1 text-[11px] font-semibold text-gray-300 pointer-events-none select-none">
              30 min
            </div>
          </div>
        </div>
        </div>
        
        {/* Price - Same logic/design as "Leaving in" */}
        <div
          className={`price-card-surface p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden group ${
            isFreePrice ? 'price-gold-surface' : ''
          }`}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 flex items-center justify-center rounded-full shadow-sm transition-transform duration-200 ease-out active:scale-95 [@media(hover:hover)]:group-hover:scale-105 ${
                  isFreePrice
                    ? 'bg-white/45 text-slate-900 shadow-none ring-1 ring-black/55'
                    : 'bg-orange-50 text-orange-500 shadow-orange-100/50'
                }`}
              >
                <Euro size={20} strokeWidth={2.5} />
              </div>
              <label className={`${isFreePrice ? 'text-slate-900' : 'text-gray-600'} font-semibold text-[15px] tracking-wide`}>
                {t('askingPrice', 'Asking Price')}
              </label>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-4xl font-bold tracking-tight font-sans ${
                  isFreePrice ? 'text-white drop-shadow-[0_12px_26px_rgba(0,0,0,0.22)]' : 'text-gray-900'
                }`}
              >
                {proposeForm.price}
              </span>
              <span className={`text-sm font-bold uppercase tracking-wider translate-y-[-2px] ${isFreePrice ? 'text-white/80' : 'text-gray-400'}`}>
                €
              </span>
            </div>
          </div>

          <div className="relative h-10 flex items-center px-1">
            <input
              ref={priceSliderRef}
              type="range"
              min="0"
              max="20"
              step="1"
              value={proposeForm.price}
              onPointerDown={(e) => startRangeDrag(e, priceSliderRef, 0, 20, 1, setProposeForm, 'price')}
              onChange={(e) => setProposeForm((prev) => ({ ...prev, price: parseInt(e.target.value, 10) }))}
              style={{
                backgroundSize: `${(Math.max(0, Math.min(20, proposeForm.price)) * 100) / 20}% 100%`,
              }}
              className="
                relative w-full h-2.5 bg-gray-100 rounded-full appearance-none cursor-pointer touch-none
                bg-[image:linear-gradient(to_right,#f97316,#f97316)] bg-no-repeat
                focus:outline-none focus:ring-0
                
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-7
                [&::-webkit-slider-thumb]:h-7
                [&::-webkit-slider-thumb]:bg-white
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:shadow-[0_4px_12px_rgba(0,0,0,0.15),0_0_0_1px_rgba(0,0,0,0.05)]
                [&::-webkit-slider-thumb]:border-0
                [&::-webkit-slider-thumb]:transition-transform
                [&::-webkit-slider-thumb]:duration-150
                [&::-webkit-slider-thumb]:ease-out
                [&::-webkit-slider-thumb]:hover:scale-110
                [&::-webkit-slider-thumb]:active:scale-95
              "
            />
            <div className="absolute top-8 left-1 text-[11px] font-semibold text-gray-300 pointer-events-none select-none">
              0 €
            </div>
            <div className="absolute top-8 right-1 text-[11px] font-semibold text-gray-300 pointer-events-none select-none">
              20 €
            </div>
          </div>
        </div>

        {/* Length - Same style as "Leaving in" */}
        <div className="bg-white p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 relative overflow-hidden group">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center bg-orange-50 rounded-full text-orange-500 shadow-sm shadow-orange-100/50 transition-transform duration-200 ease-out active:scale-95 [@media(hover:hover)]:group-hover:scale-105">
                <Ruler size={20} strokeWidth={2.5} />
              </div>
              <label className="text-gray-600 font-semibold text-[15px] tracking-wide">
                {t('spotLengthLabel', 'Length of the spot')}
              </label>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 tracking-tight font-sans">
                {proposeForm.length}
              </span>
              <span className="text-sm font-bold text-gray-400 uppercase tracking-wider translate-y-[-2px]">
                m
              </span>
            </div>
          </div>

          <div className="relative h-10 flex items-center px-1">
            <input
              ref={lengthSliderRef}
              type="range"
              min="4"
              max="6"
              step="0.5"
              value={proposeForm.length}
              onPointerDown={(e) => startRangeDrag(e, lengthSliderRef, 4, 6, 0.5, setProposeForm, 'length')}
              onChange={(e) => setProposeForm({ ...proposeForm, length: parseFloat(e.target.value) })}
              style={{
                backgroundSize: `${((proposeForm.length - 4) * 100) / 2}% 100%`,
              }}
              className="
                relative w-full h-2.5 bg-gray-100 rounded-full appearance-none cursor-pointer touch-none
                bg-[image:linear-gradient(to_right,#f97316,#f97316)] bg-no-repeat
                focus:outline-none focus:ring-0
                
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-7
                [&::-webkit-slider-thumb]:h-7
                [&::-webkit-slider-thumb]:bg-white
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:shadow-[0_4px_12px_rgba(0,0,0,0.15),0_0_0_1px_rgba(0,0,0,0.05)]
                [&::-webkit-slider-thumb]:border-0
                [&::-webkit-slider-thumb]:transition-transform
                [&::-webkit-slider-thumb]:duration-150
                [&::-webkit-slider-thumb]:ease-out
                [&::-webkit-slider-thumb]:hover:scale-110
                [&::-webkit-slider-thumb]:active:scale-95
              "
            />
            <div className="absolute top-8 left-1 text-[11px] font-semibold text-gray-300 pointer-events-none select-none">
              4 m
            </div>
            <div className="absolute top-8 right-1 text-[11px] font-semibold text-gray-300 pointer-events-none select-none">
              6 m
            </div>
          </div>
        </div>
      </div>

      {publishError ? (
        <p className="mt-6 text-sm font-semibold text-rose-600 text-center">{publishError}</p>
      ) : null}
	    </div>
	  );
});

export default ProposeView;
