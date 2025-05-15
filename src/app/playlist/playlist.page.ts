import { Component, OnInit } from '@angular/core';
import { AlertController }      from '@ionic/angular';
import { AudioService, Track }  from '../services/audio.service';
import { StorageService }       from '../services/storage.service';
import { ThemeService }         from '../services/theme.service';
import { Observable }           from 'rxjs';

interface Playlist {
  id: number;
  name: string;
  created_at: string;
  updated_at?: string;
  trackCount?: number;
}

@Component({
  selector: 'app-playlists',
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
  isDarkMode: Observable<boolean>;

  constructor(
    private audio: AudioService,
    private storage: StorageService,
    private theme: ThemeService,
    private alertCtrl: AlertController
  ) {
    this.isDarkMode = this.theme.isDarkMode();
  }

  async ngOnInit() {
    await this.storage.init();
    await this.refreshAll();
  }

  ionViewWillEnter() {
    this.refreshAll();
  }

  private async refreshAll() {
  // 1) All user-created playlists
  const raw = await this.storage.getPlaylists();
  this.playlists = await Promise.all(
    raw.map(async p => {
      const tracks = await this.storage.getPlaylistTracks(p.id);
      return { ...p, trackCount: tracks.length };
    })
  );

  // 2) All liked tracks (IDs or full Track[] per your service)
  this.likedTracks = await this.storage.getLikedTracks();

  // 3) Downloaded list
  this.downloaded = await this.storage.getDownloadedTracks();

  // 4) If detail open, reload its tracks
  if (this.selectedPlaylist && this.selectedPlaylist.id !== -1) {
    this.playlistTracks = await this.storage.getPlaylistTracks(
      this.selectedPlaylist.id
    );
  }
  }


  async createPlaylist() {
    const alert = await this.alertCtrl.create({
      header: 'New Playlist',
      inputs: [{ name: 'name', placeholder: 'Name' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Create',
          handler: async data => {
            const name = (data.name || '').trim();
            if (!name) return false;
            await this.storage.createPlaylist(name);
            await this.refreshAll();
            return true;
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
  }

  playPlaylist() {
    const tracks =
      this.selectedPlaylist?.id === -1
        ? this.likedTracks
        : this.playlistTracks;
    this.audio.setQueue(tracks);
  }

  backToList() {
    this.selectedPlaylist = null;
    this.playlistTracks = [];
  }
}
