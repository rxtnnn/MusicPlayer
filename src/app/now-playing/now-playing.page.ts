import { Component, OnInit, OnDestroy } from '@angular/core';
import { Location } from '@angular/common';
import { Subscription } from 'rxjs';
import { AudioService, Track } from '../services/audio.service';
import { StorageService } from '../services/storage.service';
import { SettingsService } from '../services/settings.service';

@Component({
  selector: 'app-now-playing',
  templateUrl: './now-playing.page.html',
  styleUrls: ['./now-playing.page.scss'],
  standalone: false
})
export class NowPlayingPage implements OnInit, OnDestroy {
  currentTrack: Track | null = null;
  isPlaying = false;
  currentTime = 0;
  duration = 0;
  isDarkMode?: boolean;
  private settingsSubscription?: Subscription;
  private subscriptions: Subscription[] = [];

  constructor(
    public audioService: AudioService,
    private settingsService: SettingsService,
    private storageService: StorageService,
    private location: Location
  ) {}

  ngOnInit() {
    // Subscribe only once to the current track
    this.subscriptions.push(
      this.audioService.getCurrentTrack().subscribe(track => {
        this.currentTrack = track;
        // Check if a valid track with a preview URL is available
        if (track && track.previewUrl) {
          console.log('Playing track:', track.title);
          this.audioService.play(track);
        } else {
          console.warn('No valid track to play.');
        }
      }),

      this.audioService.getIsPlaying().subscribe(isPlaying => {
        this.isPlaying = isPlaying;
      }),

      this.audioService.getCurrentTime().subscribe(time => {
        this.currentTime = time;
      }),

      this.audioService.getDuration().subscribe(duration => {
        this.duration = duration;
      }),

      this.settingsSubscription = this.settingsService.settings$.subscribe(settings => {
        this.isDarkMode = settings.darkMode;
        document.body.setAttribute('color-theme', settings.darkMode ? 'dark' : 'light');
      }),
    );
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.audioService.cleanup();
  }

  goBack() {
    this.location.back();
  }

  togglePlay() {
    if (this.currentTrack && this.currentTrack.previewUrl) {
      this.audioService.togglePlay();
    } else {
      console.warn('No track loaded or preview URL missing.');
    }
  }

  seek(event: any) {
    const newTime = event.detail.value;
    this.audioService.seek(newTime);
  }

  previous() {
    this.audioService.previous();
  }

  next() {
    this.audioService.next();
  }

  formatTime(time: number): string {
    if (!time) return '0:00';

    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  async toggleLike() {
    if (!this.currentTrack) return;

    const newLikedState = !this.currentTrack.liked;
    await this.storageService.toggleLikedTrack(this.currentTrack.id, newLikedState);

    // Update the current track object
    this.currentTrack = {
      ...this.currentTrack,
      liked: newLikedState
    };
  }
}
