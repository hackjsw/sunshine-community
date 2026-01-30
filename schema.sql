DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS memos;
DROP TABLE IF EXISTS settings;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  nickname TEXT,
  role TEXT DEFAULT 'user',
  created_at INTEGER
);

CREATE TABLE memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  content TEXT NOT NULL,
  tags TEXT,
  is_private INTEGER DEFAULT 0,
  created_at INTEGER
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);