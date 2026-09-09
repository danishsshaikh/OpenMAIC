import { supportedLocales } from './locales';
import type { Locale } from './types';

export const deploymentDefaultLocale: Locale = 'en-US';
export const deploymentFallbackLocale: Locale = 'en-US';
export const deploymentExposedLocales = supportedLocales.filter(
  (locale) => locale.code === deploymentDefaultLocale,
);

export const englishOnlyDeployment = {
  defaultLocale: deploymentDefaultLocale,
  fallbackLocale: deploymentFallbackLocale,
  exposedLocales: deploymentExposedLocales,
  showLanguageSwitcher: deploymentExposedLocales.length > 1,
} as const;

export function resolveDeploymentLocale(_rawLocale?: string | null): Locale {
  return deploymentDefaultLocale;
}
