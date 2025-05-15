// src/app/services/storage.service.ts

import { Injectable } from '@angular/core';
import { Platform }   from '@ionic/angular';
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection
} from '@capacitor-community/sqlite';
import { Track }      from './audio.service';

@Injectable({ providedIn: 'root' })
export class StorageService {
  private sqlite: SQLiteConnection;
  private db!: SQLiteDBConnection;
  private _initPromise: Promise<void> | null = null;

  constructor(private platform: Platform) {
    this.sqlite = new SQLiteConnection(CapacitorSQLite);
  }

  async ensureInit(): Promise<void> {
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      await this.platform.ready();
      if (!this.platform.is('hybrid')) {
        // Web fallback storage
        await this.sqlite.initWebStore();
      }
      // clean up any leftover connections
      await this.sqlite.checkConnectionsConsistency();

      // (re)create connection
      this.db = await this.sqlite.createConnection(
        'harmony.db', false, 'no-encryption', 1, false
      );
      await this.db.open();

      // create all tables in one transaction
      const sql = `
        CREATE TABLE IF NOT EXISTS playlists (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          name         TEXT NOT NULL,
          created_at   TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TRIGGER IF NOT EXISTS trg_playlists_updated
          AFTER UPDATE OF name ON playlists
        BEGIN
          UPDATE playlists SET updated_at = datetime('now') WHERE id = NEW.id;
        END;
        CREATE TABLE IF NOT EXISTS playlist_tracks (
          playlist_id INTEGER NOT NULL,
          track_id    TEXT NOT NULL,
          position    INTEGER,
          PRIMARY KEY (playlist_id, track_id)
        );
        CREATE TABLE IF NOT EXISTS tracks (
          id           TEXT PRIMARY KEY,
          title        TEXT,
          artist       TEXT,
          album        TEXT,
          duration     INTEGER,
          image_url    TEXT,
          preview_url  TEXT,
          spotify_id   TEXT,
          liked        INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS liked_music (
          track_id     TEXT PRIMARY KEY,
          liked_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS downloaded_music (
          track_id     TEXT PRIMARY KEY,
          file_uri     TEXT,
          downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `;
      await this.db.execute(sql);
    })();

    return this._initPromise;
  }

  // ---------- Playlist CRUD ----------

  /** Returns new row ID or -1 */
  async createPlaylist(name: string): Promise<number> {
    await this.ensureInit();
    const now = new Date().toISOString();
    const res = await this.db.run(
      `INSERT INTO playlists (name, created_at, updated_at)
       VALUES (?, ?, ?);`,
      [name, now, now]
    );
    return res.changes?.lastId ?? -1;
  }

  async getPlaylists(): Promise<{id:number;name:string;created_at:string;updated_at:string}[]> {
    await this.ensureInit();
    const res = await this.db.query(`
      SELECT id, name, created_at, updated_at
        FROM playlists
       ORDER BY created_at DESC;
    `);
    return res.values || [];
  }

  // ---------- Playlist ↔ Track ----------

  async addTrackToPlaylist(
    playlistId: number,
    trackId: string,
    position?: number
  ): Promise<boolean> {
    await this.ensureInit();
    if (position === undefined) {
      const r = await this.db.query(
        `SELECT MAX(position) AS max_pos FROM playlist_tracks WHERE playlist_id = ?;`,
        [playlistId]
      );
      position = (r.values?.[0]?.max_pos ?? -1) + 1;
    }
    await this.db.run(
      `INSERT OR REPLACE INTO playlist_tracks
         (playlist_id, track_id, position)
       VALUES (?, ?, ?);`,
      [playlistId, trackId, position]
    );
    return true;
  }

  async getPlaylistTracks(playlistId: number): Promise<Track[]> {
    await this.ensureInit();
    const res = await this.db.query(`
      SELECT t.id, t.title, t.artist, t.album,
             t.duration, t.image_url  AS imageUrl,
             t.preview_url              AS previewUrl,
             t.spotify_id               AS spotifyId,
             t.liked
        FROM tracks t
        JOIN playlist_tracks pt
          ON pt.track_id = t.id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position;
    `, [playlistId]);

    return (res.values || []).map((r: any) => ({
      id:         r.id,
      title:      r.title,
      artist:     r.artist,
      album:      r.album,
      duration:   r.duration,
      imageUrl:   r.imageUrl,
      previewUrl: r.previewUrl,
      spotifyId:  r.spotifyId,
      liked:      !!r.liked
    }));
  }

  // ---------- Liked Music ----------

  async addLiked(trackId: string): Promise<boolean> {
    await this.ensureInit();
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR IGNORE INTO liked_music (track_id, liked_at) VALUES (?, ?);`,
      [trackId, now]
    );
    await this.db.run(
      `UPDATE tracks SET liked = 1 WHERE id = ?;`,
      [trackId]
    );
    return true;
  }

  async removeLiked(trackId: string): Promise<boolean> {
    await this.ensureInit();
    await this.db.run(
      `DELETE FROM liked_music WHERE track_id = ?;`,
      [trackId]
    );
    await this.db.run(
      `UPDATE tracks SET liked = 0 WHERE id = ?;`,
      [trackId]
    );
    return true;
  }

  async getLikedTracks(): Promise<Track[]> {
    await this.ensureInit();
    const res = await this.db.query(`
      SELECT t.id, t.title, t.artist, t.album,
             t.duration, t.image_url  AS imageUrl,
             t.preview_url              AS previewUrl,
             t.spotify_id               AS spotifyId,
             1                          AS liked
        FROM tracks t
        JOIN liked_music lm ON lm.track_id = t.id
       ORDER BY lm.liked_at DESC;
    `);
    return (res.values || []).map((r: any) => ({
      id:         r.id,
      title:      r.title,
      artist:     r.artist,
      album:      r.album,
      duration:   r.duration,
      imageUrl:   r.imageUrl,
      previewUrl: r.previewUrl,
      spotifyId:  r.spotifyId,
      liked:      true
    }));
  }

  // ---------- Downloaded Music ----------

  async addDownloaded(trackId: string, uri: string): Promise<boolean> {
    await this.ensureInit();
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR REPLACE INTO downloaded_music
         (track_id, file_uri, downloaded_at)
       VALUES (?, ?, ?);`,
      [trackId, uri, now]
    );
    return true;
  }

  async removeDownloaded(trackId: string): Promise<boolean> {
    await this.ensureInit();
    await this.db.run(
      `DELETE FROM downloaded_music WHERE track_id = ?;`,
      [trackId]
    );
    return true;
  }

  async getDownloadedTracks(): Promise<{track_id:string;file_uri:string}[]> {
    await this.ensureInit();
    const res = await this.db.query(
      `SELECT track_id, file_uri FROM downloaded_music;`
    );
    return res.values || [];
  }

  // ---------- Track Table Management ----------

  async saveTrack(track: any): Promise<boolean> {
    await this.ensureInit();
    await this.db.run(
      `INSERT OR REPLACE INTO tracks
         (id, title, artist, album,
          duration, image_url, preview_url,
          spotify_id, liked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        track.id,
        track.title, track.artist, track.album,
        track.duration,
        track.imageUrl, track.previewUrl,
        track.spotifyId,
        track.liked ? 1 : 0
      ]
    );
    return true;
  }

  async getTrack(trackId: string): Promise<any> {
    await this.ensureInit();
    const res = await this.db.query(
      `SELECT * FROM tracks WHERE id = ?;`,
      [trackId]
    );
    return res.values?.[0] || null;
  }

  // ---------- Execute Raw SQL ----------
  async executeSql(sql: string, params: any[] = []): Promise<any> {
    await this.ensureInit();

    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('SELECT')) {
      return this.db.query(sql, params);
    } else {
      return this.db.run(sql, params);
    }
  }

  // ---------- Generic Key/Value ----------
  async set(key: string, value: any): Promise<void> {
    await this.ensureInit();
    const str = JSON.stringify(value);
    await this.db.run(
      `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);`,
      [key, str]
    );
  }

  async get(key: string): Promise<any> {
    await this.ensureInit();
    const res = await this.db.query(
      `SELECT value FROM settings WHERE key = ?;`,
      [key]
    );
    if (res.values?.length) {
      try {
        return JSON.parse(res.values[0].value);
      } catch {
        return res.values[0].value;
      }
    }
    return null;
  }

  async toggleLikedTrack(trackId: string, liked: boolean): Promise<boolean> {
    await this.ensureInit();
    if (liked) {
      return this.addLiked(trackId);
    } else {
      return this.removeLiked(trackId);
    }
  }

  private async initSettingsTable(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

/**
 * Save a local music file
 */
  async saveLocalMusic(track: Track): Promise<boolean> {
    await this.ensureInit();

    // First save the track data
    await this.saveTrack(track);

    // Then add it to the downloaded music table
    await this.addDownloaded(track.id, track.previewUrl);

    return true;
  }

/**
 * Get all downloaded tracks with full track info
 */
  async getDownloadedTracksWithInfo(): Promise<Track[]> {
    await this.ensureInit();
    const res = await this.db.query(`
      SELECT t.id, t.title, t.artist, t.album,
            t.duration, t.image_url AS imageUrl,
            t.preview_url AS previewUrl,
            t.spotify_id AS spotifyId,
            t.liked
        FROM tracks t
        JOIN downloaded_music dm ON dm.track_id = t.id
      ORDER BY dm.downloaded_at DESC;
    `);

    return (res.values || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      album: r.album,
      duration: r.duration,
      imageUrl: r.imageUrl,
      previewUrl: r.previewUrl,
      spotifyId: r.spotifyId,
      liked: !!r.liked
    }));
  }
}
