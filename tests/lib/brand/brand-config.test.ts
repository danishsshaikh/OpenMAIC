import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

describe('DEFAULT_BRAND (single-brand build)', () => {
  it('uses the Sahaya product identity for full chrome', () => {
    expect(DEFAULT_BRAND.productName).toBe('Sahaya');
    expect(DEFAULT_BRAND.shortName).toBe('Sahaya');
    expect(DEFAULT_BRAND.markSrc).toBe('/branding/sahaya-mark.svg');
    expect(DEFAULT_BRAND.themeColor).toBe('#42116F');
  });

  it('marks its horizontal logo as already containing the wordmark', () => {
    expect(DEFAULT_BRAND.logoHasWordmark).toBe(true);
    expect(DEFAULT_BRAND.logoSrc).toBe('/branding/sahaya-wordmark.svg');
  });
});
