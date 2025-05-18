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
  // Use separate Audio objects for better control
  private audioPlayer: HTMLAudioElement;
  private localAudioPlayer: HTMLAudioElement;

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
    // Create separate audio players for different types of content
    this.audioPlayer = new Audio();
    this.localAudioPlayer = new Audio();

    // Configure audio elements
    this.configureAudioElement(this.audioPlayer);
    this.configureAudioElement(this.localAudioPlayer);

    // Initial state setup
    this.setupAudioEvents();
    this.restoreLastTrack();
  }

  // Configure audio element with optimal settings
  private configureAudioElement(audio: HTMLAudioElement) {
    audio.autoplay = false;
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.volume = 1.0;

    // Fix for iOS
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
  }

  // Set up events on both audio elements
  private setupAudioEvents() {
    // Main audio player events
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

    // Local audio player events (mostly the same)
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
    this.stopUpdates(); // Clear any existing timer
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

  // Get the currently active audio player
  private getCurrentPlayer(): HTMLAudioElement {
    const track = this.currentTrack$.getValue();
    return track?.isLocal ? this.localAudioPlayer : this.audioPlayer;
  }

  private async restoreLastTrack() {
    try {
      const saved = await this.storage.get('last_played_track') as Track | null;
      if (saved) {
        console.log('Restoring last played track:', saved.title);

        // Check if the track still exists
        if (saved.isLocal) {
          const exists = await this.storage.getTrack(saved.id);
          if (!exists) {
            console.log('Last track no longer exists, not restoring');
            return;
          }
        }

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
    console.log('Playing track:', track);
    this.cleanup();
    this.currentTrack$.next(track);
    this.saveLastTrack(track);

    try {
      if (track.isLocal) {
        const player = this.localAudioPlayer;

        if (Capacitor.isNativePlatform()) {
          console.log('Playing local track on native platform:', track.previewUrl);

          // Convert the URI to a format the audio element can use
          const audioSrc = Capacitor.convertFileSrc(track.previewUrl);
          console.log('Converted audio path:', audioSrc);

          player.src = audioSrc;
          player.load();

          try {
            await player.play();
            this.isPlaying$.next(true);
            this.startUpdates();
          } catch (playError) {
            console.error('Error playing local audio:', playError);
            throw playError;
          }
        } else {
          // For web, we need to re-read the file from storage
          console.log('Playing local track in browser from path:', track.previewUrl);

          try {
            // Read the file from storage with explicit options
            const fileData = await Filesystem.readFile({
              path: track.previewUrl.replace('file://', ''),
              directory: Directory.Data,
              // Don't specify encoding to get data as base64
            });

            // Create a blob and URL - handle the data properly
            if (fileData.data) {
              let blob: Blob;
              if (fileData.data instanceof Blob) {
                // Convert Blob to ArrayBuffer, then to base64, then to Blob
                const arrayBuffer = await fileData.data.arrayBuffer();
                blob = this.base64ToBlob(this.arrayBufferToBase64(arrayBuffer), 'audio/mpeg');
              } else {
                blob = this.base64ToBlob(fileData.data, 'audio/mpeg');
              }
              const url = URL.createObjectURL(blob);

              // Save for cleanup later
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
        // Streaming audio code (unchanged)
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
    // First, update your base64ToBlob method to handle both string and ArrayBuffer
  private base64ToBlob(data: string | ArrayBuffer, mimeType: string): Blob {
    // If data is already a string (base64), use it directly
    let base64String: string;

    if (typeof data === 'string') {
      base64String = data;
    } else {
      // If it's an ArrayBuffer, convert it to base64 string
      base64String = this.arrayBufferToBase64(data);
    }

    // Now process the base64 string
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
      activePlayer.pause();
      this.isPlaying$.next(false);
    } catch (error) {
      console.error('Error pausing:', error);
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
  // REVISED TOGGLE PLAY
  async togglePlay(): Promise<void> {
    try {
      const isPlaying = this.isPlaying$.getValue();
      const track = this.currentTrack$.getValue();

      if (!track) {
        throw new Error('No track selected to play');
      }

      if (isPlaying) {
        // Currently playing, so pause
        await this.pause();
      } else {
        // For local tracks, always restart playback instead of resuming
        // This fixes many issues with toggle play
        if (track.isLocal) {
          await this.play(track);
        } else {
          // For streaming tracks, use standard resume
          const activePlayer = this.getCurrentPlayer();

          try {
            await activePlayer.play();
            this.isPlaying$.next(true);
            this.startUpdates();
          } catch (playError) {
            console.error('Error resuming playback:', playError);
            // Try full playback restart
            await this.play(track);
          }
        }
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

  // Resource cleanup
  cleanup(): void {
    // Stop both players
    this.audioPlayer.pause();
    this.localAudioPlayer.pause();

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

  // Clear current track completely
  public async clearCurrentTrack(): Promise<void> {
    try {
      await this.pause();
    } catch {
      // Ignore pause errors
    }

    this.currentTrack$.next(null);
    this.isPlaying$.next(false);
    this.currentTime$.next(0);
    this.duration$.next(0);

    this.audioPlayer.src = '';
    this.localAudioPlayer.src = '';
    await this.storage.set('last_played_track', null);
  }
}
