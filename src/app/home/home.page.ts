import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoadingController, AlertController } from '@ionic/angular';
import { MusicService } from '../services/music.service';
import { AudioService, Track } from '../services/audio.service';
import { ThemeService } from '../services/theme.service';
import { firstValueFrom, Observable } from 'rxjs';

interface SpotifyCategory {
  id: string;
  name: string;
  icons?: {url: string}[];
  href?: string;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false
})
export class HomePage implements OnInit {
  categories: SpotifyCategory[] = [];
  newReleases: Track[] = [];
  featuredPlaylists: any[] = [];
  selectedCategory = 'all';
  isDarkMode: Observable<boolean>;
  isLoading = false;
  debugInfo = '';

  constructor(
    private musicService: MusicService,
    public audioService: AudioService,
    private themeService: ThemeService,
    private router: Router,
    private loadingCtrl: LoadingController,
    private alertController: AlertController
  ) {
    this.isDarkMode = this.themeService.isDarkMode();
  }

  async ngOnInit() {
    await this.loadInitialData();
  }

  async loadInitialData() {
    const loading = await this.loadingCtrl.create({
      message: 'Loading music...'
    });

    this.isLoading = true;
    await loading.present();

    try {
      // Authenticate first
      console.log('Starting authentication...');
      const authSuccess = await firstValueFrom(this.musicService.authenticate());
      if (!authSuccess) {
        throw new Error('Authentication failed');
      }
      console.log('Authentication successful');

      // Load data in parallel
      console.log('Loading categories, new releases, and featured playlists...');
      const [ categoriesData, newRelData, playlists ] = await Promise.all([
        firstValueFrom(this.musicService.getGenres()),
        firstValueFrom(this.musicService.getNewReleases()),
        firstValueFrom(this.musicService.getPlaylistsByGenre(this.selectedCategory))
      ]);

      // Process categories data
      this.categories = categoriesData.categories.items.map((item: any) => ({
        id: item.id,
        name: item.name,
        icons: item.icons
      }));

      // Log available categories for debugging
      this.debugInfo = `Available categories: ${this.categories.map(c => c.name).join(', ')}`;
      console.log(this.debugInfo);
      console.log('Category IDs:', this.categories.map(c => c.id));

      // Process new releases and playlists
      this.newReleases = newRelData.albums.items.map((item: any) => this.mapSpotifyTrack(item));
      this.featuredPlaylists = playlists;

      console.log(`Loaded ${this.categories.length} categories, ${this.newReleases.length} new releases, and ${this.featuredPlaylists.length} featured playlists`);
    } catch (err) {
      console.error('Error loading initial data', err);
      await this.showErrorAlert('Failed to load music data. Please try again.');
    } finally {
      this.isLoading = false;
      await loading.dismiss();
    }
  }

  async selectCategory(categoryId: string) {
    this.selectedCategory = categoryId;
    const loading = await this.loadingCtrl.create({
      message: 'Loading playlists…'
    });
    await loading.present();

    try {
      const playlists = await firstValueFrom(
        this.musicService.getPlaylistsByGenre(categoryId)
      );
      console.log(`playlists for ${categoryId}:`, playlists);
      this.featuredPlaylists = playlists;
      if (playlists.length === 0) {
        const name = this.categories.find(c => c.id === categoryId)?.name || categoryId;
        await this.showErrorAlert(`No playlists found for “${name}”.`);
      }
    } catch (err) {
      console.error('Error selecting category', err);
      await this.showErrorAlert('Failed to load playlists.');
    } finally {
      await loading.dismiss();
    }
  }

  async showErrorAlert(message: string) {
    const alert = await this.alertController.create({
      header: 'Notice',
      message: message,
      buttons: ['OK']
    });

    await alert.present();
  }

  playTrack(track: Track) {
    this.audioService.setCurrentTrack(track);
    this.router.navigate(['/now-playing']);
  }

  playPlaylist(playlistId: string) {
    console.log(`Playing playlist: ${playlistId}`);
    this.musicService.getPlaylistTracks(playlistId).subscribe({
      next: (data) => {
        if (!Array.isArray(data)) {
          console.error('Expected array of tracks but got:', data);
          this.showErrorAlert('Failed to parse playlist tracks.');
          return;
        }

        const tracks = data.map((item: any) => {
          if (!item.track) {
            console.warn('Track item missing track property:', item);
            return null;
          }
          return this.mapSpotifyTrack(item.track);
        }).filter(track => track !== null) as Track[];

        console.log(`Mapped ${tracks.length} valid tracks from playlist`);

        if (tracks.length > 0) {
          this.audioService.setQueue(tracks);
          this.router.navigate(['/now-playing']);
        } else {
          this.showErrorAlert('No playable tracks found in this playlist.');
        }
      },
      error: (err) => {
        console.error('Error loading playlist tracks', err);
        this.showErrorAlert('Failed to load playlist tracks.');
      }
    });
  }

  private mapSpotifyTrack(item: any): Track {
    if (!item) {
      console.warn('Attempted to map null or undefined item to track');
      return this.createEmptyTrack();
    }

    try {
      let imageUrl = '';
      if (item.images?.length) {
        imageUrl = item.images[0].url;
      } else if (item.album?.images?.length) {
        imageUrl = item.album.images[0].url;
      }

      return {
        id: item.id || `local-${Date.now()}`,
        title: item.name || 'Unknown Title',
        artist: Array.isArray(item.artists)
          ? item.artists.map((a: any) => a.name).join(', ')
          : 'Unknown Artist',
        album: item.album?.name || 'Unknown Album',
        duration: item.duration_ms ? item.duration_ms / 1000 : 0,
        imageUrl: imageUrl || 'assets/default-album-art.png',
        previewUrl: item.preview_url || '',
        spotifyId: item.id || '',
        liked: false
      };
    } catch (error) {
      console.error('Error mapping track:', error, item);
      return this.createEmptyTrack();
    }
  }

  private createEmptyTrack(): Track {
    return {
      id: `empty-${Date.now()}`,
      title: 'Unknown Track',
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration: 0,
      imageUrl: 'assets/default-album-art.png',
      previewUrl: '',
      spotifyId: '',
      liked: false
    };
  }

  // Refresh method to reload data
  async refreshData(event?: any) {
    try {
      await this.loadInitialData();
      if (event) event.target.complete();
    } catch (err) {
      console.error('Error refreshing data', err);
      if (event) event.target.complete();
    }
  }
}
