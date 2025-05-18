import { Injectable } from '@angular/core';
import { Platform } from '@ionic/angular';
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection
} from '@capacitor-community/sqlite';
import { Track } from './audio.service';
import { Filesystem, Directory } from '@capacitor/filesystem';

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
        await this.sqlite.initWebStore();
      }
      await this.sqlite.checkConnectionsConsistency();
      this.db = await this.sqlite.createConnection('harmony.db', false, 'no-encryption', 1, false);
      await this.db.open();

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
          liked        INTEGER DEFAULT 0,
          is_local     INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS liked_music (
          track_id     TEXT PRIMARY KEY,
          liked_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        CREATE TABLE IF NOT EXISTS downloaded_music (
          track_id     TEXT PRIMARY KEY,
          file_uri     TEXT NOT NULL,
          file_path    TEXT NOT NULL,
          downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );`;

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
             t.duration, t.image_url AS imageUrl,
             t.preview_url AS previewUrl,
             t.spotify_id AS spotifyId,
             t.liked, t.is_local AS isLocal
        FROM tracks t
        JOIN playlist_tracks pt
          ON pt.track_id = t.id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position;
    `, [playlistId]);

    return (res.values || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      album: r.album,
      duration: r.duration,
      imageUrl: r.imageUrl,
      previewUrl: r.previewUrl,
      spotifyId: r.spotifyId,
      liked: !!r.liked,
      isLocal: !!r.isLocal
    }));
  }

  async getLocalTracks(): Promise<Track[]> {
    await this.ensureInit();

    // Join with downloaded_music to get file_path as well
    const res = await this.db.query(`
      SELECT
        t.id,
        t.title,
        t.artist,
        t.album,
        t.duration,
        t.image_url    AS imageUrl,
        t.preview_url  AS previewUrl,
        t.spotify_id   AS spotifyId,
        t.liked,
        t.is_local     AS isLocal,
        dm.file_path   AS localPath
      FROM tracks t
      LEFT JOIN downloaded_music dm ON dm.track_id = t.id
      WHERE t.is_local = 1
      ORDER BY t.ROWID DESC;
    `);

    return (res.values || []).map((r: any) => ({
      id:        r.id,
      title:     r.title,
      artist:    r.artist,
      album:     r.album,
      duration:  r.duration,
      imageUrl:  r.imageUrl,
      previewUrl:r.previewUrl,
      spotifyId: r.spotifyId,
      liked:     !!r.liked,
      isLocal:   !!r.isLocal,
      localPath: r.localPath
    }));
  }

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
             t.duration, t.image_url AS imageUrl,
             t.preview_url AS previewUrl,
             t.spotify_id AS spotifyId,
             1 AS liked, t.is_local AS isLocal
        FROM tracks t
        JOIN liked_music lm ON lm.track_id = t.id
       ORDER BY lm.liked_at DESC;
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
      liked: true,
      isLocal: !!r.isLocal
    }));
  }

  async uploadedMusic(trackId: string, uri: string, filePath: string = ''): Promise<boolean> {
    await this.ensureInit();
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR REPLACE INTO downloaded_music
        (track_id, file_uri, file_path, downloaded_at)
      VALUES (?, ?, ?, ?);`,
      [trackId, uri, filePath || uri, now]
    );
    return true;
  }

  async deleteLocalTrack(trackId: string): Promise<boolean> {
    await this.ensureInit();

    try {
      const track = await this.getTrack(trackId);
      if (!track) {
        console.error('Track not found:', trackId);
        return false;
      }

      //check if local track
      if (!track.isLocal) {
        console.error('Cannot delete non-local track:', trackId);
        return false;
      }

      // delete if local file
      if (track.previewUrl) {
        try {
          if (track.previewUrl.startsWith('blob:')) {
            console.log('Blob URL will be garbage collected:', track.previewUrl);
          }
          else if (track.previewUrl.startsWith('file://')) {
            const path = track.previewUrl.replace(/^file:\/\//, '');
            await Filesystem.deleteFile({
              path,
              directory: Directory.Data
            });
            console.log('Deleted file:', path);
          }
        } catch (fileError) {
          console.warn('Error deleting file:', fileError);
        }
      }

      await this.db.run(
        'DELETE FROM tracks WHERE id = ?',
        [trackId]
      );

      await this.db.run(
        'DELETE FROM liked_music WHERE track_id = ?',
        [trackId]
      );

      await this.db.run(
        'DELETE FROM downloaded_music WHERE track_id = ?',
        [trackId]
      );

      await this.db.run(
        'DELETE FROM playlist_tracks WHERE track_id = ?',
        [trackId]
      );
      return true;
    } catch (error) {
      throw error;
    }
  }

  async getTrackFilePath(trackId: string): Promise<{uri: string, path: string} | null> {
    await this.ensureInit();
    const res = await this.db.query(
      `SELECT file_uri, file_path FROM downloaded_music WHERE track_id = ?;`,
      [trackId]
    );

    if (res.values?.length) {
      return {
        uri: res.values[0].file_uri,
        path: res.values[0].file_path
      };
    }
    return null;
  }

  async saveTrack(track: any): Promise<boolean> {
    await this.ensureInit();
    await this.db.run(
      `INSERT OR REPLACE INTO tracks
         (id, title, artist, album,
          duration, image_url, preview_url,
          spotify_id, liked, is_local)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        track.id,
        track.title, track.artist, track.album,
        track.duration,
        track.imageUrl, track.previewUrl,
        track.spotifyId,
        track.liked ? 1 : 0,
        track.isLocal ? 1 : 0
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

    if (res.values && res.values.length > 0) {
      const track = res.values[0];
      return {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        imageUrl: track.image_url,
        previewUrl: track.preview_url,
        spotifyId: track.spotify_id,
        liked: !!track.liked,
        isLocal: !!track.is_local
      };
    }

    return null;
  }

  async queryTracks(query: string, params: any[] = []): Promise<any[]> {
    await this.ensureInit();

    try {
      const result = await this.db.query(query, params);
      return result.values || [];
    } catch (error) {
      console.error('Error executing track query:', error);
      throw error;
    }
  }

  async executeSql(sql: string, params: any[] = []): Promise<any> {
    await this.ensureInit();

    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('SELECT')) {
      return this.db.query(sql, params);
    } else {
      return this.db.run(sql, params);
    }
  }

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

   async saveLocalMusic(track: Track, filePath: string = ''): Promise<boolean> {
    await this.ensureInit();
    const trackWithLocal = {
      ...track,
      isLocal: true
    };
    await this.saveTrack(trackWithLocal);
    await this.uploadedMusic(
      track.id,
      track.previewUrl,
      filePath || `music/${track.id}.mp3`
    );

    return true;
  }

  async getDownloadedTracksWithInfo(): Promise<Track[]> {
    await this.ensureInit();
    const res = await this.db.query(`
      SELECT t.id, t.title, t.artist, t.album,
             t.duration, t.image_url AS imageUrl,
             t.preview_url AS previewUrl,
             t.spotify_id AS spotifyId,
             t.liked, t.is_local AS isLocal
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
      liked: !!r.liked,
      isLocal: !!r.isLocal
    }));
  }
  async fileExists(path: string): Promise<boolean> {
    try {
      await Filesystem.stat({
        path,
        directory: Directory.Data
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  async verifyLocalTrack(trackId: string): Promise<boolean> {
    try {
      const track = await this.getTrack(trackId);
      if (!track || !track.isLocal) return false;
      const fileInfo = await this.getTrackFilePath(trackId);
      if (!fileInfo) return false;
      let exists = false;

      if (fileInfo.uri.startsWith('blob:')) {
        return true;
      }

      try {
        if (fileInfo.uri.startsWith('file://')) {
          const path = fileInfo.uri.replace(/^file:\/\//, '');
          await Filesystem.stat({
            path,
            directory: Directory.Data
          });
          exists = true;
        }else {
          await Filesystem.stat({
            path: fileInfo.path,
            directory: Directory.Data
          });
          exists = true;
        }
      } catch (e) {
        try {
          await Filesystem.stat({
            path: fileInfo.path,
            directory: Directory.Data
          });
          await this.db.run(
            `UPDATE downloaded_music SET file_uri = ? WHERE track_id = ?`,
            [fileInfo.path, trackId]
          );

          exists = true;
        } catch (backupError) {
          exists = false;
        }
      }
      return exists;
    } catch (error) {
      return false;
    }
  }
}
