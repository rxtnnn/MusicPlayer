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
        
        // First map albums
        const albumTracks = newRel.albums.items.map((a: any) => this.mapSpotifyAlbumToTrack(a));
        
        // Then fetch preview URLs for a few albums (limiting to avoid too many requests)
        const albumsToFetch = newRel.albums.items.slice(0, 5);
        
        // Fetch tracks for these albums
        for (const album of albumsToFetch) {
          try {
            const albumTracks = await firstValueFrom(this.musicService.getAlbumTracks(album.id));
            
            // For each album track, get the full details including preview URL
            if (albumTracks && albumTracks.items && albumTracks.items.length > 0) {
              // Just get the first track with a preview URL
              for (const track of albumTracks.items) {
                const fullTrack = await firstValueFrom(this.musicService.getFullTrackDetails(track.id));
                if (fullTrack && fullTrack.preview_url) {
                  // Update the album entry with this track's preview URL
                  const albumTrack = this.newReleases.find(t => t.spotifyId === album.id);
                  if (albumTrack) {
                    albumTrack.previewUrl = fullTrack.preview_url;
                    break; // Found one track with preview URL, move to next album
                  }
                }
              }
            }
          } catch (error) {
            console.error(`Error fetching tracks for album ${album.id}:`, error);
          }
        }
        
        this.newReleases = albumTracks;
        this.featuredPlaylists = playlists;
        this.recommendedTracks = [...albumTracks]; // Use the same tracks with preview URLs
      } else {
        // Your existing code for auth failure
      }
    } catch (error) {
      // Your existing error handling
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

 playTrack(track: Track) {
  this.hideMiniPlayer = false;
    if (track.isLocal) {
      this.audioService.play(track);
    } else {
      this.audioService.play(track);
    }
    this.router.navigate(['/now-playing']);
  }

  playPlaylist(playlistId: string) {
    this.musicService
      .getPlaylistTracks(playlistId)
      .pipe(
        map((items: any[]) =>
          items
            .map((i) => i.track)
            .filter((t) => t && t.preview_url)
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
          console.log('Loaded ${tracks.length} tracks for genre ${categoryId}');
        } else {
          this.showGenreTracks = false;
          this.showError('No tracks found for "${categoryId}"');
        }
      }

      if (!this.featuredPlaylists.length && !this.genreTracks.length) {
        this.showError('No content found for "${categoryId}".');
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
        const current  = await firstValueFrom(this.audioService.getCurrentTrack());
        const playing  = await firstValueFrom(this.audioService.getIsPlaying());
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
    const local = this.localMusic.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q)
    );
    if (local.length) {
      this.searchResults = local;
    } else {
      this.musicService.searchTracks(q, 20)
        .pipe(
          map(r => r.tracks.items.map((i: any) => this.mapSpotifyTrack(i))),
          catchError(() => of<Track[]>([]))
        )
        .subscribe(res => (this.searchResults = res));
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
      previewUrl: i.preview_url,
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
      previewUrl: '',
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

          this.newReleases = newRel.albums.items.map((a: any) => this.mapSpotifyAlbumToTrack(a));
          this.featuredPlaylists = playlists;
          this.recommendedTracks = newRel.albums.items.map((a: any) => this.mapSpotifyAlbumToTrack(a));
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
