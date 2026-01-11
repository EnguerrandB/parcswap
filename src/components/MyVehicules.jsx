import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Car } from 'lucide-react';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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

  let res = letters1;
  if (letters1.length === 2 && (digits.length > 0 || cleaned.length > 2)) res += '-';
  res += digits;
  if (digits.length === 3 && (letters2.length > 0 || cleaned.length > 5)) res += '-';
  res += letters2;

  return res;
};

const isFullPlate = (plate) => /^[A-Z]{2}-\d{3}-[A-Z]{2}$/.test(plate || '');

const PLATE_TEMPLATE = 'AB-123-CD';
const PLATE_EDIT_POSITIONS = [0, 1, 3, 4, 5, 7, 8];

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
  const { t } = useTranslation('common');
  const [form, setForm] = useState({ model: '' });
  const [plateSlots, setPlateSlots] = useState(Array(7).fill(''));
  const [plateFocused, setPlateFocused] = useState(false);
  const [formImage, setFormImage] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [closingModal, setClosingModal] = useState(false);
  const vehiclesRowRef = useRef(null);
  const [highlightVehiclesRow, setHighlightVehiclesRow] = useState(false);
  const highlightVehiclesTimerRef = useRef(null);
  const [highlightAddVehicleButton, setHighlightAddVehicleButton] = useState(false);
  const highlightAddVehicleTimerRef = useRef(null);
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
    } catch (_) {}

    if (highlightVehiclesTimerRef.current) window.clearTimeout(highlightVehiclesTimerRef.current);
    highlightVehiclesTimerRef.current = window.setTimeout(() => setHighlightVehiclesRow(false), 4200);
  }, [highlightVehiclesRequestId, vehicles.length]);

  useEffect(() => {
    return () => {
      if (highlightVehiclesTimerRef.current) window.clearTimeout(highlightVehiclesTimerRef.current);
      if (highlightAddVehicleTimerRef.current) window.clearTimeout(highlightAddVehicleTimerRef.current);
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
    setForm({ model: '' });
    setPlateSlots(Array(7).fill(''));
    setPlateFocused(false);
    setFormImage(null);
  };

  const handleSubmit = () => {
    const plateValue = plateSlots.join('');
    const formattedPlate = formatPlate(plateValue);
    if (!form.model.trim() || !isFullPlate(formattedPlate)) return;
    onAddVehicle?.({
      model: form.model.trim(),
      plate: formattedPlate,
      photo: formImage,
    });
    resetVehicleModal();
  };

  const closeVehicleModal = () => {
    resetVehicleModal();
    closeWithAnim(setClosingModal, setShowModal);
  };

  const plateNextKind = useMemo(() => {
    const lettersDone = Boolean(plateSlots[0] && plateSlots[1]);
    const digitsDone = Boolean(plateSlots[2] && plateSlots[3] && plateSlots[4]);
    if (lettersDone && !digitsDone) return 'digits';
    if (lettersDone && digitsDone) return 'letters';
    return 'letters';
  }, [plateSlots]);

  const buildPlateDisplay = (slots) => {
    const chars = PLATE_TEMPLATE.split('');
    for (let i = 0; i < PLATE_EDIT_POSITIONS.length; i += 1) {
      const pos = PLATE_EDIT_POSITIONS[i];
      const v = slots[i];
      if (v) chars[pos] = v;
    }
    return chars.join('');
  };

  const clampPlateCaret = (pos) => {
    const p = Math.max(0, Math.min(PLATE_TEMPLATE.length, Number(pos) || 0));
    if (p === 2) return 3;
    if (p === 6) return 7;
    return p;
  };

  const prevEditablePos = (pos) => {
    const p = clampPlateCaret(pos);
    for (let i = PLATE_EDIT_POSITIONS.length - 1; i >= 0; i -= 1) {
      if (PLATE_EDIT_POSITIONS[i] < p) return PLATE_EDIT_POSITIONS[i];
    }
    return PLATE_EDIT_POSITIONS[0];
  };

  const nextEditablePos = (pos) => {
    const p = clampPlateCaret(pos);
    for (let i = 0; i < PLATE_EDIT_POSITIONS.length; i += 1) {
      if (PLATE_EDIT_POSITIONS[i] > p) return PLATE_EDIT_POSITIONS[i];
    }
    return PLATE_EDIT_POSITIONS[PLATE_EDIT_POSITIONS.length - 1] + 1;
  };

  const slotIndexForPos = (pos) => PLATE_EDIT_POSITIONS.indexOf(pos);

  const coercePlateChar = (pos, ch) => {
    const c = String(ch || '').toUpperCase();
    if (!c) return '';
    const isLetterPos = pos === 0 || pos === 1 || pos === 7 || pos === 8;
    if (isLetterPos) return /[A-Z]/.test(c) ? c : '';
    return /[0-9]/.test(c) ? c : '';
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
        className={`relative overflow-hidden w-full p-4 flex items-center justify-between text-left transition ${
          isDark ? '[@media(hover:hover)]:hover:bg-slate-800 text-slate-100' : '[@media(hover:hover)]:hover:bg-gray-50 text-gray-900'
        }`}
      >
        {highlightVehiclesRow ? (
          <>
            <span className="pointer-events-none absolute inset-0 bg-orange-400/10" aria-hidden="true" />
            <span className="pointer-events-none absolute inset-2 rounded-2xl border border-orange-300/70 animate-pulse" aria-hidden="true" />
          </>
        ) : null}
        <div className="relative z-10 flex items-center space-x-3">
          <div className="bg-white p-2 rounded-lg border border-gray-100">
            <Car size={20} style={iconStyle ? iconStyle('vehicle') : undefined} />
          </div>
          <span className={`font-medium ${isDark ? 'text-slate-50' : 'text-gray-800'}`}>
            {t('myVehicles')}
          </span>
        </div>
        <ArrowRight size={16} className={`relative z-10 ${isDark ? 'text-slate-500' : 'text-gray-300'}`} />
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
            <div className="flex items-center space-x-2 mb-4">
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
                <div
                  key={v.id}
                  className={`flex items-center justify-between border rounded-xl px-3 py-2 ${
                    v.isDefault ? 'border-orange-200 bg-orange-50' : 'border-gray-100'
                  }`}
                >
                  <div>
                    <p className="font-semibold text-gray-900">{v.model}</p>
                    <p className="text-xs text-gray-500 tracking-widest font-mono">{v.plate}</p>
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
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder={t('modelPlaceholder', 'Model (e.g., Tesla Model 3)')}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
                  value={form.model}
                  onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
                />
              </div>
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder={plateFocused ? 'AB-123-CD' : t('platePlaceholderFull', 'Plate')}
                  className={`flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 placeholder:text-gray-300 ${
                    plateFocused || plateSlots.some(Boolean)
                      ? 'text-center uppercase tracking-widest font-mono'
                      : 'text-left normal-case tracking-normal font-sans'
                  }`}
                  inputMode={plateNextKind === 'digits' ? 'numeric' : 'text'}
                  pattern={plateNextKind === 'digits' ? '[0-9]*' : '[A-Za-z]*'}
                  autoCapitalize="characters"
                  value={plateFocused || plateSlots.some(Boolean) ? buildPlateDisplay(plateSlots) : ''}
                  onFocus={(e) => {
                    setPlateFocused(true);
                    const start = clampPlateCaret(e.target.selectionStart ?? 0);
                    window.requestAnimationFrame(() => {
                      try {
                        e.target.setSelectionRange(start, start);
                      } catch (_) {}
                    });
                  }}
                  onBlur={() => setPlateFocused(false)}
                  onKeyDown={(e) => {
                    const el = e.currentTarget;
                    const selStart = typeof el.selectionStart === 'number' ? el.selectionStart : 0;
                    const caret = clampPlateCaret(selStart);

                    if (e.key === 'ArrowLeft') {
                      e.preventDefault();
                      const next = prevEditablePos(caret);
                      el.setSelectionRange(next, next);
                      return;
                    }
                    if (e.key === 'ArrowRight') {
                      e.preventDefault();
                      const next = nextEditablePos(caret);
                      el.setSelectionRange(next, next);
                      return;
                    }
                    if (e.key === 'Backspace') {
                      e.preventDefault();
                      const pos = prevEditablePos(caret);
                      const idx = slotIndexForPos(pos);
                      if (idx >= 0) {
                        setPlateSlots((prev) => {
                          const next = [...prev];
                          next[idx] = '';
                          return next;
                        });
                      }
                      window.requestAnimationFrame(() => {
                        el.setSelectionRange(pos, pos);
                      });
                      return;
                    }

                    if (e.key === 'Delete') {
                      e.preventDefault();
                      const pos = clampPlateCaret(caret);
                      const idx = slotIndexForPos(pos);
                      if (idx >= 0) {
                        setPlateSlots((prev) => {
                          const next = [...prev];
                          next[idx] = '';
                          return next;
                        });
                      }
                      window.requestAnimationFrame(() => {
                        el.setSelectionRange(pos, pos);
                      });
                      return;
                    }

                    if (e.key && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                      e.preventDefault();
                      const pos = clampPlateCaret(caret);
                      const idx = slotIndexForPos(pos);
                      const coerced = coercePlateChar(pos, e.key);
                      if (idx >= 0 && coerced) {
                        setPlateSlots((prev) => {
                          const next = [...prev];
                          next[idx] = coerced;
                          return next;
                        });

                        const nextPos = nextEditablePos(pos);
                        window.requestAnimationFrame(() => {
                          el.setSelectionRange(nextPos, nextPos);
                        });
                      }
                    }
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    const text = (e.clipboardData?.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                    if (!text) return;
                    const chars = text.split('');
                    setPlateSlots((prev) => {
                      const next = [...prev];
                      let j = 0;
                      for (let i = 0; i < PLATE_EDIT_POSITIONS.length && j < chars.length; i += 1) {
                        const pos = PLATE_EDIT_POSITIONS[i];
                        const coerced = coercePlateChar(pos, chars[j]);
                        if (coerced) {
                          next[i] = coerced;
                          j += 1;
                        } else {
                          j += 1;
                          i -= 1;
                        }
                      }
                      return next;
                    });
                  }}
                />
              </div>
              <div className="flex space-x-2 items-center">
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
              <div className="flex space-x-2">
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
                      <span className="pointer-events-none absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-orange-600 text-xs font-extrabold flex items-center justify-center shadow" aria-hidden="true">
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
