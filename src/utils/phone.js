export const PHONE_COUNTRIES = [
  { code: 'FR', name: 'France', callingCode: '+33', flag: '🇫🇷', trunkPrefix: '0' },
  { code: 'BE', name: 'Belgique', callingCode: '+32', flag: '🇧🇪', trunkPrefix: '0' },
  { code: 'CH', name: 'Suisse', callingCode: '+41', flag: '🇨🇭', trunkPrefix: '0' },
  { code: 'GB', name: 'United Kingdom', callingCode: '+44', flag: '🇬🇧', trunkPrefix: '0' },
  { code: 'US', name: 'United States', callingCode: '+1', flag: '🇺🇸', trunkPrefix: null },
];

const countryByCode = (code) =>
  PHONE_COUNTRIES.find((c) => c.code === String(code || '').toUpperCase()) || PHONE_COUNTRIES[0];

export const guessPhoneCountry = (e164) => {
  const raw = String(e164 || '').trim();
  if (!raw.startsWith('+')) return PHONE_COUNTRIES[0];
  const sorted = [...PHONE_COUNTRIES].sort((a, b) => b.callingCode.length - a.callingCode.length);
  return sorted.find((c) => raw.startsWith(c.callingCode)) || PHONE_COUNTRIES[0];
};

export const toE164Phone = (rawPhone, countryCode = 'FR') => {
  const country = countryByCode(countryCode);
  let v = String(rawPhone || '').trim();
  if (!v) return { e164: '', error: 'empty' };

  v = v.replace(/\(0\)/g, '');
  v = v.replace(/[()\s.-]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;

  if (v.startsWith('+')) {
    v = `+${v.slice(1).replace(/\D/g, '')}`;
  } else {
    const digits = v.replace(/\D/g, '');
    if (country.trunkPrefix && digits.startsWith(country.trunkPrefix)) {
      v = `${country.callingCode}${digits.slice(country.trunkPrefix.length)}`;
    } else {
      v = `${country.callingCode}${digits}`;
    }
  }

  if (!/^\+\d{6,15}$/.test(v)) return { e164: '', error: 'invalid' };
  return { e164: v, error: '' };
};

export const formatPhoneForDisplay = (e164, countryCode = 'FR') => {
  const country = countryByCode(countryCode);
  const raw = String(e164 || '').trim();
  if (!raw) return '';
  if (!raw.startsWith(country.callingCode)) return raw;

  const national = raw.slice(country.callingCode.length).replace(/\D/g, '');
  if (!national) return raw;

  if (country.code === 'FR' && national.length === 9) {
    const withTrunk = `0${national}`;
    const grouped = withTrunk.replace(/(\d)(?=(\d{2})+$)/g, '$1 ').trim();
    return grouped.replace(/^0/, '(0)');
  }

  if (country.trunkPrefix) return `${country.trunkPrefix}${national}`;
  return national;
};

export const formatPhoneInput = (rawPhone, countryCode = 'FR') => {
  const country = countryByCode(countryCode);
  const raw = String(rawPhone || '');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  const wantsTrunk =
    country.trunkPrefix && digits.startsWith(country.trunkPrefix) ? country.trunkPrefix : '';
  let rest = wantsTrunk ? digits.slice(wantsTrunk.length) : digits;

  // Keep it reasonable in the UI (E.164 max is 15 digits, national parts vary)
  rest = rest.slice(0, 14);

  if (wantsTrunk === '0') {
    // Allow deleting the trunk prefix: keep a bare "0" until another digit is entered.
    if (!rest) return '0';

    // France: 0X XX XX XX XX (first digit then pairs)
    if (country.code === 'FR') {
      const first = rest.slice(0, 1);
      const tail = rest.slice(1);
      const pairs = tail.match(/.{1,2}/g)?.join(' ') || '';
      return `(0)${first}${pairs ? ` ${pairs}` : ''}`.trim();
    }

    const pairs = rest.match(/.{1,2}/g)?.join(' ') || '';
    return `(0)${pairs ? ` ${pairs}` : ''}`.trim();
  }

  const pairs = rest.match(/.{1,2}/g)?.join(' ') || '';
  return `${wantsTrunk}${pairs ? ` ${pairs}` : ''}`.trim();
};
