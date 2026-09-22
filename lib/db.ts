import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { config } from "../config.js";

let db: Database.Database | null = null;

export function getDbPath() {
  return config.storage.dbPath;
}

export function getDb() {
  if (db) return db;
  const dbPath = getDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL DEFAULT 'Untitled',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      graph_version INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS nodes (
      session_id  TEXT NOT NULL,
      id          TEXT NOT NULL,
      x           REAL NOT NULL DEFAULT 0,
      y           REAL NOT NULL DEFAULT 0,
      data        TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (session_id, id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS edges (
      session_id  TEXT NOT NULL,
      id          TEXT NOT NULL,
      source      TEXT NOT NULL,
      target      TEXT NOT NULL,
      data        TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (session_id, id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_session ON nodes(session_id);
    CREATE INDEX IF NOT EXISTS idx_edges_session ON edges(session_id);

    CREATE TABLE IF NOT EXISTS inflight (
      request_id     TEXT PRIMARY KEY,
      kind           TEXT NOT NULL,
      prompt         TEXT NOT NULL DEFAULT '',
      meta           TEXT NOT NULL DEFAULT '{}',
      session_id     TEXT,
      parent_node_id TEXT,
      client_node_id TEXT,
      started_at     INTEGER NOT NULL,
      phase          TEXT NOT NULL DEFAULT 'queued',
      phase_at       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_inflight_started ON inflight(started_at);
    CREATE INDEX IF NOT EXISTS idx_inflight_kind ON inflight(kind);
    CREATE INDEX IF NOT EXISTS idx_inflight_session ON inflight(session_id);

    -- #151: terminal job snapshots outlive the process that produced them.
    -- The in-memory map stays the source of truth; this table repopulates it
    -- on the first read after a restart so a client that reconnects still
    -- learns how its job ended.
    CREATE TABLE IF NOT EXISTS terminal_jobs (
      request_id  TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      status      TEXT NOT NULL,
      started_at  INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      phase       TEXT NOT NULL DEFAULT 'unknown',
      phase_at    INTEGER NOT NULL,
      http_status INTEGER,
      error_code  TEXT,
      meta        TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_terminal_jobs_finished ON terminal_jobs(finished_at);

    -- #151: idempotency keys. A duplicate POST carrying the same key replays
    -- the first request's outcome instead of paying a provider twice.
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key              TEXT PRIMARY KEY,
      request_id       TEXT NOT NULL,
      kind             TEXT NOT NULL,
      fingerprint      TEXT NOT NULL,
      created_at       INTEGER NOT NULL,
      terminal_status  TEXT,
      terminal_payload TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id                 TEXT PRIMARY KEY,
      title              TEXT NOT NULL DEFAULT 'New Agent',
      codex_thread_id    TEXT,
      last_turn_id       TEXT,
      current_image_id   TEXT,
	      compacted          INTEGER NOT NULL DEFAULT 0,
	      web_search_enabled INTEGER NOT NULL DEFAULT 1,
	      generation_settings TEXT NOT NULL DEFAULT '{}',
	      style_locks        TEXT NOT NULL DEFAULT '[]',
	      subject_locks      TEXT NOT NULL DEFAULT '[]',
	      created_at         INTEGER NOT NULL,
	      updated_at         INTEGER NOT NULL
	    );

    CREATE TABLE IF NOT EXISTS agent_turns (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      role            TEXT NOT NULL,
      text            TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'complete',
      image_ids       TEXT NOT NULL DEFAULT '[]',
      web_finding_ids TEXT NOT NULL DEFAULT '[]',
      raw             TEXT NOT NULL DEFAULT '{}',
      created_at      INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_images (
      id             TEXT PRIMARY KEY,
      session_id     TEXT NOT NULL,
      filename       TEXT NOT NULL,
      url            TEXT NOT NULL,
      thumb_url      TEXT,
      prompt         TEXT,
      revised_prompt TEXT,
      width          INTEGER,
      height         INTEGER,
      created_at     INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_references (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'source',
      image_id   TEXT,
      filename   TEXT,
      url        TEXT,
      prompt     TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
    );

	    CREATE TABLE IF NOT EXISTS agent_web_findings (
	      id         TEXT PRIMARY KEY,
	      session_id TEXT NOT NULL,
	      query      TEXT NOT NULL DEFAULT '',
	      url        TEXT,
      title      TEXT,
      snippet    TEXT,
      created_at INTEGER NOT NULL,
	      FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
	    );

	    CREATE TABLE IF NOT EXISTS agent_queue_items (
	      id               TEXT PRIMARY KEY,
	      session_id       TEXT NOT NULL,
	      request_id       TEXT NOT NULL,
	      prompt           TEXT NOT NULL DEFAULT '',
	      options          TEXT NOT NULL DEFAULT '{}',
	      tool_plan        TEXT NOT NULL DEFAULT '{}',
	      status           TEXT NOT NULL DEFAULT 'queued',
	      position         INTEGER NOT NULL DEFAULT 0,
	      result_image_ids TEXT NOT NULL DEFAULT '[]',
	      error_code       TEXT,
	      error_class      TEXT,
	      error_message    TEXT,
	      progress_stage   TEXT,
	      created_at       INTEGER NOT NULL,
	      started_at       INTEGER,
	      finished_at      INTEGER,
	      FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
	    );

    CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated
      ON agent_sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_agent_turns_session
      ON agent_turns(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_images_session
      ON agent_images(session_id, created_at);
	    CREATE INDEX IF NOT EXISTS idx_agent_web_findings_session
	      ON agent_web_findings(session_id, created_at);
	    CREATE INDEX IF NOT EXISTS idx_agent_queue_session
	      ON agent_queue_items(session_id, status, created_at);
	    CREATE INDEX IF NOT EXISTS idx_agent_queue_status
	      ON agent_queue_items(status, created_at);

    -- Lich su cac luot chay khuon (BAT DAU -> KET THUC) goi qua API.
    -- KHONG khoa ngoai toi sessions: xoa mot phien khong nen xoa ca ghi chep ve
    -- nhung gi da sinh ra, vi cac tep trong /generated van con do.
    CREATE TABLE IF NOT EXISTS wf_runs (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      start_node_id TEXT NOT NULL,
      status        TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      finished_at   INTEGER,
      inputs        TEXT NOT NULL DEFAULT '{}',
      steps         TEXT NOT NULL DEFAULT '[]',
      result        TEXT,
      error         TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_wf_runs_created ON wf_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_wf_runs_session ON wf_runs(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_wf_runs_status ON wf_runs(status, created_at);

    -- Anh tham chieu nguoi dung dinh len tung node.
    -- Truoc day chung nam o localStorage cua trinh duyet, nen mot khuon chay o
    -- may chu khong he thay chung, va doi may la mat. Bang nay giu URL tep
    -- (/generated/...) chu khong giu data URL: graph va bang deu nho, con byte
    -- anh nam trong thu muc tep nhu moi anh khac cua du an.
    CREATE TABLE IF NOT EXISTS node_refs (
      session_id TEXT NOT NULL,
      node_id    TEXT NOT NULL,
      idx        INTEGER NOT NULL,
      url        TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, node_id, idx),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_node_refs_session ON node_refs(session_id);
	  `);

  const sessionColumns = (database
    .prepare("PRAGMA table_info(sessions)")
    .all() as Array<{ name: string }>)
    .map((row) => row.name);
  if (!sessionColumns.includes("graph_version")) {
    database.exec(
      "ALTER TABLE sessions ADD COLUMN graph_version INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!sessionColumns.includes("style_sheet")) {
    database.exec("ALTER TABLE sessions ADD COLUMN style_sheet TEXT");
  }
	  if (!sessionColumns.includes("style_sheet_enabled")) {
	    database.exec(
	      "ALTER TABLE sessions ADD COLUMN style_sheet_enabled INTEGER NOT NULL DEFAULT 0",
	    );
	  }

	  const agentSessionColumns = (database
	    .prepare("PRAGMA table_info(agent_sessions)")
	    .all() as Array<{ name: string }>)
	    .map((row) => row.name);
	  if (!agentSessionColumns.includes("generation_settings")) {
	    database.exec("ALTER TABLE agent_sessions ADD COLUMN generation_settings TEXT NOT NULL DEFAULT '{}'");
	  }

  const agentQueueColumns = (database
    .prepare("PRAGMA table_info(agent_queue_items)")
    .all() as Array<{ name: string }>)
    .map((row) => row.name);
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "request_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "options", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "tool_plan", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "position", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "result_image_ids", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "error_code", "TEXT");
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "error_class", "TEXT");
  // The wrapper code alone (AGENT_TEXT_ONLY_RESULT) tells the user nothing about WHY.
  // The worker already computes rawCode; without this column it was dropped here.
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "error_raw_code", "TEXT");
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "error_message", "TEXT");
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "progress_stage", "TEXT");
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "started_at", "INTEGER");
  addColumnIfMissing(database, agentQueueColumns, "agent_queue_items", "finished_at", "INTEGER");

  // ── Prompt Library (schema v4) ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS prompt_folders (
      id          TEXT PRIMARY KEY,
      parent_id   TEXT NOT NULL,
      name        TEXT NOT NULL COLLATE NOCASE,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(parent_id, name)
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id            TEXT PRIMARY KEY,
      folder_id     TEXT NOT NULL DEFAULT '__root__',
      name          TEXT NOT NULL,
      text          TEXT NOT NULL,
      tags          TEXT,
      mode          TEXT,
      is_favorite   INTEGER NOT NULL DEFAULT 0,
      favorited_at  INTEGER,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (folder_id) REFERENCES prompt_folders(id) ON DELETE SET DEFAULT
    );

    CREATE TABLE IF NOT EXISTS gallery_favorites (
      id            TEXT PRIMARY KEY,
      browser_id    TEXT NOT NULL,
      filename      TEXT NOT NULL,
      favorited_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(browser_id, filename)
    );

    CREATE TABLE IF NOT EXISTS image_annotations (
      id             TEXT PRIMARY KEY,
      browser_id     TEXT NOT NULL,
      filename       TEXT NOT NULL,
      payload        TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(browser_id, filename)
    );

    CREATE INDEX IF NOT EXISTS idx_image_annotations_filename
      ON image_annotations(filename);

    INSERT OR IGNORE INTO prompt_folders (id, parent_id, name) VALUES
      ('__root__', '__root__', '__root__'),
      ('__trash__', '__root__', '__trash__');
  `);

  // ── Assets Library (phase 050, schema v6) ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS asset_folders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      parent_id  TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES asset_folders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id         TEXT PRIMARY KEY,
      kind       TEXT NOT NULL CHECK (kind IN ('image','video','element','preset','template')),
      name       TEXT NOT NULL,
      file_path  TEXT,
      folder_id  TEXT,
      notes      TEXT,
      metadata   TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES asset_folders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS asset_tags (
      asset_id TEXT NOT NULL,
      tag      TEXT NOT NULL,
      PRIMARY KEY (asset_id, tag),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag);

    CREATE TABLE IF NOT EXISTS sprite_recipes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, recipe TEXT NOT NULL,
      anchor_asset_id TEXT, anchor_status TEXT NOT NULL DEFAULT 'missing'
        CHECK (anchor_status IN ('missing','candidate','approved')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY (anchor_asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS sprite_recipe_rows (
      recipe_id TEXT NOT NULL, state_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','queued','running','complete','error','canceled')),
      request_id TEXT, result_asset_id TEXT, error_code TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY (recipe_id, state_key),
      FOREIGN KEY (recipe_id) REFERENCES sprite_recipes(id) ON DELETE CASCADE,
      FOREIGN KEY (result_asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sprite_recipes_updated ON sprite_recipes(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sprite_rows_request ON sprite_recipe_rows(request_id);
  `);

  const row = database.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
  if (!row) {
    database.prepare("INSERT INTO _meta (key, value) VALUES ('schema_version', '7')").run();
  } else if (row.value !== "7") {
    database
      .prepare("UPDATE _meta SET value = '7' WHERE key = 'schema_version'")
      .run();
  }
}

function addColumnIfMissing(
  database: Database.Database,
  columns: readonly string[],
  table: string,
  name: string,
  definition: string,
) {
  if (columns.includes(name)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
