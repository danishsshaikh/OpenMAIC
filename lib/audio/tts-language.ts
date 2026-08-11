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
  const input = languageDirectiveOrLocale?.trim();
  if (input) {
    const direct = normalizeDirectLanguageCode(input);
    if (direct) return direct;
    const alias = resolveLanguageAlias(input);
    if (alias) return alias;
  }

  const fallback = options.fallbackLanguage?.trim();
  if (fallback) {
    const direct = normalizeDirectLanguageCode(fallback);
    if (direct) return direct;
    const alias = resolveLanguageAlias(fallback);
    if (alias) return alias;
  }

  const defaultLanguage = options.defaultLanguage?.trim();
  if (defaultLanguage) {
    const direct = normalizeDirectLanguageCode(defaultLanguage);
    if (direct) return direct;
    const alias = resolveLanguageAlias(defaultLanguage);
    if (alias) return alias;
  }

  return 'en';
}
