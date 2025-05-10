import { Injectable } from '@angular/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Platform } from '@ionic/angular';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private sqliteConnection: SQLiteConnection;
  private isReady = false;
  private database: SQLiteDBConnection | any;
  private db: SQLiteDBConnection | any;

  constructor(private platform: Platform) {
    this.sqliteConnection = new SQLiteConnection(CapacitorSQLite);
  }

  async init() {
    await this.platform.ready();
    if (this.platform.is('android')) {
      const jeepEl = document.querySelector('jeep-sqlite');
      if (jeepEl) {
        await customElements.whenDefined('jeep-sqlite');
        await this.sqliteConnection.initWebStore();
      }
    }
    await this.createDatabase();
  }

  private async createDatabase(): Promise<void> {
  try {
    const dbName = 'harmony.db';
    const isConn = (await this.sqliteConnection.isConnection(dbName, false)).result;

    if (!isConn) {
      this.db = await this.sqliteConnection.createConnection(dbName, false, 'no-encryption', 1, false);
      await this.db.open();
    } else {
      this.db = await this.sqliteConnection.retrieveConnection(dbName, false);
      if (!this.db.isDBOpen()) {
        await this.db.open();
      }
    }

      await this.createTables();
      this.isReady = true;
    } catch (error) {
      console.error('Error initializing database', error);
    }
  }


  private async createTables() {
    const statements = `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        title TEXT,
        artist TEXT,
        album TEXT,
        duration INTEGER,
        image_url TEXT,
        preview_url TEXT,
        spotify_id TEXT,
        liked INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id INTEGER,
        track_id TEXT,
        position INTEGER,
        PRIMARY KEY (playlist_id, track_id),
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );
    `;
    const res = await this.db.execute(statements);
    if ((res.changes?.changes ?? 0) < 0) {
      throw new Error('Failed to create tables');
    }

  }

  // Generic data access methods
  async get(key: string): Promise<any> {
    if (!this.isReady) {
      await this.init();
    }

    try {
      const result = await this.database.executeSql(
        'SELECT value FROM settings WHERE key = ?',
        [key]
      );

      if (result.rows.length > 0) {
        const value = result.rows.item(0).value;
        try {
          return JSON.parse(value);
        } catch (e) {
          return value;
        }
      }
      return null;
    } catch (error) {
      console.error(`Error retrieving ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: any): Promise<boolean> {
    if (!this.isReady) {
      await this.init();
    }

    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

    try {
      await this.database.executeSql(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        [key, stringValue]
      );
      return true;
    } catch (error) {
      console.error(`Error setting ${key}:`, error);
      return false;
    }
  }

  // Playlist methods
  async createPlaylist(name: string): Promise<number> {
    if (!this.isReady) {
      await this.init();
    }

    try {
      const now = new Date().toISOString();
      const result = await this.database.executeSql(
        'INSERT INTO playlists (name, created_at) VALUES (?, ?)',
        [name, now]
      );
      return result.insertId;
    } catch (error) {
      console.error('Error creating playlist:', error);
      return -1;
    }
  }

  async getPlaylists(): Promise<any[]> {
    if (!this.isReady) {
      await this.init();
    }

    try {
      const result = await this.database.executeSql(
        'SELECT * FROM playlists ORDER BY created_at DESC',
        []
      );

      const playlists = [];
      for (let i = 0; i < result.rows.length; i++) {
        playlists.push(result.rows.item(i));
      }
      return playlists;
    } catch (error) {
      console.error('Error fetching playlists:', error);
      return [];
    }
  }

  // Track methods
  async saveTrack(track: any): Promise<boolean> {
    if (!this.isReady) {
      await this.init();
    }

    try {
      await this.database.executeSql(
        `INSERT OR REPLACE INTO tracks
         (id, title, artist, album, duration, image_url, preview_url, spotify_id, liked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          track.id,
          track.title,
          track.artist,
          track.album,
          track.duration,
          track.imageUrl,
          track.previewUrl,
          track.spotifyId,
          track.liked ? 1 : 0
        ]
      );
      return true;
    } catch (error) {
      console.error('Error saving track:', error);
      return false;
    }
  }

  async getLikedTracks(): Promise<any[]> {
    if (!this.isReady) {
      await this.init();
    }

    try {
      const result = await this.database.executeSql(
        'SELECT * FROM tracks WHERE liked = 1',
        []
      );

      const tracks = [];
      for (let i = 0; i < result.rows.length; i++) {
        const track = result.rows.item(i);
        track.liked = !!track.liked;
        tracks.push(track);
      }
      return tracks;
    } catch (error) {
      console.error('Error fetching liked tracks:', error);
      return [];
    }
  }

  async toggleLikedTrack(trackId: string, liked: boolean): Promise<boolean> {
    if (!this.isReady) {
      await this.init();
    }

    try {
      await this.database.executeSql(
        'UPDATE tracks SET liked = ? WHERE id = ?',
        [liked ? 1 : 0, trackId]
      );
      return true;
    } catch (error) {
      console.error('Error toggling track like status:', error);
      return false;
    }
  }

  // Playlist track methods
  async addTrackToPlaylist(playlistId: number, trackId: string, position: number): Promise<boolean> {
    if (!this.isReady) {
      await this.init();
    }

    try {
      await this.database.executeSql(
        'INSERT OR REPLACE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
        [playlistId, trackId, position]
      );
      return true;
    } catch (error) {
      console.error('Error adding track to playlist:', error);
      return false;
    }
  }

  async getPlaylistTracks(playlistId: number): Promise<any[]> {
    if (!this.isReady) {
      await this.init();
    }

    try {
      const result = await this.database.executeSql(
        `SELECT t.* FROM tracks t
         JOIN playlist_tracks pt ON t.id = pt.track_id
         WHERE pt.playlist_id = ?
         ORDER BY pt.position`,
        [playlistId]
      );

      const tracks = [];
      for (let i = 0; i < result.rows.length; i++) {
        const track = result.rows.item(i);
        track.liked = !!track.liked;
        tracks.push(track);
      }
      return tracks;
    } catch (error) {
      console.error('Error fetching playlist tracks:', error);
      return [];
    }
  }
}
