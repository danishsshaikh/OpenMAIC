'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CircleAlert,
  Mic,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  CHATTERBOX_LANGUAGE_LABELS,
  CHATTERBOX_SUPPORTED_LANGUAGE_IDS,
  isTTSLanguageCode,
  type TTSLanguageCode,
} from '@/lib/audio/tts-language';
import { VOICE_ENROLLMENT_PARAGRAPH } from '@/lib/voice-cloning/phrases';
import {
  MAX_RECORDING_DURATION_SECONDS,
  MIN_RECORDING_SIZE_BYTES,
  MIN_RECORDING_DURATION_SECONDS,
  VOICE_ENROLLMENT_TARGET_SECONDS,
} from '@/lib/voice-cloning/limits';
import {
  DEFAULT_CHATTERBOX_MODEL_VARIANT,
  RECOMMENDED_VOICE_GENERATION_SETTINGS,
  VOICE_GENERATION_SETTING_RANGES,
  VOICE_SETTINGS_PRESETS,
  voiceGenerationPresetForSettings,
  type ChatterboxModelVariant,
  type PublicVoiceProfile,
  type VoiceConfiguration,
  type VoiceGenerationSettings,
  type VoiceSettingsPreset,
} from '@/lib/voice-cloning/types';

interface TeachingVoiceCardProps {
  selectedProfileId?: string;
  onSelectedProfileIdChange: (profileId: string | undefined) => void;
}

type ClipState = {
  blob?: Blob;
  url?: string;
  duration?: number;
  error?: string;
};

type ApiProfileResponse = {
  success?: boolean;
  profile?: PublicVoiceProfile | null;
  error?: string;
  details?: string;
};

const MODEL_OPTIONS: Array<{
  value: ChatterboxModelVariant;
  label: string;
  description: string;
}> = [
  { value: 'v3', label: 'V3 — Recommended', description: 'Newer multilingual voice model' },
  { value: 'v2', label: 'V2 — Legacy', description: 'Previous voice model' },
];

const PRESET_OPTIONS: Array<{
  value: VoiceSettingsPreset;
  label: string;
  description: string;
}> = [
  { value: 'natural', label: 'Natural', description: 'Recommended balanced settings' },
  { value: 'accent-test', label: 'Accent Test', description: 'Lower guidance for A/B testing' },
  { value: 'expressive', label: 'Expressive', description: 'More emphasis in delivery' },
  { value: 'custom', label: 'Custom', description: 'Manual slider values' },
];

const SETTING_LABELS: Record<keyof VoiceGenerationSettings, { label: string; helper: string }> = {
  exaggeration: {
    label: 'Voice Variation',
    helper: 'Controls emphasis and expressiveness in the generated line.',
  },
  cfgWeight: {
    label: 'Voice Guidance',
    helper: 'Lower values leave more room for the reference voice during A/B testing.',
  },
  temperature: {
    label: 'Speech Randomness',
    helper: 'Controls how much variation Chatterbox can use while speaking.',
  },
  topP: {
    label: 'Speech Variation',
    helper: 'Expert sampling control for the range of likely next sounds.',
  },
  minP: {
    label: 'Low-Probability Filtering',
    helper: 'Expert sampling control for filtering unlikely sounds.',
  },
  repetitionPenalty: {
    label: 'Repeat Control',
    helper: 'Expert control that discourages repeated words or phrases.',
  },
};

const BASIC_SETTING_KEYS: Array<keyof VoiceGenerationSettings> = [
  'exaggeration',
  'cfgWeight',
  'temperature',
];

const EXPERT_SETTING_KEYS: Array<keyof VoiceGenerationSettings> = [
  'topP',
  'minP',
  'repetitionPenalty',
];

function cloneRecommendedSettings(): VoiceGenerationSettings {
  return { ...RECOMMENDED_VOICE_GENERATION_SETTINGS };
}

function normalizeProfileLanguageId(profile: PublicVoiceProfile | null): TTSLanguageCode {
  return isTTSLanguageCode(profile?.languageId) ? profile.languageId : 'en';
}

function profileConfiguration(profile: PublicVoiceProfile): VoiceConfiguration {
  return {
    modelVariant: profile.modelVariant,
    languageId: normalizeProfileLanguageId(profile),
    generationSettings: profile.generationSettings ?? cloneRecommendedSettings(),
  };
}

function voiceConfigurationsEqual(left: VoiceConfiguration, right: VoiceConfiguration): boolean {
  return (
    left.modelVariant === right.modelVariant &&
    left.languageId === right.languageId &&
    Object.keys(RECOMMENDED_VOICE_GENERATION_SETTINGS).every((key) => {
      const typedKey = key as keyof VoiceGenerationSettings;
      return (
        Math.abs(left.generationSettings[typedKey] - right.generationSettings[typedKey]) < 0.000001
      );
    })
  );
}

function chooseMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function formatSeconds(value: number | undefined): string {
  if (!value) return '';
  return `${value.toFixed(1)}s`;
}

function formatClock(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function TeachingVoiceCard({
  selectedProfileId,
  onSelectedProfileIdChange,
}: TeachingVoiceCardProps) {
  const enrollmentParagraph = useMemo(() => VOICE_ENROLLMENT_PARAGRAPH, []);
  const [profile, setProfile] = useState<PublicVoiceProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [consented, setConsented] = useState(false);
  const [recording, setRecording] = useState<ClipState>({});
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [draftModelVariant, setDraftModelVariant] = useState<ChatterboxModelVariant>(
    DEFAULT_CHATTERBOX_MODEL_VARIANT,
  );
  const [draftLanguageId, setDraftLanguageId] = useState<TTSLanguageCode>('en');
  const [draftGenerationSettings, setDraftGenerationSettings] =
    useState<VoiceGenerationSettings>(cloneRecommendedSettings);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [expertOpen, setExpertOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const selectedProfileIdRef = useRef(selectedProfileId);
  const onSelectedProfileIdChangeRef = useRef(onSelectedProfileIdChange);
  const recordingUrlRef = useRef<string | undefined>(undefined);

  const readyProfile = profile?.status === 'ready' ? profile : null;
  const draftConfiguration: VoiceConfiguration = {
    modelVariant: draftModelVariant,
    languageId: draftLanguageId,
    generationSettings: draftGenerationSettings,
  };
  const draftPreset = voiceGenerationPresetForSettings(draftGenerationSettings);
  const acceptedConfiguration = readyProfile ? profileConfiguration(readyProfile) : null;
  const draftMatchesAccepted =
    acceptedConfiguration && voiceConfigurationsEqual(draftConfiguration, acceptedConfiguration);
  const selectedPreview =
    profile?.draftPreview &&
    voiceConfigurationsEqual(profile.draftPreview.config, draftConfiguration)
      ? profile.draftPreview.preview
      : draftMatchesAccepted
        ? readyProfile?.preview
        : undefined;
  const recordingReady =
    Boolean(recording.blob) &&
    Boolean(recording.duration) &&
    recording.duration! >= MIN_RECORDING_DURATION_SECONDS &&
    recording.duration! <= MAX_RECORDING_DURATION_SECONDS;
  const recordingGuidance =
    recordingStartedAt !== null
      ? elapsedSeconds < MIN_RECORDING_DURATION_SECONDS
        ? `Keep going. Minimum ${MIN_RECORDING_DURATION_SECONDS} seconds.`
        : elapsedSeconds < VOICE_ENROLLMENT_TARGET_SECONDS
          ? `Aim for about ${VOICE_ENROLLMENT_TARGET_SECONDS} seconds.`
          : elapsedSeconds <= MAX_RECORDING_DURATION_SECONDS
            ? 'You can stop when the paragraph feels complete.'
            : 'Please stop and record a shorter sample.'
      : `Target: about ${VOICE_ENROLLMENT_TARGET_SECONDS} seconds.`;

  useEffect(() => {
    recordingUrlRef.current = recording.url;
  }, [recording.url]);

  useEffect(() => {
    if (recordingStartedAt === null) return undefined;
    const updateElapsed = () => setElapsedSeconds((performance.now() - recordingStartedAt) / 1000);
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [recordingStartedAt]);

  useEffect(
    () => () => {
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    selectedProfileIdRef.current = selectedProfileId;
    onSelectedProfileIdChangeRef.current = onSelectedProfileIdChange;
  }, [onSelectedProfileIdChange, selectedProfileId]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/voice-cloning/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ApiProfileResponse | null) => {
        if (cancelled) return;
        const next = data?.profile ?? null;
        setProfile(next);
        if (next?.draftPreview) {
          setDraftModelVariant(next.draftPreview.config.modelVariant);
          setDraftLanguageId(
            isTTSLanguageCode(next.draftPreview.config.languageId)
              ? next.draftPreview.config.languageId
              : 'en',
          );
          setDraftGenerationSettings(next.draftPreview.config.generationSettings);
        } else if (next) {
          const config = profileConfiguration(next);
          setDraftModelVariant(config.modelVariant);
          setDraftLanguageId(config.languageId as TTSLanguageCode);
          setDraftGenerationSettings(config.generationSettings);
        }
        if (next?.status === 'ready' && !selectedProfileIdRef.current) {
          onSelectedProfileIdChangeRef.current(next.id);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const replaceRecording = (next: ClipState) => {
    setRecording((prev) => {
      if (prev.url) URL.revokeObjectURL(prev.url);
      return next;
    });
  };

  const updateGenerationSetting = (key: keyof VoiceGenerationSettings, value: number) => {
    setDraftGenerationSettings((prev) => ({ ...prev, [key]: value }));
  };

  const applyPreset = (preset: VoiceSettingsPreset) => {
    if (preset === 'custom') return;
    setDraftGenerationSettings({ ...VOICE_SETTINGS_PRESETS[preset] });
  };

  const resetRecommendedDraft = () => {
    setDraftModelVariant(DEFAULT_CHATTERBOX_MODEL_VARIANT);
    setDraftLanguageId(
      isTTSLanguageCode(acceptedConfiguration?.languageId)
        ? acceptedConfiguration.languageId
        : draftLanguageId,
    );
    setDraftGenerationSettings(cloneRecommendedSettings());
  };

  const renderSettingSlider = (key: keyof VoiceGenerationSettings) => {
    const range = VOICE_GENERATION_SETTING_RANGES[key];
    const metadata = SETTING_LABELS[key];
    const value = draftGenerationSettings[key];
    return (
      <div key={key} className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={`voice-setting-${key}`} className="text-xs font-medium text-foreground">
            {metadata.label}
          </label>
          <span className="text-xs tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
        </div>
        <input
          id={`voice-setting-${key}`}
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          aria-valuetext={`${metadata.label} ${value.toFixed(2)}`}
          onChange={(event) => updateGenerationSetting(key, Number(event.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{range.min.toFixed(2)}</span>
          <span>Recommended {range.recommended.toFixed(2)}</span>
          <span>{range.max.toFixed(2)}</span>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{metadata.helper}</p>
      </div>
    );
  };

  const renderVoiceConfigurationControls = () => (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.8fr)]">
        <div className="space-y-2">
          <div className="text-xs font-medium text-foreground">Voice Model</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODEL_OPTIONS.map((option) => {
              const selected = draftModelVariant === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs transition-colors',
                    selected
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border/70 text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  <input
                    type="radio"
                    name="voice-model-variant"
                    value={option.value}
                    checked={selected}
                    onChange={() => setDraftModelVariant(option.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    <span className="mt-0.5 block">{option.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="voice-language-id" className="text-xs font-medium text-foreground">
            Voice Language
          </label>
          <select
            id="voice-language-id"
            value={draftLanguageId}
            onChange={(event) => setDraftLanguageId(event.target.value as TTSLanguageCode)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            {CHATTERBOX_SUPPORTED_LANGUAGE_IDS.map((languageId) => (
              <option key={languageId} value={languageId}>
                {CHATTERBOX_LANGUAGE_LABELS[languageId]}
              </option>
            ))}
          </select>
          <p className="text-xs leading-snug text-muted-foreground">
            Chatterbox receives the selected language ID for previews and narration.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border/70">
        <button
          type="button"
          onClick={() => setAdvancedOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium text-foreground"
          aria-expanded={advancedOpen}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" />
            Advanced Voice Settings
          </span>
          <span className="text-xs text-muted-foreground">{advancedOpen ? 'Hide' : 'Show'}</span>
        </button>

        {advancedOpen && (
          <div className="space-y-4 border-t border-border/70 p-3">
            <div className="grid gap-2 sm:grid-cols-4">
              {PRESET_OPTIONS.map((preset) => {
                const selected = draftPreset === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => applyPreset(preset.value)}
                    className={cn(
                      'rounded-md border p-2 text-left text-xs transition-colors',
                      selected
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border/70 text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    <span className="block font-medium">{preset.label}</span>
                    <span className="mt-0.5 block leading-snug">{preset.description}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {BASIC_SETTING_KEYS.map(renderSettingSlider)}
            </div>

            <div className="rounded-md border border-border/70">
              <button
                type="button"
                onClick={() => setExpertOpen((value) => !value)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium text-foreground"
                aria-expanded={expertOpen}
              >
                <span>Expert Settings</span>
                <span className="text-muted-foreground">{expertOpen ? 'Hide' : 'Show'}</span>
              </button>
              {expertOpen && (
                <div className="grid gap-4 border-t border-border/70 p-3 md:grid-cols-3">
                  {EXPERT_SETTING_KEYS.map(renderSettingSlider)}
                </div>
              )}
            </div>

            <Button type="button" size="sm" variant="outline" onClick={resetRecommendedDraft}>
              <RotateCcw className="size-4" />
              Reset to Recommended
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  const startRecording = async () => {
    setError(null);
    if (!consented) {
      setError('Consent is required before recording.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('This browser does not support audio recording.');
      return;
    }
    const mimeType = chooseMimeType();
    if (!mimeType) {
      setError('This browser cannot record a supported audio format.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      const recordingStartedAt = performance.now();
      replaceRecording({});
      streamRef.current = stream;
      recorderRef.current = recorder;
      setRecordingStartedAt(recordingStartedAt);
      setElapsedSeconds(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        setError('Recording failed. Please try again.');
      };
      recorder.onstop = () => {
        const duration = (performance.now() - recordingStartedAt) / 1000;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecordingStartedAt(null);
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < MIN_RECORDING_SIZE_BYTES) {
          replaceRecording({
            error: 'The recording appears empty. Please check your microphone and try again.',
          });
          return;
        }
        if (duration < MIN_RECORDING_DURATION_SECONDS) {
          replaceRecording({
            error: 'The recording is too short. Please read the full paragraph naturally.',
          });
          return;
        }
        if (duration > MAX_RECORDING_DURATION_SECONDS) {
          replaceRecording({
            error: 'The recording is too long. Please keep it close to ten seconds.',
          });
          return;
        }
        replaceRecording({
          blob,
          duration,
          url: URL.createObjectURL(blob),
        });
      };
      recorder.start();
    } catch (err) {
      setRecordingStartedAt(null);
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied.'
          : 'Microphone is unavailable.',
      );
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  };

  const submitEnrollment = async () => {
    if (!recordingReady || !recording.blob) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set('consent', 'true');
      formData.set('displayName', 'My Teaching Voice');
      formData.set('language', draftLanguageId);
      formData.set('languageId', draftLanguageId);
      formData.set('modelVariant', draftModelVariant);
      formData.set('generationSettings', JSON.stringify(draftGenerationSettings));
      formData.set('recording', recording.blob, 'teaching-voice.webm');
      const response = await fetch('/api/voice-cloning/profile', {
        method: 'POST',
        body: formData,
      });
      const data = (await response.json()) as ApiProfileResponse;
      if (!response.ok || !data.profile) {
        throw new Error(data.details || data.error || 'Voice enrollment failed.');
      }
      setProfile(data.profile);
      const config = data.profile.draftPreview?.config ?? profileConfiguration(data.profile);
      setDraftModelVariant(config.modelVariant);
      setDraftLanguageId(isTTSLanguageCode(config.languageId) ? config.languageId : 'en');
      setDraftGenerationSettings(config.generationSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice enrollment failed.');
    } finally {
      setBusy(false);
    }
  };

  const acceptPreview = async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/voice-cloning/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: profile.id,
          action: 'accept-preview',
          modelVariant: draftModelVariant,
          languageId: draftLanguageId,
          generationSettings: draftGenerationSettings,
        }),
      });
      const data = (await response.json()) as ApiProfileResponse;
      if (!response.ok || !data.profile) {
        throw new Error(data.details || data.error || 'Could not accept preview.');
      }
      setProfile(data.profile);
      const config = profileConfiguration(data.profile);
      setDraftModelVariant(config.modelVariant);
      setDraftLanguageId(config.languageId as TTSLanguageCode);
      setDraftGenerationSettings(config.generationSettings);
      onSelectedProfileIdChange(data.profile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept preview.');
    } finally {
      setBusy(false);
    }
  };

  const generateModelPreview = async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/voice-cloning/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: profile.id,
          action: 'preview-model',
          modelVariant: draftModelVariant,
          languageId: draftLanguageId,
          generationSettings: draftGenerationSettings,
        }),
      });
      const data = (await response.json()) as ApiProfileResponse;
      if (!response.ok || !data.profile) {
        throw new Error(data.details || data.error || 'Could not generate preview.');
      }
      setProfile(data.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate preview.');
    } finally {
      setBusy(false);
    }
  };

  const deleteProfile = async (profileId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
      await fetch(`/api/voice-cloning/profile${query}`, { method: 'DELETE' });
      setProfile(null);
      if (!profileId || selectedProfileId === profileId) {
        onSelectedProfileIdChange(undefined);
      }
      if (!profileId) setOpen(false);
    } catch {
      setError('Could not delete the voice profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 w-full rounded-xl border border-border/70 bg-background/85 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">My Teaching Voice</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {readyProfile
              ? selectedProfileId === readyProfile.id
                ? 'Teaching Voice selected'
                : 'Teaching Voice ready'
              : profile?.status === 'preview-ready'
                ? 'Preview is ready for review'
                : 'Create a private voice for AI Teacher narration'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {readyProfile && (
            <Button
              type="button"
              size="sm"
              variant={selectedProfileId === readyProfile.id ? 'default' : 'outline'}
              onClick={() =>
                onSelectedProfileIdChange(
                  selectedProfileId === readyProfile.id ? undefined : readyProfile.id,
                )
              }
            >
              <Check className="size-4" />
              {selectedProfileId === readyProfile.id ? 'Using Voice' : 'Use Voice'}
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            <Volume2 className="size-4" />
            {readyProfile ? 'Manage Voice' : profile ? 'Continue Setup' : 'Create Voice'}
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-4 border-t border-border/70 pt-4">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {(profile?.status === 'preview-ready' || readyProfile) && (
            <div className="mb-3">{renderVoiceConfigurationControls()}</div>
          )}

          {profile?.status === 'preview-ready' ? (
            <div className="space-y-3">
              {selectedPreview ? (
                <audio
                  controls
                  className="w-full"
                  src={`data:audio/${selectedPreview.format};base64,${selectedPreview.base64}`}
                />
              ) : (
                <Button type="button" size="sm" onClick={generateModelPreview} disabled={busy}>
                  <Play className="size-4" />
                  Generate Preview
                </Button>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={acceptPreview}
                  disabled={busy || !selectedPreview}
                >
                  <Check className="size-4" />
                  Use These Settings
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => deleteProfile(profile.id)}
                  disabled={busy}
                >
                  <RotateCcw className="size-4" />
                  Re-record
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  <X className="size-4" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : readyProfile ? (
            <div className="flex flex-wrap gap-2">
              {selectedPreview && (
                <audio
                  controls
                  className="min-w-[260px] flex-1"
                  src={`data:audio/${selectedPreview.format};base64,${selectedPreview.base64}`}
                />
              )}
              {!draftMatchesAccepted &&
                (selectedPreview ? (
                  <Button type="button" size="sm" onClick={acceptPreview} disabled={busy}>
                    <Check className="size-4" />
                    Use These Settings
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={generateModelPreview} disabled={busy}>
                    <Play className="size-4" />
                    Generate Preview
                  </Button>
                ))}
              <Button type="button" size="sm" variant="outline" onClick={() => setProfile(null)}>
                <RotateCcw className="size-4" />
                Replace Voice
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => deleteProfile()}
                disabled={busy}
              >
                <Trash2 className="size-4" />
                Delete Voice
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="flex items-start gap-3 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(event) => setConsented(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I am recording my own voice. These samples will be stored privately and used to
                  generate course narration in my voice. I can delete my voice profile later.
                </span>
              </label>

              {renderVoiceConfigurationControls()}

              <div className="rounded-lg border border-border/70 p-3">
                <div className="text-sm font-medium text-foreground">
                  Record Your Teaching Voice
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Read this short paragraph naturally, just as you would speak while teaching.
                </p>
                <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-foreground">
                  {enrollmentParagraph}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>Quiet room</span>
                  <span aria-hidden="true">•</span>
                  <span>Steady mic distance</span>
                  <span aria-hidden="true">•</span>
                  <span>Natural voice</span>
                </div>
                <p className="mt-2 text-xs leading-snug text-muted-foreground">
                  Your recording is used only to create your private teaching-voice reference. A
                  quiet, natural recording usually produces the closest result.
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {recordingStartedAt !== null ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={stopRecording}
                      aria-label="Stop recording teaching voice"
                    >
                      <Mic className="size-4" />
                      Stop Recording
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!consented}
                      onClick={startRecording}
                      aria-label={
                        recording.blob
                          ? 'Record teaching voice again'
                          : 'Start recording teaching voice'
                      }
                    >
                      <Mic className="size-4" />
                      {recording.blob ? 'Re-record' : 'Start Recording'}
                    </Button>
                  )}
                  <span
                    className={cn(
                      'rounded-md border px-2 py-1 text-sm tabular-nums',
                      recordingStartedAt !== null
                        ? 'border-destructive/30 bg-destructive/5 text-destructive'
                        : 'border-border text-muted-foreground',
                    )}
                    aria-live="polite"
                  >
                    {formatClock(
                      recordingStartedAt !== null ? elapsedSeconds : (recording.duration ?? 0),
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{recordingGuidance}</span>
                </div>

                {recording.url && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <audio
                      controls
                      className="h-9 min-w-[240px] max-w-full flex-1"
                      src={recording.url}
                    />
                    <span className="text-xs text-muted-foreground">
                      {formatSeconds(recording.duration)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => replaceRecording({})}
                    >
                      <Trash2 className="size-4" />
                      Discard
                    </Button>
                  </div>
                )}

                {recording.error && (
                  <p className="mt-2 text-xs text-destructive" role="alert">
                    {recording.error}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={submitEnrollment}
                  disabled={!recordingReady || busy}
                >
                  <Play className="size-4" />
                  Generate Preview
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
