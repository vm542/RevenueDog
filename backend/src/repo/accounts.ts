import { randomBytes } from 'node:crypto';
import type { DB } from '../db.js';
import { conflict } from '../errors.js';
import { genId, genKey, nowIso } from '../ids.js';

export interface UserRow {
  id: string;
  org_id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export interface SessionRow {
  token: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createUser(db: DB, orgId: string, email: string, passwordHash: string): UserRow {
  const row: UserRow = {
    id: genId('user'),
    org_id: orgId,
    email: email.toLowerCase(),
    password_hash: passwordHash,
    created_at: nowIso(),
  };
  try {
    db.prepare(
      'INSERT INTO users (id, org_id, email, password_hash, created_at) VALUES (@id, @org_id, @email, @password_hash, @created_at)',
    ).run(row);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw conflict('An account with that email already exists.');
    throw err;
  }
  return row;
}

export function getUserByEmail(db: DB, email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
}

export function getUser(db: DB, id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function createSession(db: DB, userId: string): SessionRow {
  const row: SessionRow = {
    token: `sess_${randomBytes(24).toString('hex')}`,
    user_id: userId,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (@token, @user_id, @created_at, @expires_at)',
  ).run(row);
  return row;
}

/** Resolves a non-expired session to its user, or undefined. */
export function getSessionUser(db: DB, token: string): UserRow | undefined {
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as SessionRow | undefined;
  if (!session) return undefined;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return undefined;
  }
  return getUser(db, session.user_id);
}

export function deleteSession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// --- Secret API keys (per project) ---

export interface SecretKeyRow {
  key: string;
  project_id: string | null;
  created_at: string;
}

export function createSecretKey(db: DB, projectId: string): SecretKeyRow {
  const row: SecretKeyRow = { key: genKey('sk'), project_id: projectId, created_at: nowIso() };
  db.prepare('INSERT INTO secret_keys (key, project_id, created_at) VALUES (@key, @project_id, @created_at)').run(row);
  return row;
}

export function listSecretKeys(db: DB, projectId: string): SecretKeyRow[] {
  return db
    .prepare('SELECT key, project_id, created_at FROM secret_keys WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as SecretKeyRow[];
}

export function deleteSecretKey(db: DB, projectId: string, key: string): boolean {
  return db.prepare('DELETE FROM secret_keys WHERE key = ? AND project_id = ?').run(key, projectId).changes > 0;
}
