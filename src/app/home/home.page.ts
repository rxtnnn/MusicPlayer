import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoadingController } from '@ionic/angular';
import { MusicService } from '../services/music.service';
import { AudioService, Track } from '../services/audio.service';
import { ThemeService } from '../services/theme.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false
})
export class HomePage implements OnInit {
  genres: any[] = [];
  newReleases: any[] = [];
  featuredPlaylists: any[] = [];
  selectedGenre: string = 'all';
  isDarkMode: Observable<boolean>;

  constructor(
    private spotifyService: MusicService,
    public audioService: AudioService,
    private themeService: ThemeService,
    private router: Router,
    private loadingCtrl: LoadingController
  ) {
    this.isDarkMode = this.themeService.isDarkMode();
  }

  async ngOnInit() {
    const loading = await this.loadingCtrl.create({
      message: 'Loading music...'
    });
    await loading.present();

    try {
      await this.loadGenres();
      await this.loadNewReleases();
      await this.loadFeaturedPlaylists();
    } finally {
      loading.dismiss();
    }
  }

  async loadGenres() {
    this.spotifyService.getGenres().subscribe(
      (data: any) => {
        this.genres = data.categories.items;
      },
      error => {
        console.error('Error loading genres', error);
      }
    );
  }

  async loadNewReleases() {
    this.spotifyService.getNewReleases().subscribe(
      (data: any) => {
        this.newReleases = data.albums.items.map((item: any) => this.mapSpotifyTrack(item));
      },
      error => {
        console.error('Error loading new releases', error);
      }
    );
  }

  async loadFeaturedPlaylists() {
    this.spotifyService.getPlaylistsByGenre(this.selectedGenre).subscribe(
      (data: any) => {
        this.featuredPlaylists = data.playlists.items;
      },
      error => {
        console.error('Error loading featured playlists', error);
      }
    );
  }

  selectGenre(genreId: string) {
    this.selectedGenre = genreId;
    this.loadFeaturedPlaylists();
  }

  playTrack(track: Track) {
    this.audioService.play(track);
    this.router.navigate(['/now-playing']);
  }

  playPlaylist(playlistId: string) {
    this.spotifyService.getPlaylistTracks(playlistId).subscribe(
      (data: any) => {
        const tracks = data.items.map((item: { track: any; }) => this.mapSpotifyTrack(item.track));
        this.audioService.setQueue(tracks);
        this.router.navigate(['/now-playing']);
      },
      error => {
        console.error('Error loading playlist tracks', error);
      }
    );
  }

  private mapSpotifyTrack(item: any): Track {
  // First, log the item to debug what we're receiving
  console.log('Spotify track item:', item);

  // Check the structure of 'album' and 'images' if they exist
  if (item.album) {
    console.log('Album object:', item.album);
    console.log('Album images:', item.album.images);
  }

  // Handle different response structures from different Spotify API endpoints
  let imageUrl = '';

  // Some endpoints directly include images at the top level (like albums in new releases)
  if (item.images && item.images.length > 0) {
    imageUrl = item.images[0].url;
  }
  // Others have images nested in the album object (like tracks)
  else if (item.album && item.album.images && item.album.images.length > 0) {
    imageUrl = item.album.images[0].url;
  }

  return {
    id: item.id || `local-${Date.now()}`,
    title: item.name || 'Unknown Title',
    artist: item.artists && Array.isArray(item.artists)
      ? item.artists.map((a: { name: string }) => a.name || 'Unknown Artist').join(', ')
      : 'Unknown Artist',
    album: item.album && item.album.name ? item.album.name : 'Unknown Album',
    duration: item.duration_ms ? item.duration_ms / 1000 : 0,
    imageUrl: imageUrl || 'assets/default-album-art.png', // Always provide a fallback
    previewUrl: item.preview_url || '',
    spotifyId: item.id || '',
    liked: false
  };
}
}
