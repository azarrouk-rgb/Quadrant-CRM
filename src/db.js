const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");

const DATABASE_FILE = process.env.DATABASE_FILE || "./data/quadrant.db";

// Make sure the folder for the database file exists.
const dir = path.dirname(DATABASE_FILE);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DATABASE_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','rep')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    industry TEXT DEFAULT '',
    website TEXT DEFAULT '',
    source TEXT DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'New',
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    value REAL,
    primary_contact_name TEXT DEFAULT '',
    last_activity_at TEXT,
    last_activity_text TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    title TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    is_primary INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    author_name TEXT DEFAULT 'Someone',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_lead ON contacts(lead_id);
  CREATE INDEX IF NOT EXISTS idx_notes_lead ON notes(lead_id);
`);

// Bootstrap the first admin account so there's a way to log in at all.
const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
if (userCount === 0) {
  const name = process.env.ADMIN_NAME || "Admin";
  const username = (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "change-this-password";
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(
    `INSERT INTO users (id, name, username, password_hash, role, active, created_at)
     VALUES (?, ?, ?, ?, 'admin', 1, ?)`
  ).run(uuid(), name, username, hash, new Date().toISOString());
  // eslint-disable-next-line no-console
  console.log(
    `\nCreated first admin account:\n  username: ${username}\n  password: ${password === "change-this-password" ? "(the ADMIN_PASSWORD you set in .env)" : "(the one you set in .env)"}\n  Please log in and consider changing the password.\n`
  );
}

module.exports = db;
