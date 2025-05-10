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
  getUserPlaylists() {
    throw new Error('Method not implemented.');
  }
  getSavedTracks() {
    throw new Error('Method not implemented.');
  }
  private authToken: string | null = null;

  constructor(
    private http: HttpClient,
    private storageService: StorageService
  ) {
    this.loadToken();
  }

  private async loadToken() {
    this.authToken = await this.storageService.get('spotify_token');
  }

  private saveToken(token: string) {
    this.authToken = token;
    this.storageService.set('spotify_token', token);
  }

  authenticate(): Observable<boolean> {
    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${environment.spotify.clientId}:${environment.spotify.clientSecret}`)
    });

    return this.http.post<any>(environment.spotify.tokenEndpoint, body.toString(), { headers }).pipe(
      map(response => {
        this.saveToken(response.access_token);
        return true;
      }),
      catchError(() => of(false))
    );
  }

  private getHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Authorization': `Bearer ${this.authToken}`
    });
  }

  private ensureAuthenticated(): Observable<boolean> {
    if (this.authToken) {
      return of(true);
    } else {
      return this.authenticate();
    }
  }

  getNewReleases(): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/browse/new-releases`, { headers: this.getHeaders() })
      )
    );
  }

  getGenres(): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/browse/categories`, { headers: this.getHeaders() })
      )
    );
  }

  getPlaylistsByGenre(genreId: string): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/browse/categories/${genreId}/playlists`, { headers: this.getHeaders() })
      )
    );
  }

  getPlaylistTracks(playlistId: string): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/playlists/${playlistId}/tracks`, { headers: this.getHeaders() })
      )
    );
  }

  searchTracks(query: string): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/search?q=${encodeURIComponent(query)}&type=track`, { headers: this.getHeaders() })
      )
    );
  }

  getTrackById(trackId: string): Observable<any> {
    return this.ensureAuthenticated().pipe(
      switchMap(() =>
        this.http.get(`${environment.spotify.apiEndpoint}/tracks/${trackId}`, { headers: this.getHeaders() })
      )
    );
  }
}
