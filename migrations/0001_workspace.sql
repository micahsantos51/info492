PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('submitter', 'responder', 'checker')),
  project_id TEXT NOT NULL,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS rfis (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES users(id),
  sender_email TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  reference TEXT NOT NULL,
  question TEXT NOT NULL,
  due TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'in_progress', 'reviewed', 'resolved')),
  history_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS rfis_sender_idx ON rfis(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rfis_recipient_idx ON rfis(recipient_email, status);
CREATE INDEX IF NOT EXISTS rfis_checker_idx ON rfis(project_id, status);

CREATE TABLE IF NOT EXISTS rfi_messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  rfi_id TEXT NOT NULL REFERENCES rfis(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  author TEXT NOT NULL,
  email TEXT NOT NULL,
  at TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 5000)
);
CREATE INDEX IF NOT EXISTS rfi_messages_thread_idx ON rfi_messages(rfi_id, at, id);

CREATE TABLE IF NOT EXISTS rfi_attachments (
  rfi_id TEXT NOT NULL REFERENCES rfis(id) ON DELETE CASCADE,
  file_index INTEGER NOT NULL CHECK (file_index BETWEEN 0 AND 2),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('application/pdf', 'image/png', 'image/jpeg')),
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 0 AND 1048576),
  data TEXT NOT NULL CHECK (length(data) <= 1400000),
  PRIMARY KEY (rfi_id, file_index)
);
