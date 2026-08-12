'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, Mic, Play, RotateCcw, Trash2, Volume2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getVoiceEnrollmentPhrases } from '@/lib/voice-cloning/phrases';
import {
  MAX_RECORDING_DURATION_SECONDS,
  MIN_RECORDING_DURATION_SECONDS,
} from '@/lib/voice-cloning/limits';
import {
  DEFAULT_CHATTERBOX_MODEL_VARIANT,
  type ChatterboxModelVariant,
  type PublicVoiceProfile,
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

function chooseMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function formatSeconds(value: number | undefined): string {
  if (!value) return '';
  return `${value.toFixed(1)}s`;
}

export function TeachingVoiceCard({
  selectedProfileId,
  onSelectedProfileIdChange,
}: TeachingVoiceCardProps) {
  const phrases = useMemo(() => getVoiceEnrollmentPhrases('en'), []);
  const [profile, setProfile] = useState<PublicVoiceProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [consented, setConsented] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [clips, setClips] = useState<ClipState[]>(phrases.map(() => ({})));
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const [modelVariant, setModelVariant] = useState<ChatterboxModelVariant>(
    DEFAULT_CHATTERBOX_MODEL_VARIANT,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const selectedProfileIdRef = useRef(selectedProfileId);
  const onSelectedProfileIdChangeRef = useRef(onSelectedProfileIdChange);

  const readyProfile = profile?.status === 'ready' ? profile : null;
  const selectedPreview =
    profile?.previewVariants?.[modelVariant] ??
    (profile?.modelVariant === modelVariant ? profile.preview : undefined);
  const allClipsReady = clips.every(
    (clip) =>
      clip.blob &&
      clip.duration &&
      clip.duration >= MIN_RECORDING_DURATION_SECONDS &&
      clip.duration <= MAX_RECORDING_DURATION_SECONDS,
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
        if (next?.modelVariant) setModelVariant(next.modelVariant);
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
      clips.forEach((clip) => {
        if (clip.url) URL.revokeObjectURL(clip.url);
      });
    };
  }, [clips]);

  const replaceClip = (index: number, next: ClipState) => {
    setClips((prev) =>
      prev.map((clip, i) => {
        if (i !== index) return clip;
        if (clip.url) URL.revokeObjectURL(clip.url);
        return next;
      }),
    );
  };

  const renderModelSelector = () => (
    <div className="space-y-2">
      <div className="text-xs font-medium text-foreground">Voice Model</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {MODEL_OPTIONS.map((option) => {
          const selected = modelVariant === option.value;
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
                onChange={() => setModelVariant(option.value)}
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
  );

  const startRecording = async (index: number) => {
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
      streamRef.current = stream;
      recorderRef.current = recorder;
      setRecordingIndex(index);
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
        setRecordingIndex(null);
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size === 0 || duration < MIN_RECORDING_DURATION_SECONDS) {
          replaceClip(index, { error: 'Recording is too short.' });
          return;
        }
        if (duration > MAX_RECORDING_DURATION_SECONDS) {
          replaceClip(index, { error: 'Recording is too long.' });
          return;
        }
        replaceClip(index, {
          blob,
          duration,
          url: URL.createObjectURL(blob),
        });
      };
      recorder.start();
    } catch (err) {
      setRecordingIndex(null);
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
    if (!allClipsReady) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set('consent', 'true');
      formData.set('displayName', 'My Teaching Voice');
      formData.set('language', 'en');
      formData.set('modelVariant', modelVariant);
      clips.forEach((clip, index) => {
        formData.set(`clip${index}`, clip.blob!, `phrase-${index + 1}.webm`);
      });
      const response = await fetch('/api/voice-cloning/profile', {
        method: 'POST',
        body: formData,
      });
      const data = (await response.json()) as ApiProfileResponse;
      if (!response.ok || !data.profile) {
        throw new Error(data.details || data.error || 'Voice enrollment failed.');
      }
      setProfile(data.profile);
      setModelVariant(data.profile.modelVariant);
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
        body: JSON.stringify({ profileId: profile.id, action: 'accept-preview', modelVariant }),
      });
      const data = (await response.json()) as ApiProfileResponse;
      if (!response.ok || !data.profile) {
        throw new Error(data.details || data.error || 'Could not accept preview.');
      }
      setProfile(data.profile);
      setModelVariant(data.profile.modelVariant);
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
        body: JSON.stringify({ profileId: profile.id, action: 'preview-model', modelVariant }),
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

  const deleteProfile = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/voice-cloning/profile', { method: 'DELETE' });
      setProfile(null);
      onSelectedProfileIdChange(undefined);
      setOpen(false);
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
            <div className="mb-3">{renderModelSelector()}</div>
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
                  Preview {modelVariant.toUpperCase()}
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
                  Use This Voice
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setProfile(null)}>
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
              {modelVariant !== readyProfile.modelVariant &&
                (selectedPreview ? (
                  <Button type="button" size="sm" onClick={acceptPreview} disabled={busy}>
                    <Check className="size-4" />
                    Use {modelVariant.toUpperCase()}
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={generateModelPreview} disabled={busy}>
                    <Play className="size-4" />
                    Preview {modelVariant.toUpperCase()}
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
                onClick={deleteProfile}
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

              {renderModelSelector()}

              <div className="rounded-lg border border-border/70 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  {activeIndex + 1} of {phrases.length}
                </div>
                <p className="text-sm leading-relaxed text-foreground">
                  {phrases[activeIndex].text}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {recordingIndex === activeIndex ? (
                    <Button type="button" size="sm" onClick={stopRecording}>
                      <Mic className="size-4" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!consented || recordingIndex !== null}
                      onClick={() => startRecording(activeIndex)}
                    >
                      <Mic className="size-4" />
                      Record
                    </Button>
                  )}
                  {clips[activeIndex].url && (
                    <audio controls className="h-9 max-w-full" src={clips[activeIndex].url} />
                  )}
                  {clips[activeIndex].blob && (
                    <span className="text-xs text-muted-foreground">
                      {formatSeconds(clips[activeIndex].duration)}
                    </span>
                  )}
                  {clips[activeIndex].blob && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => replaceClip(activeIndex, {})}
                    >
                      <Trash2 className="size-4" />
                      Discard
                    </Button>
                  )}
                </div>
                {clips[activeIndex].error && (
                  <p className="mt-2 text-xs text-destructive">{clips[activeIndex].error}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1">
                  {phrases.map((phrase, index) => (
                    <button
                      type="button"
                      key={phrase.id}
                      onClick={() => setActiveIndex(index)}
                      className={cn(
                        'size-7 rounded-full border text-xs transition-colors',
                        index === activeIndex
                          ? 'border-primary bg-primary text-primary-foreground'
                          : clips[index].blob
                            ? 'border-emerald-500/60 bg-emerald-50 text-emerald-700'
                            : 'border-border text-muted-foreground',
                      )}
                    >
                      {index + 1}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))}
                    disabled={activeIndex === 0}
                  >
                    Back
                  </Button>
                  {activeIndex < phrases.length - 1 ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setActiveIndex(activeIndex + 1)}
                      disabled={!clips[activeIndex].blob}
                    >
                      Continue
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={submitEnrollment}
                      disabled={!allClipsReady || busy}
                    >
                      <Play className="size-4" />
                      Generate Preview
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
