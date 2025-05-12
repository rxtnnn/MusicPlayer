import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of, from } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { StorageService } from './storage.service';

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

  /**
   * Load the stored token and expiration time
   */
  private async loadToken() {
    this.authToken = await this.storageService.get('spotify_token');
    this.tokenExpiration = await this.storageService.get('spotify_token_expiration') || 0;
  }

  /**
   * Save the token and expiration time
   */
  private saveToken(token: string, expiresIn: number) {
    const expiration = Date.now() + expiresIn * 1000;
    this.authToken = token;
    this.tokenExpiration = expiration;

    this.storageService.set('spotify_token', token);
    this.storageService.set('spotify_token_expiration', expiration);
  }

  /**
   * Check if the current token is valid
   */
  private isTokenValid(): boolean {
    return this.authToken !== null && Date.now() < this.tokenExpiration;
  }

  /**
   * Authenticate with Spotify and store the token
   */
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

  /**
   * Get the authentication headers
   */
  private getHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Authorization': `Bearer ${this.authToken}`
    });
  }

  /**
   * Ensure that the user is authenticated before making a request
   */
  private ensureAuthenticated(): Observable<boolean> {
    if (this.isTokenValid()) {
      console.log('Token is valid');
      return of(true);
    } else {
      console.log('Token is invalid or expired, authenticating...');
      return this.authenticate();
    }
  }

  /**
   * Get new releases from Spotify
   */
  getNewReleases(country: string = 'US', limit: number = 20): Observable<any> {
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

  /**
   * Get available genres from Spotify
   */
  getGenres(country: string = 'US', limit: number = 50): Observable<any> {
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

  getPlaylistsByGenre(
    categoryId: string,
    country: string = 'PH',    // ← default to PH
    limit: number = 20
  ): Observable<any[]> {
    const endpoint = environment.spotify.apiEndpoint;

    // featured playlists still scoped to a country
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

    // for specific categories, drop the country param
    const url = `${endpoint}/browse/categories/${categoryId}/playlists`;
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get<any>(url, { headers: this.getHeaders() })
      ),
      // Spotify may return { playlists: { items: […] } } OR { items: […] }
      map(resp => {
        if (resp.playlists?.items)       return resp.playlists.items;
        else if (Array.isArray(resp.items)) return resp.items;
        else                               return [];
      }),
      catchError(() => of([]))
    );
    }



  /**
   * Get tracks from a specific playlist
   */
  getPlaylistTracks(playlistId: string): Observable<any> {
    console.log(`Fetching tracks for playlist: ${playlistId}`);

    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/playlists/${playlistId}/tracks`, {
          headers: this.getHeaders()
        })
      ),
      tap(data => console.log('Playlist tracks received:', data)),
      map((response: any) => {
        // Filter tracks without a preview URL
        const filteredTracks = response.items.filter((item: any) =>
          item.track && item.track.preview_url);
        console.log(`Filtered ${response.items.length} to ${filteredTracks.length} tracks with preview URLs`);
        return filteredTracks;
      }),
      catchError((error) => {
        console.error('Error fetching playlist tracks:', error);
        return of([]);
      })
    );
  }

  /**
   * Search tracks by a query string
   */
  searchTracks(query: string, limit: number = 20): Observable<any> {
    const params = new HttpParams()
      .set('q', query)
      .set('type', 'track')
      .set('limit', limit.toString());

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

  /**
   * Get track details by track ID
   */
  getTrackById(trackId: string): Observable<any> {
    console.log(`Fetching track by ID: ${trackId}`);

    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/tracks/${trackId}`, {
          headers: this.getHeaders()
        })
      ),
      tap(data => console.log('Track details received:', data)),
      catchError((error) => {
        console.error('Error fetching track details:', error);
        return of(null);
      })
    );
  }
}
