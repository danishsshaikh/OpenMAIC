import { describe, expect, it } from 'vitest';
import {
  defaultLocale,
  deploymentDefaultLocale,
  deploymentExposedLocales,
  deploymentFallbackLocale,
  englishOnlyDeployment,
  resolveDeploymentLocale,
  supportedLocales,
} from '@/lib/i18n';

describe('English-only deployment locale policy', () => {
  it('uses en-US as the default, fallback, and only exposed locale', () => {
    expect(defaultLocale).toBe('en-US');
    expect(deploymentDefaultLocale).toBe('en-US');
    expect(deploymentFallbackLocale).toBe('en-US');
    expect(deploymentExposedLocales.map((locale) => locale.code)).toEqual(['en-US']);
    expect(englishOnlyDeployment.showLanguageSwitcher).toBe(false);
  });

  it('retains upstream locale registry while resolving stale or unsupported values to English', () => {
    expect(supportedLocales.some((locale) => locale.code === 'zh-CN')).toBe(true);
    expect(resolveDeploymentLocale('zh-CN')).toBe('en-US');
    expect(resolveDeploymentLocale('zh')).toBe('en-US');
    expect(resolveDeploymentLocale('fr-FR')).toBe('en-US');
    expect(resolveDeploymentLocale(null)).toBe('en-US');
  });
});
