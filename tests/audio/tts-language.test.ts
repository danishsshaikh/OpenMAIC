import { describe, expect, it } from 'vitest';
import { resolveTTSLanguageCode } from '@/lib/audio/tts-language';

describe('resolveTTSLanguageCode', () => {
  it('maps English directives to en', () => {
    expect(
      resolveTTSLanguageCode(
        'Deliver the entire course in English. Use clear, accessible language.',
      ),
    ).toBe('en');
  });

  it('normalizes en-US to en', () => {
    expect(resolveTTSLanguageCode('en-US')).toBe('en');
  });

  it('maps Hindi directives to hi', () => {
    expect(resolveTTSLanguageCode('Teach this lesson in Hindi for first-year students.')).toBe(
      'hi',
    );
  });

  it('normalizes hi-IN to hi', () => {
    expect(resolveTTSLanguageCode('hi-IN')).toBe('hi');
  });

  it('maps Chinese locale/directives to zh', () => {
    expect(resolveTTSLanguageCode('zh-CN')).toBe('zh');
    expect(
      resolveTTSLanguageCode('Use Simplified Chinese, preserving standard English terms.'),
    ).toBe('zh');
  });

  it('maps Japanese locale/directives to ja', () => {
    expect(resolveTTSLanguageCode('ja-JP')).toBe('ja');
    expect(resolveTTSLanguageCode('Respond in Japanese.')).toBe('ja');
  });

  it('maps Russian locale/directives to ru', () => {
    expect(resolveTTSLanguageCode('ru-RU')).toBe('ru');
    expect(resolveTTSLanguageCode('Explain this course in Russian.')).toBe('ru');
  });

  it('uses fallback/default for unknown prose without forwarding it', () => {
    expect(
      resolveTTSLanguageCode('Use clear beginner-friendly wording.', { fallbackLanguage: 'hi-IN' }),
    ).toBe('hi');
    expect(resolveTTSLanguageCode('Use clear beginner-friendly wording.')).toBe('en');
  });
});
