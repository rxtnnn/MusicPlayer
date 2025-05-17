// src/app/services/audio.service.ts

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { StorageService } from './storage.service';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Platform } from '@ionic/angular';
import { NativeAudio } from '@capacitor-community/native-audio';
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
  isLocal?: boolean;
  localPath?: string;
}

@Injectable({ providedIn: 'root' })
export class AudioService {
  public audio: HTMLAudioElement;
  private currentTrack$ = new BehaviorSubject<Track | null>(null);
  private isPlaying$ = new BehaviorSubject<boolean>(false);
  private currentTime$ = new BehaviorSubject<number>(0);
  private duration$ = new BehaviorSubject<number>(0);
  private queue: Track[] = [];
  private queueIndex = 0;
  private timerId: any;
  private _currentBlobUrl: string | null = null;

  constructor(
    private storage: StorageService,
    private platform: Platform
  ) {
    this.audio = document.createElement('audio');
    this.audio.crossOrigin = 'anonymous';
    this.setupAudioEvents();
    this.restoreLastTrack();
  }

  private setupAudioEvents() {
    this.audio.addEventListener('loadedmetadata', () => {
      console.log('Audio loadedmetadata event, duration:', this.audio.duration);
      this.duration$.next(this.audio.duration);
    });

    this.audio.addEventListener('timeupdate', () => {
      this.currentTime$.next(this.audio.currentTime);
    });

    this.audio.addEventListener('play', () => {
      console.log('Audio play event fired');
      this.isPlaying$.next(true);
      this.startUpdates();
    });

    this.audio.addEventListener('pause', () => {
      console.log('Audio pause event fired');
      this.isPlaying$.next(false);
      this.stopUpdates();
    });

    this.audio.addEventListener('ended', () => {
      console.log('Audio ended event fired');
      this.next();
    });

    this.audio.addEventListener('error', (e: any) => {
      const error = this.audio.error;
      console.error('Audio playback error:', e);
      console.error('Error code:', error ? error.code : 'unknown');
      console.error('Error message:', error ? error.message : 'unknown');
      this.isPlaying$.next(false);
    });
  }

  private startUpdates() {
    this.stopUpdates(); // Clear any existing timer
    this.timerId = setInterval(() => this.currentTime$.next(this.audio.currentTime), 500);
  }

  private stopUpdates() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private async restoreLastTrack() {
    try {
      const saved = await this.storage.get('last_played_track') as Track | null;
      if (saved) {
        console.log('Restoring last played track:', saved.title);
        this.currentTrack$.next(saved);
        // Don't set audio.src here, just prepare the track info
      }
    } catch (err) {
      console.error('[AudioService] restoreLastTrack error:', err);
    }
  }

  private saveLastTrack(track: Track) {
    this.storage.set('last_played_track', track);
  }

   async play(track: Track): Promise<void> {
    // Cleanup previous playback
    this.cleanup();
    // Update current track
    this.currentTrack$.next(track);

    if (track.isLocal && this.platform.is('hybrid')) {
      // Native playback via NativeAudio
      try {
        await NativeAudio.preload({ assetId: track.id, assetPath: track.previewUrl });
      } catch {
        // Already loaded
      }
      await NativeAudio.play({ assetId: track.id });
      this.isPlaying$.next(true);
    } else {
      // Web or streaming playback
      this.audio.src = track.previewUrl;
      this.audio.load();
      try {
        await this.audio.play();
      } catch (e) {
        console.error('Playback failed:', e);
      }
    }
  }

  /** Playback a local file path/URI */
  private async playLocalFile(track: Track, filePath: string): Promise<void> {
    try {
      console.log('Playing local file from path:', filePath);

      // For Web platform, try using the URL directly (for blob URLs)
      if (!this.platform.is('hybrid') && filePath.startsWith('blob:')) {
        console.log('Using blob URL directly for web platform');
        this.audio.src = filePath;
        this.audio.load();
        return;
      }

      // Clean filepath - remove file:// prefix if present
      let path = filePath;
      if (path.startsWith('file://')) {
        path = path.replace(/^file:\/\//, '');
      }

      // Try to read the file from the filesystem
      try {
        console.log('Reading file from filesystem:', path);
        const fileData = await Filesystem.readFile({
          path: path,
          directory: Directory.Data
        });

        // Create a blob URL from the file data
        if (typeof fileData.data === 'string') {
          // Handle base64 data
          const blob = this.base64ToBlob(fileData.data, this.getAudioMimeType(path));
          const blobUrl = URL.createObjectURL(blob);
          console.log('Created blob URL for base64 data:', blobUrl);
          this.audio.src = blobUrl;
          this._currentBlobUrl = blobUrl;
        } else {
          // Handle binary data
          const blobUrl = URL.createObjectURL(new Blob([fileData.data]));
          console.log('Created blob URL for binary data:', blobUrl);
          this.audio.src = blobUrl;
          this._currentBlobUrl = blobUrl;
        }

        this.audio.load();
      } catch (error) {
        console.error('Error reading file, trying direct path:', error);

        // As a fallback, try using the file path directly
        this.audio.src = filePath;
        this.audio.load();
      }
    } catch (e) {
      console.error('Error loading local file:', e);
      throw e;
    }
  }

  // Helper to determine MIME type from file extension
  private getAudioMimeType(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    switch (extension) {
      case 'mp3': return 'audio/mpeg';
      case 'wav': return 'audio/wav';
      case 'm4a': return 'audio/mp4';
      case 'aac': return 'audio/aac';
      case 'ogg': return 'audio/ogg';
      case 'flac': return 'audio/flac';
      default: return 'audio/mpeg'; // Default to MP3
    }
  }

  async pause(): Promise<void> {
    const track = this.currentTrack$.getValue();
    if (track?.isLocal && this.platform.is('hybrid')) {
      await NativeAudio.stop({ assetId: track.id });
    } else {
      this.audio.pause();
    }
    this.isPlaying$.next(false);
  }

 async togglePlay(): Promise<void> {
    if (this.isPlaying$.getValue()) {
      await this.pause();
      alert('Toggle Play working')
    } else {
      const track = this.currentTrack$.getValue();
      if (track) {
        await this.play(track);
      }
    }
  }

  setQueue(tracks: Track[], startIndex = 0): void {
    console.log(`Setting queue with ${tracks.length} tracks, starting at index ${startIndex}`);
    this.queue = tracks;
    this.queueIndex = startIndex;
    if (tracks.length) {
      this.play(tracks[startIndex]);
    }
  }

  next(): void {
    this.cleanup();
    if (!this.queue.length) {
      alert('Cannot go to next track: queue is empty');
      return;
    }
    this.queueIndex = (this.queueIndex + 1) % this.queue.length;
    console.log(`Moving to next track, new index: ${this.queueIndex}`);
    this.play(this.queue[this.queueIndex]);
  }

  previous(): void {
    this.cleanup();
    if (!this.queue.length) {
      console.log('Cannot go to previous track: queue is empty');
      return;
    }
    if (this.audio.currentTime > 3) {
      console.log('Current time > 3 seconds, restarting current track');
      this.audio.currentTime = 0;
    } else {
      this.queueIndex = (this.queueIndex - 1 + this.queue.length) % this.queue.length;
      console.log(`Moving to previous track, new index: ${this.queueIndex}`);
      this.play(this.queue[this.queueIndex]);
    }
  }

  seek(time: number): void {
    console.log(`Seeking to time: ${time}`);
    this.audio.currentTime = time;
  }

  async toggleLike(track: Track): Promise<void> {
    if (track.liked) {
      await this.storage.removeLiked(track.id);
    } else {
      await this.storage.addLiked(track.id);
    }
    track.liked = !track.liked;
    console.log(`Toggled like status for ${track.title}: ${track.liked}`);
  }

  // Observable getters
  getCurrentTrack(): Observable<Track|null> { return this.currentTrack$.asObservable(); }
  getIsPlaying(): Observable<boolean> { return this.isPlaying$.asObservable(); }
  getCurrentTime(): Observable<number> { return this.currentTime$.asObservable(); }
  getDuration(): Observable<number> { return this.duration$.asObservable(); }
  getQueue(): Track[] { return this.queue; }
  getQueueIndex(): number { return this.queueIndex; }

   async addLocalTrack(file: File): Promise<Track> {
    const id  = `local-${Date.now()}`;
    const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
    let previewUrl: string;

    if (this.platform.is('hybrid')) {
      const base64 = await this.fileToBase64(file);
      const saved = await Filesystem.writeFile({
        path: `music/${id}.${ext}`,
        data: base64,
        directory: Directory.Data,
        recursive: true
      });
      previewUrl = saved.uri;
    } else {
      previewUrl = URL.createObjectURL(file);
    }

    const track: Track = {
      id,
      title:     file.name.replace(/\.[^/.]+$/, ''),
      artist:    'Local File',
      album:     'My Music',
      duration:  0,
      imageUrl:  'assets/default-album-art.png',
      previewUrl,
      spotifyId: '',
      liked:     false,
      isLocal:   true
    };

    await this.storage.saveTrack(track);
    return track;
  }


  /** Get audio duration using a temporary audio element */
  private async getAudioDuration(file: File): Promise<number> {
    return new Promise((resolve) => {
      // Create a temporary URL for the file
      const url = URL.createObjectURL(file);

      // Create a temporary audio element
      const tempAudio = new Audio();

      // Set a timeout to avoid hanging
      const timeout = setTimeout(() => {
        console.warn('Audio duration detection timeout, defaulting to 0');
        URL.revokeObjectURL(url);
        resolve(0);
      }, 3000);

      // When metadata is loaded, get the duration
      tempAudio.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        const duration = isNaN(tempAudio.duration) ? 0 : tempAudio.duration;
        URL.revokeObjectURL(url);
        resolve(duration);
      });

      // Handle errors
      tempAudio.addEventListener('error', () => {
        clearTimeout(timeout);
        console.warn('Error getting audio duration, using default 0');
        URL.revokeObjectURL(url);
        resolve(0);
      });

      // Set the source and load the audio
      tempAudio.preload = 'metadata';
      tempAudio.src = url;
    });
  }

  /** Helper function to convert base64 to Blob */
  private base64ToBlob(base64: string, type: string): Blob {
    const byteCharacters = atob(base64);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);

      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, { type });
  }

  private async fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const bytes  = new Uint8Array(buffer);
    const CHUNK  = 0x8000;   // 8 KB
    let   binary = '';

    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.subarray(i, i + CHUNK);
      binary += String.fromCharCode(...slice);
    }

    return window.btoa(binary);
  }

  /** Clean up resources when audio changes or component is destroyed */
  cleanup(): void {
    // Revoke any existing blob URLs
    if (this._currentBlobUrl) {
      console.log('Cleaning up blob URL');
      URL.revokeObjectURL(this._currentBlobUrl);
      this._currentBlobUrl = null;
    }

    // Stop time updates
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}
