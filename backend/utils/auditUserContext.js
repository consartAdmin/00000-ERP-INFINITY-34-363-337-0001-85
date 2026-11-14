// ╔════════════════════════════════════════════════════════════════════╗
// ║ auditUserContext.js — Quem fez a alteração (auditoria no banco)    ║
// ║ Cada request roda num contexto com o usuário do JWT (sem bloquear  ║
// ║ nada: sem token o contexto fica vazio). Ao pegar uma conexão do    ║
// ║ pool, o usuário vai para o PostgreSQL (app.user_id/app.user_name)  ║
// ║ e a trigger audit_row_change() grava em auditLogs quem alterou.    ║
// ║ Fora de request (boot, jobs) o usuário fica vazio.                 ║
// ╚════════════════════════════════════════════════════════════════════╝

import { AsyncLocalStorage } from 'node:async_hooks';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

const store = new AsyncLocalStorage();
const EMPTY = Object.freeze({ userId: null, userName: '' });

function tokenFromReq(req) {
  const authorization = String(req.headers?.authorization || '').trim();
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearer?.[1]) return bearer[1].trim();

  if (req.headers?.['x-access-token']) return String(req.headers['x-access-token']).trim();

  const cookie = String(req.headers?.cookie || '').match(/(?:^|;\s*)token=([^;]+)/);
  if (cookie?.[1]) {
    try { return decodeURIComponent(cookie[1]).trim(); } catch { return cookie[1].trim(); }
  }

  return null;
}

function firstText(values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Usuário do token da request (ou vazio). Nunca lança erro. */
export function auditUserFromReq(req) {
  const token = tokenFromReq(req);
  const secret = process.env.JWT_SECRET;
  if (!token || !secret) return EMPTY;

  try {
    const p = jwt.verify(token, secret) || {};
    const id = Number(p.user_id ?? p.id ?? p.userId ?? p.sub);
    const userId = Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
    const userName = firstText([
      p.name, p.username, p.email,
      p.user?.name, p.user?.username, p.user?.email,
      p.usuario?.nome, p.usuario?.name, p.usuario?.username, p.usuario?.email,
    ]).slice(0, 200);

    return userId || userName ? { userId, userName } : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Usuário da request atual (vazio fora de request). */
export function currentAuditUser() {
  return store.getStore() || EMPTY;
}

/** Roda fn() como se fosse o usuário informado (jobs que agem em nome de alguém). */
export function runWithAuditUser(user, fn) {
  return store.run({ userId: user?.userId ?? null, userName: String(user?.userName || '') }, fn);
}

/** Middleware Express: contexto do usuário da request. */
export function auditUserContext(req, _res, next) {
  store.run(auditUserFromReq(req), next);
}

// Passa o usuário para a conexão só quando ele muda (evita uma ida ao banco por query)
async function applyAuditUser(client, user) {
  const key = `${user.userId ?? ''}|${user.userName || ''}`;
  if ((client.__auditUserKey ?? '|') === key) return;

  await client.query(
    "SELECT set_config('app.user_id', $1, false), set_config('app.user_name', $2, false)",
    [user.userId ? String(user.userId) : '', user.userName || '']
  );
  client.__auditUserKey = key;
}

let installed = false;
let warned = false;

/**
 * Envolve Pool.connect (Pool.query também passa por ele) para que toda
 * conexão entregue à aplicação carregue o usuário da request atual.
 * Uma falha aqui só gera aviso no log: a operação principal segue.
 */
export function installPgAuditUser() {
  if (installed) return;
  installed = true;

  const origConnect = Pool.prototype.connect;

  Pool.prototype.connect = function auditConnect(cb) {
    const user = currentAuditUser();

    const promise = origConnect.call(this).then(async (client) => {
      try {
        await applyAuditUser(client, user);
      } catch (err) {
        client.__auditUserKey = undefined;
        if (!warned) {
          warned = true;
          console.warn('[audit] não foi possível passar o usuário para o PostgreSQL:', err?.message);
        }
      }
      return client;
    });

    if (typeof cb === 'function') {
      promise.then((client) => cb(undefined, client, client.release), (err) => cb(err));
      return undefined;
    }

    return promise;
  };
}
