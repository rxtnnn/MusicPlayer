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

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  toggleLike(track: Track) {
    throw new Error('Method not implemented.');
  }
  private audio: HTMLAudioElement;
  private currentTrack = new BehaviorSubject<Track | null>(null);
  private isPlaying = new BehaviorSubject<boolean>(false);
  private currentTime = new BehaviorSubject<number>(0);
  private duration = new BehaviorSubject<number>(0);
  private queue: Track[] = [];
  private queueIndex = 0;
  private timerId: any;

  constructor(private storageService: StorageService) {
    this.audio = new Audio();
    this.setupAudioEvents();
    this.loadLastPlayedTrack();
  }

  private setupAudioEvents() {
    this.audio.addEventListener('timeupdate', () => {
      this.currentTime.next(this.audio.currentTime);
    });

    this.audio.addEventListener('loadedmetadata', () => {
      this.duration.next(this.audio.duration);
    });

    this.audio.addEventListener('ended', () => {
      this.next();
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying.next(true);
      this.startTimeUpdate();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying.next(false);
      this.stopTimeUpdate();
    });
  }

  private startTimeUpdate() {
    this.timerId = setInterval(() => {
      this.currentTime.next(this.audio.currentTime);
    }, 1000);
  }

  private stopTimeUpdate() {
    if (this.timerId) {
      clearInterval(this.timerId);
    }
  }

  private async loadLastPlayedTrack() {
    const lastTrack = await this.storageService.get('last_played_track');
    if (lastTrack) {
      this.currentTrack.next(lastTrack);
      this.audio.src = lastTrack.previewUrl;
    }
  }

  private saveLastPlayedTrack(track: Track) {
    this.storageService.set('last_played_track', track);
  }

  play(track?: Track): void {
    if (track) {
      // If a new track is provided, set it as current
      this.currentTrack.next(track);
      this.audio.src = track.previewUrl;
      this.saveLastPlayedTrack(track);
    }

    this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  togglePlay(): void {
    if (this.audio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  setQueue(tracks: Track[], startIndex: number = 0): void {
    this.queue = [...tracks];
    this.queueIndex = startIndex;
    if (this.queue.length > 0) {
      this.play(this.queue[this.queueIndex]);
    }
  }

  next(): void {
    if (this.queue.length === 0) return;

    this.queueIndex = (this.queueIndex + 1) % this.queue.length;
    this.play(this.queue[this.queueIndex]);
  }

  previous(): void {
    if (this.queue.length === 0) return;

    // If current time is more than 3 seconds, restart the track
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }

    this.queueIndex = (this.queueIndex - 1 + this.queue.length) % this.queue.length;
    this.play(this.queue[this.queueIndex]);
  }

  seek(time: number): void {
    if (this.audio) {
      this.audio.currentTime = time;
    }
  }

  getCurrentTrack(): Observable<Track | null> {
    return this.currentTrack.asObservable();
  }

  getIsPlaying(): Observable<boolean> {
    return this.isPlaying.asObservable();
  }

  getCurrentTime(): Observable<number> {
    return this.currentTime.asObservable();
  }

  getDuration(): Observable<number> {
    return this.duration.asObservable();
  }

  getQueue(): Track[] {
    return [...this.queue];
  }

  getCurrentQueueIndex(): number {
    return this.queueIndex;
  }
}
