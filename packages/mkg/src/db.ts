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

    -- ===== 统一内容节点主表（P0：文件/目录/笔记/素材/看板卡片共用一个实体） =====
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('file','directory','note','material','card','snippet')),
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      meta TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_title ON nodes(title);

    -- 节点上的标签（统一到节点维度，替代旧的 resource 维度）
    CREATE TABLE IF NOT EXISTS node_tags (
      node_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (node_id, tag_id),
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    -- 节点上的关系（统一到节点维度）
    CREATE TABLE IF NOT EXISTS node_relations (
      from_node_id INTEGER NOT NULL,
      to_node_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (from_node_id, to_node_id, relation_type),
      FOREIGN KEY (from_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );
  `);

  // ===== 迁移：resources 接入 nodes 主表 =====
  // 1) resources 增加 node_id 列（若不存在）
  const 资源列 = db.prepare("PRAGMA table_info(resources)").all() as { name: string }[];
  if (!资源列.some((c) => c.name === "node_id")) {
    db.exec("ALTER TABLE resources ADD COLUMN node_id INTEGER");
  }

  // 2) 为已有 file/directory 生成对应 node，并回填 node_id
  const 无节点资源 = db
    .prepare("SELECT id, name, kind FROM resources WHERE node_id IS NULL")
    .all() as { id: number; name: string; kind: string }[];
  const 插入节点 = db.prepare(
    "INSERT INTO nodes (type, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
  );
  const 回填节点 = db.prepare("UPDATE resources SET node_id = ? WHERE id = ?");
  for (const r of 无节点资源) {
    const 当前 = Math.floor(Date.now() / 1000);
    const res = 插入节点.run(r.kind === "directory" ? "directory" : "file", r.name, 当前, 当前);
    回填节点.run(Number(res.lastInsertRowid), r.id);
  }

  // 3) 迁移旧标签：resource_tags -> node_tags
  const 是否有旧标签表 = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='resource_tags'")
    .get() as { c: number };
  if (是否有旧标签表.c > 0) {
    const 节点标签插入 = db.prepare(
      "INSERT OR IGNORE INTO node_tags (node_id, tag_id, created_at) SELECT r.node_id, rt.tag_id, rt.created_at FROM resource_tags rt JOIN resources r ON r.id = rt.resource_id WHERE r.node_id IS NOT NULL",
    );
    节点标签插入.run();
  }

  // 4) 迁移旧关系：resource_relations -> node_relations
  const 是否有旧关系表 = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='resource_relations'")
    .get() as { c: number };
  if (是否有旧关系表.c > 0) {
    const 节点关系插入 = db.prepare(
      "INSERT OR IGNORE INTO node_relations (from_node_id, to_node_id, relation_type, created_at) SELECT rf.node_id, rt.node_id, rr.relation_type, rr.created_at FROM resource_relations rr JOIN resources rf ON rf.id = rr.from_resource_id JOIN resources rt ON rt.id = rr.to_resource_id WHERE rf.node_id IS NOT NULL AND rt.node_id IS NOT NULL",
    );
    节点关系插入.run();
  }

  
  // 5) 迁移 nodes 表：旧 CHECK 约束不含 'snippet'。采用 SQLite 标准三件套重建，避免子表外键指向旧表名
  const 建表SQL = db
    .prepare("SELECT sql AS s FROM sqlite_master WHERE type='table' AND name='nodes'")
    .get() as { s?: string } | undefined;
  if (建表SQL?.s && !建表SQL.s.includes("'snippet'")) {
    db.pragma("foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(
        [
          "CREATE TABLE nodes_new (",
          "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
          "  type TEXT NOT NULL CHECK(type IN ('file','directory','note','material','card','snippet')),",
          "  title TEXT NOT NULL,",
          "  created_at INTEGER NOT NULL DEFAULT 0,",
          "  updated_at INTEGER NOT NULL DEFAULT 0,",
          "  meta TEXT NOT NULL DEFAULT '{}'",
          ");",
          "INSERT INTO nodes_new (id, type, title, created_at, updated_at, meta)",
          "  SELECT id, type, title, created_at, updated_at, meta FROM nodes;",
          "DROP TABLE nodes;",
          "ALTER TABLE nodes_new RENAME TO nodes;",
        ].join("\n"),
      );
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
      throw new Error("迁移 nodes 表失败：无法支持 snippet 类型");
    } finally {
      db.pragma("foreign_keys = ON");
    }
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type); CREATE INDEX IF NOT EXISTS idx_nodes_title ON nodes(title);",
    );
  }

  // ===== v0.4：标签扩展 / 保存视图 / 位置 / 全文索引（见 docs/知识库设计.md） =====
  // 1) tags 增列（幂等）
  const 标签列 = db.prepare("PRAGMA table_info(tags)").all() as { name: string }[];
  const 待增列: Array<[string, string]> = [
    ["color", "TEXT"],
    // kind 列已废弃（曾计划表达 plain|arrow|group|smart，但从零读写逻辑，纯占位）。
    // 保留列以兼容既有库与待删的旧数据；类型定义已不再暴露该字段。
    ["kind", "TEXT NOT NULL DEFAULT 'plain'"],
    ["icon", "TEXT"],
    ["sort", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [列, 定义] of 待增列) {
    if (!标签列.some((c) => c.name === 列)) {
      db.exec(`ALTER TABLE tags ADD COLUMN ${列} ${定义}`);
    }
  }

  // 2) 保存视图（智能文件夹）与受管位置
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      query TEXT NOT NULL DEFAULT '{}',
      icon TEXT,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT,
      mode TEXT NOT NULL DEFAULT 'watch',
      excludes TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  // 3) 全文索引 FTS5：优先 trigram（适合中文子串），不可用则回退 unicode61
  const 已有FTS = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE name = 'node_fts'")
    .get() as { c: number };
  if (已有FTS.c === 0) {
    try {
      db.exec(
        "CREATE VIRTUAL TABLE node_fts USING fts5(node_id UNINDEXED, title, body, tokenize='trigram')",
      );
    } catch {
      db.exec(
        "CREATE VIRTUAL TABLE node_fts USING fts5(node_id UNINDEXED, title, body, tokenize='unicode61')",
      );
    }
  }

return db;
}

export type { default as DatabaseType } from "better-sqlite3";
