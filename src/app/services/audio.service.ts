import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { StorageService } from './storage.service';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Platform } from '@ionic/angular';
import { NativeAudio } from '@capacitor-community/native-audio';
import { Capacitor } from '@capacitor/core';

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
  private audioPlayer: HTMLAudioElement;
  private localAudioPlayer: HTMLAudioElement;
  private _savedPosition: number | undefined = undefined;
  private currentTrack$ = new BehaviorSubject<Track | null>(null);
  private isPlaying$ = new BehaviorSubject<boolean>(false);
  private currentTime$ = new BehaviorSubject<number>(0);
  private duration$ = new BehaviorSubject<number>(0);
  private queue: Track[] = [];
  private queueIndex = 0;
  private timerId: any;
  private _currentBlobUrl: string | null = null;
  private _trackReady = false;
  private progressSubject = new BehaviorSubject<number>(0);

  constructor(
    private storage: StorageService,
    private platform: Platform
  ) {
    this.audioPlayer = new Audio();
    this.localAudioPlayer = new Audio();
    this.configureAudioElement(this.audioPlayer);
    this.configureAudioElement(this.localAudioPlayer);
    this.setupAudioEvents();
    this.restoreLastTrack();
  }

  private configureAudioElement(audio: HTMLAudioElement) {
    audio.autoplay = false;
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.volume = 1.0;
  }

  private setupAudioEvents() {
    this.audioPlayer.addEventListener('loadedmetadata', () => {
      this.duration$.next(this.audioPlayer.duration);
      this._trackReady = true;
    });

    this.audioPlayer.addEventListener('play', () => {
      this.isPlaying$.next(true);
      this.startUpdates();
    });

    this.audioPlayer.addEventListener('pause', () => {
      this.isPlaying$.next(false);
      this.stopUpdates();
    });

    this.audioPlayer.addEventListener('ended', () => {
      this.next();
    });

    this.audioPlayer.addEventListener('error', (e: any) => {
      this.isPlaying$.next(false);
    });

    this.localAudioPlayer.addEventListener('loadedmetadata', () => {
      this.duration$.next(this.localAudioPlayer.duration);
      this._trackReady = true;
    });

    this.localAudioPlayer.addEventListener('play', () => {
      this.isPlaying$.next(true);
      this.startUpdates();
    });

    this.localAudioPlayer.addEventListener('pause', () => {
      this.isPlaying$.next(false);
      this.stopUpdates();
    });

    this.localAudioPlayer.addEventListener('ended', () => {
      this.next();
    });

    this.localAudioPlayer.addEventListener('error', (e: any) => {
      const error = this.localAudioPlayer.error;
      this.isPlaying$.next(false);
    });

    this.localAudioPlayer.addEventListener('timeupdate', () => {
      const currentTime = this.localAudioPlayer.currentTime;
      this.currentTime$.next(currentTime);
      const progress = (currentTime / this.localAudioPlayer.duration) * 100 || 0;
      this.progressSubject.next(progress);
    });
  }

  private startUpdates() {
    this.stopUpdates(); // clear sa timer
    this.timerId = setInterval(() => {
      const activePlayer = this.getCurrentPlayer();
      this.currentTime$.next(activePlayer.currentTime);
    }, 500);
  }

  private stopUpdates() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private getCurrentPlayer(): HTMLAudioElement {
    const track = this.currentTrack$.getValue();
    return track?.isLocal ? this.localAudioPlayer : this.audioPlayer;
  }

  private async restoreLastTrack() {
    try {
      const saved = await this.storage.get('last_played_track') as Track | null;
      if (saved) {
        if (saved.isLocal) {
          const exists = await this.storage.getTrack(saved.id);
          if (!exists) {
            return;
          }
        }
        this.currentTrack$.next(saved);
      }
    } catch (err) {
      console.error('[AudioService] restoreLastTrack error:', err);
    }
  }

  private saveLastTrack(track: Track) {
    this.storage.set('last_played_track', track);
  }

  async play(track: Track): Promise<void> {
    this.cleanup();
    this.currentTrack$.next(track);
    this.saveLastTrack(track);

    try {
      if (track.isLocal) {
        const player = this.localAudioPlayer;

        if (Capacitor.isNativePlatform()) {
          const audioSrc = Capacitor.convertFileSrc(track.previewUrl);
          player.src = audioSrc;
          player.load();
          try {
            await player.play();
            this.isPlaying$.next(true);
            this.startUpdates();
          } catch (playError) {
            throw playError;
          }
        } else {
          try {
            const fileData = await Filesystem.readFile({
              path: track.previewUrl.replace('file://', ''),
              directory: Directory.Data,
            });

            if (fileData.data) {
              let blob: Blob;
              if (fileData.data instanceof Blob) {
                const arrayBuffer = await fileData.data.arrayBuffer();
                blob = this.base64ToBlob(this.arrayBufferToBase64(arrayBuffer), 'audio/mpeg');
              } else {
                blob = this.base64ToBlob(fileData.data, 'audio/mpeg');
              }

              if (this._currentBlobUrl) {
                URL.revokeObjectURL(this._currentBlobUrl);
              }
              const url = URL.createObjectURL(blob);
              this._currentBlobUrl = url;
              player.src = url;
              player.load();
              await player.play();
              this.isPlaying$.next(true);
              this.startUpdates();
            } else {
              throw new Error('File data is empty');
            }
          } catch (webPlayError) {
            console.error('Error playing web audio:', webPlayError);
            throw webPlayError;
          }
        }
      } else {
        // Check if Spotify track has a valid preview URL
        if (!track.previewUrl || track.previewUrl.trim() === '') {
          console.error('Missing preview URL for Spotify track:', track.title);
          throw new Error(`No preview URL available for "${track.title}"`);
        }
        
        this.audioPlayer.src = track.previewUrl;
        this.audioPlayer.load();
        await this.audioPlayer.play();
        this.isPlaying$.next(true);
      }
    } catch (e) {
      this.isPlaying$.next(false);
      throw e;
    }
  }

  private base64ToBlob(data: string | ArrayBuffer, mimeType: string): Blob {
    let base64String: string;

    if (typeof data === 'string') {
      base64String = data;
    } else {
      base64String = this.arrayBufferToBase64(data);
    }

    const byteCharacters = atob(base64String);
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
    return new Blob(byteArrays, { type: mimeType });
  }

  async pause(): Promise<void> {
    try {
      const activePlayer = this.getCurrentPlayer();
      this._savedPosition = activePlayer.currentTime;
      activePlayer.pause();
      this.isPlaying$.next(false);
    } catch (error) {
      throw error;
    }
    if (this.currentTrack$.getValue()) {
      await this.storage.set(`position_${this.currentTrack$.getValue()?.id}`, this.getCurrentPlayer().currentTime);
    }
  }

  async resume(position?: number): Promise<void> {
    try {
      const track = this.currentTrack$.getValue();
      if (!track) {
        throw new Error('No track selected to resume');
      }
      const activePlayer = this.getCurrentPlayer();
      if (position !== undefined && !isNaN(position)) {
        activePlayer.currentTime = position;
      }else if (this._savedPosition !== undefined && !isNaN(this._savedPosition)) {
        activePlayer.currentTime = this._savedPosition;
      }

      try {
        await activePlayer.play();
        this.isPlaying$.next(true);
        this.startUpdates();
      } catch (playError) {
        throw playError;
      }
    } catch (error) {
      throw error;
    }
  }
  async verifyLocalTrack(trackId: string): Promise<boolean> {
    try {
      const track = await this.storage.getTrack(trackId);
      if (!track) {
        console.error('Track not found in database:', trackId);
        return false;
      }

      if (track.isLocal && track.previewUrl) {
        try {
          const filePath = track.previewUrl.replace('file://', '');
          return true;
        } catch (fileError) {
          return false;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async togglePlay(): Promise<void> {
    try {
      this.cleanup();
      const isPlaying = this.isPlaying$.getValue();
      const track = this.currentTrack$.getValue();

      if (!track) {
        throw new Error('No track selected to play');
      }

      if (isPlaying) {
        await this.pause();
      } else {
        await this.resume();
      }
    } catch (error) {
      this.isPlaying$.next(false);
      throw error;
    }
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
    if (!this.queue.length) {
      console.warn('Cannot go to next track: queue is empty');
      return;
    }
    this.queueIndex = (this.queueIndex + 1) % this.queue.length;
    this.play(this.queue[this.queueIndex]);
  }

  previous(): void {
    this.cleanup();
    if (!this.queue.length) {
      return;
    }

    const activePlayer = this.getCurrentPlayer();
    if (activePlayer.currentTime > 3) {
      activePlayer.currentTime = 0;
    } else {
      this.queueIndex = (this.queueIndex - 1 + this.queue.length) % this.queue.length;
      this.play(this.queue[this.queueIndex]);
    }
  }

  seek(time: number): void {
    const activePlayer = this.getCurrentPlayer();
    activePlayer.currentTime = time;
    this._savedPosition = time;
  }

  async toggleLike(track: Track): Promise<void> {
    if (track.liked) {
      await this.storage.removeLiked(track.id);
    } else {
      await this.storage.addLiked(track.id);
    }
    track.liked = !track.liked;
  }

  getCurrentTrack(): Observable<Track|null> { return this.currentTrack$.asObservable(); }
  getIsPlaying(): Observable<boolean> { return this.isPlaying$.asObservable(); }
  getCurrentTime(): Observable<number> { return this.currentTime$.asObservable(); }
  getDuration(): Observable<number> { return this.duration$.asObservable(); }
  getQueue(): Track[] { return this.queue; }
  getQueueIndex(): number { return this.queueIndex; }
  getProgress(): Observable<number> { return this.progressSubject.asObservable(); }

  async addLocalTrack(file: File): Promise<Track> {
    try {
      const id = `local-${Date.now()}`;
      const fileName = file.name;
      const fileExtension = fileName.split('.').pop()?.toLowerCase() || 'mp3';
      const uniqueFileName = `${id}.${fileExtension}`;
      const relativeFilePath = `music/${uniqueFileName}`;
      let fileUri = '';

      if (this.platform.is('hybrid')) {
        const fileArrayBuffer = await file.arrayBuffer();
        const base64 = this.arrayBufferToBase64(fileArrayBuffer);
        try {
          await Filesystem.mkdir({
            path: 'music',
            directory: Directory.Data,
            recursive: true
          });
        } catch (dirErr) {
        }

        const savedFile = await Filesystem.writeFile({
          path: relativeFilePath,
          data: base64,
          directory: Directory.Data
        });

        fileUri = savedFile.uri;
        
      } else {
        fileUri = URL.createObjectURL(file);
      }

      const track: Track = {
        id,
        title: fileName.replace(/\.[^/.]+$/, ''),
        artist: 'Local Music',
        album: 'My Music',
        duration: await this.getAudioDuration(file),
        imageUrl: 'assets/music-bg.png',
        previewUrl: fileUri,
        spotifyId: '',
        liked: false,
        isLocal: true,
        localPath: relativeFilePath
      };
      await this.storage.saveLocalMusic(track, relativeFilePath);
      return track;
    } catch (error) {
      console.error('Error adding local track:', error);
      throw error;
    }
  }

  async getAudioDuration(file: File): Promise<number> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const tempAudio = new Audio();
      const timeout = setTimeout(() => {
        console.warn('Audio duration detection timeout, defaulting to 0');
        URL.revokeObjectURL(url);
        resolve(0);
      }, 3000);

      tempAudio.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        const duration = isNaN(tempAudio.duration) ? 0 : tempAudio.duration;
        URL.revokeObjectURL(url);
        resolve(duration);
      });

      tempAudio.addEventListener('error', () => {
        clearTimeout(timeout);
        console.warn('Error getting audio duration, using default 0');
        URL.revokeObjectURL(url);
        resolve(0);
      });

      tempAudio.preload = 'metadata';
      tempAudio.src = url;
    });
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;

    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return window.btoa(binary);
  }

  async trackExistsByName(fileName: string): Promise<boolean> {
    try {
      const title = fileName.replace(/\.[^/.]+$/, '');
      const existingTracks = await this.storage.queryTracks(
        'SELECT id FROM tracks WHERE title = ? AND is_local = 1',
        [title]
      );

      return existingTracks.length > 0;
    } catch (error) {
      console.error('Error checking for existing track:', error);
      return false;
    }
  }

  cleanup(): void {
    this.audioPlayer.pause();
    this.localAudioPlayer.pause();
    this.audioPlayer.currentTime = 0;
    this.localAudioPlayer.currentTime = 0;
    if (this._currentBlobUrl) {
      URL.revokeObjectURL(this._currentBlobUrl);
      this._currentBlobUrl = null;
    }
    this._savedPosition = undefined;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  public async clearCurrentTrack(): Promise<void> {
    try {
      await this.pause();

      this.currentTrack$.next(null);
      this.isPlaying$.next(false);

      this.currentTime$.next(0);
      this.duration$.next(0);

      this.audioPlayer.src = '';
      this.audioPlayer.currentTime = 0;

      this.localAudioPlayer.src = '';
      this.localAudioPlayer.currentTime = 0;

      if (this._savedPosition !== undefined) {
        this._savedPosition = undefined;
      }

      await this.storage.set('last_played_track', null);
    } catch (error) {
      console.error('Error clearing current track:', error);
    }
  }

  async pauseAndReset(): Promise<void> {
    try {
      const activePlayer = this.getCurrentPlayer();
      activePlayer.pause();
      this.isPlaying$.next(false);
      activePlayer.currentTime = 0;
      this.currentTime$.next(0);
      this._savedPosition = undefined;
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
    } catch (error) {
      throw error;
    }
  }
}
