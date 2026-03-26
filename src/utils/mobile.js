import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Clipboard } from '@capacitor/clipboard';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Share } from '@capacitor/share';

const DEFAULT_PUBLIC_WEB_URL = 'https://parkswap.app';
const DEFAULT_DEEP_LINK_SCHEME = 'com.parkswap.app';
const DEFAULT_DEEP_LINK_HOST = 'app';

let appUrlHandlerInstalled = false;

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const ensureLeadingSlash = (value) => {
  const normalized = String(value || '/').trim();
  if (!normalized) return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

export const getPublicWebBaseUrl = () => {
  return trimTrailingSlash(import.meta.env.VITE_PUBLIC_WEB_URL || DEFAULT_PUBLIC_WEB_URL);
};

export const getDeepLinkScheme = () => {
  return String(import.meta.env.VITE_MOBILE_DEEP_LINK_SCHEME || DEFAULT_DEEP_LINK_SCHEME).trim();
};

export const getDeepLinkHost = () => {
  return String(import.meta.env.VITE_MOBILE_DEEP_LINK_HOST || DEFAULT_DEEP_LINK_HOST).trim();
};

export const isNativeApp = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch (_) {
    return false;
  }
};

export const buildPublicUrl = (path = '/') => {
  const target = ensureLeadingSlash(path);
  return new URL(target, `${getPublicWebBaseUrl()}/`).toString();
};

export const buildCurrentShareUrl = () => {
  if (typeof window === 'undefined') return buildPublicUrl('/');
  if (!isNativeApp()) return window.location.href;
  const current = new URL(window.location.href);
  return buildPublicUrl(`${current.pathname}${current.search}${current.hash}`);
};

export const buildReturnUrl = (path = '/') => {
  const target = ensureLeadingSlash(path);
  if (!isNativeApp()) {
    if (typeof window === 'undefined') return buildPublicUrl(target);
    return new URL(target, window.location.origin).toString();
  }
  return `${getDeepLinkScheme()}://${getDeepLinkHost()}${target}`;
};

const normalizeIncomingNativeUrl = (incomingUrl) => {
  if (!incomingUrl) return null;

  try {
    const parsed = new URL(incomingUrl);
    const publicBaseUrl = new URL(`${getPublicWebBaseUrl()}/`);
    if (parsed.protocol === `${getDeepLinkScheme()}:`) {
      return `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
    }
    if (parsed.origin === publicBaseUrl.origin) {
      return `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
    }
  } catch (_) {
    return null;
  }

  return null;
};

export const installAppUrlOpenHandler = () => {
  if (appUrlHandlerInstalled || !isNativeApp() || typeof window === 'undefined') return;
  appUrlHandlerInstalled = true;

  CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
    const nextTarget = normalizeIncomingNativeUrl(url);
    if (!nextTarget) return;

    try {
      await Browser.close();
    } catch (_) {}

    const nextUrl = new URL(nextTarget, window.location.origin);
    const relativeTarget = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    window.history.replaceState({}, document.title, relativeTarget);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
};

export const openExternalUrl = async (url) => {
  const target = String(url || '').trim();
  if (!target) return;

  if (isNativeApp() && /^https?:\/\//i.test(target)) {
    await Browser.open({ url: target });
    return;
  }

  if (typeof window !== 'undefined') {
    window.location.assign(target);
  }
};

export const shareContent = async ({ title = '', text = '', url = '' } = {}) => {
  const payload = {
    title: String(title || '').trim(),
    text: String(text || '').trim(),
    url: String(url || '').trim(),
  };

  if (isNativeApp()) {
    await Share.share(payload);
    return true;
  }

  if (navigator?.share) {
    await navigator.share(payload);
    return true;
  }

  return false;
};

export const copyText = async (value) => {
  const text = String(value || '');
  if (!text) return false;

  if (isNativeApp()) {
    await Clipboard.write({ string: text });
    return true;
  }

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand('copy');
    return true;
  } finally {
    document.body.removeChild(textarea);
  }
};

export const getCurrentLocationCoordinates = async (options = {}) => {
  const enableHighAccuracy = options.enableHighAccuracy ?? true;
  const timeout = options.timeout ?? 10000;
  const maximumAge = options.maximumAge ?? 0;

  if (isNativeApp()) {
    await Geolocation.requestPermissions();
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy,
      timeout,
      maximumAge,
    });
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
  }

  if (!navigator?.geolocation) return null;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy,
        timeout,
        maximumAge,
      },
    );
  });
};