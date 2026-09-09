export const CHATTERBOX_SUPPORTED_LANGUAGE_IDS = [
  'ar',
  'da',
  'de',
  'el',
  'en',
  'es',
  'fi',
  'fr',
  'he',
  'hi',
  'it',
  'ja',
  'ko',
  'ms',
  'nl',
  'no',
  'pl',
  'pt',
  'ru',
  'sv',
  'sw',
  'tr',
  'zh',
] as const;

export type TTSLanguageCode = (typeof CHATTERBOX_SUPPORTED_LANGUAGE_IDS)[number];

const SUPPORTED_LANGUAGE_IDS = new Set<string>(CHATTERBOX_SUPPORTED_LANGUAGE_IDS);

export const CHATTERBOX_LANGUAGE_LABELS: Record<TTSLanguageCode, string> = {
  ar: 'Arabic',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  fi: 'Finnish',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  ms: 'Malay',
  nl: 'Dutch',
  no: 'Norwegian',
  pl: 'Polish',
  pt: 'Portuguese',
  ru: 'Russian',
  sv: 'Swedish',
  sw: 'Swahili',
  tr: 'Turkish',
  zh: 'Chinese',
};

const LANGUAGE_ALIASES: Record<string, TTSLanguageCode> = {
  arabic: 'ar',
  danish: 'da',
  german: 'de',
  greek: 'el',
  english: 'en',
  spanish: 'es',
  finnish: 'fi',
  french: 'fr',
  hebrew: 'he',
  hindi: 'hi',
  italian: 'it',
  japanese: 'ja',
  korean: 'ko',
  malay: 'ms',
  dutch: 'nl',
  norwegian: 'no',
  polish: 'pl',
  portuguese: 'pt',
  russian: 'ru',
  swedish: 'sv',
  swahili: 'sw',
  turkish: 'tr',
  chinese: 'zh',
  mandarin: 'zh',
  'simplified chinese': 'zh',
  'traditional chinese': 'zh',
  中文: 'zh',
  汉语: 'zh',
  漢語: 'zh',
  普通话: 'zh',
  日本語: 'ja',
  にほんご: 'ja',
  हिंदी: 'hi',
  русский: 'ru',
};

function normalizeDirectLanguageCode(value: string): TTSLanguageCode | null {
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return null;
  const base = normalized.split('-')[0];
  return SUPPORTED_LANGUAGE_IDS.has(base) ? (base as TTSLanguageCode) : null;
}

function resolveLanguageAlias(value: string): TTSLanguageCode | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const aliases = Object.entries(LANGUAGE_ALIASES).sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [alias, code] of aliases) {
    const normalizedAlias = alias.toLowerCase();
    if (normalized === normalizedAlias) return code;
    if (normalized.includes(normalizedAlias)) return code;
  }
  return null;
}

export function tryResolveTTSLanguageCode(
  languageDirectiveOrLocale?: string | null,
): TTSLanguageCode | null {
  const input = languageDirectiveOrLocale?.trim();
  if (!input) return null;
  const direct = normalizeDirectLanguageCode(input);
  if (direct) return direct;
  return resolveLanguageAlias(input);
}

export function isTTSLanguageCode(value: unknown): value is TTSLanguageCode {
  return typeof value === 'string' && SUPPORTED_LANGUAGE_IDS.has(value);
}

/**
 * Resolve OpenMAIC's human language directive/locale input into the provider
 * language_id expected by speech engines such as Chatterbox.
 *
 * Unknown prose falls back to `fallbackLanguage`, then `defaultLanguage`, then
 * English. That prevents arbitrary LLM instructions from being forwarded as a
 * provider language code while keeping the policy explicit and deterministic.
 */
export function resolveTTSLanguageCode(
  languageDirectiveOrLocale?: string | null,
  options: { fallbackLanguage?: string | null; defaultLanguage?: string | null } = {},
): TTSLanguageCode {
  const resolvedInput = tryResolveTTSLanguageCode(languageDirectiveOrLocale);
  if (resolvedInput) return resolvedInput;

  const resolvedFallback = tryResolveTTSLanguageCode(options.fallbackLanguage);
  if (resolvedFallback) return resolvedFallback;

  const resolvedDefault = tryResolveTTSLanguageCode(options.defaultLanguage);
  if (resolvedDefault) return resolvedDefault;

  return 'en';
}
