const normalizeParkingText = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const extractTimeRanges = (raw) => {
  const text = String(raw || '');
  const matches = [...text.matchAll(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/gi)];
  const minutes = matches
    .map((match) => {
      const hour = Number(match[1]);
      const min = match[2] ? Number(match[2]) : 0;
      if (!Number.isFinite(hour) || hour < 0 || hour > 24) return null;
      if (!Number.isFinite(min) || min < 0 || min > 59) return null;
      return hour === 24 ? 24 * 60 : hour * 60 + min;
    })
    .filter((value) => value != null);
  const ranges = [];
  for (let i = 0; i + 1 < minutes.length; i += 2) {
    ranges.push([minutes[i], minutes[i + 1]]);
  }
  return ranges;
};

const isOpenEveryDayText = (text) => /\b7\s*j(?:ours)?\s*(?:\/|sur)\s*7\b/.test(text);

export const isParkingOpenNow = (record, now = new Date()) => {
  if (!record) return false;
  const raw = record?.horaire_na ?? record?.horaire ?? record?.horaires ?? '';
  const text = normalizeParkingText(raw);
  if (!text) return false;
  if (text.includes('ferme') || text.includes('fermee')) return false;
  if (text.includes('24h') || text.includes('24 h') || text.includes('24/24')) return true;
  if (isOpenEveryDayText(text)) return true;

  const ranges = extractTimeRanges(text);
  if (!ranges.length) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return ranges.some(([start, end]) => {
    if (start == null || end == null) return false;
    if (start === end) return false;
    if (end > start) return nowMinutes >= start && nowMinutes <= end;
    return nowMinutes >= start || nowMinutes <= end;
  });
};

export const isResidentOnlyParking = (record) => {
  if (!record) return false;
  const type = normalizeParkingText(record?.type_usagers ?? record?.type_usager ?? '');
  const hours = normalizeParkingText(record?.horaire_na ?? '');
  const info = normalizeParkingText(
    Array.isArray(record?.info) ? record.info.join(' ') : record?.info ?? '',
  );
  const isPublic =
    type.includes('tous') || type.includes('public') || type.includes('visiteur') || type.includes('visitor');
  if (isPublic) return false;
  if (type.includes('abonn') || type.includes('resident')) return true;
  if (hours.includes('abonn')) return true;
  if (info.includes('abonn')) return true;
  return false;
};