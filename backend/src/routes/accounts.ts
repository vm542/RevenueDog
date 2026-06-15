import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import { notFound, unauthorized } from '../errors.js';
import { hashPassword, verifyPassword } from '../password.js';
import { parse } from '../validate.js';
import {
  createSecretKey,
  createSession,
  createUser,
  deleteSecretKey,
  deleteSession,
  getSessionUser,
  getUserByEmail,
  listSecretKeys,
  type UserRow,
} from '../repo/accounts.js';
import {
  createOrganization,
  createProject,
  getProjectForOrg,
  listProjectsByOrg,
} from '../repo/projects.js';
import { recordAudit } from '../repo/audit.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the session guard on account (dashboard) routes. */
    user?: UserRow;
  }
}

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  org_name: z.string().min(1).optional(),
  project_name: z.string().min(1).optional(),
});
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const projectSchema = z.object({ name: z.string().min(1) });

function bearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized('Missing Authorization: Bearer <token> header.');
  const token = header.slice('Bearer '.length).trim();
  if (!token) throw unauthorized('Missing session token.');
  return token;
}

export function registerAccountRoutes(app: FastifyInstance, db: DB): void {
  // --- Public: signup / login ---
  app.post('/v1/auth/signup', async (req, reply) => {
    const body = parse(signupSchema, req.body);
    const result = db.transaction(() => {
      const org = createOrganization(db, body.org_name ?? `${body.email.split('@')[0]}'s org`);
      const user = createUser(db, org.id, body.email, hashPassword(body.password));
      const project = createProject(db, org.id, body.project_name ?? 'Default');
      const secret = createSecretKey(db, project.id);
      const session = createSession(db, user.id);
      return { org, user, project, secret, session };
    })();
    recordAudit(db, {
      projectId: result.project.id,
      actor: result.user.email,
      action: 'auth.signup',
      ip: req.ip,
    });
    reply.code(201);
    return {
      token: result.session.token,
      user: { id: result.user.id, email: result.user.email, org_id: result.org.id },
      organization: { id: result.org.id, name: result.org.name },
      project: { id: result.project.id, name: result.project.name },
      // The full secret key is shown exactly once, at creation.
      secret_key: result.secret.plaintext,
    };
  });

  app.post('/v1/auth/login', async (req) => {
    const body = parse(loginSchema, req.body);
    const user = getUserByEmail(db, body.email);
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw unauthorized('Invalid email or password.');
    }
    const session = createSession(db, user.id);
    recordAudit(db, { actor: user.email, action: 'auth.login', ip: req.ip });
    return { token: session.token, user: { id: user.id, email: user.email, org_id: user.org_id } };
  });

  // --- Session-authenticated account routes ---
  app.register(async (scoped) => {
    scoped.addHook('preHandler', async (req) => {
      const user = getSessionUser(db, bearer(req));
      if (!user) throw unauthorized('Invalid or expired session.');
      req.user = user;
    });

    scoped.post('/v1/auth/logout', async (req) => {
      deleteSession(db, bearer(req));
      return { ok: true };
    });

    scoped.get('/v1/auth/me', async (req) => {
      const user = req.user!;
      return {
        user: { id: user.id, email: user.email, org_id: user.org_id },
        projects: listProjectsByOrg(db, user.org_id).map((p) => ({ id: p.id, name: p.name, created_at: p.created_at })),
      };
    });

    scoped.get('/v1/projects', async (req) => ({
      items: listProjectsByOrg(db, req.user!.org_id).map((p) => ({ id: p.id, name: p.name, created_at: p.created_at })),
    }));

    scoped.post('/v1/projects', async (req, reply) => {
      const body = parse(projectSchema, req.body);
      const result = db.transaction(() => {
        const project = createProject(db, req.user!.org_id, body.name);
        const secret = createSecretKey(db, project.id);
        return { project, secret };
      })();
      reply.code(201);
      return {
        id: result.project.id,
        name: result.project.name,
        created_at: result.project.created_at,
        secret_key: result.secret.plaintext,
      };
    });

    // --- API key management (the "check your API key" flow) ---
    scoped.get('/v1/projects/:id/keys', async (req) => {
      const { id } = req.params as { id: string };
      const project = getProjectForOrg(db, req.user!.org_id, id);
      if (!project) throw notFound('No project with that id.');
      return {
        items: listSecretKeys(db, project.id).map((k) => ({
          id: k.id,
          key_prefix: k.key_prefix,
          created_at: k.created_at,
          last_used_at: k.last_used_at,
        })),
      };
    });

    scoped.post('/v1/projects/:id/keys', async (req, reply) => {
      const { id } = req.params as { id: string };
      const project = getProjectForOrg(db, req.user!.org_id, id);
      if (!project) throw notFound('No project with that id.');
      const secret = createSecretKey(db, project.id);
      recordAudit(db, {
        projectId: project.id,
        actor: req.user!.email,
        action: 'key.create',
        target: secret.row.id,
        ip: req.ip,
      });
      reply.code(201);
      // Full key returned once, at creation; thereafter only the prefix is retrievable.
      return { id: secret.row.id, secret_key: secret.plaintext, key_prefix: secret.row.key_prefix, created_at: secret.row.created_at };
    });

    scoped.delete('/v1/projects/:id/keys/:keyId', async (req) => {
      const { id, keyId } = req.params as { id: string; keyId: string };
      const project = getProjectForOrg(db, req.user!.org_id, id);
      if (!project) throw notFound('No project with that id.');
      if (!deleteSecretKey(db, project.id, keyId)) throw notFound('No such key on this project.');
      recordAudit(db, {
        projectId: project.id,
        actor: req.user!.email,
        action: 'key.delete',
        target: keyId,
        ip: req.ip,
      });
      return { ok: true };
    });
  });
}
