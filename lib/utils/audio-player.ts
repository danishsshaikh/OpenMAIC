/**
 * Audio Player - Audio player interface
 *
 * Handles audio playback, pause, stop, and other operations
 * Loads pre-generated TTS audio files from IndexedDB
 *
 */

import { db } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioPlayer');

/**
 * Audio player implementation
 */
export class AudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private onEndedCallback: (() => void) | null = null;
  private muted: boolean = false;
  private volume: number = 1;
  private playbackRate: number = 1;
  private playRequestId: number = 0;

  private clearAudio(resetTime = true): void {
    if (!this.audio) return;
    this.audio.pause();
    if (resetTime) {
      this.audio.currentTime = 0;
    }
    this.audio = null;
  }

  private isCurrentRequest(requestId: number): boolean {
    return requestId === this.playRequestId;
  }

  /**
   * Play audio (from URL or IndexedDB pre-generated cache)
   * @param audioId Audio ID
   * @param audioUrl Optional server-generated audio URL (takes priority over IndexedDB)
   * @param startTimeMs Optional start offset in milliseconds
   * @returns true if audio started playing, false if no audio (TTS disabled or not generated)
   */
  public async play(audioId: string, audioUrl?: string, startTimeMs = 0): Promise<boolean> {
    const requestId = ++this.playRequestId;
    this.clearAudio();

    try {
      // 1. Try audioUrl first (server-generated TTS)
      if (audioUrl) {
        const audio = new Audio();
        this.audio = audio;
        audio.src = audioUrl;
        if (this.muted) audio.volume = 0;
        else audio.volume = this.volume;
        audio.defaultPlaybackRate = this.playbackRate;
        audio.playbackRate = this.playbackRate;
        audio.addEventListener('ended', () => {
          if (!this.isCurrentRequest(requestId) || this.audio !== audio) return;
          this.audio = null;
          this.onEndedCallback?.();
        });
        this.seekTo(startTimeMs);
        await audio.play();
        if (!this.isCurrentRequest(requestId) || this.audio !== audio) {
          audio.pause();
          return false;
        }
        audio.playbackRate = this.playbackRate;
        return true;
      }

      // 2. Fall back to IndexedDB (client-generated TTS)
      const audioRecord = await db.audioFiles.get(audioId);
      if (!this.isCurrentRequest(requestId)) {
        return false;
      }

      if (!audioRecord) {
        // Pre-generated audio does not exist (generation failed), skip silently
        return false;
      }

      // Create audio element
      const audio = new Audio();
      this.audio = audio;

      // Set audio source
      const blobUrl = URL.createObjectURL(audioRecord.blob);
      audio.src = blobUrl;
      if (this.muted) audio.volume = 0;
      else audio.volume = this.volume;

      // Apply playback rate
      audio.defaultPlaybackRate = this.playbackRate;
      audio.playbackRate = this.playbackRate;
      this.seekTo(startTimeMs);

      // Set ended callback
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(blobUrl);
        if (!this.isCurrentRequest(requestId) || this.audio !== audio) return;
        this.audio = null;
        this.onEndedCallback?.();
      });

      // Play. If play() rejects (autoplay policy, decode error, interrupted
      // load) the 'ended' listener never fires, so revoke the blob URL here to
      // avoid leaking it for the lifetime of the document.
      try {
        await audio.play();
      } catch (playError) {
        URL.revokeObjectURL(blobUrl);
        if (this.isCurrentRequest(requestId) && this.audio === audio) {
          this.audio = null;
        }
        throw playError;
      }
      if (!this.isCurrentRequest(requestId) || this.audio !== audio) {
        audio.pause();
        URL.revokeObjectURL(blobUrl);
        return false;
      }
      // Re-apply after play() — some browsers reset during load
      audio.playbackRate = this.playbackRate;
      return true;
    } catch (error) {
      if (!this.isCurrentRequest(requestId)) {
        return false;
      }
      log.error('Failed to play audio:', error);
      throw error;
    }
  }

  /**
   * Pause playback
   */
  public pause(): void {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
  }

  /**
   * Stop playback
   */
  public stop(): void {
    this.playRequestId += 1;
    this.clearAudio();
    // Note: onEndedCallback intentionally NOT cleared here because play()
    // calls stop() internally — clearing would break the callback chain.
    // Stale callbacks are harmless: engine mode check prevents processNext().
  }

  /**
   * Resume playback
   */
  public resume(): void {
    if (this.audio?.paused) {
      this.audio.playbackRate = this.playbackRate;
      this.audio.play().catch((error) => {
        log.error('Failed to resume audio:', error);
      });
    }
  }

  /**
   * Get current playback status (actively playing, not paused)
   */
  public isPlaying(): boolean {
    return this.audio !== null && !this.audio.paused;
  }

  /**
   * Whether there is active audio (playing or paused, but not ended)
   * Used to decide whether to resume playback or skip to the next line
   */
  public hasActiveAudio(): boolean {
    return this.audio !== null;
  }

  /**
   * Get current playback time (milliseconds)
   */
  public getCurrentTime(): number {
    return this.audio ? this.audio.currentTime * 1000 : 0;
  }

  /**
   * Get audio duration (milliseconds)
   */
  public getDuration(): number {
    return this.audio && !isNaN(this.audio.duration) ? this.audio.duration * 1000 : 0;
  }

  /**
   * Seek active audio to a position in milliseconds.
   */
  public seekTo(timeMs: number): boolean {
    if (!this.audio) return false;
    const durationMs = this.getDuration();
    const clampedMs =
      durationMs > 0 ? Math.max(0, Math.min(timeMs, durationMs)) : Math.max(0, timeMs);
    try {
      this.audio.currentTime = clampedMs / 1000;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Set playback ended callback
   */
  public onEnded(callback: () => void): void {
    this.onEndedCallback = callback;
  }

  /**
   * Set mute state (takes effect immediately on currently playing audio)
   */
  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audio) {
      this.audio.volume = muted ? 0 : this.volume;
    }
  }

  /**
   * Set volume (0-1)
   */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio && !this.muted) {
      this.audio.volume = this.volume;
    }
  }

  /**
   * Set playback speed (takes effect immediately on currently playing audio)
   */
  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2, rate));
    if (this.audio) {
      this.audio.playbackRate = this.playbackRate;
    }
  }

  /**
   * Destroy the player
   */
  public destroy(): void {
    this.stop();
    this.onEndedCallback = null;
  }
}

/**
 * Create an audio player instance
 */
export function createAudioPlayer(): AudioPlayer {
  return new AudioPlayer();
}
