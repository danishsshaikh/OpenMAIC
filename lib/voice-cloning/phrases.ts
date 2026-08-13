export type VoiceEnrollmentLanguage = 'en';

export interface VoiceEnrollmentPhrase {
  id: string;
  text: string;
  consent?: boolean;
}

export const VOICE_CLONING_CONSENT_VERSION = 'faculty-self-voice-v1';

export const VOICE_ENROLLMENT_PARAGRAPH =
  'Today we will take a simple idea, look at it from two sides, and connect it to an example you can remember. Speak naturally, pause where it feels right, and keep the explanation clear for the class.';

export const VOICE_ENROLLMENT_PHRASES: Record<VoiceEnrollmentLanguage, VoiceEnrollmentPhrase[]> = {
  en: [
    {
      id: 'teaching-paragraph',
      text: VOICE_ENROLLMENT_PARAGRAPH,
    },
  ],
};

export const VOICE_PREVIEW_TEXT =
  'Welcome to the course. Today we are going to explore this topic together.';

export function getVoiceEnrollmentPhrases(language: string | undefined): VoiceEnrollmentPhrase[] {
  const key = language === 'en' ? language : 'en';
  return VOICE_ENROLLMENT_PHRASES[key];
}
