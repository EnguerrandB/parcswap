import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Car } from 'lucide-react';
import {
  PLATE_COUNTRY_OPTIONS,
  formatStoredVehiclePlate,
  formatVehiclePlate,
  getDefaultPlateCountry,
  getPlateCountryMeta,
  inferPlateCountryFromPlate,
  isValidVehiclePlate,
} from '../utils/vehiclePlates';

const MyVehicules = ({
  vehicles = [],
  isDark = false,
  iconStyle,
  onAddVehicle,
  onDeleteVehicle,
  onSelectVehicle,
  onCollapse,
  openAddVehicleRequestId = 0,
  highlightVehiclesRequestId = 0,
}) => {
  const { t, i18n } = useTranslation('common');
  const isRtl = i18n.dir(i18n.resolvedLanguage || i18n.language) === 'rtl';
  const defaultPlateCountry = useMemo(
    () => getDefaultPlateCountry(i18n.resolvedLanguage || i18n.language),
    [i18n.language, i18n.resolvedLanguage],
  );
  const [form, setForm] = useState({ model: '', plate: '', plateCountry: defaultPlateCountry });
  const [formImage, setFormImage] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [closingModal, setClosingModal] = useState(false);
  const vehiclesRowRef = useRef(null);
  const [highlightVehiclesRow, setHighlightVehiclesRow] = useState(false);
  const highlightVehiclesTimerRef = useRef(null);
  const highlightAddVehicleButton = false;
  const lastAddVehicleRequestRef = useRef(0);
  const lastHighlightVehiclesRef = useRef(0);

  useEffect(() => {
    if (showModal) setClosingModal(false);
  }, [showModal]);

  useEffect(() => {
    const id = Number(openAddVehicleRequestId) || 0;
    if (!id) return;
    if (lastAddVehicleRequestRef.current === id) return;
    lastAddVehicleRequestRef.current = id;
    setClosingModal(false);
    setShowModal(true);
  }, [openAddVehicleRequestId]);

  useEffect(() => {
    const id = Number(highlightVehiclesRequestId) || 0;
    if (!id) return;
    if (lastHighlightVehiclesRef.current === id) return;
    lastHighlightVehiclesRef.current = id;

    setHighlightVehiclesRow(true);
    try {
      vehiclesRowRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      void error;
    }

    if (highlightVehiclesTimerRef.current) window.clearTimeout(highlightVehiclesTimerRef.current);
    highlightVehiclesTimerRef.current = window.setTimeout(() => setHighlightVehiclesRow(false), 4200);
  }, [highlightVehiclesRequestId, vehicles.length]);

  useEffect(() => {
    return () => {
      if (highlightVehiclesTimerRef.current) window.clearTimeout(highlightVehiclesTimerRef.current);
    };
  }, []);

  const closeWithAnim = (setClosing, setShow) => {
    setClosing(true);
    setTimeout(() => {
      setShow(false);
      setClosing(false);
    }, 260);
  };

  const resetVehicleModal = () => {
    setForm({ model: '', plate: '', plateCountry: defaultPlateCountry });
    setFormImage(null);
  };

  const selectedPlateCountry = useMemo(
    () => getPlateCountryMeta(form.plateCountry),
    [form.plateCountry],
  );

  const handleSubmit = () => {
    const formattedPlate = formatVehiclePlate(form.plate, form.plateCountry);
    if (!form.model.trim() || !isValidVehiclePlate(formattedPlate, form.plateCountry)) return;
    onAddVehicle?.({
      model: form.model.trim(),
      plate: formattedPlate,
      plateCountry: form.plateCountry,
      photo: formImage,
    });
    resetVehicleModal();
  };

  const closeVehicleModal = () => {
    resetVehicleModal();
    closeWithAnim(setClosingModal, setShowModal);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          onCollapse?.();
          setShowModal(true);
        }}
        ref={vehiclesRowRef}
        className={`relative overflow-hidden w-full p-4 flex items-center justify-between transition ${isRtl ? 'text-right' : 'text-left'} ${
          isDark ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100' : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
        }`}
      >
        {highlightVehiclesRow ? (
          <>
            <span className="pointer-events-none absolute inset-0 bg-orange-400/10" aria-hidden="true" />
            <span className="pointer-events-none absolute inset-2 rounded-2xl border border-orange-300/70 animate-pulse" aria-hidden="true" />
          </>
        ) : null}
        <div className="relative z-10 flex items-center gap-3">
          <div className="bg-white p-2 rounded-lg border border-gray-100">
            <Car size={20} style={iconStyle ? iconStyle('vehicle') : undefined} />
          </div>
          <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
            {t('myVehicles')}
          </span>
        </div>
        <ArrowRight size={16} className={`relative z-10 ${isDark ? 'text-slate-500' : 'text-gray-300'} ${isRtl ? 'rotate-180' : ''}`} />
      </button>

      {showModal && (
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center px-4 ${
            closingModal ? 'animate-[overlayFadeOut_0.2s_ease_forwards]' : 'animate-[overlayFade_0.2s_ease]'
          }`}
          onClick={closeVehicleModal}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 relative ${
              closingModal ? 'animate-[modalOut_0.24s_ease_forwards]' : 'animate-[modalIn_0.28s_ease]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center gap-2 mb-4 ${isRtl ? 'flex-row-reverse' : ''}`}>
              <div className="bg-white p-2 rounded-lg border border-gray-100">
                <Car size={20} style={iconStyle ? iconStyle('vehicle') : undefined} />
              </div>
              <h3 className="text-xl font-bold text-gray-900">{t('manageVehiclesTitle', 'Manage my vehicles')}</h3>
            </div>

            <div className="space-y-3 mb-4 max-h-64 overflow-y-auto pr-1">
              {vehicles.length === 0 && (
                <p className="text-sm text-gray-400">{t('noVehiclesModal', 'No vehicles yet. Add one below.')}</p>
              )}
              {vehicles.map((v) => (
                (() => {
                  const vehiclePlateCountry = v.plateCountry || inferPlateCountryFromPlate(v.plate) || defaultPlateCountry;
                  const vehicleCountryMeta = getPlateCountryMeta(vehiclePlateCountry);
                  return (
                <div
                  key={v.id}
                  className={`flex items-center justify-between border rounded-xl px-3 py-2 ${
                    v.isDefault ? 'border-orange-200 bg-orange-50' : 'border-gray-100'
                  }`}
                >
                  <div>
                    <p className="font-semibold text-gray-900">{v.model}</p>
                    <p className="text-xs text-gray-500 tracking-widest font-mono">
                      <span className="mr-1">{vehicleCountryMeta.flag}</span>
                      {formatStoredVehiclePlate(v.plate, vehiclePlateCountry)}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onSelectVehicle?.(v.id)}
                      className={`text-sm font-semibold px-3 py-1 rounded-lg ${
                        v.isDefault
                          ? 'bg-orange-600 text-white'
                          : 'bg-white border border-gray-200 text-gray-600 hover:border-orange-200 hover:text-orange-600'
                      }`}
                    >
                      {v.isDefault ? t('selected', 'Selected') : t('select', 'Select')}
                    </button>
                    <button onClick={() => onDeleteVehicle?.(v.id)} className="text-sm text-rose-500 hover:text-rose-600 px-2">
                      {t('delete', 'Delete')}
                    </button>
                  </div>
                </div>
                  );
                })()
              ))}
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <div className={`flex items-center justify-between ${isRtl ? 'flex-row-reverse' : ''}`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                    {t('vehiclePlateCountryLabel', 'Registration country')}
                  </p>
                  <p className="text-xs text-gray-400 font-mono">{selectedPlateCountry.template}</p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {PLATE_COUNTRY_OPTIONS.map((option) => {
                    const isSelected = option.code === form.plateCountry;
                    return (
                      <button
                        key={option.code}
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({
                            ...prev,
                            plateCountry: option.code,
                            plate: formatVehiclePlate(prev.plate, option.code),
                          }));
                        }}
                        className={`rounded-xl border px-3 py-2 text-left transition ${
                          isSelected
                            ? 'border-orange-400 bg-orange-50 text-orange-700 shadow-sm'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-orange-200 hover:text-orange-600'
                        } ${isRtl ? 'text-right' : 'text-left'}`}
                      >
                        <div className={`flex items-center gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
                          <span className="text-lg leading-none">{option.flag}</span>
                          <span className="text-xs font-semibold leading-tight">
                            {t(option.labelKey, option.fallbackLabel)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t('modelPlaceholder', 'Model (e.g., Tesla Model 3)')}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                  value={form.model}
                  onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={selectedPlateCountry.placeholder}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-center uppercase tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-orange-200 placeholder:text-gray-300"
                  inputMode={selectedPlateCountry.inputMode}
                  autoCapitalize="characters"
                  value={form.plate}
                  onChange={(e) => {
                    const nextPlate = formatVehiclePlate(e.target.value, form.plateCountry);
                    setForm((prev) => ({ ...prev, plate: nextPlate }));
                  }}
                />
              </div>
              <div className="flex gap-2 items-center">
                <label className="w-full cursor-pointer">
                  <div className="border border-dashed border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-600 hover:border-orange-300 hover:text-orange-600 transition">
                    {formImage ? t('imageSelected', 'Image selected') : t('uploadPhoto', 'Upload vehicle photo')}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) {
                        setFormImage(null);
                        return;
                      }
                      const reader = new FileReader();
                      reader.onloadend = () => setFormImage(reader.result);
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeVehicleModal}
                  className="flex-1 bg-white border border-gray-200 text-gray-600 py-3 rounded-xl font-bold shadow-sm hover:bg-gray-50 transition"
                >
                  {t('cancel', 'Cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  className={`relative flex-1 bg-orange-600 text-white py-3 rounded-xl font-bold shadow-md hover:bg-orange-700 transition overflow-hidden ${
                    highlightAddVehicleButton ? 'ring-2 ring-orange-300 shadow-[0_0_0_10px_rgba(249,115,22,0.16)] animate-pulse' : ''
                  }`}
                >
                  {highlightAddVehicleButton ? (
                    <>
                      <span className="pointer-events-none absolute -inset-1 bg-gradient-to-r from-orange-400/25 to-amber-300/20 blur-lg" aria-hidden="true" />
                      <span className={`pointer-events-none absolute top-2 w-6 h-6 rounded-full bg-white text-orange-600 text-xs font-extrabold flex items-center justify-center shadow ${isRtl ? 'left-2' : 'right-2'}`} aria-hidden="true">
                        !
                      </span>
                    </>
                  ) : null}
                  {t('addVehicle', 'Add vehicle')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MyVehicules;
