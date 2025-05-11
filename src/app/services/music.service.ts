import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, from } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
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

    return this.http.post<any>(environment.spotify.tokenEndpoint, body.toString(), { headers }).pipe(
      map(response => {
        this.saveToken(response.access_token, response.expires_in);
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
      return of(true);
    } else {
      return this.authenticate();
    }
  }

  /**
   * Get new releases from Spotify
   */
  getNewReleases(): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/browse/new-releases`, { headers: this.getHeaders() })
      ),
      catchError((error) => {
        console.error('Error fetching new releases:', error);
        return of([]);
      })
    );
  }

  /**
   * Get available genres from Spotify
   */
  getGenres(): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/browse/categories`, { headers: this.getHeaders() })
      ),
      catchError((error) => {
        console.error('Error fetching genres:', error);
        return of([]);
      })
    );
  }

  /**
   * Get playlists based on genre
   */
  getPlaylistsByGenre(genreId: string): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/browse/categories/${genreId}/playlists`, { headers: this.getHeaders() })
      ),
      catchError((error) => {
        console.error('Error fetching playlists by genre:', error);
        return of([]);
      })
    );
  }

  /**
   * Get tracks from a specific playlist
   */
  getPlaylistTracks(playlistId: string): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/playlists/${playlistId}/tracks`, { headers: this.getHeaders() })
      ),
      map((response: any) => {
        // Filter tracks without a preview URL
        return response.items.filter((item: any) => item.track.preview_url);
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
  searchTracks(query: string): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/search?q=${encodeURIComponent(query)}&type=track`, { headers: this.getHeaders() })
      ),
      catchError((error) => {
        console.error('Error searching tracks:', error);
        return of([]);
      })
    );
  }

  /**
   * Get track details by track ID
   */
  getTrackById(trackId: string): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/tracks/${trackId}`, { headers: this.getHeaders() })
      ),
      catchError((error) => {
        console.error('Error fetching track details:', error);
        return of(null);
      })
    );
  }
}
