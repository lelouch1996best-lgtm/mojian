import Database from "better-sqlite3";
import path from "path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath =
    process.env.DB_PATH ||
    path.join(process.cwd(), "data", "mojian-dev.db");

  // 确保目录存在
  const dir = path.dirname(dbPath);
  const fs = require("fs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // 建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS series (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL DEFAULT '',
      description       TEXT NOT NULL DEFAULT '',
      order_num         INTEGER NOT NULL DEFAULT 0,
      world_setting     TEXT NOT NULL DEFAULT '{}',
      character_settings TEXT NOT NULL DEFAULT '[]',
      object_settings   TEXT NOT NULL DEFAULT '[]',
      scene_settings    TEXT NOT NULL DEFAULT '[]',
      style_settings    TEXT NOT NULL DEFAULT '{}',
      episode_order     TEXT NOT NULL DEFAULT '[]',
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id               TEXT PRIMARY KEY,
      title            TEXT NOT NULL DEFAULT '',
      series_id        TEXT NOT NULL,
      step             INTEGER NOT NULL DEFAULT 1,
      original_content TEXT NOT NULL DEFAULT '',
      expanded_content TEXT NOT NULL DEFAULT '',
      shots            TEXT NOT NULL DEFAULT '[]',
      assets           TEXT NOT NULL DEFAULT '[]',
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_episodes_series_id ON episodes(series_id);

    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id            TEXT PRIMARY KEY,
      media_type    TEXT NOT NULL,
      url           TEXT NOT NULL,
      entity_type   TEXT NOT NULL,
      entity_name   TEXT NOT NULL DEFAULT '',
      prompt        TEXT NOT NULL DEFAULT '',
      source        TEXT NOT NULL DEFAULT '',
      series_id     TEXT NOT NULL DEFAULT '',
      series_title  TEXT NOT NULL DEFAULT '',
      episode_id    TEXT NOT NULL DEFAULT '',
      episode_title TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_assets_created_at ON media_assets(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_assets_series_id ON media_assets(series_id);
    CREATE INDEX IF NOT EXISTS idx_media_assets_media_type ON media_assets(media_type);
    CREATE INDEX IF NOT EXISTS idx_media_assets_entity_type ON media_assets(entity_type);

    CREATE TABLE IF NOT EXISTS presets (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL DEFAULT '',
      type       TEXT NOT NULL,
      url        TEXT NOT NULL DEFAULT '',
      content    TEXT NOT NULL DEFAULT '',
      tags       TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_presets_created_at ON presets(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_presets_type ON presets(type);

    CREATE TABLE IF NOT EXISTS preset_tags (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
  `);

  return db;
}

/** 关闭数据库连接（进程退出时调用） */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
