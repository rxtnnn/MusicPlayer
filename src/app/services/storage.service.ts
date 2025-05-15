// src/app/services/storage.service.ts
import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Platform } from '@ionic/angular';
import { Track } from './audio.service';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private sqliteConnection: SQLiteConnection;
  private db!: SQLiteDBConnection;
  private isReady = false;

  constructor(private platform: Platform) {
    this.sqliteConnection = new SQLiteConnection(CapacitorSQLite);
  }

  async init() {
    try {
      await this.platform.ready();
      if (!this.platform.is('hybrid')) {
        await this.sqliteConnection.initWebStore();
      }
      await this.createDatabase();
      this.isReady = true;
      console.log('[StorageService] Database ready');
    } catch (error) {
      console.error('[StorageService] Initialization error:', error);
      throw error;
    }
  }

  private async createDatabase(): Promise<void> {
    const name = 'harmony.db';
    const version = 1;

    try {
      const conn = await this.sqliteConnection.isConnection(name, false);

      if (!conn.result) {
        this.db = await this.sqliteConnection.createConnection(name, false, 'no-encryption', version, false);
      } else {
        this.db = await this.sqliteConnection.retrieveConnection(name, false);
      }

      if (!this.db.isDBOpen()) {
        await this.db.open();
      }

      await this.createTables();
    } catch (error) {
      console.error('[StorageService] Database creation error:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS settings (
         key TEXT PRIMARY KEY,
         value TEXT
       );`,
      `CREATE TABLE IF NOT EXISTS playlists (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         name TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         updated_at TEXT NOT NULL DEFAULT (datetime('now'))
       );`,
      `CREATE TRIGGER IF NOT EXISTS trg_playlists_update
         AFTER UPDATE OF name ON playlists
       BEGIN
         UPDATE playlists
           SET updated_at = datetime('now')
         WHERE id = NEW.id;
       END;`,
      `CREATE TABLE IF NOT EXISTS playlist_tracks (
         playlist_id INTEGER NOT NULL,
         track_id TEXT NOT NULL,
         position INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (playlist_id, track_id)
       );`,
      `CREATE TABLE IF NOT EXISTS liked_music (
         track_id TEXT PRIMARY KEY,
         liked_at TEXT NOT NULL DEFAULT (datetime('now'))
       );`,
      `CREATE TABLE IF NOT EXISTS downloaded_music (
         track_id TEXT PRIMARY KEY,
         file_uri TEXT NOT NULL,
         downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
       );`,
      `CREATE TABLE IF NOT EXISTS tracks (
         id TEXT PRIMARY KEY,
         title TEXT,
         artist TEXT,
         album TEXT,
         duration INTEGER,
         image_url TEXT,
         preview_url TEXT,
         spotify_id TEXT,
         liked INTEGER DEFAULT 0
       );`
    ];

    for (const sql of stmts) {
      try {
        await this.db.execute(sql);
      } catch (e) {
        console.error('Table creation error:', sql, e);
      }
    }
  }

  // ---------- Generic Key/Value ----------
  async set(key: string, value: any): Promise<void> {
    if (!this.isReady) await this.init();
    const str = JSON.stringify(value);
    await this.db.run(
      `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);`,
      [key, str]
    );
  }

  async get(key: string): Promise<any> {
    if (!this.isReady) await this.init();
    const res = await this.db.query(
      `SELECT value FROM settings WHERE key = ?;`,
      [key]
    );
    if (res.values && res.values.length > 0) {
      try {
        return JSON.parse(res.values[0].value);
      } catch {
        return res.values[0].value;
      }
    }
    return null;
  }

  // ---------- Playlist CRUD ----------
  async createPlaylist(name: string): Promise<number> {
    if (!this.isReady) await this.init();
    const now = new Date().toISOString();
    const res = await this.db.run(
      `INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?);`,
      [name, now, now]
    );
    return res.changes?.lastId ?? -1;
  }

  async getPlaylists(): Promise<any[]> {
    if (!this.isReady) await this.init();
    const res = await this.db.query(
      `SELECT id, name, created_at, updated_at FROM playlists ORDER BY created_at DESC;`,
      []
    );
    return res.values || [];
  }

  async renamePlaylist(id: number, newName: string): Promise<boolean> {
    if (!this.isReady) await this.init();
    await this.db.run(
      `UPDATE playlists SET name = ? WHERE id = ?;`,
      [newName, id]
    );
    return true;
  }

  async deletePlaylist(id: number): Promise<boolean> {
    if (!this.isReady) await this.init();
    await this.db.run(`DELETE FROM playlists WHERE id = ?;`, [id]);
    await this.db.run(`DELETE FROM playlist_tracks WHERE playlist_id = ?;`, [id]);
    return true;
  }

  async addTrackToPlaylist(playlistId: number, trackId: string, position?: number): Promise<boolean> {
    if (!this.isReady) await this.init();

    // If no position specified, add to end
    if (position === undefined) {
      const res = await this.db.query(
        `SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = ?;`,
        [playlistId]
      );
      position = (res.values?.[0]?.max_pos ?? -1) + 1;
    }

    await this.db.run(
      `INSERT OR REPLACE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?);`,
      [playlistId, trackId, position]
    );
    return true;
  }

  async removeTrackFromPlaylist(playlistId: number, trackId: string): Promise<boolean> {
    if (!this.isReady) await this.init();
    await this.db.run(
      `DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?;`,
      [playlistId, trackId]
    );
    return true;
  }

    async getPlaylistTracks(playlistId: number): Promise<Track[]> {
    if (!this.isReady) await this.init();
    const res = await this.db.query(
      `SELECT t.id, t.title, t.artist, t.album,
              t.duration, t.image_url  AS imageUrl,
              t.preview_url AS previewUrl,
              t.spotify_id AS spotifyId,
              t.liked
         FROM tracks t
         JOIN playlist_tracks pt
           ON pt.track_id = t.id
        WHERE pt.playlist_id = ?
        ORDER BY pt.position;`,
      [playlistId]
    );

    // Map SQLite results into your Track shape
    return (res.values || []).map(row => ({
      id:         row.id,
      title:      row.title,
      artist:     row.artist,
      album:      row.album,
      duration:   row.duration,
      imageUrl:   row.imageUrl,
      previewUrl: row.previewUrl,
      spotifyId:  row.spotifyId,
      liked:      !!row.liked
    }));
  }
  // ---------- Liked Music ----------
  async addLiked(trackId: string): Promise<boolean> {
    if (!this.isReady) await this.init();
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR IGNORE INTO liked_music (track_id, liked_at) VALUES (?, ?);`,
      [trackId, now]
    );
    // Update track liked status
    await this.db.run(
      `UPDATE tracks SET liked = 1 WHERE id = ?;`,
      [trackId]
    );
    return true;
  }

  async removeLiked(trackId: string): Promise<boolean> {
    if (!this.isReady) await this.init();
    await this.db.run(`DELETE FROM liked_music WHERE track_id = ?;`, [trackId]);
    // Update track liked status
    await this.db.run(
      `UPDATE tracks SET liked = 0 WHERE id = ?;`,
      [trackId]
    );
    return true;
  }

  async toggleLikedTrack(trackId: string, liked: boolean): Promise<boolean> {
  if (!this.isReady) await this.init();

  if (liked) {
    return this.addLiked(trackId);
  } else {
    return this.removeLiked(trackId);
  }
}
  async getLikedTracks(): Promise<Track[]> {
    if (!this.isReady) await this.init();

    const res = await this.db.query(
      `SELECT
         t.id,
         t.title,
         t.artist,
         t.album,
         t.duration,
         t.image_url   AS imageUrl,
         t.preview_url AS previewUrl,
         t.spotify_id  AS spotifyId,
         1             AS liked
       FROM tracks t
       JOIN liked_music lm ON lm.track_id = t.id
       ORDER BY lm.liked_at DESC;`,
      []
    );

    return (res.values || []).map(row => ({
      id:         row.id,
      title:      row.title,
      artist:     row.artist,
      album:      row.album,
      duration:   row.duration,
      imageUrl:   row.imageUrl,
      previewUrl: row.previewUrl,
      spotifyId:  row.spotifyId,
      liked:      true
    })) as Track[];
  }

  // ---------- Downloaded Music ----------
  async addDownloaded(trackId: string, uri: string): Promise<boolean> {
    if (!this.isReady) await this.init();
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR REPLACE INTO downloaded_music (track_id, file_uri, downloaded_at) VALUES (?, ?, ?);`,
      [trackId, uri, now]
    );
    return true;
  }

  async removeDownloaded(trackId: string): Promise<boolean> {
    if (!this.isReady) await this.init();
    await this.db.run(`DELETE FROM downloaded_music WHERE track_id = ?;`, [trackId]);
    return true;
  }

  async getDownloadedTracks(): Promise<{ track_id: string; file_uri: string }[]> {
    if (!this.isReady) await this.init();
    const res = await this.db.query(`SELECT track_id, file_uri FROM downloaded_music;`, []);
    return res.values || [];
  }

  // ---------- Track Management ----------
  async saveTrack(track: any): Promise<boolean> {
    if (!this.isReady) await this.init();
    await this.db.run(
      `INSERT OR REPLACE INTO tracks (id, title, artist, album, duration, image_url, preview_url, spotify_id, liked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        track.id,
        track.title,
        track.artist,
        track.album,
        track.duration,
        track.imageUrl || track.image_url,
        track.previewUrl || track.preview_url,
        track.spotifyId || track.spotify_id,
        track.liked ? 1 : 0
      ]
    );
    return true;
  }

  async getTrack(trackId: string): Promise<any> {
    if (!this.isReady) await this.init();
    const res = await this.db.query(
      `SELECT * FROM tracks WHERE id = ?;`,
      [trackId]
    );
    return res.values?.[0] || null;
  }

  // ---------- Execute Raw SQL ----------
  async executeSql(sql: string, params: any[] = []): Promise<any> {
    if (!this.isReady) await this.init();

    // Determine if this is a query or command
    const trimmedSql = sql.trim().toUpperCase();
    if (trimmedSql.startsWith('SELECT')) {
      return await this.db.query(sql, params);
    } else {
      return await this.db.run(sql, params);
    }
  }
}
