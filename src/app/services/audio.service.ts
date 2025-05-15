// src/app/services/audio.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { StorageService } from './storage.service';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  imageUrl: string;
  previewUrl: string;
  spotifyId: string;
  liked: boolean;
}

@Injectable({ providedIn: 'root' })
export class AudioService {
  private audio: HTMLAudioElement;
  private currentTrack$ = new BehaviorSubject<Track | null>(null);
  private isPlaying$  = new BehaviorSubject<boolean>(false);
  private currentTime$ = new BehaviorSubject<number>(0);
  private duration$    = new BehaviorSubject<number>(0);
  private queue: Track[] = [];
  private queueIndex = 0;
  private timerId: any;

  constructor(private storage: StorageService) {
    this.audio = new Audio();
    this.setupAudioEvents();
    this.restoreLastTrack();
  }

  private setupAudioEvents(): void {
    this.audio.addEventListener('loadedmetadata', () => this.duration$.next(this.audio.duration));
    this.audio.addEventListener('timeupdate', () => this.currentTime$.next(this.audio.currentTime));
    this.audio.addEventListener('play', () => { this.isPlaying$.next(true); this.startUpdates(); });
    this.audio.addEventListener('pause', () => { this.isPlaying$.next(false); this.stopUpdates(); });
    this.audio.addEventListener('ended', () => this.next());
  }

  private startUpdates(): void {
    this.timerId = setInterval(() => this.currentTime$.next(this.audio.currentTime), 500);
  }

  private stopUpdates(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
    }
  }

  private async restoreLastTrack(): Promise<void> {
    try {
      const saved = await this.storage.get('last_played_track') as Track | null;
      if (saved) {
        this.currentTrack$.next(saved);
        this.audio.src = saved.previewUrl;
        this.audio.load();
      }
    } catch (err) {
      console.error('[AudioService] restoreLastTrack error:', err);
    }
  }

  private saveLastTrack(track: Track): void {
    this.storage.set('last_played_track', track);
  }

  play(track?: Track): void {
    if (track) {
      if (!track.previewUrl) {
        alert(`No preview available for "${track.title}"`);
        return;
      }
      this.currentTrack$.next(track);
      this.audio.src = track.previewUrl;
      this.audio.load();
      this.saveLastTrack(track);
    }
    this.audio.play().catch(e => {
      console.error('Playback error:', e);
      alert(`Unable to play track: ${e.message}`);
    });
  }

  pause(): void {
    this.audio.pause();
  }

  togglePlay(): void {
    this.audio.paused ? this.play() : this.pause();
  }

  setQueue(tracks: Track[], startIndex = 0): void {
    this.queue = tracks;
    this.queueIndex = startIndex;
    if (tracks.length) {
      this.play(tracks[startIndex]);
    }
  }

  next(): void {
    if (!this.queue.length) return;
    this.queueIndex = (this.queueIndex + 1) % this.queue.length;
    this.play(this.queue[this.queueIndex]);
  }

  previous(): void {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
    } else {
      this.queueIndex = (this.queueIndex - 1 + this.queue.length) % this.queue.length;
      this.play(this.queue[this.queueIndex]);
    }
  }

  seek(time: number): void {
    this.audio.currentTime = time;
  }

  async toggleLike(track: Track): Promise<void> {
    if (track.liked) {
      await this.storage.removeLiked(track.id);
    } else {
      await this.storage.addLiked(track.id);
    }
    track.liked = !track.liked;
  }

  /**
   * Download a track locally and return its URI. Stub implementation.
   */
  async downloadTrack(track: Track): Promise<string> {
    // TODO: Replace stub with actual download logic
    const uri = track.previewUrl;
    return uri;
  }

  // Observables for UI binding
  getCurrentTrack(): Observable<Track|null> { return this.currentTrack$.asObservable(); }
  getIsPlaying():   Observable<boolean>   { return this.isPlaying$.asObservable(); }
  getCurrentTime(): Observable<number>    { return this.currentTime$.asObservable(); }
  getDuration():    Observable<number>    { return this.duration$.asObservable(); }
  getQueue():       Track[]               { return this.queue; }
  getQueueIndex():  number                { return this.queueIndex; }
}
