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
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL DEFAULT '',
      description    TEXT NOT NULL DEFAULT '',
      order_num      INTEGER NOT NULL DEFAULT 0,
      world_settings TEXT NOT NULL DEFAULT '{}',
      style_settings TEXT NOT NULL DEFAULT '{}',
      episode_order  TEXT NOT NULL DEFAULT '[]',
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
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
