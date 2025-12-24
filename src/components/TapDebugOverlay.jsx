// src/components/TapDebugOverlay.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'parkswap.debugTap';
const MAX_STACK_ITEMS = 6;

const readEnabledFromUrlOrStorage = () => {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('debugTap');
    if (fromUrl === '1') {
      localStorage.setItem(STORAGE_KEY, '1');
      return true;
    }
    if (fromUrl === '0') {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const normalizeText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

const describeElement = (element) => {
  if (!element || !(element instanceof Element)) return '∅';

  const tag = (element.tagName || '').toLowerCase();
  const id = element.id ? `#${element.id}` : '';

  const className =
    typeof element.className === 'string'
      ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 4)
      : [];
  const classes = className.length ? `.${className.join('.')}` : '';

  const role = element.getAttribute('role') || '';
  const dataRole = element.getAttribute('data-role') || '';
  const ariaLabel = element.getAttribute('aria-label') || '';

  const style = window.getComputedStyle(element);
  const pe = style.pointerEvents || '?';
  const zi = style.zIndex || '?';
  const pos = style.position || '?';

  const text = normalizeText(element.getAttribute('aria-label') || element.textContent);

  const meta = [
    `pe=${pe}`,
    `z=${zi}`,
    `pos=${pos}`,
    role ? `role=${role}` : null,
    dataRole ? `data-role=${dataRole}` : null,
    ariaLabel ? `aria-label="${normalizeText(ariaLabel)}"` : null,
    text ? `text="${text}"` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return `${tag}${id}${classes}${meta ? ` [${meta}]` : ''}`;
};

const getClientPoint = (event) => {
  if (event?.touches?.length) {
    return { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }
  if (event?.changedTouches?.length) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  if (typeof event?.clientX === 'number' && typeof event?.clientY === 'number') {
    return { x: event.clientX, y: event.clientY };
  }
  return null;
};

const clampRectToViewport = (rect) => {
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(vw, rect.right);
  const bottom = Math.min(vh, rect.bottom);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
};

const ACTION_SELECTOR = 'button, a, [role="button"], input, label, textarea, select';

const TapDebugOverlay = () => {
  const [enabled, setEnabled] = useState(false);
  const [debug, setDebug] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const lastPointerDownRef = useRef({ ts: 0, x: 0, y: 0 });

  useEffect(() => {
    setEnabled(readEnabledFromUrlOrStorage());
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onEvent = (event) => {
      const point = getClientPoint(event);
      if (!point) return;

      const now = Date.now();
      const roundedX = Math.round(point.x);
      const roundedY = Math.round(point.y);

      if (event.type === 'touchstart') {
        const last = lastPointerDownRef.current;
        const isSamePoint = Math.abs(last.x - roundedX) <= 2 && Math.abs(last.y - roundedY) <= 2;
        if (now - last.ts < 200 && isSamePoint) return;
      }
      if (event.type === 'pointerdown') {
        lastPointerDownRef.current = { ts: now, x: roundedX, y: roundedY };
      }

      const stackRaw = document.elementsFromPoint(roundedX, roundedY) || [];
      const stack = stackRaw.filter((el) => !el?.closest?.('[data-tapdebug-overlay]'));
      const fromPoint = stack[0] || null;

      const target = event.target instanceof Element ? event.target : null;
      const closestAction =
        (fromPoint?.closest?.(ACTION_SELECTOR) || target?.closest?.(ACTION_SELECTOR) || null) ?? null;

      const highlightElement = closestAction || fromPoint || target;
      const rect = highlightElement?.getBoundingClientRect?.() ?? null;

      setHighlight(rect ? clampRectToViewport(rect) : null);
      setDebug({
        type: event.type,
        pointerType: event.pointerType || (event.touches ? 'touch' : ''),
        x: roundedX,
        y: roundedY,
        target: describeElement(target),
        fromPoint: describeElement(fromPoint),
        closestAction: describeElement(closestAction),
        stack: stack.slice(0, MAX_STACK_ITEMS).map(describeElement),
      });
    };

    const capturePassive = { capture: true, passive: true };
    window.addEventListener('pointerdown', onEvent, capturePassive);
    window.addEventListener('touchstart', onEvent, capturePassive);
    window.addEventListener('click', onEvent, { capture: true });

    return () => {
      window.removeEventListener('pointerdown', onEvent, capturePassive);
      window.removeEventListener('touchstart', onEvent, capturePassive);
      window.removeEventListener('click', onEvent, { capture: true });
    };
  }, [enabled]);

  const debugText = useMemo(() => {
    if (!debug) return '';
    const lines = [
      `debugTap=1 • ${debug.type}${debug.pointerType ? ` (${debug.pointerType})` : ''} @ ${debug.x},${debug.y}`,
      `target: ${debug.target}`,
      `fromPoint: ${debug.fromPoint}`,
      `closestAction: ${debug.closestAction}`,
      `stack: ${debug.stack.join('  →  ')}`,
      `disable: ?debugTap=0`,
    ];
    return lines.join('\n');
  }, [debug]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[2147483647]" data-tapdebug-overlay="1">
      {highlight ? (
        <div
          className="absolute border-2 border-fuchsia-400/90 rounded-md"
          style={{
            left: `${highlight.left}px`,
            top: `${highlight.top}px`,
            width: `${highlight.width}px`,
            height: `${highlight.height}px`,
            boxShadow: '0 0 0 2px rgba(0,0,0,0.25)',
          }}
        />
      ) : null}
      {debug ? (
        <div className="absolute top-2 left-2 right-2">
          <div className="w-fit max-w-full rounded-lg bg-black/80 text-white font-mono text-[11px] leading-snug px-3 py-2 whitespace-pre-wrap shadow-lg">
            {debugText}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default TapDebugOverlay;
