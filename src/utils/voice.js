const VOICE_URI_KEY = 'parkswap.voiceUri';
const VOICE_NAME_KEY = 'parkswap.voiceName';
const VOICE_LANG_KEY = 'parkswap.voiceLang';

export const getVoicePreference = () => {
  if (typeof window === 'undefined') {
    return { voiceUri: '', voiceName: '', voiceLang: '' };
  }
  try {
    return {
      voiceUri: window.localStorage?.getItem(VOICE_URI_KEY) || '',
      voiceName: window.localStorage?.getItem(VOICE_NAME_KEY) || '',
      voiceLang: window.localStorage?.getItem(VOICE_LANG_KEY) || '',
    };
  } catch (_) {
    return { voiceUri: '', voiceName: '', voiceLang: '' };
  }
};

export const setVoicePreference = (pref) => {
  if (typeof window === 'undefined') return;
  const voiceUri = pref?.voiceUri || '';
  const voiceName = pref?.voiceName || '';
  const voiceLang = pref?.voiceLang || '';
  try {
    if (voiceUri) window.localStorage?.setItem(VOICE_URI_KEY, voiceUri);
    else window.localStorage?.removeItem(VOICE_URI_KEY);
    if (voiceName) window.localStorage?.setItem(VOICE_NAME_KEY, voiceName);
    else window.localStorage?.removeItem(VOICE_NAME_KEY);
    if (voiceLang) window.localStorage?.setItem(VOICE_LANG_KEY, voiceLang);
    else window.localStorage?.removeItem(VOICE_LANG_KEY);
  } catch (_) {
    // ignore storage failures
  }
};

export const scoreVoice = (voice, lang) => {
  if (!voice) return 0;
  const name = String(voice.name || '').toLowerCase();
  const voiceLang = String(voice.lang || '').toLowerCase();
  const targetLang = String(lang || '').toLowerCase();
  let score = 0;
  if (targetLang.startsWith('fr') && name.includes('marie')) score += 120;
  if (targetLang && voiceLang === targetLang) score += 12;
  if (targetLang && voiceLang.startsWith(targetLang)) score += 8;
  if (name.includes('google')) score += 50;
  if (name.includes('siri')) score += 40;
  if (name.includes('natural')) score += 30;
  if (name.includes('enhanced')) score += 25;
  if (name.includes('neural')) score += 25;
  if (name.includes('premium')) score += 20;
  if (voice.localService === false) score += 5;
  if (voice.default) score += 3;
  return score;
};

export const pickPreferredVoice = (voices, lang, pref = {}) => {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const targetLang = String(lang || '').toLowerCase();
  const byLang = targetLang
    ? voices.filter((v) => String(v.lang || '').toLowerCase().startsWith(targetLang))
    : voices.slice();
  const pool = byLang.length ? byLang : voices;

  const prefUri = pref?.voiceUri || pref?.voiceURI || '';
  const prefName = pref?.voiceName || '';
  const prefLang = String(pref?.voiceLang || '').toLowerCase();

  if (prefUri) {
    const exact = pool.find((v) => v.voiceURI === prefUri) || voices.find((v) => v.voiceURI === prefUri);
    if (exact) return exact;
  }
  if (prefName) {
    const match = pool.find((v) => v.name === prefName && (!prefLang || String(v.lang || '').toLowerCase() === prefLang))
      || pool.find((v) => v.name === prefName);
    if (match) return match;
  }

  let best = pool[0];
  let bestScore = scoreVoice(best, lang);
  for (const voice of pool) {
    const score = scoreVoice(voice, lang);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
};
