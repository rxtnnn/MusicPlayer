import { Component, OnInit, OnDestroy } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { AudioService, Track } from '../services/audio.service';
import { StorageService } from '../services/storage.service';
import { firstValueFrom, Subscription } from 'rxjs';
import { SettingsService } from '../services/settings.service';
import { Router } from '@angular/router';

interface Playlist {
  id: number;
  name: string;
  created_at: string;
  updated_at?: string;
  trackCount?: number;
}

@Component({
  selector: 'app-playlist',
  templateUrl: './playlist.page.html',
  styleUrls: ['./playlist.page.scss'],
  standalone: false
})
export class PlaylistsPage implements OnInit, OnDestroy {
  playlists: Playlist[] = [];
  likedTracks: Track[] = [];
  downloadedTracks: Track[] = [];
  selectedPlaylist: Playlist | null = null;
  playlistTracks: Track[] = [];
  isDarkMode?: boolean;
  private settingsSubscription?: Subscription;

  constructor(
    public audio: AudioService,
    private storage: StorageService,
    private alertCtrl: AlertController,
    private settingsService: SettingsService,
    private router: Router,
  ) {}

  async ngOnInit() {
    await this.storage.ensureInit();
    await this.loadPlaylists();
    await this.loadLikedTracks();
    await this.loadLocalTracks();

    this.settingsSubscription = this.settingsService.settings$.subscribe(settings => {
      this.isDarkMode = settings.darkMode;
      document.body.setAttribute('color-theme', settings.darkMode ? 'dark' : 'light');
    });
  }

  ngOnDestroy() {
    if (this.settingsSubscription) {
      this.settingsSubscription.unsubscribe();
    }
  }

  async ionViewWillEnter() {
    await this.loadPlaylists();
    await this.loadLikedTracks();
    await this.loadLocalTracks();

    if (this.selectedPlaylist) {
      if (this.selectedPlaylist.id === -1) {
        await this.loadLikedTracks();
      } else if (this.selectedPlaylist.id === -2) {
        await this.loadLocalTracks();
        this.playlistTracks = [...this.downloadedTracks];
      } else {
        await this.loadPlaylistTracks(this.selectedPlaylist.id);
      }
    }
  }
  async loadLocalTracks() {
    this.downloadedTracks = await this.storage.getLocalTracks();
  }

  private async loadLikedTracks() {
    try {
      this.likedTracks = await this.storage.getLikedTracks();
    } catch (error) {
      console.error('Error loading liked tracks:', error);
      this.likedTracks = [];
      await this.showAlert('Error', 'Failed to load liked music.');
    }
  }

  async selectUploadedMusic() {
    this.selectedPlaylist = { id: -2, name: 'Local Music', created_at: '' };
    this.playlistTracks = await this.storage.getLocalTracks();
  }


  private async loadPlaylists() {
    try {
      const raw = await this.storage.getPlaylists();
      this.playlists = await Promise.all(
        raw.map(async (p) => {
          const tracks = await this.storage.getPlaylistTracks(p.id);
          return {
            id: p.id,
            name: p.name,
            created_at: p.created_at,
            updated_at: p.updated_at,
            trackCount: tracks.length
          };
        })
      );
    } catch (error) {
      console.error('Error loading playlists:', error);
      this.playlists = [];
      await this.showAlert('Error', 'Failed to load playlists.');
    }
  }

  async createPlaylist() {
    const alert = await this.alertCtrl.create({
      header: 'New Playlist',
      inputs: [
        { name: 'name', type: 'text', placeholder: 'Playlist Name' }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Create',
          handler: async (data) => {
            const name = (data.name || '').trim();
            if (!name) {
              return false;
            }
            try {
              const id = await this.storage.createPlaylist(name);
              if (id > 0) {
                await this.loadPlaylists();
                await this.showAlert('Success', 'Playlist created successfully!');
              }
              return true;
            } catch (error) {
              console.error('Error creating playlist:', error);
              await this.showAlert('Error', 'Failed to create playlist.');
              return true;
            }
          }
        }
      ]
    });
    await alert.present();
  }

  selectPlaylist(pl: Playlist) {
    this.selectedPlaylist = pl;
    if (pl.id === -1) {
      this.playlistTracks = [...this.likedTracks];
    } else if (pl.id === -2) {
      this.playlistTracks = [...this.downloadedTracks];
    } else {
      this.loadPlaylistTracks(pl.id);
    }
  }

  private async loadPlaylistTracks(id: number) {
    try {
      this.playlistTracks = await this.storage.getPlaylistTracks(id);
    } catch (error) {
      console.error(`Error loading tracks for playlist ${id}:`, error);
      this.playlistTracks = [];
      await this.showAlert('Error', 'Failed to load playlist tracks.');
    }
  }

  async addToPlaylist(track: Track) {
    const alert = await this.alertCtrl.create({
      header: 'Add to Playlist',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Add',
          handler: async (playlistId) => {
            if (!playlistId) return;

            try {
              const id = parseInt(playlistId, 10);
              await this.storage.addTrackToPlaylist(id, track.id);
              await this.showAlert('Success', 'Track added to playlist.');
              await this.loadPlaylists();

            } catch (error) {
              console.error('Error adding track to playlist:', error);
              await this.showAlert('Error', 'Failed to add track to playlist.');
            }
          }
        }
      ]
    });

    this.playlists.forEach(playlist => {
      alert.inputs?.push({
        type: 'radio',
        label: playlist.name,
        value: playlist.id.toString()
      });
    });

    alert.inputs?.push({
      type: 'radio',
      label: '+ Create New Playlist',
      value: 'new'
    });

    await alert.present();
  }

  async toggleTrack(track: Track): Promise<void> {
    try {
      this.audio.cleanup();
      const current  = await firstValueFrom(this.audio.getCurrentTrack());
      const playing  = await firstValueFrom(this.audio.getIsPlaying());
      if (current?.id === track.id && playing) {
        await this.audio.pause();
      } else {
        await this.audio.play(track);
      }
    } catch (err) {
      console.error('Error toggling track playback:', err);
    }
  }

  playTrack(track: Track) {
    if (track.isLocal) {
      this.audio.play(track);
    } else {
      this.audio.play(track);
    }
    this.router.navigate(['/now-playing']);
  }

  playPlaylist() {
    let tracks: Track[] = [];
    if (this.selectedPlaylist?.id === -1) {
      tracks = this.likedTracks;
    } else if (this.selectedPlaylist?.id === -2) {
      tracks = this.downloadedTracks;
    } else {
      tracks = this.playlistTracks;
    }
    if (tracks.length > 0) {
      this.audio.setQueue(tracks);
      this.audio.play(tracks[0]);
      this.router.navigate(['/now-playing']);
    } else {
      this.showAlert('No tracks', 'This playlist contains no tracks to play.');
    }
  }

  private async showAlert(header: string, message: string) {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: ['OK']
    });
    await alert.present();
  }

  backToList() {
    this.selectedPlaylist = null;
    this.playlistTracks = [];
  }

  async confirmDeletePlaylist(pl: Playlist) {
    const alert = await this.alertCtrl.create({
      header: 'Delete Playlist',
      message: `Are you sure you want to delete "${pl.name}"?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          handler: async () => {
            try {
              await this.storage.executeSql(
                'DELETE FROM playlists WHERE id = ?;',
                [pl.id]
              );
              await this.storage.executeSql(
                'DELETE FROM playlist_tracks WHERE playlist_id = ?;',
                [pl.id]
              );
              await this.loadPlaylists();
              this.backToList();
            } catch (err) {
              console.error('Error deleting playlist', err);
              await this.showAlert('Error', 'Could not delete playlist.');
            }
          }
        }
      ]
    });
    await alert.present();
  }
}
