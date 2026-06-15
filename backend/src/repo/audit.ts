import type { DB } from '../db.js';
import { genId, nowIso } from '../ids.js';

export interface AuditEntry {
  id: string;
  project_id: string | null;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
  created_at: string;
}

export interface RecordAuditInput {
  projectId?: string | null;
  actor: string;
  action: string;
  target?: string | null;
  ip?: string | null;
}

/** Appends an audit entry for a security-relevant action. Best-effort; never throws into the caller. */
export function recordAudit(db: DB, input: RecordAuditInput): void {
  try {
    db.prepare(
      `INSERT INTO audit_log (id, project_id, actor, action, target, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      genId('aud'),
      input.projectId ?? null,
      input.actor,
      input.action,
      input.target ?? null,
      input.ip ?? null,
      nowIso(),
    );
  } catch {
    // auditing must never break the operation it records
  }
}

export function listAudit(db: DB, projectId: string, limit = 100): AuditEntry[] {
  return db
    .prepare('SELECT * FROM audit_log WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit) as AuditEntry[];
}
