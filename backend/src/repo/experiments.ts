import type { DB } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { genId, nowIso } from '../ids.js';

export type ExperimentStatus = 'draft' | 'running' | 'stopped';
export type Variant = 'control' | 'treatment';

export interface ExperimentRow {
  id: string;
  name: string;
  status: ExperimentStatus;
  control_offering_id: string;
  treatment_offering_id: string;
  traffic_pct: number;
  created_at: string;
}

export interface CreateExperimentInput {
  name: string;
  status?: ExperimentStatus;
  control_offering_id: string;
  treatment_offering_id: string;
  traffic_pct: number;
}

export function createExperiment(db: DB, input: CreateExperimentInput): ExperimentRow {
  for (const offId of [input.control_offering_id, input.treatment_offering_id]) {
    if (!db.prepare('SELECT id FROM offerings WHERE id = ?').get(offId)) {
      throw notFound(`No offering with id "${offId}".`);
    }
  }
  const row: ExperimentRow = {
    id: genId('exp'),
    name: input.name,
    status: input.status ?? 'draft',
    control_offering_id: input.control_offering_id,
    treatment_offering_id: input.treatment_offering_id,
    traffic_pct: input.traffic_pct,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO experiments (id, name, status, control_offering_id, treatment_offering_id, traffic_pct, created_at)
     VALUES (@id, @name, @status, @control_offering_id, @treatment_offering_id, @traffic_pct, @created_at)`,
  ).run(row);
  return row;
}

export function listExperiments(db: DB): ExperimentRow[] {
  return db.prepare('SELECT * FROM experiments ORDER BY created_at DESC').all() as ExperimentRow[];
}

export function getExperiment(db: DB, id: string): ExperimentRow | undefined {
  return db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as ExperimentRow | undefined;
}

export function getRunningExperiment(db: DB): ExperimentRow | undefined {
  return db.prepare("SELECT * FROM experiments WHERE status = 'running' ORDER BY created_at ASC LIMIT 1").get() as
    | ExperimentRow
    | undefined;
}

export function updateExperiment(db: DB, id: string, patch: Partial<CreateExperimentInput>): ExperimentRow {
  const existing = getExperiment(db, id);
  if (!existing) throw notFound('No experiment with that id.');
  const next: ExperimentRow = {
    ...existing,
    name: patch.name ?? existing.name,
    status: patch.status ?? existing.status,
    control_offering_id: patch.control_offering_id ?? existing.control_offering_id,
    treatment_offering_id: patch.treatment_offering_id ?? existing.treatment_offering_id,
    traffic_pct: patch.traffic_pct ?? existing.traffic_pct,
  };
  db.prepare(
    `UPDATE experiments SET name=@name, status=@status, control_offering_id=@control_offering_id,
      treatment_offering_id=@treatment_offering_id, traffic_pct=@traffic_pct WHERE id=@id`,
  ).run(next);
  return next;
}

export function stopExperiment(db: DB, id: string): ExperimentRow {
  const existing = getExperiment(db, id);
  if (!existing) throw notFound('No experiment with that id.');
  db.prepare("UPDATE experiments SET status = 'stopped' WHERE id = ?").run(id);
  return { ...existing, status: 'stopped' };
}

export function deleteExperiment(db: DB, id: string): boolean {
  return db.prepare('DELETE FROM experiments WHERE id = ?').run(id).changes > 0;
}

export function getEnrollment(
  db: DB,
  experimentId: string,
  subscriberId: string,
): { variant: Variant } | undefined {
  return db
    .prepare('SELECT variant FROM experiment_enrollments WHERE experiment_id = ? AND subscriber_id = ?')
    .get(experimentId, subscriberId) as { variant: Variant } | undefined;
}

export function enroll(db: DB, experimentId: string, subscriberId: string, variant: Variant): void {
  try {
    db.prepare(
      'INSERT INTO experiment_enrollments (experiment_id, subscriber_id, variant, enrolled_at) VALUES (?, ?, ?, ?)',
    ).run(experimentId, subscriberId, variant, nowIso());
  } catch (err) {
    if (!String(err).includes('UNIQUE')) throw err;
  }
}

export interface VariantResult {
  enrolled: number;
  purchases: number;
  revenue: number;
}

export function experimentResults(db: DB, experimentId: string): { control: VariantResult; treatment: VariantResult } {
  const exp = getExperiment(db, experimentId);
  if (!exp) throw conflict('No experiment with that id.');
  const result = (variant: Variant): VariantResult => {
    const enrolled = (
      db
        .prepare('SELECT COUNT(*) AS c FROM experiment_enrollments WHERE experiment_id = ? AND variant = ?')
        .get(experimentId, variant) as { c: number }
    ).c;
    const purchases = db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(r.price), 0) AS revenue
         FROM receipts r
         JOIN experiment_enrollments e ON e.subscriber_id = r.subscriber_id
         WHERE e.experiment_id = ? AND e.variant = ?`,
      )
      .get(experimentId, variant) as { c: number; revenue: number };
    return { enrolled, purchases: purchases.c, revenue: Number(purchases.revenue ?? 0) };
  };
  return { control: result('control'), treatment: result('treatment') };
}
