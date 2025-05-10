import { Component, OnInit } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { AudioService, Track } from '../services/audio.service';
import { StorageService } from '../services/storage.service';
import { ThemeService } from '../services/theme.service';
import { Observable } from 'rxjs';

interface Playlist {
  id: number;
  name: string;
  created_at: string;
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
  selectedPlaylist: Playlist | null = null;
  playlistTracks: Track[] = [];
  isDarkMode: Observable<boolean>;

  constructor(
    private audioService: AudioService,
    private storageService: StorageService,
    private themeService: ThemeService,
    private alertCtrl: AlertController
  ) {
    this.isDarkMode = this.themeService.isDarkMode();
  }

  async ngOnInit() {
    await this.loadPlaylists();
    await this.loadLikedTracks();
  }

  ionViewWillEnter() {
    this.loadPlaylists();
    this.loadLikedTracks();
  }

  async loadPlaylists() {
    const playlists = await this.storageService.getPlaylists();

    for (const playlist of playlists) {
      const tracks = await this.storageService.getPlaylistTracks(playlist.id);
      playlist.trackCount = tracks.length;
    }

    this.playlists = playlists;
  }

  async loadLikedTracks() {
    this.likedTracks = await this.storageService.getLikedTracks();
  }

  async createPlaylist() {
    const alert = await this.alertCtrl.create({
      header: 'New Playlist',
      inputs: [
        {
          name: 'name',
          type: 'text',
          placeholder: 'Playlist Name'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Create',
          handler: async (data) => {
            if (data.name.trim()) {
              await this.storageService.createPlaylist(data.name);
              this.loadPlaylists();
            }
          }
        }
      ]
    });

    await alert.present();
  }

  selectPlaylist(playlist: Playlist) {
    this.selectedPlaylist = playlist;
    this.loadPlaylistTracks(playlist.id);
  }

  async loadPlaylistTracks(playlistId: number) {
    this.playlistTracks = await this.storageService.getPlaylistTracks(playlistId);
  }

  playTrack(track: Track) {
    this.audioService.play(track);
  }

  playPlaylist(tracks: Track[]) {
    if (tracks.length > 0) {
      this.audioService.setQueue(tracks);
    }
  }

  async toggleLike(track: Track) {
    const newLikedState = !track.liked;
    await this.storageService.toggleLikedTrack(track.id, newLikedState);
    track.liked = newLikedState;
    if (!this.selectedPlaylist) {
      this.loadLikedTracks();
    }
  }

  backToPlaylists() {
    this.selectedPlaylist = null;
  }
}
