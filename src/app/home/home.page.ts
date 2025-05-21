import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController, LoadingController, AlertController } from '@ionic/angular';
import { AudioService, Track } from '../services/audio.service';
import { StorageService } from '../services/storage.service';
import { MusicService } from '../services/music.service';
import { SettingsService } from '../services/settings.service';
import { firstValueFrom, of, Subscription } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: false
})
export class HomePage implements OnInit, OnDestroy {
  @ViewChild('searchInput', { read: ElementRef }) searchInput!: ElementRef;
  @ViewChild('fileInput', { static: false }) fileInput!: ElementRef<HTMLInputElement>;

  // local music
  localMusic: Track[] = [];
  currentLocal?: Track;
  localAudio = new Audio();
  localPlaying = false;
  localDuration = 0;
  localCurrentTime = 0;
  currentTrack: Track | null = null;
  isPlaying = false;
  currentTime = 0;
  //search
  searchActive = false;
  searchQuery = '';
  searchResults: Track[] = [];

  categories: any[] = [];
  newReleases: Track[] = [];
  featuredPlaylists: any[] = [];
  recommendedTracks: Track[] = [];
  selectedCategory = 'all';

  // Settings & loading
  isDarkMode = false;
  isLoading = false;
  private settingsSub?: Subscription;
  showGenreTracks: boolean | any;
  genreTracks: Track[] | any;

  //mini-player
  slideOffset = 0;
  touchStartY = 0;
  dismissThreshold = 80;
  hideMiniPlayer = false;

  constructor(
    public audioService: AudioService,
    private storageService: StorageService,
    private musicService: MusicService,
    private settingsService: SettingsService,
    private router: Router,
    private toastCtrl: ToastController,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController,
  ) {}

  async ngOnInit() {
    this.localAudio.addEventListener('loadedmetadata', () => {
      this.localDuration = this.localAudio.duration;
    });
    this.localAudio.addEventListener('timeupdate', () => {
      this.localCurrentTime = this.localAudio.currentTime;
    });
    this.localAudio.addEventListener('ended', () => {
      this.localPlaying = false;
    });

    this.settingsSub = this.settingsService.settings$.subscribe(s => {
      this.isDarkMode = s.darkMode;
      document.body.setAttribute('color-theme', s.darkMode ? 'dark' : 'light');
    });
    this.audioService.getIsPlaying().subscribe(p => this.isPlaying = p);
    await this.storageService.ensureInit();
    await this.refreshLocalMusic();
    await this.loadInitialData();
    this.hideMiniPlayer = false;
    this.slideOffset = 0;
  }

  ngOnDestroy() {
    this.localAudio.pause();
    this.localAudio.src = '';
    this.settingsSub?.unsubscribe();
  }

  openFileSelector() {
    this.fileInput.nativeElement.click();
  }

  async onFileSelected(evt: Event) {
    const input = evt.target as HTMLInputElement;
    if (!input.files?.length) return;

    await this.refreshLocalMusic();
    const files = Array.from(input.files);
    const existingFileNames = new Set();
    this.localMusic.forEach(track => {
      let filename = '';
      
      if (track.localPath) {
        const pathParts = track.localPath.split(/[\/\\]/);
        filename = pathParts[pathParts.length - 1];
      } else {
        // If no path, use title
        filename = track.title;
      }
      
      filename = filename.replace(/\.[^/.]+$/, '');
      const normalizedName = filename.toLowerCase().trim();
      existingFileNames.add(normalizedName);
    });

    const newFiles = [];
    const dupFiles = [];

    for (const file of files) {
      const fileName = file.name.replace(/\.[^/.]+$/, '').toLowerCase().trim();
      
      if (existingFileNames.has(fileName)) {
        dupFiles.push(file);
      } else {
        console.log(`New file: "${fileName}"`);
        newFiles.push(file);
        existingFileNames.add(fileName);
      }
    }

    if (dupFiles.length) {
      const dupToast = await this.toastCtrl.create({
        message: `Skipped ${dupFiles.length} duplicate file(s).`,
        duration: 2000,
        position: 'bottom',
        color: 'warning'
      });
      await dupToast.present();
    }

    if (!newFiles.length) {
      input.value = '';
      return;
    }

    const loading = await this.loadingCtrl.create({ message: 'Uploading music…' });
    await loading.present();

    try {
      for (const file of newFiles) {
        const track = await this.audioService.addLocalTrack(file);
        const okToast = await this.toastCtrl.create({
          message: `"${track.title}" uploaded successfully!`,
          duration: 1500,
          position: 'bottom',
          color: 'success'
        });
        await okToast.present();
      }
      
      await this.refreshLocalMusic();
    } catch (error) {
      console.error('Error uploading file:', error);
      const errToast = await this.toastCtrl.create({
        message: 'Error uploading some files.',
        duration: 2000,
        position: 'bottom',
        color: 'danger'
      });
      await errToast.present();
    } finally {
      input.value = '';
      loading.dismiss();
    }
  }

  private async loadInitialData() {
    const load = await this.loadingCtrl.create({ message: 'Loading music…' });
    await load.present();
    this.isLoading = true;

    try {
      await this.storageService.ensureInit();
      await this.refreshLocalMusic();
      const authOk = await firstValueFrom(this.musicService.authenticate());

      if (authOk) {
        const [cats, newRel, playlists] = await Promise.all([
          firstValueFrom(this.musicService.getGenres()),
          firstValueFrom(this.musicService.getNewReleases()),
          firstValueFrom(this.musicService.getPlaylistsByGenre(this.selectedCategory))
        ]);
        
        this.categories = cats.categories.items;
        this.featuredPlaylists = playlists;
        
        // Process new releases to get tracks with preview URLs
        const processedTracks: Track[] = [];
        
        // Take a few albums to avoid too many API calls
        const albumsToProcess = newRel.albums.items.slice(0, 5);
        
        for (const album of albumsToProcess) {
          try {
            // Get tracks with preview URLs for this album
            const tracksWithPreviews = await firstValueFrom(
              this.musicService.getAlbumWithPreviewUrl(album.id)
            );
            
            if (tracksWithPreviews && tracksWithPreviews.length > 0) {
              // Take a few tracks from each album
              processedTracks.push(...tracksWithPreviews.slice(0, 3));
            }
          } catch (error) {
            console.error(`Error processing album ${album.id}:`, error);
          }
        }
        
        // If we found tracks with previews, use them
        if (processedTracks.length > 0) {
          console.log(`Found ${processedTracks.length} tracks with preview URLs`);
          this.newReleases = processedTracks;
          this.recommendedTracks = [...processedTracks];
        } else {
          // Fallback to albums without preview URLs (will need to be fetched on play)
          this.newReleases = newRel.albums.items.map((a: any) => this.mapSpotifyAlbumToTrack(a));
          this.recommendedTracks = [...this.newReleases];
        }
      } else {
        this.newReleases = [];
        this.recommendedTracks = [];
        const toast = await this.toastCtrl.create({
          message: 'Could not load streaming content. Only local music is available.',
          duration: 3000,
          position: 'bottom',
          color: 'warning'
        });
        await toast.present();
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
      this.newReleases = [];
      this.recommendedTracks = [];
      const toast = await this.toastCtrl.create({
        message: 'Error loading streaming content. Only local music is available.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    } finally {
      this.isLoading = false;
      load.dismiss();
    }
  }

  private async refreshLocalMusic() {
    try {
      this.localMusic = await this.storageService.getLocalTracks();
      return this.localMusic;
    } catch (error) {
      console.error('Error refreshing local music:', error);
      throw error;
    }
  }

  async requestAudioPermissions() {
    if (Capacitor.isNativePlatform()) {
      try {
        await Filesystem.requestPermissions();
        return true;
      } catch (e) {
        console.error('Error requesting permissions:', e);
        return false;
      }
    }
    return true;
  }

  async playTrack(track: Track) {
    this.hideMiniPlayer = false;
    
    try {
      // For local tracks, play directly 
      if (track.isLocal) {
        this.audioService.play(track);
        this.router.navigate(['/now-playing']);
        return;
      }
      
      // For Spotify tracks, ensure preview URL exists
      if (!track.previewUrl || track.previewUrl === '') {
        const loading = await this.loadingCtrl.create({
          message: 'Loading track...',
          duration: 3000
        });
        await loading.present();
        
        try {
          // Try to fetch the track details with preview URL
          const fullTrack = await firstValueFrom(
            this.musicService.getTrackById(track.spotifyId)
          );
          
          if (fullTrack && fullTrack.preview_url) {
            track.previewUrl = fullTrack.preview_url;
            track.duration = fullTrack.duration_ms / 1000;
            loading.dismiss();
            this.audioService.play(track);
            this.router.navigate(['/now-playing']);
          } else {
            loading.dismiss();
            const toast = await this.toastCtrl.create({
              message: `No preview available for "${track.title}"`,
              duration: 2000,
              position: 'bottom',
              color: 'warning'
            });
            await toast.present();
          }
        } catch (error) {
          console.error('Error fetching track preview:', error);
          loading.dismiss();
          const toast = await this.toastCtrl.create({
            message: 'Unable to play this track',
            duration: 2000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      } else {
        // Preview URL exists, play normally
        this.audioService.play(track);
        this.router.navigate(['/now-playing']);
      }
    } catch (error) {
      console.error('Error playing track:', error);
      const toast = await this.toastCtrl.create({
        message: 'Error playing track',
        duration: 2000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }

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

  async selectCategory(categoryId: string) {
    console.log('Selecting category:', categoryId);
    this.selectedCategory = categoryId;
    const loading = await this.loadingCtrl.create({
      message: 'Loading music...',
    });
    await loading.present();

    try {
      this.featuredPlaylists = await firstValueFrom(
        this.musicService.getPlaylistsByGenre(categoryId)
      );

      if (categoryId === 'all') {
        this.showGenreTracks = false;
      } else {
        const tracks = await firstValueFrom(
          this.musicService.getTracksByGenre(categoryId)
        );

        if (tracks && tracks.length > 0) {
          this.genreTracks = tracks;
          this.showGenreTracks = true;
          console.log(`Loaded ${tracks.length} tracks for genre ${categoryId}`);
        } else {
          this.showGenreTracks = false;
          this.showError(`No tracks found for "${categoryId}"`);
        }
      }

      if (!this.featuredPlaylists.length && !this.genreTracks?.length) {
        this.showError(`No content found for "${categoryId}".`);
      }
    } catch (error) {
      console.error('Error loading category content:', error);
      this.showError('Failed to load content for this category.');
    } finally {
      loading.dismiss();
    }
  }

  toggleSearch() {
    this.searchActive = !this.searchActive;
    if (this.searchActive) {
      setTimeout(() => this.searchInput.nativeElement.focus(), 200);
    } else {
      this.searchQuery = '';
      this.searchResults = [];
    }
  }

  async toggleTrack(currentTrack: Track): Promise<void> {
    try {
      this.audioService.cleanup();
      const current = await firstValueFrom(this.audioService.getCurrentTrack());
      const playing = await firstValueFrom(this.audioService.getIsPlaying());
      if (current?.id === currentTrack.id && playing) {
        await this.audioService.pause();
      } else {
        await this.audioService.play(currentTrack);
      }
    } catch (err) {
      console.error('Error toggling track playback:', err);
    }
  }
    
  clearSearch() {
    this.searchQuery = '';
    this.searchResults = [];
  }
  
  onSearchFocus() { }
  onSearchBlur() { }
  
  onSearch() {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) {
      this.searchResults = [];
      return;
    }
    
    // Search local music first
    const local = this.localMusic.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q)
    );
    
    if (local.length) {
      this.searchResults = local;
    } else {
      // Search Spotify
      this.musicService.searchTracks(q, 20)
        .pipe(
          map(r => {
            // Only include tracks with preview URLs
            return r.tracks.items
              .filter((track: any) => track.preview_url)
              .map((track: any) => this.mapSpotifyTrack(track));
          }),
          catchError(() => of<Track[]>([]))
        )
        .subscribe(res => {
          this.searchResults = res;
          console.log('Search results with preview URLs:', this.searchResults.length);
        });
    }
  }

  private mapSpotifyTrack(i: any): Track {
    return {
      id: i.id,
      title: i.name,
      artist: i.artists.map((a: any) => a.name).join(', '),
      album: i.album.name,
      duration: i.duration_ms / 1000,
      imageUrl: i.album.images[0]?.url,
      previewUrl: i.preview_url || '',
      spotifyId: i.id,
      liked: false,
      isLocal: false
    };
  }

  private mapSpotifyAlbumToTrack(a: any): Track {
    return {
      id: a.id,
      title: a.name,
      artist: a.artists.map((x: any) => x.name).join(', '),
      album: a.name,
      duration: 0,
      imageUrl: a.images[0]?.url,
      previewUrl: '', // We'll fetch this separately when needed
      spotifyId: a.id,
      liked: false,
      isLocal: false
    };
  }

  private async showError(msg: string) {
    const alert = await this.alertCtrl.create({
      header: 'Error',
      message: msg,
      buttons: ['OK']
    });
    await alert.present();
  }

  async doRefresh(event: any) {
    console.log('Begin refresh operation');

    try {
      await this.refreshLocalMusic();
      try {
        const authOk = await firstValueFrom(this.musicService.authenticate());

        if (authOk) {
          const [newRel, playlists] = await Promise.all([
            firstValueFrom(this.musicService.getNewReleases()),
            firstValueFrom(this.musicService.getPlaylistsByGenre(this.selectedCategory))
          ]);

          // Process albums to get tracks with preview URLs
          const processedTracks: Track[] = [];
          const albumsToProcess = newRel.albums.items.slice(0, 3);
          
          for (const album of albumsToProcess) {
            try {
              const tracksWithPreviews = await firstValueFrom(
                this.musicService.getAlbumWithPreviewUrl(album.id)
              );
              
              if (tracksWithPreviews && tracksWithPreviews.length > 0) {
                processedTracks.push(...tracksWithPreviews.slice(0, 3));
              }
            } catch (error) {
              console.error(`Error processing album ${album.id}:`, error);
            }
          }
          
          // If we found tracks with previews, use them
          if (processedTracks.length > 0) {
            this.newReleases = processedTracks;
            this.recommendedTracks = [...processedTracks];
          } else {
            this.newReleases = newRel.albums.items.map((a: any) => this.mapSpotifyAlbumToTrack(a));
            this.recommendedTracks = [...this.newReleases];
          }
          
          this.featuredPlaylists = playlists;
        }
      } catch (streamingError) {
        console.error('Error refreshing streaming content:', streamingError);
      }

      const toast = await this.toastCtrl.create({
        message: 'Music library refreshed!',
        duration: 2000,
        position: 'bottom',
        color: 'success'
      });
      toast.present();

      console.log('Refresh completed successfully');
    } catch (error) {
      console.error('Error during refresh:', error);

      const toast = await this.toastCtrl.create({
        message: 'Could not refresh content. Please try again.',
        duration: 2000,
        position: 'bottom',
        color: 'danger'
      });
      toast.present();
    } finally {
      event.target.complete();
    }
  }

  onTouchStart(event: TouchEvent) {
    this.touchStartY = event.touches[0].clientY;
    event.stopPropagation();
  }

  onTouchMove(event: TouchEvent) {
    const touchY = event.touches[0].clientY;
    const deltaY = touchY - this.touchStartY;

    if (deltaY >= 0) {
      this.slideOffset = deltaY;
    } else {
      this.slideOffset = 0;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  async onTouchEnd(event: TouchEvent) {
    if (this.slideOffset > this.dismissThreshold) {
      const miniPlayer = event.currentTarget as HTMLElement;
      miniPlayer.classList.add('closing');

      try {
        await this.audioService.pauseAndReset();
        const toast = await this.toastCtrl.create({
          message: 'Playback stopped',
          duration: 1500,
          position: 'bottom',
          color: 'medium'
        });
        await toast.present();

        setTimeout(() => {
          this.hideMiniPlayer = true;
        }, 300);

        console.log('Playback stopped, mini player hidden until next track');
      } catch (error) {
        console.error('Error stopping playback:', error);
      }
    } else {
      this.slideOffset = 0;
    }
    event.stopPropagation();
  }
}