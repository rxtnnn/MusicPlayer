// src/app/services/audio.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { StorageService } from './storage.service';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Platform } from '@ionic/angular';
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
  private _currentBlobUrl: string | null = null;

  constructor(private storage: StorageService, private platform: Platform ) {
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

  async play(track?: Track): Promise<void> {
    if (track) {
      if (!track.previewUrl) {
        alert(`No preview available for "${track.title}"`);
        return;
      }

      try {
        this.currentTrack$.next(track);

        // Handle filesystem URLs for local files
        if (track.previewUrl.startsWith('file://') || track.previewUrl.includes('/_capacitor_file_')) {
          try {
            // Read the file from filesystem
            const fileData = await Filesystem.readFile({
              path: track.previewUrl.replace(/^file:\/\//, ''),
              directory: Directory.Data
            });

            // Check if data is a string (base64)
            if (typeof fileData.data === 'string') {
              // Create a blob URL from the base64 data
              const blob = this.base64ToBlob(fileData.data, 'audio/mpeg');
              const blobUrl = URL.createObjectURL(blob);

              // Set the audio source to the blob URL
              this.audio.src = blobUrl;

              // Store the blob URL to revoke it later
              this._currentBlobUrl = blobUrl;
            } else {
              // Handle the case where it's already a Blob
              const blobUrl = URL.createObjectURL(fileData.data);
              this.audio.src = blobUrl;
              this._currentBlobUrl = blobUrl;
            }
          } catch (e) {
            console.error('Error loading local file:', e);
            alert(`Unable to play track: File could not be loaded`);
            return;
          }
        } else {
          // Regular URL (streaming)
          this.audio.src = track.previewUrl;
        }

        this.audio.load();
        this.saveLastTrack(track);
      } catch (e) {
        console.error('Error setting up track:', e);
        alert(`Unable to play track: File could not be loaded`);
        return;
      }
    }

    this.audio.play().catch(e => {
      console.error('Playback error:', e);
      alert(`Unable to play track: Playback failed`);
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
    this.cleanup();
    if (!this.queue.length) return;
    this.queueIndex = (this.queueIndex + 1) % this.queue.length;
    this.play(this.queue[this.queueIndex]);
  }

  previous(): void {
    this.cleanup();
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

  // src/app/services/audio.service.ts

// Add these methods to your AudioService class

/**
 * Add a local track to the library and play it
 */
  async addLocalTrack(file: File): Promise<Track> {
    try {
      // Generate a unique ID for the local track
      const trackId = `local-${Date.now()}`;

      // Create a reader to read the file
      const reader = new FileReader();

      // Read the file as array buffer
      const arrayBuffer = await this.readFileAsArrayBuffer(file);

      // Convert to base64 for saving
      const base64Data = await this.convertArrayBufferToBase64(arrayBuffer);

      // Determine file extension
      const fileExt = file.name.split('.').pop() || 'mp3';

      // Save file to filesystem
      const savedFile = await Filesystem.writeFile({
        path: `music/${trackId}.${fileExt}`,
        data: base64Data,
        directory: Directory.Data,
        recursive: true
      });

      // Create track object with filesystem URL
      const track: Track = {
        id: trackId,
        title: this.formatLocalFileName(file.name),
        artist: 'Local File',
        album: 'My Music',
        duration: 0, // Will be updated when audio loads
        imageUrl: 'assets/default-album-art.png',
        previewUrl: savedFile.uri, // Use the filesystem URI
        spotifyId: '',
        liked: false
      };

      // Try to get the duration
      try {
        // Create a temporary object URL to get duration
        const tempUrl = URL.createObjectURL(file);
        const duration = await this.getAudioDuration(tempUrl);
        track.duration = duration;
        // Revoke the temporary URL
        URL.revokeObjectURL(tempUrl);
      } catch (e) {
        console.error('Failed to get audio duration', e);
      }

      // Save the track to storage
      await this.storage.saveTrack(track);

      // Add to downloaded music
      await this.storage.addDownloaded(track.id, savedFile.uri);

      return track;
    } catch (err) {
      console.error('Error adding local track:', err);
      throw err;
    }
  }

  private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as ArrayBuffer);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  private convertArrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private formatLocalFileName(fileName: string): string {
  // Remove the file extension
    const nameParts = fileName.split('.');
    if (nameParts.length > 1) {
      nameParts.pop();
    }
    const nameWithoutExt = nameParts.join('.');

    // Replace underscores and hyphens with spaces
    return nameWithoutExt.replace(/[_-]/g, ' ');
  }

  /**
   * Get audio duration by loading it in a temporary audio element
   */
  private getAudioDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const tempAudio = new Audio();
      tempAudio.src = url;

      // Once metadata is loaded, we'll know the duration
      tempAudio.addEventListener('loadedmetadata', () => {
        resolve(tempAudio.duration);
        tempAudio.pause();
        tempAudio.src = '';
      });

      // If there's an error (or no metadata), just return 0
      tempAudio.addEventListener('error', () => {
        console.error('Error getting audio duration');
        resolve(0);
      });

      tempAudio.load();
    });
  }

  /**
   * Handle playback of downloaded tracks
   */
  playDownloadedTrack(track: Track): void {
    if (!track.previewUrl) {
      console.error('No preview URL for track:', track);
      return;
    }

    // Play the track
    this.play(track);
  }


/**
 * Convert base64 to Blob
 */
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

  return new Blob(byteArrays, {type});
}

/**
 * Clean up resources when audio changes or component is destroyed
 */
cleanup(): void {
  if (this._currentBlobUrl) {
    URL.revokeObjectURL(this._currentBlobUrl);
    this._currentBlobUrl = null;
  }

  if (this.timerId) {
    clearInterval(this.timerId);
    this.timerId = null;
  }
}

}
