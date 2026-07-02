/**
 * Playback Engine - Unified state machine for lecture playback and live discussion
 *
 * Consumes Scene.actions[] directly via ActionEngine.
 * No intermediate compile step — actions are executed as-is.
 *
 * State machine:
 *
 *                  start()                  pause()
 *   idle ──────────────────→ playing ──────────────→ paused
 *     ▲                         ▲                       │
 *     │                         │  resume()             │
 *     │                         └───────────────────────┘
 *     │
 *     │  handleEndDiscussion()
 *     │                         confirmDiscussion()
 *     │                         / handleUserInterrupt()
 *     │                              │
 *     │                              ▼         pause()
 *     └──────────────────────── live ──────────────→ paused
 *                                 ▲                    │
 *                                 │ resume / user msg  │
 *                                 └────────────────────┘
 */

import type { Scene } from '@/lib/types/stage';
import type { Action, SpeechAction, DiscussionAction } from '@/lib/types/action';
import type {
  EngineMode,
  TopicState,
  PlaybackEngineCallbacks,
  PlaybackProgress,
  PlaybackSnapshot,
  TriggerEvent,
  Effect,
} from './types';
import type { AudioPlayer } from '@/lib/utils/audio-player';
import { ActionEngine } from '@/lib/action/engine';
import { resolvePlaybackCursor } from './engine-cursor';
import { useCanvasStore } from '@/lib/store/canvas';
import { useSettingsStore } from '@/lib/store/settings';
import { isTTSProviderEnabled } from '@/lib/audio/provider-enablement';
import { createLogger } from '@/lib/logger';

const log = createLogger('PlaybackEngine');
const DISCUSSION_PROMPT_DELAY_MS = 3000;
const MIN_SPEECH_DURATION_MS = 2000;
const INSTANT_ACTION_DURATION_MS = 0;
const SEEK_UNSAFE_ACTION_TYPES = new Set<Action['type']>([
  'discussion',
  'play_video',
  'widget_highlight',
  'widget_setState',
  'widget_annotation',
  'widget_reveal',
]);

export function isPlaybackSceneSeekable(actions: readonly Action[] = []): boolean {
  return !actions.some((action) => SEEK_UNSAFE_ACTION_TYPES.has(action.type));
}

function isSeekReplayAction(action: Action): boolean {
  return action.type.startsWith('wb_');
}

/**
 * If more than 30% of characters are CJK, treat the text as Chinese.
 * Intentionally low: mixed Chinese text often contains punctuation,
 * numbers, and short Latin fragments (e.g. "AI课堂").
 */
const CJK_LANG_THRESHOLD = 0.3;

export class PlaybackEngine {
  private scenes: Scene[] = [];
  private sceneIndex: number = 0;
  private actionIndex: number = 0;
  private mode: EngineMode = 'idle';
  private consumedDiscussions: Set<string> = new Set();

  // Discussion state save
  private savedSceneIndex: number | null = null;
  private savedActionIndex: number | null = null;

  // Discussion topic state
  private currentTopicState: TopicState | null = null;

  // Dependencies
  private audioPlayer: AudioPlayer;
  private actionEngine: ActionEngine;
  private callbacks: PlaybackEngineCallbacks;

  // Scene identity (for snapshot validation)
  private sceneId: string | undefined;

  // Internal state
  private currentTrigger: TriggerEvent | null = null;
  private triggerDelayTimer: ReturnType<typeof setTimeout> | null = null;
  // Reading-time timer for speech actions without pre-generated audio (TTS disabled)
  private speechTimer: ReturnType<typeof setTimeout> | null = null;
  private speechTimerStart: number = 0; // Date.now() when timer was scheduled
  // Browser-native TTS state (Web Speech API)
  private browserTTSActive: boolean = false;
  private browserTTSChunks: string[] = []; // sentence-level chunks for sequential playback
  private browserTTSChunkIndex: number = 0; // current chunk being spoken
  private browserTTSPausedChunks: string[] = []; // remaining chunks saved on pause (for cancel+re-speak)
  private speechTimerRemaining: number = 0; // remaining ms (set on pause)
  private activeActionIndex: number | null = null;
  private activeActionStartedAt: number = 0;
  private activeActionEstimatedMs: number = 0;
  private pendingSpeechSeekOffsetMs: number = 0;
  private seekProgressOverrideMs: number | null = null;
  private playbackGeneration: number = 0;

  constructor(
    scenes: Scene[],
    actionEngine: ActionEngine,
    audioPlayer: AudioPlayer,
    callbacks: PlaybackEngineCallbacks = {},
  ) {
    this.scenes = scenes;
    this.sceneId = scenes[0]?.id;
    this.actionEngine = actionEngine;
    this.audioPlayer = audioPlayer;
    this.callbacks = callbacks;
  }

  // ==================== Public API ====================

  /** Get the current engine mode */
  getMode(): EngineMode {
    return this.mode;
  }

  /** Export a serializable playback snapshot */
  getSnapshot(): PlaybackSnapshot {
    return {
      sceneIndex: this.sceneIndex,
      actionIndex: this.actionIndex,
      consumedDiscussions: [...this.consumedDiscussions],
      sceneId: this.sceneId,
    };
  }

  /** Restore playback position from a snapshot */
  restoreFromSnapshot(snapshot: PlaybackSnapshot): void {
    this.sceneIndex = snapshot.sceneIndex;
    this.actionIndex = snapshot.actionIndex;
    this.consumedDiscussions = new Set(snapshot.consumedDiscussions);
  }

  /** Get current scene-level playback progress. */
  getProgress(): PlaybackProgress {
    return this.computeProgress();
  }

  /**
   * Seek within the current scene timeline.
   *
   * Seeking is action-boundary based for non-audio actions. For generated
   * speech that is already active, the underlying audio element is seeked
   * precisely; otherwise the offset is applied when the speech action starts.
   */
  async seekTo(timeMs: number): Promise<PlaybackProgress> {
    if (this.mode === 'live' || !this.isCurrentSceneSeekable()) {
      return this.getProgress();
    }

    const durationMs = this.getSceneDurationMs();
    const targetMs = Math.max(0, durationMs > 0 ? Math.min(timeMs, durationMs) : timeMs);
    const timeline = this.getTimeline();
    const wasPlaying = this.mode === 'playing';

    if (durationMs <= 0 || timeline.length === 0) {
      return this.getProgress();
    }

    if (targetMs >= durationMs) {
      const generation = this.cancelActivePlayback();
      this.actionEngine.resetPlaybackVisualState();
      const replayed = await this.replaySeekStateBefore(
        this.scenes[0]?.actions?.length ?? 0,
        generation,
      );
      if (!replayed) return this.getProgress();
      this.sceneIndex = 0;
      this.actionIndex = this.scenes[0]?.actions?.length ?? 0;
      this.activeActionIndex = null;
      this.seekProgressOverrideMs = durationMs;
      this.setMode('idle');
      return this.getProgress();
    }

    const target =
      timeline.find((entry) => targetMs >= entry.startMs && targetMs < entry.endMs) ??
      timeline[timeline.length - 1];
    const offsetMs = Math.max(0, targetMs - target.startMs);

    if (
      this.activeActionIndex === target.actionIndex &&
      target.action.type === 'speech' &&
      this.audioPlayer.seekTo(offsetMs)
    ) {
      const generation = this.invalidatePlaybackWork();
      this.audioPlayer.onEnded(() => {
        if (!this.isCurrentGeneration(generation)) return;
        this.callbacks.onSpeechEnd?.();
        if (this.mode === 'playing') {
          this.processNext();
        }
      });
      this.activeActionStartedAt = Date.now() - offsetMs;
      this.pendingSpeechSeekOffsetMs = 0;
      this.seekProgressOverrideMs = null;
      return this.getProgress();
    }

    const generation = this.cancelActivePlayback();
    this.actionEngine.resetPlaybackVisualState();
    const replayed = await this.replaySeekStateBefore(target.actionIndex, generation);
    if (!replayed) return this.getProgress();
    this.sceneIndex = 0;
    this.actionIndex = target.actionIndex;
    this.activeActionIndex = null;
    this.pendingSpeechSeekOffsetMs = target.action.type === 'speech' ? offsetMs : 0;
    this.seekProgressOverrideMs = target.startMs + this.pendingSpeechSeekOffsetMs;

    if (wasPlaying) {
      this.setMode('playing');
      this.processNext();
    } else {
      this.setMode('paused');
    }

    return this.getProgress();
  }

  /** idle → playing (from beginning) */
  start(): void {
    if (this.mode !== 'idle') {
      log.warn('Cannot start: not idle, current mode:', this.mode);
      return;
    }

    this.sceneIndex = 0;
    this.actionIndex = 0;
    this.pendingSpeechSeekOffsetMs = 0;
    this.seekProgressOverrideMs = null;
    this.invalidatePlaybackWork();
    this.setMode('playing');
    this.processNext();
  }

  /** idle → playing (continue from current position, e.g. after discussion end) */
  continuePlayback(): void {
    if (this.mode !== 'idle') {
      log.warn('Cannot continue: not idle, current mode:', this.mode);
      return;
    }
    this.seekProgressOverrideMs = null;
    this.invalidatePlaybackWork();
    this.setMode('playing');
    this.processNext();
  }

  /** playing → paused | live → paused (abort SSE, truncate, topic pending) */
  pause(): void {
    if (this.mode === 'playing') {
      this.invalidatePlaybackWork();
      const pausedAtMs = this.computeProgress().currentTimeMs;
      // Cancel pending timers
      if (this.triggerDelayTimer) {
        clearTimeout(this.triggerDelayTimer);
        this.triggerDelayTimer = null;
      }
      if (this.speechTimer) {
        // Save remaining time so resume() can reschedule
        this.speechTimerRemaining = Math.max(
          0,
          this.speechTimerRemaining - (Date.now() - this.speechTimerStart),
        );
        clearTimeout(this.speechTimer);
        this.speechTimer = null;
      }
      this.setMode('paused');
      // Freeze TTS — but skip if waiting on ProactiveCard (no active speech)
      if (!this.currentTrigger) {
        if (this.browserTTSActive) {
          // Cancel+re-speak pattern: save remaining chunks for resume.
          // speechSynthesis.pause()/resume() is broken on Firefox, so we
          // cancel now and re-speak from current chunk onward on resume.
          this.browserTTSPausedChunks = this.browserTTSChunks.slice(this.browserTTSChunkIndex);
          window.speechSynthesis?.cancel();
          // Note: cancel fires onerror('canceled'), which we ignore (see playBrowserTTSChunk)
        } else if (this.audioPlayer.isPlaying()) {
          this.audioPlayer.pause();
        }
      }
      this.seekProgressOverrideMs = pausedAtMs;
    } else if (this.mode === 'live') {
      this.invalidatePlaybackWork();
      this.setMode('paused');
      this.currentTopicState = 'pending';
      // Caller is responsible for aborting SSE
    } else {
      log.warn('Cannot pause: mode is', this.mode);
    }
  }

  /** paused → playing (TTS resume) | paused (in discussion) → live */
  resume(): void {
    if (this.mode !== 'paused') {
      log.warn('Cannot resume: not paused, mode is', this.mode);
      return;
    }

    if (this.currentTopicState === 'pending') {
      // Resume discussion → live
      this.currentTopicState = 'active';
      this.setMode('live');
    } else if (this.currentTrigger) {
      // Waiting on ProactiveCard — just resume mode, don't touch audio
      this.setMode('playing');
    } else {
      // Resume lecture
      const generation = this.invalidatePlaybackWork();
      const resumeProgressMs = this.seekProgressOverrideMs;
      this.setMode('playing');
      if (this.browserTTSPausedChunks.length > 0) {
        // Browser TTS was paused via cancel — re-speak remaining chunks
        this.browserTTSActive = true;
        this.browserTTSChunks = this.browserTTSPausedChunks;
        this.browserTTSChunkIndex = 0;
        this.browserTTSPausedChunks = [];
        if (resumeProgressMs !== null && this.activeActionIndex !== null) {
          this.activeActionStartedAt =
            Date.now() -
            Math.max(0, resumeProgressMs - this.getActionStartMs(this.activeActionIndex));
        }
        this.seekProgressOverrideMs = null;
        this.playBrowserTTSChunk(generation);
      } else if (this.audioPlayer.hasActiveAudio()) {
        // Audio is paused — resume it; TTS onend will call processNext
        this.seekProgressOverrideMs = null;
        this.audioPlayer.onEnded(() => {
          if (!this.isCurrentGeneration(generation)) return;
          this.callbacks.onSpeechEnd?.();
          if (this.mode === 'playing') {
            this.processNext();
          }
        });
        this.audioPlayer.resume();
      } else if (this.speechTimerRemaining > 0) {
        // Reading timer was paused — reschedule with remaining time
        if (resumeProgressMs !== null && this.activeActionIndex !== null) {
          this.activeActionStartedAt =
            Date.now() -
            Math.max(0, resumeProgressMs - this.getActionStartMs(this.activeActionIndex));
        }
        this.seekProgressOverrideMs = null;
        this.speechTimerStart = Date.now();
        this.speechTimer = setTimeout(() => {
          if (!this.isCurrentGeneration(generation)) return;
          this.speechTimer = null;
          this.speechTimerRemaining = 0;
          this.callbacks.onSpeechEnd?.();
          if (this.mode === 'playing') this.processNext();
        }, this.speechTimerRemaining);
      } else {
        // TTS finished while paused, continue to next event
        this.seekProgressOverrideMs = null;
        this.processNext();
      }
    }
  }

  /** → idle */
  stop(): void {
    this.invalidatePlaybackWork();
    // Set mode BEFORE stopping audio to prevent spurious processNext from
    // synchronous onend callbacks (see handleUserInterrupt for details).
    this.setMode('idle');
    this.audioPlayer.stop();
    this.cancelBrowserTTS();
    useCanvasStore.getState().pauseVideo();
    this.actionEngine.clearEffects();
    if (this.triggerDelayTimer) {
      clearTimeout(this.triggerDelayTimer);
      this.triggerDelayTimer = null;
    }
    if (this.speechTimer) {
      clearTimeout(this.speechTimer);
      this.speechTimer = null;
    }
    this.speechTimerRemaining = 0;
    this.activeActionIndex = null;
    this.activeActionStartedAt = 0;
    this.activeActionEstimatedMs = 0;
    this.pendingSpeechSeekOffsetMs = 0;
    this.seekProgressOverrideMs = null;
    this.sceneIndex = 0;
    this.actionIndex = 0;
    this.savedSceneIndex = null;
    this.savedActionIndex = null;
    this.currentTopicState = null;
    this.currentTrigger = null;
  }

  /** User clicks "Join" on ProactiveCard → save cursor → live */
  confirmDiscussion(): void {
    if (!this.currentTrigger) {
      log.warn('confirmDiscussion called but no trigger');
      return;
    }

    // Mark consumed so it won't re-trigger on replay
    this.consumedDiscussions.add(this.currentTrigger.id);

    // Save lecture state — keep actionIndex as-is (past the discussion).
    // Discussions are placed after all speech actions, so the preceding
    // speech was already fully played; no need to replay it.
    this.savedSceneIndex = this.sceneIndex;
    this.savedActionIndex = this.actionIndex;

    // Enter live mode
    this.currentTopicState = 'active';
    this.setMode('live');

    // Notify callbacks
    this.callbacks.onProactiveHide?.();
    this.callbacks.onDiscussionConfirmed?.(
      this.currentTrigger.question,
      this.currentTrigger.prompt,
      this.currentTrigger.agentId,
    );
    this.currentTrigger = null;
  }

  /** User clicks "Skip" on ProactiveCard → consumed → processNext */
  skipDiscussion(): void {
    if (this.currentTrigger) {
      this.consumedDiscussions.add(this.currentTrigger.id);
      this.currentTrigger = null;
    }
    this.callbacks.onProactiveHide?.();

    if (this.mode === 'playing') {
      this.processNext();
    }
  }

  /** End discussion → restore lecture → idle (user clicks "start" to continue) */
  handleEndDiscussion(): void {
    this.invalidatePlaybackWork();
    this.actionEngine.clearEffects();
    this.currentTopicState = 'closed';

    // Close whiteboard if it was open during the discussion
    useCanvasStore.getState().setWhiteboardOpen(false);

    this.callbacks.onDiscussionEnd?.();

    // Restore lecture state
    this.restoreSavedLectureState();

    this.setMode('idle');
  }

  /**
   * Exit live discussion mode after a request failure without treating it as a
   * normal discussion end. The chat session stays retryable; this only restores
   * the playback engine to a coherent non-live state.
   */
  handleDiscussionError(): void {
    const hasSavedLectureState = this.savedSceneIndex !== null && this.savedActionIndex !== null;
    const isLiveTopic =
      this.mode === 'live' || (this.mode === 'paused' && this.currentTopicState === 'pending');

    if (!isLiveTopic && !hasSavedLectureState) {
      return;
    }

    this.invalidatePlaybackWork();
    this.actionEngine.clearEffects();
    useCanvasStore.getState().setWhiteboardOpen(false);
    this.currentTopicState = 'closed';
    this.currentTrigger = null;
    this.restoreSavedLectureState();
    this.setMode('idle');
  }

  /** User sends a message during playback → interrupt → live mode */
  handleUserInterrupt(text: string): void {
    this.invalidatePlaybackWork();
    if (this.mode === 'playing' || this.mode === 'paused') {
      // Save lecture state BEFORE stopping audio — actionIndex was already
      // incremented by processNext, so subtract 1 to replay the interrupted
      // sentence when resuming.  Guard against overwriting a previously saved
      // position (e.g. live → paused → new message).
      if (this.savedSceneIndex === null) {
        this.savedSceneIndex = this.sceneIndex;
        this.savedActionIndex = Math.max(0, this.actionIndex - 1);
      }

      // Cancel pending trigger delay
      if (this.triggerDelayTimer) {
        clearTimeout(this.triggerDelayTimer);
        this.triggerDelayTimer = null;
      }
    }

    // Set mode BEFORE stopping audio — speechSynthesis.cancel() may fire the
    // onend callback synchronously, and the processNext guard checks
    // `this.mode === 'playing'`.  Setting mode first prevents a spurious
    // processNext that would advance actionIndex past the interrupted speech.
    this.currentTopicState = 'active';
    this.setMode('live');
    this.audioPlayer.stop();
    this.cancelBrowserTTS();
    this.callbacks.onUserInterrupt?.(text);
  }

  /** Whether all remaining actions have been consumed (no speech left to play) */
  isExhausted(): boolean {
    let si = this.sceneIndex;
    let ai = this.actionIndex;
    while (si < this.scenes.length) {
      const actions = this.scenes[si].actions || [];
      while (ai < actions.length) {
        const action = actions[ai];
        // Consumed discussions don't count as remaining work
        if (action.type === 'discussion' && this.consumedDiscussions.has(action.id)) {
          ai++;
          continue;
        }
        return false;
      }
      si++;
      ai = 0;
    }
    return true;
  }

  // ==================== Private ====================

  private setMode(mode: EngineMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.callbacks.onModeChange?.(mode);
  }

  private invalidatePlaybackWork(): number {
    this.playbackGeneration += 1;
    return this.playbackGeneration;
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.playbackGeneration;
  }

  private getSceneActions(): Action[] {
    return this.scenes[0]?.actions ?? [];
  }

  private isCurrentSceneSeekable(): boolean {
    return isPlaybackSceneSeekable(this.getSceneActions());
  }

  private async replaySeekStateBefore(actionIndex: number, generation: number): Promise<boolean> {
    const actions = this.getSceneActions();
    const replayUntil = Math.min(actionIndex, actions.length);
    for (let index = 0; index < replayUntil; index++) {
      if (!this.isCurrentGeneration(generation)) return false;
      const action = actions[index];
      if (!isSeekReplayAction(action)) continue;
      await this.actionEngine.execute(action, { silent: true });
      if (!this.isCurrentGeneration(generation)) return false;
    }
    return true;
  }

  private cancelActivePlayback(): number {
    const generation = this.invalidatePlaybackWork();
    this.setMode('idle');
    this.audioPlayer.stop();
    this.cancelBrowserTTS();
    useCanvasStore.getState().pauseVideo();
    if (this.triggerDelayTimer) {
      clearTimeout(this.triggerDelayTimer);
      this.triggerDelayTimer = null;
    }
    if (this.speechTimer) {
      clearTimeout(this.speechTimer);
      this.speechTimer = null;
    }
    this.speechTimerRemaining = 0;
    this.activeActionIndex = null;
    this.activeActionStartedAt = 0;
    this.activeActionEstimatedMs = 0;
    if (this.currentTrigger) {
      this.currentTrigger = null;
      this.callbacks.onProactiveHide?.();
    }
    this.actionEngine.clearEffects();
    return generation;
  }

  private getSpeechDurationMs(action: SpeechAction): number {
    const text = action.text;
    const cjkCount = (
      text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []
    ).length;
    const isCJK = text.length > 0 && cjkCount > text.length * CJK_LANG_THRESHOLD;
    const speed = this.callbacks.getPlaybackSpeed?.() ?? 1;
    const rawMs = isCJK
      ? Math.max(MIN_SPEECH_DURATION_MS, text.length * 150)
      : Math.max(MIN_SPEECH_DURATION_MS, text.split(/\s+/).filter(Boolean).length * 240);
    return rawMs / speed;
  }

  private getActionDurationMs(action: Action, actionIndex?: number): number {
    if (action.type === 'speech') {
      if (this.activeActionIndex === actionIndex) {
        const audioDuration = this.audioPlayer.getDuration();
        if (audioDuration > 0) return audioDuration;
      }
      return this.getSpeechDurationMs(action as SpeechAction);
    }
    if (action.type === 'discussion') return DISCUSSION_PROMPT_DELAY_MS;
    return INSTANT_ACTION_DURATION_MS;
  }

  private getTimeline(): Array<{
    action: Action;
    actionIndex: number;
    startMs: number;
    endMs: number;
  }> {
    const actions = this.scenes[0]?.actions ?? [];
    let cursorMs = 0;
    return actions.map((action, actionIndex) => {
      const durationMs = this.getActionDurationMs(action, actionIndex);
      const entry = {
        action,
        actionIndex,
        startMs: cursorMs,
        endMs: cursorMs + durationMs,
      };
      cursorMs += durationMs;
      return entry;
    });
  }

  private getSceneDurationMs(): number {
    const timeline = this.getTimeline();
    return timeline[timeline.length - 1]?.endMs ?? 0;
  }

  private getActionStartMs(actionIndex: number): number {
    const timeline = this.getTimeline();
    return timeline.find((entry) => entry.actionIndex === actionIndex)?.startMs ?? 0;
  }

  private computeProgress(): PlaybackProgress {
    const actions = this.scenes[0]?.actions ?? [];
    const durationMs = this.getSceneDurationMs();
    let currentTimeMs = 0;

    if (this.seekProgressOverrideMs !== null) {
      currentTimeMs = this.seekProgressOverrideMs;
    } else if (this.activeActionIndex !== null) {
      const action = actions[this.activeActionIndex];
      const actionStartMs = this.getActionStartMs(this.activeActionIndex);
      let elapsedMs = Math.max(0, Date.now() - this.activeActionStartedAt);

      if (action?.type === 'speech') {
        const audioCurrent = this.audioPlayer.getCurrentTime();
        if (audioCurrent > 0 || this.audioPlayer.hasActiveAudio()) {
          elapsedMs = audioCurrent;
        } else if (this.speechTimerRemaining > 0 && !this.speechTimer) {
          elapsedMs = Math.max(0, this.activeActionEstimatedMs - this.speechTimerRemaining);
        }
      }

      const actionDurationMs = action
        ? this.getActionDurationMs(action, this.activeActionIndex)
        : 0;
      currentTimeMs = actionStartMs + Math.min(elapsedMs, actionDurationMs);
    } else if (this.actionIndex >= actions.length && actions.length > 0) {
      currentTimeMs = durationMs;
    } else {
      currentTimeMs = this.getActionStartMs(this.actionIndex);
    }

    return {
      sceneId: this.sceneId,
      currentTimeMs: Math.max(0, durationMs > 0 ? Math.min(currentTimeMs, durationMs) : 0),
      durationMs,
      seekable: durationMs > 0 && this.isCurrentSceneSeekable(),
      actionIndex: this.activeActionIndex ?? this.actionIndex,
    };
  }

  private restoreSavedLectureState(): void {
    if (this.savedSceneIndex !== null && this.savedActionIndex !== null) {
      this.sceneIndex = this.savedSceneIndex;
      this.actionIndex = this.savedActionIndex;
    }
    this.savedSceneIndex = null;
    this.savedActionIndex = null;
  }

  /**
   * Get the current action, or null if playback is complete.
   * Advances sceneIndex automatically when a scene's actions are exhausted.
   * A scene with no actions yields one synthetic dwell beat (so the slide still
   * shows) instead of being skipped — see {@link resolvePlaybackCursor}.
   */
  private getCurrentAction(): { action: Action; sceneId: string } | null {
    const res = resolvePlaybackCursor(this.scenes, this.sceneIndex, this.actionIndex);
    if (!res) return null;
    this.sceneIndex = res.sceneIndex;
    this.actionIndex = res.actionIndex;
    return { action: res.action, sceneId: res.sceneId };
  }

  /**
   * Core processing loop: consume the next action.
   */
  private async processNext(): Promise<void> {
    if (this.mode !== 'playing') return;
    const generation = this.playbackGeneration;

    // Check for scene boundary (fire scene change callback at start of each new scene)
    if (this.actionIndex === 0 && this.sceneIndex < this.scenes.length) {
      const scene = this.scenes[this.sceneIndex];
      this.actionEngine.clearEffects();
      this.callbacks.onSceneChange?.(scene.id);
      this.callbacks.onSpeakerChange?.('teacher');
    }

    const current = this.getCurrentAction();
    if (!this.isCurrentGeneration(generation)) return;
    if (!current) {
      // All scenes complete
      this.actionEngine.clearEffects();
      this.activeActionIndex = null;
      this.seekProgressOverrideMs = this.getSceneDurationMs();
      this.setMode('idle');
      this.callbacks.onComplete?.();
      return;
    }

    const { action } = current;

    // Notify progress BEFORE advancing the cursor so the snapshot points at
    // the current action.  On restore the same action will be replayed — this
    // is the desired behaviour for speech (user may have only heard half).
    this.callbacks.onProgress?.(this.getSnapshot());

    const actionOffsetMs = action.type === 'speech' ? this.pendingSpeechSeekOffsetMs : 0;
    this.activeActionIndex = this.actionIndex;
    this.activeActionEstimatedMs = this.getActionDurationMs(action, this.actionIndex);
    this.activeActionStartedAt = Date.now() - actionOffsetMs;
    this.seekProgressOverrideMs = null;
    this.actionIndex++;

    switch (action.type) {
      case 'speech': {
        const speechAction = action as SpeechAction;
        this.callbacks.onSpeechStart?.(speechAction.text);

        // onEnded → processNext; if paused, resume() will call processNext
        this.audioPlayer.onEnded(() => {
          if (!this.isCurrentGeneration(generation)) return;
          this.callbacks.onSpeechEnd?.();
          if (this.mode === 'playing') {
            this.processNext();
          }
        });

        // Estimated reading time when no pre-generated audio (TTS disabled).
        // CJK text: ~150ms/char (one char ≈ one word).
        // Non-CJK text: ~240ms/word (≈250 WPM).
        // Min 2s. Cancelled on pause; resume() calls processNext directly.
        const scheduleReadingTimer = () => {
          if (!this.isCurrentGeneration(generation)) return;
          const readingMs = this.getSpeechDurationMs(speechAction);
          const remainingMs = Math.max(0, readingMs - actionOffsetMs);
          this.speechTimerStart = Date.now();
          this.speechTimerRemaining = remainingMs;
          this.pendingSpeechSeekOffsetMs = 0;
          this.speechTimer = setTimeout(() => {
            if (!this.isCurrentGeneration(generation)) return;
            this.speechTimer = null;
            this.speechTimerRemaining = 0;
            this.callbacks.onSpeechEnd?.();
            if (this.mode === 'playing') this.processNext();
          }, remainingMs);
        };

        // A speech line with no text (e.g. a freshly inserted blank slide's
        // seeded clip, or one the user cleared) has nothing to synthesize —
        // route it straight to the reading timer for a short dwell. Speaking an
        // empty SpeechSynthesisUtterance doesn't reliably fire onend in Chromium,
        // which would hang playback on that slide.
        const hasText = !!speechAction.text.trim();

        this.audioPlayer
          .play(speechAction.audioId || '', speechAction.audioUrl, actionOffsetMs)
          .then((audioStarted) => {
            if (!this.isCurrentGeneration(generation)) return;
            if (!audioStarted) {
              // No pre-generated audio — try browser-native TTS only when it is
              // the selected provider AND actually enabled (opt-in, #665).
              const settings = useSettingsStore.getState();
              if (
                hasText &&
                settings.ttsEnabled &&
                settings.ttsProviderId === 'browser-native-tts' &&
                isTTSProviderEnabled(
                  'browser-native-tts',
                  settings.ttsProvidersConfig?.['browser-native-tts'],
                ) &&
                typeof window !== 'undefined' &&
                window.speechSynthesis
              ) {
                this.playBrowserTTS(speechAction, actionOffsetMs, generation);
              } else {
                scheduleReadingTimer();
              }
            } else if (actionOffsetMs > 0) {
              this.pendingSpeechSeekOffsetMs = 0;
            }
          })
          .catch((err) => {
            if (!this.isCurrentGeneration(generation)) return;
            log.error('TTS error:', err);
            scheduleReadingTimer();
          });
        break;
      }

      case 'spotlight':
      case 'laser': {
        // Fire-and-forget visual effects via ActionEngine
        this.actionEngine.execute(action);
        this.callbacks.onEffectFire?.({
          kind: action.type,
          targetId: action.elementId,
          ...(action.type === 'spotlight'
            ? { dimOpacity: action.dimOpacity }
            : { color: action.color }),
        } as Effect);
        // Don't block — continue immediately (use queueMicrotask to avoid
        // stack overflow from deep synchronous recursion when many consecutive
        // spotlight/laser actions appear in sequence)
        queueMicrotask(() => {
          if (this.isCurrentGeneration(generation)) this.processNext();
        });
        break;
      }

      case 'discussion': {
        const discussionAction = action as DiscussionAction;
        // Check if already consumed
        if (this.consumedDiscussions.has(discussionAction.id)) {
          if (this.isCurrentGeneration(generation)) this.processNext();
          return;
        }
        // Skip if the discussion's agent isn't in the user's selected list
        if (
          discussionAction.agentId &&
          this.callbacks.isAgentSelected &&
          !this.callbacks.isAgentSelected(discussionAction.agentId)
        ) {
          this.consumedDiscussions.add(discussionAction.id);
          if (this.isCurrentGeneration(generation)) this.processNext();
          return;
        }

        // Short delay before showing ProactiveCard (allows previous speech to finish naturally)
        const trigger: TriggerEvent = {
          id: discussionAction.id,
          question: discussionAction.topic,
          prompt: discussionAction.prompt,
          agentId: discussionAction.agentId,
        };

        this.triggerDelayTimer = setTimeout(() => {
          if (!this.isCurrentGeneration(generation)) return;
          this.triggerDelayTimer = null;
          if (this.mode !== 'playing') return; // Cancelled if user paused/stopped
          this.currentTrigger = trigger;
          this.callbacks.onProactiveShow?.(trigger);
          // Engine pauses here — user calls confirmDiscussion() or skipDiscussion()
        }, DISCUSSION_PROMPT_DELAY_MS);
        break;
      }

      case 'play_video':
      case 'wb_open':
      case 'wb_draw_text':
      case 'wb_draw_shape':
      case 'wb_draw_chart':
      case 'wb_draw_latex':
      case 'wb_draw_table':
      case 'wb_draw_line':
      case 'wb_draw_code':
      case 'wb_edit_code':
      case 'wb_clear':
      case 'wb_delete':
      case 'wb_close':
      case 'widget_highlight':
      case 'widget_setState':
      case 'widget_annotation':
      case 'widget_reveal': {
        // Synchronous actions — await completion, then continue
        await this.actionEngine.execute(action);
        if (!this.isCurrentGeneration(generation)) return;
        if (this.mode === 'playing') {
          this.processNext();
        }
        break;
      }

      default:
        // Unknown action, skip
        if (this.isCurrentGeneration(generation)) this.processNext();
        break;
    }
  }

  // ==================== Browser Native TTS ====================

  /**
   * Split text into sentence-level chunks for sequential playback.
   * Chrome has a bug where utterances >~15s are silently cut off and onend
   * never fires, causing the engine to hang. Chunking avoids this.
   */
  private splitIntoChunks(text: string): string[] {
    // Split on sentence-ending punctuation (Latin + CJK) and newlines
    const chunks = text
      .split(/(?<=[.!?。！？\n])\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (chunks.length > 0) return chunks;
    // Blank/whitespace text → no chunks (so playBrowserTTSChunk finishes cleanly
    // instead of speaking an empty utterance that never fires onend). Otherwise
    // the text had no sentence punctuation — speak it as one chunk.
    return text.trim() ? [text] : [];
  }

  /**
   * Play text using the Web Speech API (browser-native TTS).
   * Splits text into sentence-level chunks to avoid Chrome's ~15s cutoff.
   * Uses cancel+re-speak for pause/resume (Firefox compatibility).
   */
  private getBrowserTTSStartChunkIndex(
    chunks: string[],
    offsetMs: number,
    totalMs: number,
  ): number {
    if (offsetMs <= 0 || totalMs <= 0 || chunks.length <= 1) return 0;

    const totalUnits = chunks.reduce((sum, chunk) => sum + Math.max(1, chunk.length), 0);
    let elapsedMs = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkMs = (Math.max(1, chunks[i].length) / totalUnits) * totalMs;
      if (offsetMs < elapsedMs + chunkMs) return i;
      elapsedMs += chunkMs;
    }

    return Math.max(0, chunks.length - 1);
  }

  private playBrowserTTS(
    speechAction: SpeechAction,
    offsetMs = 0,
    generation = this.playbackGeneration,
  ): void {
    if (!this.isCurrentGeneration(generation)) return;
    this.browserTTSChunks = this.splitIntoChunks(speechAction.text);
    this.browserTTSChunkIndex = this.getBrowserTTSStartChunkIndex(
      this.browserTTSChunks,
      offsetMs,
      this.getSpeechDurationMs(speechAction),
    );
    this.browserTTSPausedChunks = [];
    this.pendingSpeechSeekOffsetMs = 0;
    this.browserTTSActive = true;
    this.playBrowserTTSChunk(generation);
  }

  /** Speak the current chunk; on completion, advance to next or finish. */
  private async playBrowserTTSChunk(generation = this.playbackGeneration): Promise<void> {
    if (!this.isCurrentGeneration(generation)) return;
    if (this.browserTTSChunkIndex >= this.browserTTSChunks.length) {
      // All chunks done
      this.browserTTSActive = false;
      this.browserTTSChunks = [];
      this.callbacks.onSpeechEnd?.();
      if (this.mode === 'playing' && this.isCurrentGeneration(generation)) this.processNext();
      return;
    }

    const settings = useSettingsStore.getState();
    const chunkText = this.browserTTSChunks[this.browserTTSChunkIndex];
    const utterance = new SpeechSynthesisUtterance(chunkText);

    // Apply settings
    const speed = this.callbacks.getPlaybackSpeed?.() ?? 1;
    utterance.rate = (settings.ttsSpeed ?? 1) * speed;
    utterance.volume = settings.ttsMuted ? 0 : (settings.ttsVolume ?? 1);

    // Ensure voices are loaded (Chrome loads them asynchronously)
    const voices = await this.ensureVoicesLoaded();
    if (!this.isCurrentGeneration(generation)) return;

    // Set voice: try user's configured voice, fall back to auto-detect language
    let voiceFound = false;
    if (settings.ttsVoice && settings.ttsVoice !== 'default') {
      const voice = voices.find((v) => v.voiceURI === settings.ttsVoice);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
        voiceFound = true;
      }
    }
    if (!voiceFound) {
      // No usable voice configured — detect text language so the browser
      // auto-selects an appropriate voice.
      const cjkRatio =
        chunkText.length > 0
          ? (chunkText.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length / chunkText.length
          : 0;
      utterance.lang = cjkRatio > CJK_LANG_THRESHOLD ? 'zh-CN' : 'en-US';
    }

    utterance.onend = () => {
      if (!this.isCurrentGeneration(generation)) return;
      this.browserTTSChunkIndex++;
      if (this.mode === 'playing') {
        this.playBrowserTTSChunk(generation); // next chunk
      }
    };

    utterance.onerror = (event) => {
      if (!this.isCurrentGeneration(generation)) return;
      // 'canceled' is expected when stop/pause is called — not a real error
      if (event.error !== 'canceled') {
        log.warn('Browser TTS chunk error:', event.error);
        // Skip failed chunk, try next
        this.browserTTSChunkIndex++;
        if (this.mode === 'playing') {
          this.playBrowserTTSChunk(generation);
        }
      }
      // On 'canceled': do nothing — pause handler already saved state
    };

    // Chrome bug workaround: cancel() before speak() to clear stale synthesis
    // state that can produce garbled/broken audio output.
    if (!this.isCurrentGeneration(generation)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  /**
   * Wait for speechSynthesis voices to load (Chrome loads them asynchronously).
   * Caches result so subsequent calls return immediately.
   */
  private cachedVoices: SpeechSynthesisVoice[] | null = null;
  private async ensureVoicesLoaded(): Promise<SpeechSynthesisVoice[]> {
    if (this.cachedVoices && this.cachedVoices.length > 0) {
      return this.cachedVoices;
    }

    let voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      this.cachedVoices = voices;
      return voices;
    }

    // Chrome: voices load asynchronously — wait for the voiceschanged event
    await new Promise<void>((resolve) => {
      const onVoicesChanged = () => {
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        resolve();
      };
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
      // Timeout after 2s to avoid hanging
      setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        resolve();
      }, 2000);
    });

    voices = window.speechSynthesis.getVoices();
    this.cachedVoices = voices;
    return voices;
  }

  /** Cancel any active browser-native TTS */
  private cancelBrowserTTS(): void {
    if (this.browserTTSActive) {
      this.browserTTSActive = false;
      this.browserTTSChunks = [];
      this.browserTTSChunkIndex = 0;
      this.browserTTSPausedChunks = [];
      window.speechSynthesis?.cancel();
    }
  }
}
