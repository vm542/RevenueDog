import { randomBytes } from 'node:crypto';
import type { DB } from '../db.js';
import { conflict } from '../errors.js';
import { genId, genKey, nowIso } from '../ids.js';
import { hashApiKey, keyPrefix } from '../keys.js';

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

// --- Secret API keys (per project), hashed at rest ---

export interface SecretKeyRow {
  id: string;
  key_prefix: string;
  project_id: string | null;
  created_at: string;
  last_used_at: string | null;
}

/** Creates a secret key, persisting only its hash + prefix. The plaintext is returned once. */
export function createSecretKey(db: DB, projectId: string): { row: SecretKeyRow; plaintext: string } {
  const plaintext = genKey('sk');
  const row: SecretKeyRow = {
    id: genId('key'),
    key_prefix: keyPrefix(plaintext),
    project_id: projectId,
    created_at: nowIso(),
    last_used_at: null,
  };
  db.prepare(
    `INSERT INTO secret_keys (id, key_hash, key_prefix, project_id, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(row.id, hashApiKey(plaintext), row.key_prefix, projectId, row.created_at);
  return { row, plaintext };
}

export function listSecretKeys(db: DB, projectId: string): SecretKeyRow[] {
  return db
    .prepare(
      'SELECT id, key_prefix, project_id, created_at, last_used_at FROM secret_keys WHERE project_id = ? ORDER BY created_at ASC',
    )
    .all(projectId) as SecretKeyRow[];
}

export function deleteSecretKey(db: DB, projectId: string, id: string): boolean {
  return db.prepare('DELETE FROM secret_keys WHERE id = ? AND project_id = ?').run(id, projectId).changes > 0;
}

/** Resolves a presented secret key by hash to its project, and stamps last_used_at. */
export function resolveSecretKey(db: DB, key: string): { id: string; project_id: string | null } | undefined {
  const row = db
    .prepare('SELECT id, project_id FROM secret_keys WHERE key_hash = ?')
    .get(hashApiKey(key)) as { id: string; project_id: string | null } | undefined;
  if (row) db.prepare('UPDATE secret_keys SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
  return row;
}

/** Inserts a pre-generated key's hash (used by the root-key bootstrap). */
export function insertSecretKeyHash(db: DB, plaintext: string, projectId: string): void {
  db.prepare(
    `INSERT INTO secret_keys (id, key_hash, key_prefix, project_id, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(genId('key'), hashApiKey(plaintext), keyPrefix(plaintext), projectId, nowIso());
}
