import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "send-again.db");

function createDb(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_settings (
      id TEXT PRIMARY KEY,
      from_address TEXT NOT NULL,
      config_set TEXT NOT NULL DEFAULT 'email-tracking-config-set',
      rate_limit INTEGER NOT NULL DEFAULT 300
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      email TEXT NOT NULL,
      fields TEXT NOT NULL DEFAULT '{}',
      UNIQUE(workspace_id, email)
    );

    CREATE TABLE IF NOT EXISTS sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_events_message_id ON email_events(message_id);
    CREATE INDEX IF NOT EXISTS idx_sends_workspace ON sends(workspace_id);
  `);

  // Migrate old contacts schema to new (fields JSON)
  const cols = db.prepare("PRAGMA table_info(contacts)").all() as { name: string }[];
  const colNames = cols.map((c) => c.name);
  if (!colNames.includes("fields")) {
    db.exec("DROP TABLE contacts");
    db.exec(`
      CREATE TABLE contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        email TEXT NOT NULL,
        fields TEXT NOT NULL DEFAULT '{}',
        UNIQUE(workspace_id, email)
      )
    `);
  }

  return db;
}

// Survive Next.js HMR in dev
const globalDb = globalThis as unknown as { __db?: Database.Database };

export function getDb(): Database.Database {
  if (!globalDb.__db) {
    globalDb.__db = createDb();
  }
  return globalDb.__db;
}

// --- Contacts ---

export interface DbContact {
  email: string;
  fields: Record<string, string>;
}

export function getContacts(workspaceId: string): DbContact[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT email, fields FROM contacts WHERE workspace_id = ? ORDER BY id"
    )
    .all(workspaceId) as { email: string; fields: string }[];
  return rows.map((r) => ({ email: r.email, fields: JSON.parse(r.fields) }));
}

export function upsertContacts(workspaceId: string, contacts: DbContact[]) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO contacts (workspace_id, email, fields)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_id, email) DO UPDATE SET
      fields = excluded.fields
  `);
  const run = db.transaction((rows: DbContact[]) => {
    for (const c of rows) {
      stmt.run(workspaceId, c.email, JSON.stringify(c.fields));
    }
  });
  run(contacts);
}

export function updateContact(
  workspaceId: string,
  email: string,
  fields: Record<string, string>
) {
  const db = getDb();
  db.prepare(
    "UPDATE contacts SET fields = ? WHERE workspace_id = ? AND email = ?"
  ).run(JSON.stringify(fields), workspaceId, email);
}

export function deleteContact(workspaceId: string, email: string) {
  const db = getDb();
  db.prepare(
    "DELETE FROM contacts WHERE workspace_id = ? AND email = ?"
  ).run(workspaceId, email);
}

export function deleteAllContacts(workspaceId: string) {
  const db = getDb();
  db.prepare("DELETE FROM contacts WHERE workspace_id = ?").run(workspaceId);
}

// --- Workspace Settings ---

export interface DbWorkspaceSettings {
  id: string;
  from_address: string;
  config_set: string;
  rate_limit: number;
}

export function getAllWorkspaceSettings(): DbWorkspaceSettings[] {
  const db = getDb();
  return db
    .prepare("SELECT id, from_address, config_set, rate_limit FROM workspace_settings")
    .all() as DbWorkspaceSettings[];
}

export function upsertWorkspaceSettings(settings: {
  id: string;
  from: string;
  configSet: string;
  rateLimit: number;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO workspace_settings (id, from_address, config_set, rate_limit)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      from_address = excluded.from_address,
      config_set = excluded.config_set,
      rate_limit = excluded.rate_limit
  `).run(settings.id, settings.from, settings.configSet, settings.rateLimit);
}

// --- Sends & Events ---

export function insertSend(
  workspaceId: string,
  messageId: string,
  recipient: string,
  subject: string
) {
  const db = getDb();
  db.prepare(
    `INSERT INTO sends (workspace_id, message_id, recipient, subject) VALUES (?, ?, ?, ?)`
  ).run(workspaceId, messageId, recipient, subject);
}

export function insertEvent(
  messageId: string,
  eventType: string,
  timestamp: string,
  detail: string
) {
  const db = getDb();
  db.prepare(
    `INSERT INTO email_events (message_id, event_type, timestamp, detail) VALUES (?, ?, ?, ?)`
  ).run(messageId, eventType, timestamp, detail);
}

export interface SendHistoryRow {
  message_id: string;
  recipient: string;
  subject: string;
  sent_at: string;
  events: string; // JSON array aggregated by GROUP_CONCAT
}

export function getSendHistory(workspaceId: string, limit = 100): SendHistoryRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.message_id, s.recipient, s.subject, s.sent_at,
              CASE
                WHEN COUNT(e.event_type) = 0 THEN '[]'
                ELSE '[' || GROUP_CONCAT(
                  json_object('type', e.event_type, 'timestamp', e.timestamp, 'detail', e.detail)
                ) || ']'
              END AS events
       FROM sends s
       LEFT JOIN email_events e ON e.message_id = s.message_id
       WHERE s.workspace_id = ?
       GROUP BY s.message_id
       ORDER BY s.sent_at DESC
       LIMIT ?`
    )
    .all(workspaceId, limit) as SendHistoryRow[];
}
