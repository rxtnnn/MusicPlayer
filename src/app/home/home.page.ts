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
  ToastController,
} from '@ionic/angular';
import { MusicService } from '../services/music.service';
import { AudioService, Track } from '../services/audio.service';
import { StorageService } from '../services/storage.service';
import { SettingsService } from '../services/settings.service';
import { firstValueFrom, Observable, of, Subscription } from 'rxjs';
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
  isLoading = false;
  private settingsSubscription?: Subscription;
  isDarkMode?: boolean;

  constructor(
    private musicService: MusicService,
    public audioService: AudioService,
    private settingService: SettingsService,
    private router: Router,
    private loadingCtrl: LoadingController,
    private alertController: AlertController,
    private storageService: StorageService,
    private toast: ToastController
  ) {}

  async ngOnInit() {
    await this.loadInitialData();
     this.settingsSubscription = this.settingService.settings$.subscribe(settings => {
      this.isDarkMode = settings.darkMode;
      document.body.setAttribute('color-theme', settings.darkMode ? 'dark' : 'light');

     });
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

  async onFileSelected(event: any) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Show loading indicator
    const loading = await this.loadingCtrl.create({
      message: 'Processing audio file...',
    });
    await loading.present();

    try {
      // Process the file
      const file = files[0];

      // Check if it's an audio file
      if (!file.type.startsWith('audio/')) {
        this.showError(`${file.name} is not a valid audio file.`);
        return;
      }

      // Add the track using the enhanced AudioService
      const track = await this.audioService.addLocalTrack(file);

      // Add to new releases for display
      this.newReleases.unshift(track);

      // Navigate to now playing page
      this.router.navigate(['/now-playing']);

      // Show success message
      this.showToast(`${track.title} added to your library`);
    } catch (error) {
      console.error('Error processing audio file:', error);
      this.showError('Failed to process audio file. Please try another file.');
    } finally {
      loading.dismiss();
    }
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

  // Add a toast method
  private async showToast(message: string) {
    const toast = await this.toast.create({
      message,
      duration: 2000,
      position: 'bottom',
      color: 'success'
    });
    await toast.present();
  }
}
