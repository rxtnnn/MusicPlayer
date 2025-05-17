// src/app/now-playing/now-playing.page.ts

import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { Location } from '@angular/common';
import { Subscription } from 'rxjs';
import { AudioService, Track } from '../services/audio.service';
import { SettingsService } from '../services/settings.service';
import { AlertController, ToastController } from '@ionic/angular';

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
  isLocalTrack = false; // Add flag to track if we're playing a local file

  private subs: Subscription[] = [];
  private settingsSub?: Subscription;

  constructor(
    public audioService: AudioService,
    private settingsService: SettingsService,
    private location: Location,
    private alertCtrl: AlertController,
    private toast: ToastController,
    private zone: NgZone
  ) {}

  ngOnInit() {
    // 1) Theme toggling
    this.settingsSub = this.settingsService.settings$.subscribe(settings => {
      this.isDarkMode = settings.darkMode;
      document.body.setAttribute(
        'color-theme',
        settings.darkMode ? 'dark' : 'light'
      );
    });

    // 2) Subscribe to AudioService observables
    this.subs.push(
      this.audioService.getCurrentTrack().subscribe(track => {
        this.zone.run(() => {
          this.currentTrack = track;

          // Check if this is a local track
          this.isLocalTrack = !!track?.isLocal;

          // Debug log
          if (track) {
            console.log('Now playing track:', track.title);
            console.log('Is local:', track.isLocal);
            console.log('Path:', track.localPath || track.previewUrl);
          }
        });
      }),

      this.audioService.getIsPlaying().subscribe(is => {
        this.zone.run(() => {
          this.isPlaying = is;
        });
      }),

      this.audioService.getCurrentTime().subscribe(time => {
        this.zone.run(() => {
          this.currentTime = time;
        });
      }),

      this.audioService.getDuration().subscribe(dur => {
        this.zone.run(() => {
          this.duration = dur;
        });
      })
    );

    // 3) If we get to this page with no track playing, try to load the last track
    setTimeout(() => {
      if (!this.currentTrack && !this.isPlaying) {
        this.checkAndPlayCurrentTrack();
      }
    }, 500);
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.settingsSub?.unsubscribe();
    // we don't call any cleanup here so playback continues
  }

  /** Check if we have a current track and try to play it */
  private checkAndPlayCurrentTrack() {
    // We need to get the current value from the BehaviorSubject
    const sub = this.audioService.getCurrentTrack().subscribe(track => {
      if (track) {
        try {
          this.audioService.play(track);
        } catch (err) {
          console.error('Error playing track:', err);
          this.showAlert('Playback Error',
            'Could not play the current track. Please try selecting another track.');
        }
      }

      // Unsubscribe immediately since we only needed the current value
      sub.unsubscribe();
    });
  }

  // Navigate back
  goBack() {
    this.location.back();
  }

  // Play/pause toggle
  togglePlay() {
    if (!this.currentTrack) {
      this.showAlert('No Track', 'Please select a track first.');
      return;
    }

    // For local tracks, make sure we have a proper path
    if (this.isLocalTrack &&
        !this.currentTrack?.localPath &&
        !this.currentTrack?.previewUrl) {
      this.showAlert('Playback Error', 'Local file path is missing. Please try uploading the file again.');
      return;
    }

    // For streaming tracks, ensure we have a preview URL
    if (!this.isLocalTrack && !this.currentTrack?.previewUrl) {
      this.showAlert('Playback Error', 'This track doesn\'t have a preview available.');
      return;
    }

    this.audioService.togglePlay();
  }

  // Seek handler
  seek(event: any) {
    const t = event.detail.value as number;
    this.audioService.seek(t);
  }

  // Prev/Next
  previous() {
    this.audioService.previous();
  }
  next() {
    this.audioService.next();
  }

  // Format seconds → M:SS
  formatTime(sec: number): string {
    if (isNaN(sec) || sec === undefined) return '0:00';

    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60)
      .toString()
      .padStart(2, '0');
    return `${m}:${s}`;
  }

  // Like/unlike using AudioService
  async toggleLike() {
    if (!this.currentTrack) return;
    try {
      await this.audioService.toggleLike(this.currentTrack);
      const msg = this.currentTrack.liked
        ? 'Added to Liked'
        : 'Removed from Liked';
      const t = await this.toast.create({
        message: msg,
        duration: 1500,
        position: 'bottom',
        color: 'success'
      });
      await t.present();
    } catch (err) {
      console.error('Error toggling like status:', err);
      this.showAlert('Error', 'Could not update like status.');
    }
  }

  // Simple alert helper
  private async showAlert(header: string, msg: string) {
    const a = await this.alertCtrl.create({
      header,
      message: msg,
      buttons: ['OK']
    });
    await a.present();
  }
}
