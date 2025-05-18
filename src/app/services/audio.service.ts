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
      console.log('Audio loadedmetadata event, duration:', this.audioPlayer.duration);
      this.duration$.next(this.audioPlayer.duration);
      this._trackReady = true;
    });

    this.audioPlayer.addEventListener('timeupdate', () => {
      this.currentTime$.next(this.audioPlayer.currentTime);
    });

    this.audioPlayer.addEventListener('play', () => {
      console.log('Audio play event fired');
      this.isPlaying$.next(true);
      this.startUpdates();
    });

    this.audioPlayer.addEventListener('pause', () => {
      console.log('Audio pause event fired');
      this.isPlaying$.next(false);
      this.stopUpdates();
    });

    this.audioPlayer.addEventListener('ended', () => {
      console.log('Audio ended event fired');
      this.next();
    });

    this.audioPlayer.addEventListener('error', (e: any) => {
      const error = this.audioPlayer.error;
      console.error('Audio playback error:', e);
      console.error('Error code:', error ? error.code : 'unknown');
      console.error('Error message:', error ? error.message : 'unknown');
      this.isPlaying$.next(false);
    });

    this.localAudioPlayer.addEventListener('loadedmetadata', () => {
      console.log('Local audio loadedmetadata event, duration:', this.localAudioPlayer.duration);
      this.duration$.next(this.localAudioPlayer.duration);
      this._trackReady = true;
    });

    this.localAudioPlayer.addEventListener('timeupdate', () => {
      this.currentTime$.next(this.localAudioPlayer.currentTime);
    });

    this.localAudioPlayer.addEventListener('play', () => {
      console.log('Local audio play event fired');
      this.isPlaying$.next(true);
      this.startUpdates();
    });

    this.localAudioPlayer.addEventListener('pause', () => {
      console.log('Local audio pause event fired');
      this.isPlaying$.next(false);
      this.stopUpdates();
    });

    this.localAudioPlayer.addEventListener('ended', () => {
      console.log('Local audio ended event fired');
      this.next();
    });

    this.localAudioPlayer.addEventListener('error', (e: any) => {
      const error = this.localAudioPlayer.error;
      console.error('Local audio playback error:', e);
      console.error('Error code:', error ? error.code : 'unknown');
      console.error('Error message:', error ? error.message : 'unknown');
      this.isPlaying$.next(false);
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
          console.log('Playing local track on native platform:', track.previewUrl);
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
        this.audioPlayer.src = track.previewUrl;
        this.audioPlayer.load();
        await this.audioPlayer.play();
        this.isPlaying$.next(true);
      }
    } catch (e) {
      console.error('Playback failed:', e);
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
        console.log('Resuming to specific position:', position);
        activePlayer.currentTime = position;
      }
      // previously saved position
      else if (this._savedPosition !== undefined && !isNaN(this._savedPosition)) {
        console.log('Resuming to saved position:', this._savedPosition);
        activePlayer.currentTime = this._savedPosition;
      }

      // Start playback
      try {
        await activePlayer.play();
        this.isPlaying$.next(true);
        this.startUpdates();
      } catch (playError) {
        console.error('Error resuming playback:', playError);
        throw playError;
      }
    } catch (error) {
      console.error('Error in resume:', error);
      throw error;
    }
  }
  async verifyLocalTrack(trackId: string): Promise<boolean> {
    try {
      // Get track from database
      const track = await this.storage.getTrack(trackId);
      if (!track) {
        console.error('Track not found in database:', trackId);
        return false;
      }

      console.log('Found track in database:', track);

      // Check if the file exists in filesystem
      if (track.isLocal && track.previewUrl) {
        try {
          const filePath = track.previewUrl.replace('file://', '');
          console.log('Checking if file exists at path:', filePath);

          const fileInfo = await Filesystem.stat({
            path: filePath,
            directory: Directory.Data
          });

          console.log('File exists! Size:', fileInfo.size, 'bytes');
          return true;
        } catch (fileError) {
          console.error('File does not exist at the stored path:', fileError);
          return false;
        }
      }

      return false;
    } catch (error) {
      console.error('Error verifying track:', error);
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
        // Currently playing, so pause
        await this.pause();
      } else {
        // Currently paused, so resume from saved position
        await this.resume();
      }
    } catch (error) {
      console.error('Error in togglePlay:', error);
      this.isPlaying$.next(false);
      throw error;
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
      console.warn('Cannot go to next track: queue is empty');
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

    const activePlayer = this.getCurrentPlayer();
    if (activePlayer.currentTime > 3) {
      console.log('Current time > 3 seconds, restarting current track');
      activePlayer.currentTime = 0;
    } else {
      this.queueIndex = (this.queueIndex - 1 + this.queue.length) % this.queue.length;
      console.log(`Moving to previous track, new index: ${this.queueIndex}`);
      this.play(this.queue[this.queueIndex]);
    }
  }

  seek(time: number): void {
    console.log(`Seeking to time: ${time}`);
    const activePlayer = this.getCurrentPlayer();
    activePlayer.currentTime = time;

    // Update the saved position to match
    this._savedPosition = time;
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

  // GETTERS FOR OBSERVABLE DATA
  getCurrentTrack(): Observable<Track|null> { return this.currentTrack$.asObservable(); }
  getIsPlaying(): Observable<boolean> { return this.isPlaying$.asObservable(); }
  getCurrentTime(): Observable<number> { return this.currentTime$.asObservable(); }
  getDuration(): Observable<number> { return this.duration$.asObservable(); }
  getQueue(): Track[] { return this.queue; }
  getQueueIndex(): number { return this.queueIndex; }


  async addLocalTrack(file: File): Promise<Track> {
    try {
      // Generate unique ID
      const id = `local-${Date.now()}`;
      const fileName = file.name;
      const fileExtension = fileName.split('.').pop()?.toLowerCase() || 'mp3';
      const uniqueFileName = `${id}.${fileExtension}`;
      const relativeFilePath = `music/${uniqueFileName}`;
      let fileUri = '';

      // Save the actual file content
      if (this.platform.is('hybrid')) {
        // Convert to base64
        const fileArrayBuffer = await file.arrayBuffer();
        const base64 = this.arrayBufferToBase64(fileArrayBuffer);

        // Create directory if needed
        try {
          await Filesystem.mkdir({
            path: 'music',
            directory: Directory.Data,
            recursive: true
          });
        } catch (dirErr) {
          // Directory might already exist
        }

        // Save file
        const savedFile = await Filesystem.writeFile({
          path: relativeFilePath,
          data: base64,
          directory: Directory.Data
        });

        fileUri = savedFile.uri;
        console.log('File saved at:', fileUri);
      } else {
        // Web browser - create blob URL
        fileUri = URL.createObjectURL(file);
      }

      // Create track object
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
        localPath: relativeFilePath // Add the relative path
      };

      // Save to database with local path info
      await this.storage.saveLocalMusic(track, relativeFilePath);

      return track;
    } catch (error) {
      console.error('Error adding local track:', error);
      throw error;
    }
  }



  async getAudioDuration(file: File): Promise<number> {
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

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;

    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return window.btoa(binary);
  }

  // Track existence check
  async trackExistsByName(fileName: string): Promise<boolean> {
    try {
      // Extract the title from the filename by removing the extension
      const title = fileName.replace(/\.[^/.]+$/, '');

      // Query storage for tracks with this title that are local
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
    // Stop both players
    this.audioPlayer.pause();
    this.localAudioPlayer.pause();

    // Reset positions to beginning
    this.audioPlayer.currentTime = 0;
    this.localAudioPlayer.currentTime = 0;

    // Revoke any existing blob URLs
    if (this._currentBlobUrl) {
      console.log('Cleaning up blob URL');
      URL.revokeObjectURL(this._currentBlobUrl);
      this._currentBlobUrl = null;
    }

    // Always clear any saved position
    this._savedPosition = undefined;

    // Stop time updates
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  public async clearCurrentTrack(): Promise<void> {
    try {
      // First pause playback if it's playing
      await this.pause();

      // Reset the current track
      this.currentTrack$.next(null);
      this.isPlaying$.next(false);

      // Reset time positions
      this.currentTime$.next(0);
      this.duration$.next(0);

      // Reset audio elements and their positions
      this.audioPlayer.src = '';
      this.audioPlayer.currentTime = 0;

      this.localAudioPlayer.src = '';
      this.localAudioPlayer.currentTime = 0;

      // Clear any saved position
      if (this._savedPosition !== undefined) {
        this._savedPosition = undefined;
      }

      // Remove the last played track from storage
      await this.storage.set('last_played_track', null);

      console.log('Track cleared, all positions reset');
    } catch (error) {
      console.error('Error clearing current track:', error);
    }
  }

  async pauseAndReset(): Promise<void> {
    try {
      // Get current player
      const activePlayer = this.getCurrentPlayer();

      // Pause playback
      activePlayer.pause();
      this.isPlaying$.next(false);

      // Reset position to beginning
      activePlayer.currentTime = 0;
      this.currentTime$.next(0);

      // Clear any saved position
      this._savedPosition = undefined;

      // Stop updates
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
    } catch (error) {
      console.error('Error pausing and resetting playback:', error);
      throw error;
    }
  }
}
