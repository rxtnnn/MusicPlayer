// src/app/home/home.page.ts

import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  LoadingController,
  AlertController,
} from '@ionic/angular';
import { MusicService } from '../services/music.service';
import { AudioService, Track } from '../services/audio.service';
import { StorageService } from '../services/storage.service';
import { ThemeService } from '../services/theme.service';
import { firstValueFrom, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

interface SpotifyCategory {
  id: string;
  name: string;
  icons?: { url: string }[];
  href?: string;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false
})
export class HomePage implements OnInit {
  @ViewChild('searchInput', { read: ElementRef }) searchInput!: ElementRef;

  // Search bar state
  searchActive = false;
  searchQuery = '';
  searchResults: Track[] = [];

  // Core data
  categories: SpotifyCategory[] = [];
  newReleases: Track[] = [];
  featuredPlaylists: any[] = [];
  recommendedTracks: Track[] = [];
  selectedCategory = 'all';

  // UI state
  isDarkMode = this.themeService.isDarkMode();
  isLoading = false;

  constructor(
    private musicService: MusicService,
    public audioService: AudioService,
    private themeService: ThemeService,
    private router: Router,
    private loadingCtrl: LoadingController,
    private alertController: AlertController,
    private storageService: StorageService
  ) {}

  async ngOnInit() {
    await this.loadInitialData();
  }

  /** Toggle animated search bar open/close */
  toggleSearch() {
    this.searchActive = !this.searchActive;
    if (this.searchActive) {
      // focus the input after the container becomes visible
      setTimeout(() => this.searchInput.nativeElement.focus(), 200);
    } else {
      this.clearSearch();
    }
  }

  /** Called on every search input change */
  onSearch() {
    const q = this.searchQuery.trim();
    if (!q) {
      this.searchResults = [];
      return;
    }
    this.musicService
      .searchTracks(q, 20)
      .pipe(
        map((res) =>
          res.tracks.items.map((i: any) => this.mapSpotifyTrack(i))
        ),
        catchError((err) => {
          console.error('Search error', err);
          return of<Track[]>([]);
        })
      )
      .subscribe((tracks) => (this.searchResults = tracks));
  }

  /** When user focuses the <input> */
  onSearchFocus() {
    // you can use this to animate placeholder/title if desired
  }

  /** When user blurs the <input> */
  onSearchBlur() {
    // optionally hide results if query is empty
    if (!this.searchQuery) {
      this.searchResults = [];
    }
  }

  /** Clear search query and results */
  clearSearch() {
    this.searchQuery = '';
    this.searchResults = [];
  }

  /** Play a single track */
  playTrack(track: Track) {
    this.audioService.play(track);
    this.router.navigate(['/now-playing']);
  }

  /** Fetch and play all tracks in a playlist */
  playPlaylist(playlistId: string) {
    this.musicService
      .getPlaylistTracks(playlistId)
      .pipe(
        map((items: any[]) =>
          items
            .map((i) => i.track)
            .filter(Boolean)
            .map((t) => this.mapSpotifyTrack(t))
        ),
        catchError((err) => {
          console.error('Playlist load error', err);
          this.showError('Could not load playlist.');
          return of<Track[]>([]);
        })
      )
      .subscribe((tracks) => {
        if (tracks.length) {
          this.audioService.setQueue(tracks);
          this.router.navigate(['/now-playing']);
        } else {
          this.showError('No playable tracks in this playlist.');
        }
      });
  }

  /** Change featured playlist category */
  async selectCategory(categoryId: string) {
    this.selectedCategory = categoryId;
    const loading = await this.loadingCtrl.create({
      message: 'Loading playlists…',
    });
    await loading.present();
    try {
      this.featuredPlaylists = await firstValueFrom(
        this.musicService.getPlaylistsByGenre(categoryId)
      );
      if (!this.featuredPlaylists.length) {
        this.showError(`No playlists found for "${categoryId}".`);
      }
    } catch {
      this.showError('Failed to load playlists.');
    } finally {
      loading.dismiss();
    }
  }

  /** Handle local audio file upload */
  onFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const track: Track = {
      id: `local-${Date.now()}`,
      title: file.name,
      artist: 'Local File',
      album: 'Local Files',
      duration: 0,
      imageUrl: 'assets/default-album-art.png',
      previewUrl: url,
      spotifyId: '',
      liked: false,
    };
    this.storageService.saveTrack(track);
    this.newReleases.unshift(track);
  }

  /** Initial data load: auth, genres, releases, playlists */
  private async loadInitialData() {
    const loading = await this.loadingCtrl.create({
      message: 'Loading music...',
    });
    await loading.present();
    this.isLoading = true;
    try {
      const authOk = await firstValueFrom(
        this.musicService.authenticate()
      );
      if (!authOk) throw new Error('Spotify authentication failed');

      const [cats, newRel, playlists] = await Promise.all([
        firstValueFrom(this.musicService.getGenres()),
        firstValueFrom(this.musicService.getNewReleases()),
        firstValueFrom(
          this.musicService.getPlaylistsByGenre(this.selectedCategory)
        ),
      ]);

      this.categories = cats.categories.items.map((i: any) => ({
        id: i.id,
        name: i.name,
        icons: i.icons,
        href: i.href,
      }));
      this.newReleases = newRel.albums.items.map((i: any) =>
        this.mapSpotifyTrack(i)
      );
      this.featuredPlaylists = playlists;
      this.recommendedTracks = [...this.newReleases];
    } catch (err) {
      console.error('Data load error', err);
      await this.showError('Failed loading initial data.');
    } finally {
      this.isLoading = false;
      loading.dismiss();
    }
  }

  /** Convert raw Spotify item to our Track model */
  private mapSpotifyTrack(item: any): Track {
    return {
      id: item.id || `track-${Date.now()}`,
      title: item.name,
      artist: Array.isArray(item.artists)
        ? item.artists.map((a: any) => a.name).join(', ')
        : 'Unknown Artist',
      album: item.album?.name || 'Unknown Album',
      duration: (item.duration_ms ?? item.duration) / 1000,
      imageUrl:
        item.images?.[0]?.url ||
        item.album?.images?.[0]?.url ||
        'assets/default-album-art.png',
      previewUrl: item.preview_url || '',
      spotifyId: item.id || '',
      liked: false,
    };
  }

  /** Display a simple alert */
  private async showError(message: string) {
    const alert = await this.alertController.create({
      header: 'Notice',
      message,
      buttons: ['OK'],
    });
    await alert.present();
  }
}
