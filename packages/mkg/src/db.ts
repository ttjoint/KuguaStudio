import Database from "better-sqlite3";

/**
 * 初始化 SQLite 数据库并返回 Database 实例
 */
export function 初始化数据库(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      modified_time INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK(kind IN ('file', 'directory')),
      indexed_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_resources_sha256 ON resources(sha256);
    CREATE INDEX IF NOT EXISTS idx_resources_name ON resources(name);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER,
      description TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (parent_id) REFERENCES tags(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id);

    CREATE TABLE IF NOT EXISTS resource_tags (
      resource_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (resource_id, tag_id),
      FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS resource_relations (
      from_resource_id INTEGER NOT NULL,
      to_resource_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (from_resource_id, to_resource_id, relation_type),
      FOREIGN KEY (from_resource_id) REFERENCES resources(id) ON DELETE CASCADE,
      FOREIGN KEY (to_resource_id) REFERENCES resources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS text_contents (
      resource_id INTEGER PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS resource_aliases (
      resource_id INTEGER PRIMARY KEY,
      alias TEXT NOT NULL,
      FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS open_with_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      extension TEXT NOT NULL UNIQUE,
      program_path TEXT NOT NULL,
      arguments TEXT,
      label TEXT
    );
  `);

  return db;
}

export type { default as DatabaseType } from "better-sqlite3";
