import { Component, OnInit, OnDestroy, NgZone, ViewChild } from '@angular/core';
import { Location } from '@angular/common';
import { Subscription } from 'rxjs';
import { AudioService, Track } from '../services/audio.service';
import { SettingsService } from '../services/settings.service';
import { StorageService } from '../services/storage.service';
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
  showActions = false;
  actionButtons: any[] = [];
  @ViewChild('actionSheet') actionSheet: any;

  constructor(
    public audioService: AudioService,
    private settingsService: SettingsService,
    private storageService : StorageService,
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

   this.subs.push(
    this.audioService.getCurrentTrack().subscribe(track => {
      console.log('Now playing subscription updated with track:', track);
      if (track !== this.currentTrack) {
        this.zone.run(() => {
          this.currentTrack = track;
        });
      }
    })
  );

  this.subs.push(
    this.audioService.getIsPlaying().subscribe(playing => {
      console.log('Playing state updated:', playing);
      if (playing !== this.isPlaying) {
        this.zone.run(() => {
          this.isPlaying = playing;
        });
      }
    })
  );

  this.subs.push(
    this.audioService.getCurrentTime().subscribe(time => {
      this.zone.run(() => {
        this.currentTime = time;
      });
    })
  );
   this.subs.push(
    this.audioService.getDuration().subscribe(duration => {
      this.zone.run(() => {
        this.duration = duration;
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

  async togglePlay() {
    if (!this.currentTrack) return;

    try {
      if (this.isPlaying) {
        await this.audioService.pause();
      } else {
        await this.audioService.resume(this.currentTime);
      }
    } catch (error) {
      throw new Error('Error toggling play/pause: ' + error);
    }
  }

  seek(event: any) {
    try {
      const newValue = event.detail.value;

      // Update the time immediately for responsive UI
      this.currentTime = newValue;

      // Seek the audio to the new position
      this.audioService.seek(newValue);
    } catch (error) {
      console.error('Error seeking:', error);
    }
  }
  onSeekDrag(event: any) {
    // event.detail.value is the new slider position
    this.currentTime = event.detail.value;
  }

  previous() {
    this.audioService.previous();
  }

  next() {
    this.audioService.next();
  }

  formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds === undefined || seconds < 0) {
      return '0:00';
    }

    // Calculate minutes and seconds
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    // Format with leading zeros
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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

  showActionMenu(event: Event) {
    // Prevent event propagation
    event.stopPropagation();

    if (!this.currentTrack) {
      this.showAlert('No Track', 'No track is currently selected.');
      return;
    }

    // Define the buttons for the action sheet
    this.actionButtons = [
      {
        text: 'Delete Track',
        role: 'destructive',
        icon: 'trash',
        handler: () => {
          this.confirmDeleteTrack(this.currentTrack!);
        }
      },
      {
        text: 'Share',
        icon: 'share',
        handler: () => {
          // Placeholder for share functionality
          this.showAlert('Share', 'Share functionality is not implemented yet.');
        }
      },
      {
        text: this.currentTrack?.liked ? 'Remove from Liked' : 'Add to Liked',
        icon: 'heart',
        handler: () => {
          this.toggleLike();
        }
      },
      {
        text: 'Cancel',
        role: 'cancel',
        icon: 'close'
      }
    ];

    // Show the action sheet
    this.showActions = true;
  }

  async deleteTrack(track: Track) {
    try {
      // If it’s playing, stop it
      if (this.isPlaying) {
        await this.audioService.pause();
      }

      if (track.isLocal) {
        // 1) Clear the current track so the mini-player (in Home) will close
        await this.audioService.clearCurrentTrack();

        // 2) Delete it from storage
        await this.storageService.deleteLocalTrack(track.id);

        // 3) Show confirmation toast
        const toast = await this.toast.create({
          message: `"${track.title}" has been deleted`,
          duration: 2000,
          position: 'bottom',
          color: 'success'
        });
        await toast.present();

        // 4) Go back to Home (mini-player is now hidden)
        this.goBack();
      } else {
        this.showAlert(
          'Cannot Delete',
          'Only local tracks can be deleted. Streaming tracks are managed externally.'
        );
      }
    } catch (error) {
      console.error('Error deleting track:', error);
    }
  }


  // Add this method to confirm deletion
  async confirmDeleteTrack(track: Track) {
    const alert = await this.alertCtrl.create({
      header: 'Delete Track',
      message: `Are you sure you want to delete "${track.title}"?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.deleteTrack(track);
          }
        }
      ]
    });

    await alert.present();
  }
}
