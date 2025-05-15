import { Component, OnInit } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { AudioService, Track } from '../services/audio.service';
import { StorageService } from '../services/storage.service';
import { Subscription } from 'rxjs';
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
export class PlaylistsPage implements OnInit {
  playlists: Playlist[] = [];
  likedTracks: Track[] = [];
  downloaded: any[]         = [];
  selectedPlaylist: Playlist | null = null;
  playlistTracks: Track[]   = [];
  isDarkMode?: boolean;
  downloadedTracks: Track[] = [];
  private settingsSubscription?: Subscription;
  constructor(
    private audio: AudioService,
    private storage: StorageService,
    private alertCtrl: AlertController,
    private settingsService: SettingsService,
    private router: Router,
  ) {}

  async ngOnInit() {
    await this.storage.ensureInit();
    await this.loadPlaylists();
    await this.loadLikedTracks();
    await this.loadDownloadedTracks();

    this.settingsSubscription = this.settingsService.settings$.subscribe(settings => {
      this.isDarkMode = settings.darkMode;
      document.body.setAttribute('color-theme', settings.darkMode ? 'dark' : 'light');
    });

  }

  async ionViewWillEnter() {
    await this.loadPlaylists();
    await this.loadLikedTracks();
    await this.loadDownloadedTracks();
  }
  private async loadDownloadedTracks() {
    this.downloadedTracks = await this.storage.getDownloadedTracksWithInfo();
  }

  // Add a method to load liked tracks (which was missing)
  private async loadLikedTracks() {
    this.likedTracks = await this.storage.getLikedTracks();
  }

  selectDownloadedMusic() {
    this.selectedPlaylist = {
      id: -2, // Use -2 to differentiate from liked music (-1)
      name: 'Downloaded Music',
      created_at: ''
    };
    this.playlistTracks = [...this.downloadedTracks];
  }

  private async loadPlaylists() {
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
              return false; // keep dialog open
            }
            const id = await this.storage.createPlaylist(name);
            if (id > 0) {
              // Reload entire list so the new card appears
              await this.loadPlaylists();
            }
            return true;  // close dialog
          }
        }
      ]
    });
    await alert.present();
  }

  selectPlaylist(pl: Playlist) {
    this.selectedPlaylist = pl;
    this.loadPlaylistTracks(pl.id);
  }

  private async loadPlaylistTracks(id: number) {
    this.playlistTracks = await this.storage.getPlaylistTracks(id);
  }



  async toggleLike(track: Track) {
    if (track.liked) {
      await this.storage.removeLiked(track.id);
    } else {
      await this.storage.addLiked(track.id);
    }
    // refresh status
    this.likedTracks = await this.storage.getLikedTracks();
  }

  async toggleDownload(track: Track) {
    const isDownloaded = this.downloaded.some(d => d.track_id === track.id);
    if (isDownloaded) {
      await this.storage.removeDownloaded(track.id);
    } else {
      // user-supplied URI needed here:
      const uri = await this.audio.downloadTrack(track);
      await this.storage.addDownloaded(track.id, uri);
    }
    this.downloaded = await this.storage.getDownloadedTracks();
  }

  playTrack(track: Track) {
    this.audio.play(track);
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
}
