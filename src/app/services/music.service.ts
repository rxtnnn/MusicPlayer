import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of, from, forkJoin } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { StorageService } from './storage.service';
import { Track } from './audio.service';

@Injectable({
  providedIn: 'root'
})
export class MusicService {
  private authToken: string | null = null;
  private tokenExpiration: number = 0;

  constructor(
    private http: HttpClient,
    private storageService: StorageService
  ) {
    this.loadToken();
  }

  private loadToken(): Promise<void> {
    return Promise.all([
      this.storageService.get('spotify_token'),
      this.storageService.get('spotify_token_expiration')
    ]).then(([token, expiration]) => {
      this.authToken = token;
      this.tokenExpiration = expiration || 0;
    });
  }

  private saveToken(token: string, expiresIn: number) {
    const expiration = Date.now() + expiresIn * 1000;
    this.authToken = token;
    this.tokenExpiration = expiration;

    this.storageService.set('spotify_token', token);
    this.storageService.set('spotify_token_expiration', expiration);
  }

  private isTokenValid(): boolean {
    return this.authToken !== null && Date.now() < this.tokenExpiration;
  }

  authenticate(): Observable<boolean> {
    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${environment.spotify.clientId}:${environment.spotify.clientSecret}`)
    });

    return this.http.post<any>(environment.spotify.tokenEndpoint, body.toString(), {
      headers
    }).pipe(
      tap(response => console.log('Auth response received')),
      map(response => {
        this.saveToken(response.access_token, response.expires_in);
        console.log('Token saved successfully');
        return true;
      }),
      catchError((error) => {
        console.error('Authentication error:', error);
        return of(false);
      })
    );
  }

  getHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Authorization': `Bearer ${this.authToken}`
    });
  }

  private ensureAuthenticated(): Observable<boolean> {
    return from(this.loadToken()).pipe(
      switchMap(() => {
        if (this.isTokenValid()) {
          return of(true);
        } else {
          return this.authenticate();
        }
      })
    );
  }

  getNewReleases(country: string = 'PH', limit: number = 20): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() => {
        const params = new HttpParams()
          .set('country', country)
          .set('limit', limit.toString());

        console.log('Fetching new releases');
        return this.http.get(`${environment.spotify.apiEndpoint}/browse/new-releases`, {
          headers: this.getHeaders(),
          params
        });
      }),
      tap(data => console.log('New releases received:', data)),
      catchError((error) => {
        console.error('Error fetching new releases:', error);
        return of({ albums: { items: [] } });
      })
    );
  }

  getGenres(country: string = 'PH', limit: number = 50): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() => {
        const params = new HttpParams()
          .set('country', country)
          .set('limit', limit.toString());

        console.log('Fetching genre categories');
        return this.http.get(`${environment.spotify.apiEndpoint}/browse/categories`, {
          headers: this.getHeaders(),
          params
        });
      }),
      tap(data => console.log('Genres received:', data)),
      catchError((error) => {
        console.error('Error fetching genres:', error);
        return of({ categories: { items: [] } });
      })
    );
  }

  getPlaylistsByGenre(categoryId: string, country: string = 'PH', limit: number = 20): Observable<any[]> {
    const endpoint = environment.spotify.apiEndpoint;

    if (categoryId === 'all') {
      const params = new HttpParams()
        .set('country', country)
        .set('limit', limit.toString());

      return this.ensureAuthenticated().pipe(
        switchMap(() =>
          this.http.get<any>(
            `${endpoint}/browse/featured-playlists`,
            { headers: this.getHeaders(), params }
          )
        ),
        map(resp => resp.playlists?.items || []),
        catchError(() => of([]))
      );
    }

    const url = `${endpoint}/browse/categories/${categoryId}/playlists`;
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get<any>(url, { 
          headers: this.getHeaders(),
          params: new HttpParams().set('country', country).set('limit', limit.toString())
        })
      ),
      map(resp => {
        if (resp.playlists?.items) return resp.playlists.items;
        else if (Array.isArray(resp.items)) return resp.items;
        else return [];
      }),
      catchError(() => of([]))
    );
  }

  getPlaylistTracks(playlistId: string): Observable<any> {
    console.log(`Fetching tracks for playlist: ${playlistId}`);

    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/playlists/${playlistId}/tracks`, {
          headers: this.getHeaders(),
          params: new HttpParams().set('market', 'PH')
        })
      ),
      tap(data => console.log('Playlist tracks received:', data)),
      map((response: any) => {
        return response.items;
      }),
      catchError((error) => {
        console.error('Error fetching playlist tracks:', error);
        return of([]);
      })
    );
  }

  getTracksByGenre(genreId: string, limit: number = 50): Observable<Track[]> {
    return this.getPlaylistsByGenre(genreId).pipe(
      switchMap(playlists => {
        if (playlists.length === 0) {
          return of([]);
        }
        const selectedPlaylists = playlists.slice(0, 3);
        const playlistObservables = selectedPlaylists.map(playlist =>
          this.getPlaylistTracks(playlist.id)
        );

        return forkJoin(playlistObservables).pipe(
          map((playlistTracksArrays: any[][]) => {
            const allTracks = ([] as any[]).concat(...playlistTracksArrays); // flatten
            return allTracks
              .filter((item: any) => item.track?.preview_url) // Only include tracks with preview URLs
              .map((item: any) => this.mapSpotifyTrackToModel(item.track))
              .slice(0, limit);
          })
        );
      }),
      catchError(error => {
        console.error('Error fetching tracks by genre:', error);
        return of([]);
      })
    );
  }

  searchTracks(query: string, limit: number = 20): Observable<any> {
    const params = new HttpParams()
      .set('q', query)
      .set('type', 'track')
      .set('limit', limit.toString())
      .set('market', 'PH');  // Add market parameter to improve preview URL availability

    console.log(`Searching tracks with query: "${query}"`);

    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/search`, {
          headers: this.getHeaders(),
          params
        })
      ),
      tap(data => console.log('Search results received:', data)),
      catchError((error) => {
        console.error('Error searching tracks:', error);
        return of({ tracks: { items: [] } });
      })
    );
  }

  getTrackById(trackId: string): Observable<any> {
    console.log(`Fetching track by ID: ${trackId}`);

    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/tracks/${trackId}`, {
          headers: this.getHeaders(),
          params: new HttpParams().set('market', 'PH')  // Add market parameter
        })
      ),
      tap(data => console.log('Track details received:', data)),
      catchError((error) => {
        console.error('Error fetching track details:', error);
        return of(null);
      })
    );
  }

  // New method to get album tracks with preview URLs
  getAlbumTracks(albumId: string): Observable<any> {
    console.log(`Fetching tracks for album: ${albumId}`);

    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/albums/${albumId}/tracks`, {
          headers: this.getHeaders(),
          params: new HttpParams().set('limit', '50').set('market', 'PH')
        })
      ),
      tap(data => console.log('Album tracks received:', data)),
      catchError((error) => {
        console.error('Error fetching album tracks:', error);
        return of({ items: [] });
      })
    );
  }

  // New method to get tracks with preview URLs for an album
  getAlbumWithPreviewUrl(albumId: string): Observable<Track[]> {
    return this.ensureAuthenticated().pipe(
      switchMap(() => 
        this.http.get(`${environment.spotify.apiEndpoint}/albums/${albumId}`, {
          headers: this.getHeaders(),
          params: new HttpParams().set('market', 'PH')
        })
      ),
      switchMap((album: any) => {
        if (!album || !album.tracks || !album.tracks.items || album.tracks.items.length === 0) {
          return of([]);
        }
        
        // Get track IDs from album (limit to avoid large requests)
        const trackIds = album.tracks.items
          .slice(0, 10)
          .map((t: any) => t.id)
          .join(',');
        
        return this.http.get(
          `${environment.spotify.apiEndpoint}/tracks`, {
            headers: this.getHeaders(),
            params: new HttpParams()
              .set('ids', trackIds)
              .set('market', 'PH')
          }
        ).pipe(
          map((response: any) => {
            if (!response || !response.tracks) return [];
                
            return response.tracks
              .filter((t: any) => t.preview_url)
              .map((t: any) => {
                const track = this.mapSpotifyTrackToModel(t);
                track.imageUrl = album.images?.[0]?.url || track.imageUrl;
                return track;
              });
          })
        );
      }),
      catchError(error => {
        console.error(`Error getting album tracks with previews for ${albumId}:`, error);
        return of([]);
      })
    );
  }

  mapSpotifyTrackToModel(item: any): Track {
    return {
      id: item.id || `track-${Date.now()}`,
      title: item.name,
      artist: Array.isArray(item.artists)
        ? item.artists.map((a: any) => a.name).join(', ')
        : 'Unknown Artist',
      album: item.album?.name || 'Unknown Album',
      duration: (item.duration_ms ?? item.duration) / 1000,
      imageUrl:
        item.album?.images?.[0]?.url ||
        'assets/default-album-art.png',
      previewUrl: item.preview_url || '',
      spotifyId: item.id || '',
      liked: false,
      isLocal: false
    };
  }
}