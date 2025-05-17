// src/app/home/home.page.ts

import { Component, OnInit, ViewChild, ElementRef, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController, LoadingController, AlertController } from '@ionic/angular';
import { AudioService, Track } from '../services/audio.service';
import { StorageService } from '../services/storage.service';
import { MusicService } from '../services/music.service';
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
  @ViewChild('fileInput', { static: false }) fileInput!: ElementRef<HTMLInputElement>;

  // Search bar state
  searchActive = false;
  searchQuery = '';
  searchResults: Track[] = [];

  // Core data
  categories: SpotifyCategory[] = [];
  newReleases: Track[] = [];
  featuredPlaylists: any[] = [];
  recommendedTracks: Track[] = [];
  localMusic: Track[] = [];
  selectedCategory = 'all';
  isLoading = false;
  private settingsSubscription?: Subscription;
  isDarkMode?: boolean;

  // Genre tracks
  genreTracks: Track[] = [];
  showGenreTracks = false;

  // Flag to show whether we have local music
  hasLocalMusic = false;

  constructor(
    public audioService: AudioService,
    private storageService: StorageService,
    private musicService: MusicService,
    private settingsService: SettingsService,
    private router: Router,
    private ngZone: NgZone,
    private toast: ToastController,
    private loadingCtrl: LoadingController,
    private alertController: AlertController
  ) {}

  async ngOnInit() {
    await this.loadInitialData();
    this.settingsSubscription = this.settingsService.settings$.subscribe(settings => {
      this.isDarkMode = settings.darkMode;
      document.body.setAttribute('color-theme', settings.darkMode ? 'dark' : 'light');
    });
  }

  async ionViewWillEnter() {
    // Refresh local music whenever returning to this page
    await this.refreshLocalMusic();
  }

  ngOnDestroy() {
    if (this.settingsSubscription) {
      this.settingsSubscription.unsubscribe();
    }
  }

  /** Handle file selection for local music upload */
  async onFileSelected(event: any) {
    const files: FileList = event.target.files;
    if (!files || files.length === 0) return;

    // Show upload progress indicator
    const loadingToast = await this.toast.create({
      message: 'Processing audio file...',
      duration: 0, // Don't auto-dismiss
      position: 'top',
      color: 'primary'
    });
    await loadingToast.present();

    try {
      // Process files one by one
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Update toast message for multiple files
        if (files.length > 1) {
          loadingToast.message = `Processing file ${i+1} of ${files.length}: ${file.name}`;
        }

        // Skip non-audio files
        if (!file.type.startsWith('audio/')) {
          console.warn(`${file.name} is not a valid audio file.`);
          continue;
        }

        // Process the file through our service
        const track = await this.audioService.addLocalTrack(file);

        // Add to our local music collection
        this.ngZone.run(() => {
          this.localMusic.unshift(track);
          this.hasLocalMusic = true;

          // Also add to new releases for visibility
          this.newReleases = [track, ...this.newReleases];

          // Add to recommended tracks as well
          this.recommendedTracks = [track, ...this.recommendedTracks];
        });
      }

      // Dismiss loading toast
      loadingToast.dismiss();

      // Show success message
      const msg = files.length > 1
        ? `Added ${files.length} files to your library`
        : `${files[0].name} added to your library`;

      const toast = await this.toast.create({
        message: msg,
        duration: 2000,
        position: 'bottom',
        color: 'success'
      });
      await toast.present();

      // Update local music in the view
      await this.refreshLocalMusic();

    } catch (err) {
      console.error('Error processing audio file:', err);

      // Dismiss loading toast
      loadingToast.dismiss();

      // Show error message
      const errToast = await this.toast.create({
        message: 'Failed to process audio file.',
        duration: 2000,
        position: 'bottom',
        color: 'danger'
      });
      await errToast.present();
    } finally {
      // Reset file input
      this.fileInput.nativeElement.value = '';
    }
  }

  /** Open file selector programmatically */
  openFileSelector() {
    if (this.fileInput && this.fileInput.nativeElement) {
      this.fileInput.nativeElement.click();
    }
  }

  /** Play a single track (local or streaming) */
  playTrack(track: Track) {
    console.log('Playing track:', track);

    // Different handling for local tracks vs streaming tracks
    if (track.isLocal) {
      console.log('Playing local track with path:', track.localPath || track.previewUrl);
      this.audioService.play(track);
      this.router.navigate(['/now-playing']);
    } else {
      // Make sure streaming tracks have a preview URL
      if (!track.previewUrl) {
        this.showError('This track doesn\'t have a preview available.');
        return;
      }

      this.audioService.play(track);
      this.router.navigate(['/now-playing']);
    }
  }

  /** Load all local music from storage */
  private async refreshLocalMusic() {
    try {
      // Get local tracks from storage
      const locals = await this.storageService.getLocalTracks();

      this.ngZone.run(() => {
        this.localMusic = locals;
        this.hasLocalMusic = locals.length > 0;

        // Also update new releases if needed
        if (this.newReleases.length === 0) {
          this.newReleases = [...locals];
        }
      });

      // Ensure local tracks are added to the playlist page
      await this.updateLocalMusicInPlaylist();
    } catch (error) {
      console.error('Error refreshing local music:', error);
    }
  }

  /** Add local tracks to the "Downloaded Music" section in playlists */
  private async updateLocalMusicInPlaylist() {
    try {
      for (const track of this.localMusic) {
        // Ensure each local track is properly added to downloaded tracks for playlist page
        if (track.localPath || track.previewUrl) {
          await this.storageService.addDownloaded(
            track.id,
            track.localPath || track.previewUrl
          );
        }
      }
    } catch (error) {
      console.error('Error updating local music in playlists:', error);
    }
  }

  /** Fetch and play all tracks in a playlist */
  playPlaylist(playlistId: string) {
    this.musicService
      .getPlaylistTracks(playlistId)
      .pipe(
        map((items: any[]) =>
          items
            .map((i) => i.track)
            .filter((t) => t && t.preview_url) // Only include tracks with preview URLs
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
          console.log('Playing playlist with tracks:', tracks);
          this.audioService.setQueue(tracks);
          this.router.navigate(['/now-playing']);
        } else {
          this.showError('No playable tracks in this playlist.');
        }
      });
  }

  /** Play all local music */
  playAllLocalMusic() {
    if (this.localMusic.length === 0) {
      this.showError('No local music available to play');
      return;
    }

    this.audioService.setQueue(this.localMusic);
    this.router.navigate(['/now-playing']);
  }

  /** Toggle search bar visibility */
  toggleSearch() {
    this.searchActive = !this.searchActive;
    if (this.searchActive) {
      // focus the input after the container becomes visible
      setTimeout(() => this.searchInput.nativeElement.focus(), 200);
    } else {
      this.clearSearch();
    }
  }

  /** Handle search input changes */
  onSearch() {
    const q = this.searchQuery.trim();
    if (!q) {
      this.searchResults = [];
      return;
    }

    // First look through local music
    const localResults = this.localMusic.filter(
      track => track.title.toLowerCase().includes(q.toLowerCase()) ||
               track.artist.toLowerCase().includes(q.toLowerCase())
    );

    if (localResults.length > 0) {
      this.searchResults = localResults;
    } else {
      // Fall back to Spotify search
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
        .subscribe((tracks) => {
          console.log('Search results:', tracks);
          this.searchResults = tracks;
        });
    }
  }

  onSearchFocus() { /* Search focus handler */ }
  onSearchBlur() { /* Search blur handler */ }

  /** Clear search query and results */
  clearSearch() {
    this.searchQuery = '';
    this.searchResults = [];
  }

  /** Change category and load tracks for that genre */
  async selectCategory(categoryId: string) {
    console.log('Selecting category:', categoryId);
    this.selectedCategory = categoryId;

    // Show loading indicator
    const loading = await this.loadingCtrl.create({
      message: 'Loading music...',
    });
    await loading.present();

    try {
      // First, get playlists for this category (original behavior)
      this.featuredPlaylists = await firstValueFrom(
        this.musicService.getPlaylistsByGenre(categoryId)
      );

      // NEW: Now also get tracks for this genre
      if (categoryId === 'all') {
        // For 'all', just use recommended tracks
        this.showGenreTracks = false;
      } else {
        // For specific genres, get tracks for that genre
        const tracks = await firstValueFrom(
          this.musicService.getTracksByGenre(categoryId)
        );

        if (tracks && tracks.length > 0) {
          this.genreTracks = tracks;
          this.showGenreTracks = true;
          console.log(`Loaded ${tracks.length} tracks for genre ${categoryId}`);
        } else {
          this.showGenreTracks = false;
          this.showError(`No tracks found for "${categoryId}".`);
        }
      }

      if (!this.featuredPlaylists.length && !this.genreTracks.length) {
        this.showError(`No content found for "${categoryId}".`);
      }
    } catch (error) {
      console.error('Error loading category content:', error);
      this.showError('Failed to load content for this category.');
    } finally {
      loading.dismiss();
    }
  }

  /** Toggle like status for a track */
  async toggleLike(track: Track) {
    try {
      await this.audioService.toggleLike(track);
    } catch (error) {
      console.error('Error toggling like status:', error);
      this.showError('Failed to update like status');
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
      // Initialize storage service
      await this.storageService.ensureInit();

      // Load local tracks first
      await this.refreshLocalMusic();

      // Load streaming content
      try {
        const authOk = await firstValueFrom(
          this.musicService.authenticate()
        );

        if (authOk) {
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

          // Log the retrieved categories
          console.log('Categories loaded:', this.categories);

          // Combine streaming new releases with local tracks
          const spotifyReleases = newRel.albums.items.map((i: any) =>
            this.mapSpotifyAlbumToTrack(i)
          );

          // Put local tracks at the beginning of new releases
          this.newReleases = [
            ...this.localMusic,
            ...spotifyReleases
          ];

          this.featuredPlaylists = playlists;
          console.log('Featured playlists loaded:', this.featuredPlaylists);

          // Include local tracks in recommendations
          const spotifyRecommendations = newRel.albums.items
            .map((i: any) => this.mapSpotifyAlbumToTrack(i));

          this.recommendedTracks = [
            ...this.localMusic,
            ...spotifyRecommendations
          ];
        } else {
          // If Spotify auth fails, just use local tracks
          this.newReleases = [...this.localMusic];
          this.recommendedTracks = [...this.localMusic];
          console.warn('Spotify authentication failed, using only local tracks');
        }
      } catch (err) {
        console.error('Spotify API error:', err);
        // Fall back to local tracks only
        this.newReleases = [...this.localMusic];
        this.recommendedTracks = [...this.localMusic];
      }
    } catch (err) {
      console.error('Data load error', err);
      await this.showError('Failed loading initial data.');
    } finally {
      this.isLoading = false;
      loading.dismiss();
    }
  }

  /** Convert raw Spotify track to our Track model */
  private mapSpotifyTrack(item: any): Track {
    if (!item) return null as any;

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
      isLocal: false
    };
  }

  /** Convert Spotify album to track (for new releases) */
  private mapSpotifyAlbumToTrack(item: any): Track {
    if (!item) return null as any;

    return {
      id: item.id || `album-${Date.now()}`,
      title: item.name,
      artist: Array.isArray(item.artists)
        ? item.artists.map((a: any) => a.name).join(', ')
        : 'Unknown Artist',
      album: item.name || 'Unknown Album',
      duration: 0, // Albums don't have a duration
      imageUrl: item.images?.[0]?.url || 'assets/default-album-art.png',
      previewUrl: '', // Albums don't have preview URLs directly
      spotifyId: item.id || '',
      liked: false,
      isLocal: false
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
