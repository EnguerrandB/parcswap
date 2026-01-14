const mapCache = new Map();

const ensureEntry = (key) => {
  if (typeof document === 'undefined') return null;
  let entry = mapCache.get(key);
  if (!entry) {
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.position = 'absolute';
    container.style.inset = '0';
    entry = { container, map: null };
    mapCache.set(key, entry);
  }
  return entry;
};

export const attachPersistentMapContainer = (key, hostEl) => {
  if (!hostEl) return null;
  const entry = ensureEntry(key);
  if (!entry) return null;
  if (entry.container.parentNode !== hostEl) {
    hostEl.innerHTML = '';
    hostEl.appendChild(entry.container);
  }
  return entry.container;
};

export const getPersistentMap = (key) => mapCache.get(key)?.map || null;

export const setPersistentMap = (key, mapInstance) => {
  const entry = ensureEntry(key);
  if (!entry) return;
  entry.map = mapInstance || null;
};
