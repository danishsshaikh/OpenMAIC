export type VoiceEnrollmentLanguage = 'en';

export interface VoiceEnrollmentPhrase {
  id: string;
  text: string;
  consent?: boolean;
}

export const VOICE_CLONING_CONSENT_VERSION = 'faculty-self-voice-v1';

export const VOICE_ENROLLMENT_PHRASES: Record<VoiceEnrollmentLanguage, VoiceEnrollmentPhrase[]> = {
  en: [
    {
      id: 'consent',
      consent: true,
      text: 'I confirm that this is my own voice, and I consent to using it for generating my course narration.',
    },
    {
      id: 'teaching-clarity',
      text: 'When we compare two ideas carefully, the pattern becomes easier to explain and remember.',
    },
    {
      id: 'teaching-flow',
      text: 'Let us pause for a moment, connect this example to the definition, and then move to the next step.',
    },
  ],
};

export const VOICE_PREVIEW_TEXT =
  'Welcome to the course. Today we are going to explore this topic together.';

export function getVoiceEnrollmentPhrases(language: string | undefined): VoiceEnrollmentPhrase[] {
  const key = language === 'en' ? language : 'en';
  return VOICE_ENROLLMENT_PHRASES[key];
}
